/**
 * Slack-only commands (#889)
 *
 *   omni slack dm <instance> <userId>       — resolve/open the DM channel
 *   omni slack search <instance> <query>    — full-text search (user token only)
 *   omni slack app setup                    — register the deployment Slack app
 *   omni slack app status                   — is the deployment app configured?
 *   omni slack connect                      — one-click OAuth install from a terminal
 *
 * None has a cross-channel equivalent, which is why they live here rather
 * than under `omni messages` / `omni instances`.
 *
 * Exit codes across this group: 0 success, 2 usage, 3 API failure.
 *
 * Secrets (client secret, signing secret, app-level token) are accepted ONLY
 * from a piped stdin (`--*-stdin`) or an interactive prompt on stderr — there
 * is deliberately no `--client-secret <value>` style flag, because a value on
 * the command line lands in the shell history and in `ps`. Anything this file
 * echoes back goes through `maskSecret` first. `--*-stdin` is the
 * non-echoing path; the prompt is the convenience path.
 */

import { createInterface } from 'node:readline';
import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/** Exit codes, matching the rest of the `slack` group. */
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_API = 3;

/** The five settings keys `slack app setup` owns — the ONLY keys it writes. */
const SETTING_KEYS = {
  clientId: 'slack.app.client_id',
  clientSecret: 'slack.app.client_secret',
  signingSecret: 'slack.app.signing_secret',
  appToken: 'slack.app.app_token',
  publicUrl: 'server.public_url',
} as const;

/** Poll cadence and ceiling for `slack connect` (2 s, 5 min — see the wish). */
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_SECONDS = 300;

type SlackAppStatus = Awaited<ReturnType<OmniClient['slack']['appStatus']>>;
type SlackOAuthResult = Awaited<ReturnType<OmniClient['slack']['oauthResult']>>;

/** Every handler returns the process exit code it earned (0 — failures exit through `output.error`). */
interface CommandResult {
  readonly exitCode: number;
  readonly instanceId?: string;
}

// ---------------------------------------------------------------------------
// Secret hygiene
// ---------------------------------------------------------------------------

/**
 * Mask a secret for display. Local to this file on purpose: `instances.ts`
 * masks API *body fields*, this masks the values `slack app setup` collected
 * before they reach the API, and the two must be free to diverge.
 */
function maskSecret(secret: string): string {
  if (secret.length <= 12) return '****';
  return `****${secret.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Injectable side effects
// ---------------------------------------------------------------------------

/** Read all of stdin as UTF-8. Refuses a TTY, the way `readStdinText` does in instances.ts. */
async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('a --*-stdin flag requires piped stdin (e.g. `printf %s "$SECRET" | omni slack app setup ...`)');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Ask one question. The readline interface writes to **stderr** so stdout
 * carries only command output (and stays a valid JSON document in `--json`).
 */
async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}: `, resolve);
    });
    return answer.trim();
  } finally {
    rl.close();
  }
}

/** Best-effort browser launch; `false` means "print the URL and let the operator click". */
async function openBrowser(url: string): Promise<boolean> {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    const proc = Bun.spawn({ cmd, stdout: 'ignore', stderr: 'ignore' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/** Side effects `slack app setup` needs — injected so the test never touches the real stdin. */
interface SetupPorts {
  readonly readStdin: () => Promise<string>;
  readonly prompt: (question: string) => Promise<string>;
}

/** Side effects `slack connect` needs — injected so the test never waits or launches anything. */
interface ConnectPorts {
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly intervalMs: number;
}

const defaultSetupPorts: SetupPorts = { readStdin: readStdinText, prompt: promptLine };

const defaultConnectPorts: ConnectPorts = {
  openBrowser,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  intervalMs: POLL_INTERVAL_MS,
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/** The API's machine-readable code, when the thrown value carries one. */
function codeOf(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

async function fetchAppStatus(client: OmniClient): Promise<SlackAppStatus> {
  try {
    return await client.slack.appStatus();
  } catch (err) {
    output.error(`Failed to read the Slack app status: ${messageOf(err)}`, undefined, EXIT_API);
  }
}

function printAppStatus(status: SlackAppStatus): void {
  output.keyValue('configured', status.configured);
  output.keyValue('missing', status.missing);
  output.keyValue('redirectUrl', status.redirectUrl);
  output.keyValue('manifestUrl', status.manifestUrl);
  if (!status.configured) {
    output.info(`Not configured yet — missing: ${status.missing.join(', ')}. Run: omni slack app setup`);
  }
}

// ---------------------------------------------------------------------------
// `omni slack app setup`
// ---------------------------------------------------------------------------

interface SetupOptions {
  readonly publicUrl?: string;
  readonly clientId?: string;
  readonly clientSecretStdin?: boolean;
  readonly signingSecretStdin?: boolean;
  readonly appTokenStdin?: boolean;
  readonly nonInteractive?: boolean;
}

type SecretField = 'clientSecret' | 'signingSecret' | 'appToken';

interface SecretRequest {
  readonly field: SecretField;
  readonly flag: string;
  readonly question: string;
}

/**
 * Order matters twice: it is the flag order in `--help`, and it is the order
 * the `--*-stdin` flags consume lines from the single stdin read, so
 * `printf '%s\n%s\n%s' "$CS" "$SS" "$AT" | omni slack app setup --client-secret-stdin …`
 * is deterministic.
 */
const SECRET_REQUESTS: readonly SecretRequest[] = [
  { field: 'clientSecret', flag: '--client-secret-stdin', question: 'Slack app client secret' },
  { field: 'signingSecret', flag: '--signing-secret-stdin', question: 'Slack app signing secret' },
  { field: 'appToken', flag: '--app-token-stdin', question: 'Slack app-level token (xapp-…)' },
];

function wantsStdin(opts: SetupOptions, field: SecretField): boolean {
  if (field === 'clientSecret') return opts.clientSecretStdin === true;
  if (field === 'signingSecret') return opts.signingSecretStdin === true;
  return opts.appTokenStdin === true;
}

/** Read the `--*-stdin` values: one non-empty line each, in SECRET_REQUESTS order. */
async function readSecretsFromStdin(
  requests: readonly SecretRequest[],
  ports: SetupPorts,
): Promise<Map<SecretField, string>> {
  const collected = new Map<SecretField, string>();
  if (requests.length === 0) return collected;

  let text: string;
  try {
    text = await ports.readStdin();
  } catch (err) {
    output.error(messageOf(err), undefined, EXIT_USAGE);
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < requests.length) {
    const flags = requests.map((r) => r.flag).join(', ');
    output.error(
      `stdin carried ${lines.length} non-empty line(s) but ${requests.length} were requested (${flags}), one line per flag in that order`,
      undefined,
      EXIT_USAGE,
    );
  }
  requests.forEach((request, index) => collected.set(request.field, lines[index]));
  return collected;
}

interface ResolvedSetupValues {
  readonly publicUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly signingSecret: string;
  readonly appToken: string;
}

/** A value passed as a flag, read from stdin, or typed at the prompt — never a value-bearing secret flag. */
async function resolvePlainValue(
  given: string | undefined,
  question: string,
  flag: string,
  opts: SetupOptions,
  ports: SetupPorts,
): Promise<string> {
  const trimmed = given?.trim();
  if (trimmed) return trimmed;
  if (opts.nonInteractive) {
    output.error(`--non-interactive requires ${flag}`, undefined, EXIT_USAGE);
  }
  const answer = (await ports.prompt(question)).trim();
  if (!answer) {
    output.error(`${flag} is required`, undefined, EXIT_USAGE);
  }
  return answer;
}

async function resolveSetupValues(opts: SetupOptions, ports: SetupPorts): Promise<ResolvedSetupValues> {
  const requested = SECRET_REQUESTS.filter((request) => wantsStdin(opts, request.field));
  const fromStdin = await readSecretsFromStdin(requested, ports);

  const publicUrl = await resolvePlainValue(
    opts.publicUrl,
    'Public base URL of this deployment (https://…)',
    '--public-url <url>',
    opts,
    ports,
  );
  const clientId = await resolvePlainValue(opts.clientId, 'Slack app client id', '--client-id <id>', opts, ports);

  const secrets = new Map<SecretField, string>(fromStdin);
  for (const request of SECRET_REQUESTS) {
    if (secrets.has(request.field)) continue;
    if (opts.nonInteractive) {
      output.error(`--non-interactive requires ${request.flag}`, undefined, EXIT_USAGE);
    }
    const answer = (await ports.prompt(request.question)).trim();
    if (!answer) {
      output.error(`${request.flag} is required`, undefined, EXIT_USAGE);
    }
    secrets.set(request.field, answer);
  }

  return {
    publicUrl,
    clientId,
    clientSecret: secrets.get('clientSecret') ?? '',
    signingSecret: secrets.get('signingSecret') ?? '',
    appToken: secrets.get('appToken') ?? '',
  };
}

/** The five writes, in a fixed order, through `client.settings.set` and nothing else. */
async function writeAppSettings(client: OmniClient, values: ResolvedSetupValues): Promise<void> {
  const entries: ReadonlyArray<readonly [string, string, boolean]> = [
    [SETTING_KEYS.clientId, values.clientId, false],
    [SETTING_KEYS.clientSecret, values.clientSecret, true],
    [SETTING_KEYS.signingSecret, values.signingSecret, true],
    [SETTING_KEYS.appToken, values.appToken, true],
    [SETTING_KEYS.publicUrl, values.publicUrl, false],
  ];

  for (const [key, value] of entries) {
    try {
      await client.settings.set(key, value);
    } catch (err) {
      output.error(`Failed to write ${key}: ${messageOf(err)}`, undefined, EXIT_API);
    }
  }

  output.success(`Wrote ${entries.length} Slack app settings`);
  output.list(entries.map(([key, value, secret]) => ({ key, value: secret ? maskSecret(value) : value })));
}

async function handleAppSetup(
  client: OmniClient,
  opts: SetupOptions,
  ports: SetupPorts = defaultSetupPorts,
): Promise<CommandResult> {
  const before = await fetchAppStatus(client);
  if (before.manifestUrl) {
    output.info('Create (or update) the Slack app from this pre-filled manifest, then come back:');
    output.keyValue('manifestUrl', before.manifestUrl);
  } else {
    output.info('The pre-filled manifest link appears once server.public_url is known — this setup writes it.');
  }

  const values = await resolveSetupValues(opts, ports);
  await writeAppSettings(client, values);

  printAppStatus(await fetchAppStatus(client));
  return { exitCode: EXIT_OK };
}

async function handleAppStatus(client: OmniClient): Promise<CommandResult> {
  printAppStatus(await fetchAppStatus(client));
  return { exitCode: EXIT_OK };
}

// ---------------------------------------------------------------------------
// `omni slack connect`
// ---------------------------------------------------------------------------

interface ConnectOptions {
  readonly mode?: string;
  /** commander sets this to `false` for `--no-open`. */
  readonly open?: boolean;
  readonly timeout?: string;
}

function resolveMode(opts: ConnectOptions): 'user' | 'bot' | undefined {
  if (opts.mode === undefined) return undefined;
  if (opts.mode === 'user' || opts.mode === 'bot') return opts.mode;
  output.error(`--mode must be 'user' or 'bot' (got '${opts.mode}')`, undefined, EXIT_USAGE);
}

function resolveTimeoutSeconds(opts: ConnectOptions): number {
  if (opts.timeout === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(opts.timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    output.error(`--timeout must be a positive number of seconds (got '${opts.timeout}')`, undefined, EXIT_USAGE);
  }
  return seconds;
}

async function pollOauthResult(
  client: OmniClient,
  nonce: string,
  ports: ConnectPorts,
  timeoutMs: number,
): Promise<SlackOAuthResult | undefined> {
  const deadline = ports.now() + timeoutMs;
  // A hard attempt ceiling alongside the clock check, so a frozen clock can
  // never turn the poll into an unbounded loop.
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / Math.max(1, ports.intervalMs)));

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    await ports.sleep(ports.intervalMs);
    let result: SlackOAuthResult;
    try {
      result = await client.slack.oauthResult(nonce);
    } catch (err) {
      output.error(`Failed to read the install result: ${messageOf(err)}`, undefined, EXIT_API);
    }
    if (result.status !== 'pending') return result;
    if (ports.now() >= deadline) break;
  }
  return undefined;
}

async function handleConnect(
  client: OmniClient,
  opts: ConnectOptions,
  ports: ConnectPorts = defaultConnectPorts,
): Promise<CommandResult> {
  const mode = resolveMode(opts);
  const timeoutSeconds = resolveTimeoutSeconds(opts);

  let started: Awaited<ReturnType<OmniClient['slack']['oauthStart']>>;
  try {
    started = await client.slack.oauthStart({ entry: 'cli', ...(mode ? { mode } : {}) });
  } catch (err) {
    if (codeOf(err) === 'SLACK_APP_NOT_CONFIGURED') {
      output.error(
        `The deployment Slack app is not configured: ${messageOf(err)}. Run: omni slack app setup`,
        undefined,
        EXIT_API,
      );
    }
    output.error(`Failed to start the Slack install: ${messageOf(err)}`, undefined, EXIT_API);
  }

  output.info('Approve the install in Slack — open this URL if a browser does not:');
  output.keyValue('authorizeUrl', started.authorizeUrl);
  output.keyValue('nonce', started.nonce);
  output.keyValue('expiresAt', started.expiresAt);

  if (opts.open !== false) {
    const launched = await ports.openBrowser(started.authorizeUrl);
    if (!launched) output.info('Could not open a browser here — copy the URL above.');
  }

  const result = await pollOauthResult(client, started.nonce, ports, timeoutSeconds * 1_000);

  if (!result) {
    output.error(
      `Timed out after ${timeoutSeconds}s waiting for Slack. Finish the approval, then read the same install with nonce ${started.nonce}`,
      undefined,
      EXIT_API,
    );
  }
  if (result.status === 'error') {
    output.error(`Slack install failed: ${result.message}`, { code: result.code }, EXIT_API);
  }
  if (result.status !== 'done') {
    output.error(`Slack install did not complete (status: ${result.status})`, undefined, EXIT_API);
  }

  output.success(`Slack connected: instance ${result.instanceId}`);
  output.keyValue('instanceId', result.instanceId);
  output.keyValue('status', result.status);
  return { exitCode: EXIT_OK, instanceId: result.instanceId };
}

// ---------------------------------------------------------------------------
// Command wiring
// ---------------------------------------------------------------------------

function createSlackAppCommand(): Command {
  const app = new Command('app').description('Deployment-level Slack app registration (one app, every workspace)');

  app
    .command('setup')
    .description('Register the deployment Slack app: print the manifest link, collect the values, write the settings')
    .option('--public-url <url>', 'Public base URL of this deployment (https://…)')
    .option('--client-id <id>', 'Slack app client id')
    .option('--client-secret-stdin', 'Read the client secret from stdin (one line)')
    .option('--signing-secret-stdin', 'Read the signing secret from stdin (one line)')
    .option('--app-token-stdin', 'Read the app-level token from stdin (one line)')
    .option('--non-interactive', 'Never prompt: every value must arrive by flag or stdin')
    .action(async (opts: SetupOptions) => {
      await handleAppSetup(getClient(), opts);
    });

  app
    .command('status')
    .description('Is the deployment Slack app configured? Shows missing keys, redirect URL and manifest link.')
    .action(async () => {
      await handleAppStatus(getClient());
    });

  return app;
}

export function createSlackCommand(): Command {
  const cmd = new Command('slack').description(
    'Slack-only operations: connect a workspace, open a DM, search messages (#889)',
  );

  cmd
    .command('dm <instance> <userId>')
    .description('Resolve the DM channel id for a Slack user (U…). Idempotent.')
    .action(async (instance: string, userId: string) => {
      try {
        const instanceId = await resolveInstanceId(instance);
        const { channelId } = await getClient().slack.openDm(instanceId, userId);
        output.success(`DM channel with ${userId}: ${channelId}`);
        output.info(`Send with: omni send text ${instance} ${channelId} "..."`);
      } catch (err) {
        output.error(`Failed to open DM: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  cmd
    .command('search <instance> <query>')
    .description("Search messages. Needs an instance in 'user' auth mode — a bot token cannot search.")
    .option('--count <n>', 'Results per page', '20')
    .option('--page <n>', 'Page number', '1')
    .action(async (instance: string, query: string, opts) => {
      try {
        const instanceId = await resolveInstanceId(instance);
        const matches = await getClient().slack.search(instanceId, query, {
          count: Number(opts.count),
          page: Number(opts.page),
        });

        if (matches.length === 0) {
          output.info('No matches.');
          return;
        }

        output.list(
          matches.map((m) => ({
            channel: String(m.channelId ?? ''),
            ts: String(m.ts ?? ''),
            from: String(m.username ?? ''),
            text: String(m.text ?? '').slice(0, 80),
          })),
        );
        // Slack applies the authorizing user's own search preferences, so this
        // is that person's view of the workspace, not a neutral index query.
        output.info(`${matches.length} result(s), from the authorizing user's perspective.`);
      } catch (err) {
        output.error(`Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  cmd.addCommand(createSlackAppCommand());

  cmd
    .command('connect')
    .description('Connect a Slack workspace through the deployment app (opens Slack, then waits for the callback)')
    .option('--mode <mode>', "Authorize as the person ('user', default) or as the workspace bot ('bot')")
    .option('--no-open', 'Do not try to open a browser; just print the URL')
    .option('--timeout <seconds>', `Seconds to wait for the callback (default ${DEFAULT_TIMEOUT_SECONDS})`)
    .action(async (opts: ConnectOptions) => {
      await handleConnect(getClient(), opts);
    });

  return cmd;
}

export const __testables = {
  handleAppSetup,
  handleAppStatus,
  handleConnect,
  maskSecret,
  SETTING_KEYS,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_API,
  POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_SECONDS,
};
