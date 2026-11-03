/**
 * `omni server add` and `omni auth login` without a key sign in by device code (#1461).
 *
 * The real CLI runs in a child process with a temporary HOME and config dir, against a
 * fake Omni in this process (Bun.serve on 127.0.0.1) that scripts the RFC 8628 replies.
 * Every case checks what landed in the config file and that the device key, the device
 * token and the device code never appear in stdout or stderr.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dir, '../index.ts');
const DEVICE_KEY = 'omni_sk_cmdtestDEVICEKEYcmdtestDEVICE01';
const OTHER_SERVER_KEY = 'omni_sk_otherserverKEYotherserverKEY01';
const DEVICE_TOKEN = 'cmd-device-token-secret-01';
const DEVICE_CODE = 'cmd-device-code-secret-01';
const SECRETS = [DEVICE_KEY, DEVICE_TOKEN, DEVICE_CODE, DEVICE_KEY.slice(12)];

type TokenMode = 'approve' | 'deny' | 'expire' | 'hang';
interface FakeOmni {
  url: string;
  token: TokenMode;
  deviceCode: 'ok' | 'missing';
  keyReply: 'ok' | 'malformed';
  polls: number;
  close(): void;
}

const reply = (status: number, body: unknown) => Response.json(body, { status });

function deviceCodeReply(omni: FakeOmni): Response {
  if (omni.deviceCode === 'missing') return reply(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
  return reply(200, {
    device_code: DEVICE_CODE,
    user_code: 'WXYZ2345',
    verification_uri: `${omni.url}/api/login/device`,
    verification_uri_complete: `${omni.url}/api/login/device?user_code=WXYZ2345`,
    expires_in: 600,
    interval: omni.token === 'hang' ? 1 : 0,
  });
}

function deviceTokenReply(omni: FakeOmni): Response {
  omni.polls += 1;
  if (omni.token === 'deny') return reply(400, { error: 'access_denied' });
  if (omni.token === 'expire') return reply(400, { error: 'expired_token' });
  if (omni.token === 'hang' || omni.polls < 2) return reply(400, { error: 'authorization_pending' });
  return reply(200, { access_token: DEVICE_TOKEN, token_type: 'Bearer', expires_in: 3600 });
}

function deviceKeyReply(omni: FakeOmni, request: Request): Response {
  if (request.headers.get('authorization') !== `Bearer ${DEVICE_TOKEN}`) {
    return reply(401, { error: { code: 'UNAUTHORIZED', message: 'Unknown or used device token' } });
  }
  if (omni.keyReply === 'malformed') return reply(200, { data: { keyId: 'k1' } });
  return reply(200, {
    data: {
      apiKey: DEVICE_KEY,
      keyId: 'device-key-id-1',
      scopes: ['instances:*', 'system:read'],
      keyExpiresAt: null,
      apiUrl: omni.url,
      companions: [],
    },
  });
}

/** This server knows only its own device key; any other key is another server's. */
function validateReply(request: Request): Response {
  if (request.headers.get('x-api-key') !== DEVICE_KEY) {
    return reply(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
  }
  return reply(200, {
    data: {
      valid: true,
      keyPrefix: 'omni_sk_device-k...',
      keyName: 'device: omni CLI on test',
      scopes: ['instances:*', 'system:read'],
    },
  });
}

function startFakeOmni(): FakeOmni {
  const routes: Record<string, (request: Request) => Response> = {
    '/api/v2/health': () => reply(200, { status: 'healthy' }),
    '/api/auth/device/code': () => deviceCodeReply(omni),
    '/api/auth/device/token': () => deviceTokenReply(omni),
    '/api/v2/login/device-key': (request) => deviceKeyReply(omni, request),
    '/api/v2/auth/validate': validateReply,
  };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const path = new URL(request.url).pathname;
      const route = routes[path];
      return route ? route(request) : reply(404, { error: { code: 'NOT_FOUND', message: `no ${path}` } });
    },
  });
  const omni: FakeOmni = {
    url: `http://127.0.0.1:${server.port}`,
    token: 'approve',
    deviceCode: 'ok',
    keyReply: 'ok',
    polls: 0,
    close: () => server.stop(true),
  };
  return omni;
}

let fake: FakeOmni;
let home: string;

const configFile = () => join(home, '.omni', 'config.json');
const readConfig = () => JSON.parse(readFileSync(configFile(), 'utf8'));

function writeInitialConfig() {
  const config = {
    apiUrl: 'http://127.0.0.1:1',
    apiKey: 'local-default-key',
    servers: {
      active: 'default',
      list: { default: { url: 'http://127.0.0.1:1', apiKey: 'local-default-key' }, prod: { url: fake.url } },
    },
  };
  writeFileSync(configFile(), JSON.stringify(config));
  return config;
}

function spawnCli(args: string[]) {
  return Bun.spawn(['bun', CLI_PATH, ...args], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      OMNI_CONFIG_DIR: join(home, '.omni'),
      PM2_HOME: join(home, '.pm2'),
      OMNI_TELEMETRY: 'false',
      NO_COLOR: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

async function cli(args: string[]) {
  const child = spawnCli(args);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  for (const secret of SECRETS) expect(stdout + stderr).not.toContain(secret);
  return { stdout, stderr, exitCode };
}

beforeAll(() => {
  fake = startFakeOmni();
});
afterAll(() => fake.close());

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-device-login-'));
  rmSync(join(home, '.omni'), { recursive: true, force: true });
  mkdirSync(join(home, '.omni'), { recursive: true });
  Object.assign(fake, { token: 'approve', deviceCode: 'ok', keyReply: 'ok', polls: 0 });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('omni server add <name> <url> without a key', () => {
  test('signs in by device code and stores the device key in that entry', async () => {
    const initial = writeInitialConfig();
    const result = await cli(['server', 'add', 'lab', fake.url, '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('WXYZ2345');
    expect(result.stderr).toContain(`${fake.url}/api/login/device?user_code=WXYZ2345`);
    const shown = JSON.parse(result.stdout);
    expect(shown).toMatchObject({
      name: 'lab',
      signedIn: true,
      keyId: 'device-key-id-1',
      scopes: ['instances:*', 'system:read'],
    });
    const config = readConfig();
    expect(config.servers.list.lab).toEqual({ url: fake.url, apiKey: DEVICE_KEY });
    expect(config.servers.active).toBe(initial.servers.active);
    expect(config.servers.list.default).toEqual(initial.servers.list.default);
  });

  test('a denied sign-in exits non-zero and saves nothing', async () => {
    const initial = writeInitialConfig();
    fake.token = 'deny';
    const result = await cli(['server', 'add', 'lab', fake.url]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('denied');
    expect(readConfig()).toEqual(initial);
  });

  test('a malformed key reply exits non-zero and saves nothing', async () => {
    const initial = writeInitialConfig();
    fake.keyReply = 'malformed';
    const result = await cli(['server', 'add', 'lab', fake.url]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('malformed device key');
    expect(readConfig()).toEqual(initial);
  });

  test('a server without device sign-in is saved keyless, as before', async () => {
    writeInitialConfig();
    fake.deviceCode = 'missing';
    const result = await cli(['server', 'add', 'lab', fake.url]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No API key stored for 'lab'");
    expect(readConfig().servers.list.lab).toEqual({ url: fake.url });
  });

  test('--skip-verify saves it keyless without asking the server', async () => {
    writeInitialConfig();
    const result = await cli(['server', 'add', 'lab', fake.url, '--skip-verify']);
    expect(result.exitCode).toBe(0);
    expect(fake.polls).toBe(0);
    expect(readConfig().servers.list.lab).toEqual({ url: fake.url });
  });
});

describe('omni auth login without a key', () => {
  test('signs in by device code and saves the key into the targeted entry', async () => {
    const initial = writeInitialConfig();
    const result = await cli(['auth', 'login', '--server', 'prod', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('omni approve WXYZ2345');
    expect(JSON.parse(result.stdout)).toMatchObject({ server: 'prod', keySource: 'device', keyId: 'device-key-id-1' });
    const config = readConfig();
    expect(config.servers.list.prod).toEqual({ url: fake.url, apiKey: DEVICE_KEY });
    expect(config.servers.list.default).toEqual(initial.servers.list.default);
    expect(config.servers.active).toBe('default');
  });

  test('an expired code exits 2 and saves nothing', async () => {
    const initial = writeInitialConfig();
    fake.token = 'expire';
    const result = await cli(['auth', 'login', '--server', 'prod']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('expired');
    expect(readConfig()).toEqual(initial);
  });

  test('Ctrl+C while waiting exits 130 and saves nothing', async () => {
    const initial = writeInitialConfig();
    fake.token = 'hang';
    const child = spawnCli(['auth', 'login', '--server', 'prod']);
    // Human output: the prompt is on stdout. Interrupt once it says it is waiting.
    const reader = child.stdout.getReader();
    let stdout = '';
    while (!stdout.includes('Waiting for approval')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      stdout += new TextDecoder().decode(chunk.value);
    }
    child.kill('SIGINT');
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      stdout += new TextDecoder().decode(chunk.value);
    }
    const stderr = await new Response(child.stderr).text();
    expect(stdout).toContain('WXYZ2345');
    expect(await child.exited).toBe(130);
    expect(stdout + stderr).toContain('cancelled');
    for (const secret of SECRETS) expect(stdout + stderr).not.toContain(secret);
    expect(readConfig()).toEqual(initial);
  });
});

describe('omni auth login --api-key with a device key', () => {
  test("a device key this server validates is saved, and the key isn't printed", async () => {
    writeInitialConfig();
    const result = await cli(['auth', 'login', '--server', 'prod', '--api-key', DEVICE_KEY]);
    expect(result.exitCode).toBe(0);
    expect(readConfig().servers.list.prod).toEqual({ url: fake.url, apiKey: DEVICE_KEY });
  });

  test("another server's key is refused and nothing is saved", async () => {
    const initial = writeInitialConfig();
    const result = await cli(['auth', 'login', '--server', 'prod', '--api-key', OTHER_SERVER_KEY]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout + result.stderr).not.toContain(OTHER_SERVER_KEY);
    expect(readConfig()).toEqual(initial);
  });
});
