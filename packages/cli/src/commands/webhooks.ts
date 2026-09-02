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

          const source = await client.webhooks.createSource({
            name: options.name,
            description: options.description,
            enabled: !options.disabled,
            expectedHeaders,
            signatureConfig,
            signatureSecret,
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
          } = {};
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

  return webhooks;
}

/** Test-only surface — not part of the CLI contract. */
export const __testables = { resolveSignatureSecret, buildSignatureConfig };
