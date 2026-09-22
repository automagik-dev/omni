/**
 * CLI `omni slack app setup` / `omni slack app status` / `omni slack connect`
 * — the deployment-app + one-click-install surface (slack-personal-oauth).
 *
 * Covers:
 *   - `setup --non-interactive` with every value supplied writes exactly the
 *     five settings keys through `client.settings.set`, and the status it
 *     prints afterwards carries `configured: true`
 *   - the printed `manifestUrl` is the api.slack.com app-creation link, and its
 *     `manifest_json` decodes to a manifest carrying the deployment's redirect
 *     URL (C1)
 *   - `connect` prints an `https://slack.com/oauth/v2/authorize…` URL, polls
 *     `oauthResult` until `done`, and returns exit code 0 with the instance id
 *   - an `{ status: 'error' }` outcome exits non-zero (3)
 *   - a timeout exits non-zero (3) and tells the operator to start over — there
 *     is no resume path, and the default wait stays under the record's TTL
 *   - a usage failure exits 2, and an API failure exits 3
 *   - no secret value ever reaches stdout, stderr or an output call
 *
 * The three handlers are driven directly with a hand-built fake client and
 * fake side-effect ports: this suite reads no host config, spawns no process,
 * opens no browser, and waits no real seconds (the poll clock is injected).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { OmniClient } from '@omni/sdk';

// ---------------------------------------------------------------------------
// Output capture — `error` throws (carrying its exit code) instead of calling
// process.exit, the same precedent as tenants.test.ts / history.test.ts.
// ---------------------------------------------------------------------------

interface OutputCall {
  readonly fn: string;
  readonly args: readonly unknown[];
}

const outputCalls: OutputCall[] = [];

const capture =
  (fn: string) =>
  (...args: unknown[]): void => {
    outputCalls.push({ fn, args });
  };

interface ExitError extends Error {
  exitCode: number;
}

function isExitError(err: unknown): err is ExitError {
  return err instanceof Error && typeof (err as ExitError).exitCode === 'number';
}

mock.module('../../output.js', () => ({
  error: (message: string, details?: unknown, exitCode = 1): never => {
    outputCalls.push({ fn: 'error', args: [message, details, exitCode] });
    const err = new Error(message) as ExitError;
    err.exitCode = exitCode;
    throw err;
  },
  success: capture('success'),
  info: capture('info'),
  warn: capture('warn'),
  raw: capture('raw'),
  data: capture('data'),
  list: capture('list'),
  keyValue: capture('keyValue'),
  header: capture('header'),
  dim: capture('dim'),
  tip: capture('tip'),
  disableColors: mock(),
  areColorsEnabled: () => true,
  setMaxCellWidth: mock(),
  getCurrentFormat: () => 'human',
  flushStdout: () => Promise.resolve(),
}));

const { __testables, createSlackCommand } = await import('../slack');
const {
  dmSendHint,
  handleAppSetup,
  handleAppStatus,
  handleConnect,
  maskSecret,
  SETTING_KEYS,
  DEFAULT_TIMEOUT_SECONDS,
} = __testables;

beforeEach(() => {
  outputCalls.length = 0;
});

/** Everything the command printed, as one searchable string. */
function printed(): string {
  return JSON.stringify(outputCalls);
}

/** The exit code the handler exited with, for a call expected to fail. */
async function exitCodeOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
  } catch (err) {
    if (isExitError(err)) return err.exitCode;
    throw err;
  }
  throw new Error('expected the handler to exit, but it returned');
}

/** Capture anything written straight to the real stdio during a run. */
async function withCapturedStdio<T>(run: () => Promise<T>): Promise<{ result: T; written: string }> {
  const chunks: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const sink = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    const cb = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  (process.stdout as unknown as { write: typeof process.stdout.write }).write = sink;
  (process.stderr as unknown as { write: typeof process.stderr.write }).write = sink;
  try {
    const result = await run();
    return { result, written: chunks.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof process.stdout.write }).write = originalOut;
    (process.stderr as unknown as { write: typeof process.stderr.write }).write = originalErr;
  }
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface AppStatusShape {
  readonly configured: boolean;
  readonly missing: string[];
  readonly redirectUrl: string | null;
  readonly manifestUrl: string | null;
}

const UNCONFIGURED: AppStatusShape = {
  configured: false,
  missing: ['slack.app.client_id', 'server.public_url'],
  redirectUrl: null,
  manifestUrl: null,
};

const REDIRECT_URL = 'https://omni.example.com/api/v2/slack/oauth/callback';

/**
 * A faithful stand-in for what `GET /slack/app` returns: the api.slack.com
 * app-creation URL carrying the whole manifest, URL-encoded, in
 * `manifest_json`. Built here rather than hard-coded so the assertion below
 * decodes a real manifest and can prove the redirect URL survived the trip.
 * The shape mirrors `buildSlackManifestUrl` in the API's slack-oauth service.
 */
const MANIFEST = {
  display_information: { name: 'Omni' },
  oauth_config: { redirect_urls: [REDIRECT_URL] },
} as const;

const MANIFEST_URL = `https://api.slack.com/apps?${new URLSearchParams({
  new_app: '1',
  manifest_json: JSON.stringify(MANIFEST),
}).toString()}`;

const CONFIGURED: AppStatusShape = {
  configured: true,
  missing: [],
  redirectUrl: REDIRECT_URL,
  manifestUrl: MANIFEST_URL,
};

interface SetupFake {
  readonly client: OmniClient;
  readonly writes: Array<{ key: string; value: unknown }>;
}

function makeSetupClient(options: { statuses: AppStatusShape[]; setThrows?: Error }): SetupFake {
  const writes: Array<{ key: string; value: unknown }> = [];
  let statusCall = 0;
  const client = {
    slack: {
      appStatus: async (): Promise<AppStatusShape> => {
        const index = Math.min(statusCall, options.statuses.length - 1);
        statusCall += 1;
        return options.statuses[index];
      },
    },
    settings: {
      set: async (key: string, value: unknown): Promise<{ key: string; value: unknown }> => {
        if (options.setThrows) throw options.setThrows;
        writes.push({ key, value });
        return { key, value };
      },
    },
  } as unknown as OmniClient;
  return { client, writes };
}

type OAuthResultShape =
  | { status: 'pending' }
  | { status: 'done'; instanceId: string }
  | { status: 'error'; code: string; message: string };

interface ConnectFake {
  readonly client: OmniClient;
  readonly startBodies: unknown[];
  readonly resultNonces: string[];
}

const AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize?client_id=123&state=nonce-abc';
const NONCE = 'nonce-abc123';
const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';

function makeConnectClient(options: { results: OAuthResultShape[]; startThrows?: unknown }): ConnectFake {
  const startBodies: unknown[] = [];
  const resultNonces: string[] = [];
  let resultCall = 0;
  const client = {
    slack: {
      oauthStart: async (body: unknown) => {
        startBodies.push(body);
        if (options.startThrows) throw options.startThrows;
        return { authorizeUrl: AUTHORIZE_URL, nonce: NONCE, expiresAt: '2026-09-21T22:00:00.000Z' };
      },
      oauthResult: async (nonce: string): Promise<OAuthResultShape> => {
        resultNonces.push(nonce);
        const index = Math.min(resultCall, options.results.length - 1);
        resultCall += 1;
        return options.results[index];
      },
    },
  } as unknown as OmniClient;
  return { client, startBodies, resultNonces };
}

/** Injected ports: an instant `sleep` that advances a fake clock — no real wait, no real launch. */
function makeConnectPorts(options?: { openSucceeds?: boolean }) {
  let clock = 0;
  const opened: string[] = [];
  return {
    opened,
    ports: {
      openBrowser: async (url: string): Promise<boolean> => {
        opened.push(url);
        return options?.openSucceeds ?? true;
      },
      sleep: async (ms: number): Promise<void> => {
        clock += ms;
      },
      now: (): number => clock,
      intervalMs: 5,
    },
  };
}

// Distinctive sentinels — no substring of these may ever be printed whole.
const CLIENT_SECRET = 'sentinel-client-secret-QWERTYUIOPASDF';
const SIGNING_SECRET = 'sentinel-signing-secret-ZXCVBNMLKJHGF';
const APP_TOKEN = 'sentinel-app-token-POIUYTREWQ';
const PUBLIC_URL = 'https://omni.example.com';
const CLIENT_ID = '9999999999.8888888888';

const ALL_SECRETS_STDIN = { clientSecretStdin: true, signingSecretStdin: true, appTokenStdin: true } as const;

function stdinPorts(text: string) {
  return {
    readStdin: async (): Promise<string> => text,
    prompt: async (): Promise<string> => {
      throw new Error('prompt must not be reached in --non-interactive mode');
    },
  };
}

const SECRET_LINES = `${CLIENT_SECRET}\n${SIGNING_SECRET}\n${APP_TOKEN}\n`;

// ---------------------------------------------------------------------------
// slack app setup
// ---------------------------------------------------------------------------

describe('slack app setup', () => {
  test('--non-interactive with every value writes exactly the five settings keys and exits 0', async () => {
    const fake = makeSetupClient({ statuses: [UNCONFIGURED, CONFIGURED] });

    const result = await handleAppSetup(
      fake.client,
      { publicUrl: PUBLIC_URL, clientId: CLIENT_ID, nonInteractive: true, ...ALL_SECRETS_STDIN },
      stdinPorts(SECRET_LINES),
    );

    expect(result.exitCode).toBe(0);
    expect(fake.writes).toEqual([
      { key: 'slack.app.client_id', value: CLIENT_ID },
      { key: 'slack.app.client_secret', value: CLIENT_SECRET },
      { key: 'slack.app.signing_secret', value: SIGNING_SECRET },
      { key: 'slack.app.app_token', value: APP_TOKEN },
      { key: 'server.public_url', value: PUBLIC_URL },
    ]);
    // The literal keys the API owns, pinned against a typo in either direction.
    expect(fake.writes.map((w) => w.key)).toEqual(Object.values(SETTING_KEYS));

    // …and the status it prints afterwards is the configured one.
    const configured = outputCalls.filter((c) => c.fn === 'keyValue' && c.args[0] === 'configured');
    expect(configured.at(-1)?.args[1]).toBe(true);
  });

  test('status prints configured: true and exits 0', async () => {
    const fake = makeSetupClient({ statuses: [CONFIGURED] });

    const result = await handleAppStatus(fake.client);

    expect(result.exitCode).toBe(0);
    expect(outputCalls).toContainEqual({ fn: 'keyValue', args: ['configured', true] });
    expect(outputCalls).toContainEqual({
      fn: 'keyValue',
      args: ['redirectUrl', CONFIGURED.redirectUrl],
    });
  });

  test('status prints the manifest link, and its manifest_json decodes to the manifest carrying the redirect URL', async () => {
    const fake = makeSetupClient({ statuses: [CONFIGURED] });

    await handleAppStatus(fake.client);

    // C1: the link is printed, verbatim, as its own key/value.
    const printedManifest = outputCalls.find((c) => c.fn === 'keyValue' && c.args[0] === 'manifestUrl')?.args[1];
    expect(printedManifest).toBe(MANIFEST_URL);
    expect(printed()).toContain('api.slack.com/apps');

    // …and it is a usable app-creation link: the encoded manifest decodes and
    // carries the deployment's own OAuth redirect URL, which is the whole
    // reason to hand an operator this link.
    const parsed = new URL(String(printedManifest));
    expect(parsed.origin).toBe('https://api.slack.com');
    expect(parsed.searchParams.get('new_app')).toBe('1');
    const manifestJson = parsed.searchParams.get('manifest_json');
    expect(manifestJson).not.toBeNull();
    expect(JSON.parse(String(manifestJson))).toEqual(MANIFEST);
    expect(JSON.parse(String(manifestJson)).oauth_config.redirect_urls).toContain(REDIRECT_URL);
  });

  test('setup prints the manifest link up front when the app is already configured', async () => {
    const fake = makeSetupClient({ statuses: [CONFIGURED, CONFIGURED] });

    await handleAppSetup(
      fake.client,
      { publicUrl: PUBLIC_URL, clientId: CLIENT_ID, nonInteractive: true, ...ALL_SECRETS_STDIN },
      stdinPorts(SECRET_LINES),
    );

    // Printed BEFORE any value is collected — that is the point of the link.
    const manifestCalls = outputCalls.filter((c) => c.fn === 'keyValue' && c.args[0] === 'manifestUrl');
    expect(manifestCalls.length).toBeGreaterThanOrEqual(2);
    expect(manifestCalls[0]?.args[1]).toBe(MANIFEST_URL);
    const firstWrite = outputCalls.findIndex((c) => c.fn === 'success');
    const firstManifest = outputCalls.findIndex((c) => c.fn === 'keyValue' && c.args[0] === 'manifestUrl');
    expect(firstManifest).toBeLessThan(firstWrite);
  });

  test('--non-interactive without --public-url is a usage failure: exit 2, nothing written', async () => {
    const fake = makeSetupClient({ statuses: [UNCONFIGURED] });

    const code = await exitCodeOf(() =>
      handleAppSetup(
        fake.client,
        { clientId: CLIENT_ID, nonInteractive: true, ...ALL_SECRETS_STDIN },
        stdinPorts(SECRET_LINES),
      ),
    );

    expect(code).toBe(2);
    expect(fake.writes).toEqual([]);
  });

  test('a settings write that fails is an API failure: exit 3', async () => {
    const fake = makeSetupClient({
      statuses: [UNCONFIGURED],
      setThrows: new Error('503 upstream unavailable'),
    });

    const code = await exitCodeOf(() =>
      handleAppSetup(
        fake.client,
        { publicUrl: PUBLIC_URL, clientId: CLIENT_ID, nonInteractive: true, ...ALL_SECRETS_STDIN },
        stdinPorts(SECRET_LINES),
      ),
    );

    expect(code).toBe(3);
  });

  test('too few stdin lines for the requested --*-stdin flags is a usage failure: exit 2', async () => {
    const fake = makeSetupClient({ statuses: [UNCONFIGURED] });

    const code = await exitCodeOf(() =>
      handleAppSetup(
        fake.client,
        { publicUrl: PUBLIC_URL, clientId: CLIENT_ID, nonInteractive: true, ...ALL_SECRETS_STDIN },
        stdinPorts(`${CLIENT_SECRET}\n`),
      ),
    );

    expect(code).toBe(2);
    expect(fake.writes).toEqual([]);
  });

  test('the prompt supplies the secrets that no --*-stdin flag carried', async () => {
    const fake = makeSetupClient({ statuses: [UNCONFIGURED, CONFIGURED] });
    const asked: string[] = [];
    const answers = [CLIENT_SECRET, SIGNING_SECRET, APP_TOKEN];

    const result = await handleAppSetup(
      fake.client,
      { publicUrl: PUBLIC_URL, clientId: CLIENT_ID },
      {
        readStdin: async (): Promise<string> => {
          throw new Error('stdin must not be read when no --*-stdin flag was given');
        },
        prompt: async (question: string): Promise<string> => {
          asked.push(question);
          return answers[asked.length - 1] ?? '';
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(asked).toHaveLength(3);
    expect(fake.writes.map((w) => w.value)).toEqual([CLIENT_ID, CLIENT_SECRET, SIGNING_SECRET, APP_TOKEN, PUBLIC_URL]);
  });
});

// ---------------------------------------------------------------------------
// Secret hygiene
// ---------------------------------------------------------------------------

describe('slack app setup — secret hygiene', () => {
  test('no secret value reaches stdout, stderr or any output call', async () => {
    const fake = makeSetupClient({ statuses: [UNCONFIGURED, CONFIGURED] });

    const { result, written } = await withCapturedStdio(() =>
      handleAppSetup(
        fake.client,
        { publicUrl: PUBLIC_URL, clientId: CLIENT_ID, nonInteractive: true, ...ALL_SECRETS_STDIN },
        stdinPorts(SECRET_LINES),
      ),
    );

    expect(result.exitCode).toBe(0);

    const everythingPrinted = printed();
    for (const secret of [CLIENT_SECRET, SIGNING_SECRET, APP_TOKEN]) {
      expect(everythingPrinted).not.toContain(secret);
      expect(written).not.toContain(secret);
    }

    // The values still reached the API unmasked — only the echo is masked.
    expect(fake.writes.map((w) => w.value)).toContain(CLIENT_SECRET);
    expect(everythingPrinted).toContain(maskSecret(CLIENT_SECRET));
    // Non-secret values are printed as they are, so the operator can check them.
    expect(everythingPrinted).toContain(PUBLIC_URL);
  });

  test('maskSecret never returns the secret it was given', () => {
    expect(maskSecret(CLIENT_SECRET)).not.toContain('sentinel');
    expect(maskSecret('short')).toBe('****');
  });
});

// ---------------------------------------------------------------------------
// slack connect
// ---------------------------------------------------------------------------

describe('slack connect', () => {
  test('polls oauthResult until done and prints the instance id', async () => {
    const fake = makeConnectClient({
      results: [{ status: 'pending' }, { status: 'pending' }, { status: 'done', instanceId: INSTANCE_ID }],
    });
    const { ports, opened } = makeConnectPorts();

    const result = await handleConnect(fake.client, { mode: 'user' }, ports);

    expect(result.exitCode).toBe(0);
    expect(result.instanceId).toBe(INSTANCE_ID);
    // The authorize URL was printed, verbatim, before any polling.
    expect(printed()).toContain('https://slack.com/oauth/v2/authorize');
    expect(outputCalls).toContainEqual({ fn: 'keyValue', args: ['authorizeUrl', AUTHORIZE_URL] });
    // Started as a terminal install, carrying --mode.
    expect(fake.startBodies).toEqual([{ entry: 'cli', mode: 'user' }]);
    expect(fake.resultNonces).toEqual([NONCE, NONCE, NONCE]);
    expect(opened).toEqual([AUTHORIZE_URL]);
    expect(printed()).toContain(INSTANCE_ID);
  });

  test('--no-open never launches a browser, and omitting --mode omits the field', async () => {
    const fake = makeConnectClient({ results: [{ status: 'done', instanceId: INSTANCE_ID }] });
    const { ports, opened } = makeConnectPorts();

    const result = await handleConnect(fake.client, { open: false }, ports);

    expect(result.exitCode).toBe(0);
    expect(opened).toEqual([]);
    expect(fake.startBodies).toEqual([{ entry: 'cli' }]);
  });

  test("an { status: 'error' } outcome exits non-zero (3)", async () => {
    const fake = makeConnectClient({
      results: [{ status: 'pending' }, { status: 'error', code: 'SLACK_OAUTH_DENIED', message: 'access_denied' }],
    });
    const { ports } = makeConnectPorts();

    const code = await exitCodeOf(() => handleConnect(fake.client, {}, ports));

    expect(code).toBe(3);
    expect(printed()).toContain('access_denied');
  });

  test('a timeout exits non-zero (3) and tells the operator to start over, not to resume', async () => {
    const fake = makeConnectClient({ results: [{ status: 'pending' }] });
    const { ports } = makeConnectPorts();

    // 50 ms of fake clock at the injected 5 ms interval — ten polls, no real wait.
    const code = await exitCodeOf(() => handleConnect(fake.client, { timeout: '0.05' }, ports));

    expect(code).toBe(3);
    const timedOut = outputCalls.find((c) => c.fn === 'error');
    const message = String(timedOut?.args[0]);
    expect(message).toContain('Timed out');
    expect(message).toContain(NONCE);
    // M6: the message must not promise a resume path. No command accepts a
    // nonce and the pending record is single-use, so the only truthful
    // instruction is to run the command again.
    expect(message).toContain('omni slack connect');
    expect(message).toContain('cannot be resumed');
    expect(message).not.toContain('read the same install');
    expect(fake.resultNonces.length).toBeGreaterThan(1);
  });

  test('the default wait stays below the API pending-record TTL of 300 s', async () => {
    // M6: at 300 s the record the poll reads has already expired, so the last
    // poll could only ever report a dead nonce. The default must leave the
    // record alive for the whole window.
    expect(DEFAULT_TIMEOUT_SECONDS).toBeLessThan(300);
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(240);
  });

  test('an unusable --mode is a usage failure: exit 2, before any API call', async () => {
    const fake = makeConnectClient({ results: [{ status: 'done', instanceId: INSTANCE_ID }] });
    const { ports } = makeConnectPorts();

    const code = await exitCodeOf(() => handleConnect(fake.client, { mode: 'admin' }, ports));

    expect(code).toBe(2);
    expect(fake.startBodies).toEqual([]);
  });

  test('an unusable --timeout is a usage failure: exit 2', async () => {
    const fake = makeConnectClient({ results: [{ status: 'done', instanceId: INSTANCE_ID }] });
    const { ports } = makeConnectPorts();

    const code = await exitCodeOf(() => handleConnect(fake.client, { timeout: 'soon' }, ports));

    expect(code).toBe(2);
    expect(fake.startBodies).toEqual([]);
  });

  test('a refused oauthStart is an API failure: exit 3, and names the setup command', async () => {
    const notConfigured = Object.assign(new Error('missing slack.app.client_id'), {
      code: 'SLACK_APP_NOT_CONFIGURED',
    });
    const fake = makeConnectClient({ results: [{ status: 'pending' }], startThrows: notConfigured });
    const { ports } = makeConnectPorts();

    const code = await exitCodeOf(() => handleConnect(fake.client, {}, ports));

    expect(code).toBe(3);
    expect(printed()).toContain('omni slack app setup');
  });

  test('a failing oauthResult poll is an API failure: exit 3', async () => {
    const client = {
      slack: {
        oauthStart: async () => ({ authorizeUrl: AUTHORIZE_URL, nonce: NONCE, expiresAt: '2026-09-21T22:00:00.000Z' }),
        oauthResult: async (): Promise<OAuthResultShape> => {
          throw new Error('502 bad gateway');
        },
      },
    } as unknown as OmniClient;
    const { ports } = makeConnectPorts();

    expect(await exitCodeOf(() => handleConnect(client, { open: false }, ports))).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Command wiring — the paths the sdk-coverage map already fixes
// ---------------------------------------------------------------------------

describe('createSlackCommand wiring', () => {
  const cmd = createSlackCommand();
  const names = cmd.commands.map((c) => c.name());

  test('keeps dm and search, and adds `app` (setup, status) plus `connect`', () => {
    expect(names).toContain('dm');
    expect(names).toContain('search');
    expect(names).toContain('app');
    expect(names).toContain('connect');

    const app = cmd.commands.find((c) => c.name() === 'app');
    expect(app?.commands.map((c) => c.name()).sort()).toEqual(['setup', 'status']);
  });

  test('setup declares the frozen flags and no value-bearing secret flag', () => {
    const app = cmd.commands.find((c) => c.name() === 'app');
    const setup = app?.commands.find((c) => c.name() === 'setup');
    const flags = (setup?.options ?? []).map((o) => o.flags);

    expect(flags).toEqual([
      '--public-url <url>',
      '--client-id <id>',
      '--client-secret-stdin',
      '--signing-secret-stdin',
      '--app-token-stdin',
      '--non-interactive',
    ]);
    for (const flag of flags) {
      if (flag.includes('secret') || flag.includes('token')) {
        expect(flag).not.toContain('<');
      }
    }
  });

  test('the dm hint is a flag-based send invocation, not the old positional form', () => {
    const hint = dmSendHint('felipe-slack', 'D05J8JA79QA');
    expect(hint).toBe('Send with: omni send --instance felipe-slack --to D05J8JA79QA --text "..."');
    expect(hint).not.toContain('send text ');
  });

  test('connect declares --mode, --no-open and --timeout', () => {
    const connect = cmd.commands.find((c) => c.name() === 'connect');
    expect((connect?.options ?? []).map((o) => o.flags)).toEqual(['--mode <mode>', '--no-open', '--timeout <seconds>']);
  });
});
