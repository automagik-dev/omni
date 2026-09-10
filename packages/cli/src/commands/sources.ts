/**
 * Sources Commands — omni sources add <provider> (issue #1074)
 *
 * One command for the manual ritual in docs/runbooks/github-webhook-source.md:
 *   1. create/update the webhook source (signature alg/header/prefix + secret)
 *   2. set the idempotency key template
 *   3. set the event-type mapping
 *   4. register the provider's bundled event schemas
 *   5. create/update the webhook on the provider side (optional)
 *
 * Every step is an existing surface (`omni webhooks create|update`,
 * `omni events schema register`, provider REST API) — nothing is reimplemented.
 * Idempotent: re-running finds the source by name and PATCHes; the provider
 * webhook is matched by payload URL. A failure in step N reports steps 1..N-1
 * as done so the operator can resume.
 *
 * A second provider is a new entry in PRESETS, not a new command.
 */

import { randomBytes } from 'node:crypto';
import type { OmniClient, WebhookEventTypeMappingBody, WebhookSignatureConfigBody } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { loadConfig } from '../config.js';
import * as output from '../output.js';
import { schemaApiRequest } from './events.js';
import githubIssues from './sources/github/custom.github.issues.json' with { type: 'json' };
import githubPullRequest from './sources/github/custom.github.pull_request.json' with { type: 'json' };
import githubPush from './sources/github/custom.github.push.json' with { type: 'json' };
import githubRelease from './sources/github/custom.github.release.json' with { type: 'json' };
import { resolveSignatureSecret } from './webhooks.js';

// ============================================================================
// PRESETS
// ============================================================================

/** JSON-over-HTTP call against the provider's API (mocked in tests). */
export type ProviderApi = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => Promise<unknown>;

export interface SourcePreset {
  /** Source name — also the ingress path segment: /api/v2/webhooks/ingress/{name}. */
  name: string;
  description: string;
  signatureConfig: WebhookSignatureConfigBody;
  idempotencyKeyTemplate: string;
  eventTypeMapping: WebhookEventTypeMappingBody;
  expectedIntervalSeconds: number;
  /** Provider event name → bundled JSON Schema (registered as custom.{name}.{event}). */
  schemas: Record<string, Record<string, unknown>>;
  /** Create-or-update the webhook on the provider side; returns the provider's hook id. */
  ensureProviderWebhook(
    api: ProviderApi,
    target: string,
    hook: { url: string; secret: string; events: string[] },
  ): Promise<string>;
}

interface GithubHook {
  id: number;
  config?: { url?: string };
}

const github: SourcePreset = {
  name: 'github',
  description: 'GitHub repo webhooks (RFC #925 Phase 3 recipe)',
  signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256', prefix: 'sha256=' },
  idempotencyKeyTemplate: 'github:{headers.x-github-delivery}',
  eventTypeMapping: { source: 'header', header: 'X-GitHub-Event' },
  expectedIntervalSeconds: 86400,
  schemas: { push: githubPush, pull_request: githubPullRequest, issues: githubIssues, release: githubRelease },
  async ensureProviderWebhook(api, repo, hook) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`--repo must be OWNER/NAME, got '${repo}'`);
    const body = {
      active: true,
      events: hook.events,
      config: { url: hook.url, content_type: 'json', secret: hook.secret, insecure_ssl: '0' },
    };
    const existing = (await api('GET', `/repos/${repo}/hooks`)) as GithubHook[];
    const match = existing.find((h) => h.config?.url === hook.url);
    if (match) {
      await api('PATCH', `/repos/${repo}/hooks/${match.id}`, body);
      return String(match.id);
    }
    const created = (await api('POST', `/repos/${repo}/hooks`, { name: 'web', ...body })) as GithubHook;
    return String(created.id);
  },
};

export const PRESETS: Record<string, SourcePreset> = { github };

// ============================================================================
// PROVIDER API TRANSPORT — gh CLI if present, else GITHUB_TOKEN via REST
// ============================================================================

const GITHUB_API = 'https://api.github.com';

async function ghAvailable(): Promise<boolean> {
  try {
    return (await Bun.spawn({ cmd: ['gh', 'auth', 'status'], stdout: 'ignore', stderr: 'ignore' }).exited) === 0;
  } catch {
    return false;
  }
}

async function githubApiViaGh(method: string, path: string, body?: unknown): Promise<unknown> {
  const cmd = ['gh', 'api', '--method', method, path];
  if (body !== undefined) cmd.push('--input', '-');
  const proc = Bun.spawn({ cmd, stdin: body === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' });
  if (body !== undefined && proc.stdin) {
    proc.stdin.write(JSON.stringify(body));
    proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh api ${method} ${path} failed: ${stderr.trim() || stdout.trim()}`);
  return stdout.trim() ? JSON.parse(stdout) : undefined;
}

function githubApiViaToken(token: string): ProviderApi {
  return async (method, path, body) => {
    const resp = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`GitHub API ${method} ${path} returned ${resp.status}: ${await resp.text()}`);
    return resp.status === 204 ? undefined : await resp.json();
  };
}

/** Pick the GitHub transport: gh CLI (logged in) first, then GITHUB_TOKEN. */
async function resolveGithubApi(): Promise<ProviderApi> {
  if (await ghAvailable()) return githubApiViaGh;
  const token = process.env.GITHUB_TOKEN;
  if (token) return githubApiViaToken(token);
  throw new Error(
    'no GitHub credentials: log in with `gh auth login` or set GITHUB_TOKEN (or pass --no-provider-webhook)',
  );
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

export interface AddSourceInput {
  preset: SourcePreset;
  /** Provider-side target, e.g. OWNER/NAME for GitHub. */
  target: string;
  /** Provider event names; must be a subset of preset.schemas. */
  events: string[];
  secret: string;
  /** Omni base URL reachable from the provider. */
  publicUrl: string;
  providerWebhook: boolean;
  client: Pick<OmniClient['webhooks'], 'listSources' | 'createSource' | 'updateSource'>;
  registerSchema: (eventType: string, schema: Record<string, unknown>, description: string) => Promise<unknown>;
  providerApi: () => Promise<ProviderApi>;
}

export interface AddSourceResult {
  sourceId: string;
  created: boolean;
  webhookUrl: string;
  providerHookId?: string;
  completed: string[];
}

export class StepFailure extends Error {
  constructor(
    readonly step: string,
    readonly completed: string[],
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export const STEPS = ['source', 'idempotency', 'event-type-mapping', 'schemas', 'provider-webhook'] as const;

export async function addSource(input: AddSourceInput): Promise<AddSourceResult> {
  const { preset, client } = input;
  const unknown = input.events.filter((e) => !(e in preset.schemas));
  if (unknown.length > 0) {
    throw new Error(
      `unknown ${preset.name} events: ${unknown.join(', ')} (known: ${Object.keys(preset.schemas).join(', ')})`,
    );
  }
  const webhookUrl = `${input.publicUrl.replace(/\/+$/, '')}/api/v2/webhooks/ingress/${preset.name}`;
  const completed: string[] = [];
  const run = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    try {
      const value = await fn();
      completed.push(step);
      return value;
    } catch (err) {
      throw new StepFailure(step, completed, err);
    }
  };

  // 1. source (find-or-create by name; signature config + secret)
  const source = await run(STEPS[0], async () => {
    const existing = (await client.listSources()).find((s) => s.name === preset.name);
    const body = {
      description: preset.description,
      signatureConfig: preset.signatureConfig,
      signatureSecret: input.secret,
      expectedIntervalSeconds: preset.expectedIntervalSeconds,
    };
    if (existing) return { id: (await client.updateSource(existing.id, body)).id, created: false };
    return { id: (await client.createSource({ name: preset.name, enabled: true, ...body })).id, created: true };
  });
  // 2. idempotency key template
  await run(STEPS[1], () => client.updateSource(source.id, { idempotencyKeyTemplate: preset.idempotencyKeyTemplate }));
  // 3. event-type mapping
  await run(STEPS[2], () => client.updateSource(source.id, { eventTypeMapping: preset.eventTypeMapping }));
  // 4. schemas (byte-identical re-registration is a no-op on the API side)
  await run(STEPS[3], async () => {
    for (const event of input.events) {
      const eventType = `custom.${preset.name}.${event}`;
      await input.registerSchema(eventType, preset.schemas[event], `${preset.name} ${event} deliveries`);
    }
  });
  // 5. provider webhook
  let providerHookId: string | undefined;
  if (input.providerWebhook) {
    providerHookId = await run(STEPS[4], async () =>
      preset.ensureProviderWebhook(await input.providerApi(), input.target, {
        url: webhookUrl,
        secret: input.secret,
        events: input.events,
      }),
    );
  }
  return { sourceId: source.id, created: source.created, webhookUrl, providerHookId, completed };
}

// ============================================================================
// COMMAND
// ============================================================================

export function createSourcesCommand(): Command {
  const sources = new Command('sources').description('One-command onboarding of external webhook sources');

  sources
    .command('add <provider>')
    .description(`Create or update a provider source end to end (presets: ${Object.keys(PRESETS).join(', ')})`)
    .requiredOption('--repo <owner/name>', 'Provider-side target (GitHub: OWNER/NAME)')
    .option('--events <list>', 'Comma-separated provider events (default: every bundled schema)')
    .option('--public-url <url>', 'Omni URL reachable from the provider (default: configured apiUrl)')
    .option('--secret-env <VAR>', 'Reuse the webhook secret from environment variable VAR instead of generating one')
    .option('--no-provider-webhook', 'Skip creating the webhook on the provider side')
    .action(
      async (
        provider: string,
        options: { repo: string; events?: string; publicUrl?: string; secretEnv?: string; providerWebhook: boolean },
      ) => {
        const preset = PRESETS[provider];
        if (!preset) output.error(`Unknown provider '${provider}'. Presets: ${Object.keys(PRESETS).join(', ')}`);
        const client = getClient();
        try {
          const secret =
            (await resolveSignatureSecret({ signatureSecretEnv: options.secretEnv })) ??
            randomBytes(32).toString('hex');
          const result = await addSource({
            preset,
            target: options.repo,
            events: options.events ? options.events.split(',').map((e) => e.trim()) : Object.keys(preset.schemas),
            secret,
            publicUrl: options.publicUrl ?? loadConfig().apiUrl ?? 'http://localhost:8882',
            providerWebhook: options.providerWebhook,
            client: client.webhooks,
            registerSchema: (eventType, schema, description) =>
              schemaApiRequest('', { method: 'POST', body: JSON.stringify({ eventType, schema, description }) }),
            providerApi: resolveGithubApi,
          });
          output.success(`Source ${result.created ? 'created' : 'updated'}: ${result.sourceId}`, {
            id: result.sourceId,
            name: preset.name,
            secret,
            webhookUrl: result.webhookUrl,
            providerHookId: result.providerHookId ?? '(skipped)',
            steps: result.completed.join(', '),
          });
          output.warn('The secret is shown once; store it now (re-run with --secret-env VAR to reuse it).');
        } catch (err) {
          if (err instanceof StepFailure) {
            const remaining = STEPS.filter((s) => !err.completed.includes(s));
            output.error(`Step '${err.step}' failed: ${err.message}`, {
              completed: err.completed,
              remaining,
              resume: 're-run the same command; completed steps are updated in place, not duplicated',
            });
          }
          output.error(`Failed to add source: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    );

  return sources;
}
