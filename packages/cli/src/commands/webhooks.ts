/**
 * Webhooks Commands
 *
 * omni webhooks list [--enabled]
 * omni webhooks get <id>
 * omni webhooks create --name <name> [--description <desc>]
 * omni webhooks update <id> [--name <name>] [--enabled]
 * omni webhooks delete <id>
 * omni webhooks trigger --type <event-type> --payload <json> [--instance <id>]
 *
 * The signature secret can come from argv (`--signature-secret`, visible in
 * shell history and `ps`), an environment variable (`--signature-secret-env`),
 * or stdin (`--signature-secret-stdin`, for `pass show ... | omni webhooks ...`).
 */

import type { WebhookSignatureConfigBody } from '@omni/sdk';
import { Command } from 'commander';
import { z } from 'zod';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveWebhookId } from '../resolve.js';

const SIGNATURE_ALGORITHMS = ['hmac-sha256', 'hmac-sha1', 'token-match'] as const;

/** Same bounds the API enforces on `signatureSecret` (schemas/openapi/webhooks.ts). */
const signatureSecretSchema = z.string().min(8, 'at least 8 characters').max(512, 'at most 512 characters');

const SECRET_SOURCE_FLAGS = '--signature-secret, --signature-secret-env, --signature-secret-stdin';

interface SignatureSecretOptions {
  signatureSecret?: string;
  signatureSecretEnv?: string;
  signatureSecretStdin?: boolean;
}

/** Read all of stdin as UTF-8 (raw; the caller strips the trailing newline). */
async function readSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('--signature-secret-stdin requires piped stdin (e.g. `printf %s "$SECRET" | omni webhooks ...`)');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Resolve the signature secret from exactly one of the three sources, or
 * undefined when none is given. Throws (caught by the command's error path)
 * on conflicting flags, a missing/empty env var, empty stdin, or a value
 * outside the API's bounds — the CLI fails before any request is sent.
 */
async function resolveSignatureSecret(
  options: SignatureSecretOptions,
  readStdin: () => Promise<string> = readSecretFromStdin,
): Promise<string | undefined> {
  const sources = [
    options.signatureSecret !== undefined,
    options.signatureSecretEnv !== undefined,
    options.signatureSecretStdin === true,
  ].filter(Boolean).length;
  if (sources === 0) return undefined;
  if (sources > 1) {
    throw new Error(`Use only one of ${SECRET_SOURCE_FLAGS}`);
  }

  let raw: string | undefined;
  let origin: string;
  if (options.signatureSecretEnv !== undefined) {
    const name = options.signatureSecretEnv;
    if (!name) throw new Error('--signature-secret-env requires a variable name');
    raw = process.env[name];
    origin = `environment variable ${name}`;
    if (raw === undefined || raw === '') {
      throw new Error(`${origin} is not set or empty`);
    }
  } else if (options.signatureSecretStdin) {
    // Strip exactly one trailing line break — `echo`/`pass show` append one.
    raw = (await readStdin()).replace(/\r?\n$/, '');
    origin = 'stdin';
    if (!raw) throw new Error('no secret received on stdin');
  } else {
    raw = options.signatureSecret;
    origin = '--signature-secret';
  }

  const parsed = signatureSecretSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid signature secret from ${origin}: ${reason}`);
  }
  return parsed.data;
}

/** Assemble a signatureConfig from the --signature-* flags, or undefined when none given. */
function buildSignatureConfig(options: {
  signatureAlgorithm?: string;
  signatureHeader?: string;
  signaturePrefix?: string;
}): WebhookSignatureConfigBody | undefined {
  const { signatureAlgorithm, signatureHeader, signaturePrefix } = options;
  if (!signatureAlgorithm && !signatureHeader && !signaturePrefix) return undefined;
  if (!signatureAlgorithm || !signatureHeader) {
    output.error('--signature-algorithm and --signature-header must be provided together');
  }
  const algorithm = SIGNATURE_ALGORITHMS.find((a) => a === signatureAlgorithm);
  if (!algorithm) {
    output.error(`Invalid --signature-algorithm; expected one of: ${SIGNATURE_ALGORITHMS.join(', ')}`);
  }
  if (algorithm === 'token-match' && signaturePrefix) {
    output.error('--signature-prefix is not applicable to token-match (the header carries the secret verbatim)');
  }
  return { algorithm, header: signatureHeader, prefix: signaturePrefix };
}

/**
 * Create-only pairing: the API rejects a `signatureConfig` without a secret
 * and a secret without a config (CreateWebhookSourceSchema). Fail here, before
 * the request, the same way the secret bounds do. Update is deliberately not
 * covered — a secret-only update rotates the secret against the stored config.
 */
function assertPairedSignatureOnCreate(
  signatureConfig: WebhookSignatureConfigBody | undefined,
  signatureSecret: string | undefined,
): void {
  if ((signatureConfig === undefined) === (signatureSecret === undefined)) return;
  if (signatureConfig === undefined) {
    throw new Error(
      `a signature secret (${SECRET_SOURCE_FLAGS}) requires --signature-algorithm and --signature-header`,
    );
  }
  throw new Error(`--signature-algorithm and --signature-header require a signature secret (${SECRET_SOURCE_FLAGS})`);
}

// Connector lifecycle contract (#961) — declared semantics values, mirroring
// the API's enums (schemas/openapi/webhooks.ts).
const WINDOW_SEMANTICS = ['future_only', 'includes_in_progress'] as const;
const MUTATION_POLICIES = ['same_id', 'new_id'] as const;

/** Positive integer seconds, or undefined when the flag was not given. */
function parseExpectedInterval(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 1) {
    output.error('--expected-interval must be a positive integer number of seconds');
  }
  return seconds;
}

function parseWindowSemantics(raw: string | undefined): (typeof WINDOW_SEMANTICS)[number] | undefined {
  if (raw === undefined) return undefined;
  const value = WINDOW_SEMANTICS.find((v) => v === raw);
  if (!value) {
    output.error(`Invalid --window-semantics; expected one of: ${WINDOW_SEMANTICS.join(', ')}`);
  }
  return value;
}

function parseMutationPolicy(raw: string | undefined): (typeof MUTATION_POLICIES)[number] | undefined {
  if (raw === undefined) return undefined;
  const value = MUTATION_POLICIES.find((v) => v === raw);
  if (!value) {
    output.error(`Invalid --mutation-policy; expected one of: ${MUTATION_POLICIES.join(', ')}`);
  }
  return value;
}

/** The lifecycle-contract portion of a source update, from the (#961) flags. */
function buildLifecycleUpdates(options: {
  expectedInterval?: string;
  clearCadence?: boolean;
  windowSemantics?: string;
  mutationPolicy?: string;
}): {
  expectedIntervalSeconds?: number | null;
  windowSemantics?: (typeof WINDOW_SEMANTICS)[number];
  mutationPolicy?: (typeof MUTATION_POLICIES)[number];
} {
  if (options.clearCadence && options.expectedInterval !== undefined) {
    output.error('Use only one of --expected-interval and --clear-cadence');
  }
  const updates: ReturnType<typeof buildLifecycleUpdates> = {};
  if (options.clearCadence) updates.expectedIntervalSeconds = null;
  const expectedIntervalSeconds = parseExpectedInterval(options.expectedInterval);
  if (expectedIntervalSeconds !== undefined) updates.expectedIntervalSeconds = expectedIntervalSeconds;
  const windowSemantics = parseWindowSemantics(options.windowSemantics);
  if (windowSemantics !== undefined) updates.windowSemantics = windowSemantics;
  const mutationPolicy = parseMutationPolicy(options.mutationPolicy);
  if (mutationPolicy !== undefined) updates.mutationPolicy = mutationPolicy;
  return updates;
}

export function createWebhooksCommand(): Command {
  const webhooks = new Command('webhooks').description('Manage webhook sources');

  // omni webhooks list
  webhooks
    .command('list')
    .description('List webhook sources')
    .option('--enabled', 'Show only enabled sources')
    .option('--disabled', 'Show only disabled sources')
    .action(async (options: { enabled?: boolean; disabled?: boolean }) => {
      const client = getClient();

      try {
        let enabledFilter: boolean | undefined;
        if (options.enabled) enabledFilter = true;
        if (options.disabled) enabledFilter = false;

        const result = await client.webhooks.listSources({
          enabled: enabledFilter,
        });

        const items = result.map((w) => ({
          id: w.id,
          name: w.name,
          enabled: w.enabled ? 'yes' : 'no',
          // Liveness (#961): '-' = unsupervised (no declared cadence).
          health: w.livenessStatus ?? '-',
          cadence: w.expectedIntervalSeconds != null ? `${w.expectedIntervalSeconds}s` : '-',
          createdAt: w.createdAt,
        }));

        output.list(items, { emptyMessage: 'No webhook sources found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list webhook sources: ${message}`);
      }
    });

  // omni webhooks get <id>
  webhooks
    .command('get <id>')
    .description('Get webhook source details')
    .action(async (id: string) => {
      const resolvedId = await resolveWebhookId(id);
      const client = getClient();

      try {
        const source = await client.webhooks.getSource(resolvedId);
        output.data(source);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get webhook source: ${message}`);
      }
    });

  // omni webhooks create
  webhooks
    .command('create')
    .description('Create a webhook source')
    .requiredOption('--name <name>', 'Webhook source name')
    .option('--description <desc>', 'Description')
    .option('--disabled', 'Create in disabled state')
    .option('--headers <json>', 'Expected headers as JSON (e.g., \'{"X-Secret": true}\')')
    .option('--signature-algorithm <alg>', 'Signature verification: hmac-sha256, hmac-sha1, or token-match')
    .option('--signature-header <name>', 'Header carrying the signature/token (e.g., X-Hub-Signature-256)')
    .option('--signature-prefix <prefix>', "Prefix before the hex digest (e.g., 'sha256=')")
    .option(
      '--signature-secret <secret>',
      'Shared secret for signature verification (write-only). Visible in shell history and process lists — prefer --signature-secret-env or --signature-secret-stdin',
    )
    .option('--signature-secret-env <VAR>', 'Read the shared secret from environment variable VAR')
    .option('--signature-secret-stdin', 'Read the shared secret from stdin (trailing newline stripped)')
    .option(
      '--expected-interval <seconds>',
      'Declared cadence: >=1 event or heartbeat per N seconds. Arms liveness supervision (#961)',
    )
    .option('--window-semantics <value>', `Declared window semantics: ${WINDOW_SEMANTICS.join(' or ')}`)
    .option('--mutation-policy <value>', `Declared mutation re-emit policy: ${MUTATION_POLICIES.join(' or ')}`)
    .action(
      async (options: {
        name: string;
        description?: string;
        disabled?: boolean;
        headers?: string;
        signatureAlgorithm?: string;
        signatureHeader?: string;
        signaturePrefix?: string;
        signatureSecret?: string;
        signatureSecretEnv?: string;
        signatureSecretStdin?: boolean;
        expectedInterval?: string;
        windowSemantics?: string;
        mutationPolicy?: string;
      }) => {
        const client = getClient();

        try {
          let expectedHeaders: Record<string, boolean> | undefined;
          if (options.headers) {
            try {
              expectedHeaders = JSON.parse(options.headers);
            } catch {
              output.error('Invalid JSON for --headers');
            }
          }

          const signatureConfig = buildSignatureConfig(options);
          const signatureSecret = await resolveSignatureSecret(options);
          assertPairedSignatureOnCreate(signatureConfig, signatureSecret);

          const source = await client.webhooks.createSource({
            name: options.name,
            description: options.description,
            enabled: !options.disabled,
            expectedHeaders,
            signatureConfig,
            signatureSecret,
            expectedIntervalSeconds: parseExpectedInterval(options.expectedInterval),
            windowSemantics: parseWindowSemantics(options.windowSemantics),
            mutationPolicy: parseMutationPolicy(options.mutationPolicy),
          });

          const details: Record<string, unknown> = {
            id: source.id,
            name: source.name,
            // Both receivers key on the source NAME, not the id
            url: `POST /api/v2/webhooks/${source.name}`,
          };
          if (signatureConfig) {
            details.publicUrl = `POST /api/v2/webhooks/ingress/${source.name}`;
          }
          output.success(`Webhook source created: ${source.id}`, details);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to create webhook source: ${message}`);
        }
      },
    );

  // omni webhooks update <id>
  webhooks
    .command('update <id>')
    .description('Update a webhook source')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--enable', 'Enable the webhook')
    .option('--disable', 'Disable the webhook')
    .option('--signature-algorithm <alg>', 'Signature verification: hmac-sha256, hmac-sha1, or token-match')
    .option('--signature-header <name>', 'Header carrying the signature/token (e.g., X-Hub-Signature-256)')
    .option('--signature-prefix <prefix>', "Prefix before the hex digest (e.g., 'sha256=')")
    .option(
      '--signature-secret <secret>',
      'Shared secret for signature verification (write-only). Visible in shell history and process lists — prefer --signature-secret-env or --signature-secret-stdin',
    )
    .option('--signature-secret-env <VAR>', 'Read the shared secret from environment variable VAR')
    .option('--signature-secret-stdin', 'Read the shared secret from stdin (trailing newline stripped)')
    .option('--clear-signature', 'Remove the signature config and stored secret')
    .option(
      '--expected-interval <seconds>',
      'Declared cadence: >=1 event or heartbeat per N seconds. (Re)arms liveness supervision (#961)',
    )
    .option('--clear-cadence', 'Remove the declared cadence (disarms liveness supervision)')
    .option('--window-semantics <value>', `Declared window semantics: ${WINDOW_SEMANTICS.join(' or ')}`)
    .option('--mutation-policy <value>', `Declared mutation re-emit policy: ${MUTATION_POLICIES.join(' or ')}`)
    .action(
      async (
        id: string,
        options: {
          name?: string;
          description?: string;
          enable?: boolean;
          disable?: boolean;
          signatureAlgorithm?: string;
          signatureHeader?: string;
          signaturePrefix?: string;
          signatureSecret?: string;
          signatureSecretEnv?: string;
          signatureSecretStdin?: boolean;
          clearSignature?: boolean;
          expectedInterval?: string;
          clearCadence?: boolean;
          windowSemantics?: string;
          mutationPolicy?: string;
        },
      ) => {
        const resolvedId = await resolveWebhookId(id);
        const client = getClient();

        try {
          const updates: {
            name?: string;
            description?: string;
            enabled?: boolean;
            signatureConfig?: WebhookSignatureConfigBody | null;
            signatureSecret?: string;
            expectedIntervalSeconds?: number | null;
            windowSemantics?: (typeof WINDOW_SEMANTICS)[number];
            mutationPolicy?: (typeof MUTATION_POLICIES)[number];
          } = buildLifecycleUpdates(options);
          if (options.name) updates.name = options.name;
          if (options.description) updates.description = options.description;
          if (options.enable) updates.enabled = true;
          if (options.disable) updates.enabled = false;
          if (options.clearSignature) {
            updates.signatureConfig = null;
          } else {
            const signatureConfig = buildSignatureConfig(options);
            if (signatureConfig) updates.signatureConfig = signatureConfig;
            const signatureSecret = await resolveSignatureSecret(options);
            if (signatureSecret) updates.signatureSecret = signatureSecret;
          }

          const source = await client.webhooks.updateSource(resolvedId, updates);
          output.success(`Webhook source updated: ${source.id}`, {
            id: source.id,
            name: source.name,
            enabled: source.enabled,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to update webhook source: ${message}`);
        }
      },
    );

  // omni webhooks delete <id>
  webhooks
    .command('delete <id>')
    .description('Delete a webhook source')
    .action(async (id: string) => {
      const resolvedId = await resolveWebhookId(id);
      const client = getClient();

      try {
        await client.webhooks.deleteSource(resolvedId);
        output.success(`Webhook source deleted: ${resolvedId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete webhook source: ${message}`);
      }
    });

  // omni webhooks trigger
  webhooks
    .command('trigger')
    .description('Trigger a custom event')
    .requiredOption('--type <type>', 'Event type')
    .requiredOption('--payload <json>', 'Event payload as JSON')
    .option('--instance <id>', 'Instance ID')
    .option('--correlation-id <id>', 'Correlation ID')
    .action(async (options: { type: string; payload: string; instance?: string; correlationId?: string }) => {
      const client = getClient();

      try {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(options.payload);
        } catch {
          output.error('Invalid JSON for --payload');
          return;
        }

        const result = await client.webhooks.trigger({
          eventType: options.type,
          payload,
          instanceId: options.instance,
          correlationId: options.correlationId,
        });

        output.success(`Event triggered: ${result.eventId}`, {
          eventId: result.eventId,
          eventType: result.eventType,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to trigger event: ${message}`);
      }
    });

  // omni webhooks heartbeat <source-name>
  webhooks
    .command('heartbeat <source>')
    .description('Record a connector heartbeat ("ran, zero events found") — resets the liveness window (#961)')
    .action(async (source: string) => {
      const client = getClient();

      try {
        // Keyed on the source NAME (like the receiver URL), not the id.
        const result = await client.webhooks.heartbeat(source);
        output.success(`Heartbeat recorded for '${result.source}'`, {
          heartbeatAt: result.heartbeatAt,
          livenessStatus: result.livenessStatus ?? 'unsupervised',
          expectedIntervalSeconds: result.expectedIntervalSeconds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to record heartbeat: ${message}`);
      }
    });

  return webhooks;
}

/** Test-only surface — not part of the CLI contract. */
export const __testables = { resolveSignatureSecret, buildSignatureConfig, assertPairedSignatureOnCreate };
