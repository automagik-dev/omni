/** Real login command/output/config in isolated children; no HTTP or process-wide mock leakage. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH_PATH = fileURLToPath(new URL('../auth.ts', import.meta.url));
const CONFIG_PATH = fileURLToPath(new URL('../../config.ts', import.meta.url));
const KEY = 'test-cli-key';
const PRIMARY_KEY = 'test-primary-key';
const initialConfig = {
  apiUrl: 'http://default.invalid',
  apiKey: 'test-local-key',
  servers: {
    active: 'default',
    list: {
      default: { url: 'http://default.invalid', apiKey: 'test-local-key' },
      prod: { url: 'https://prod.invalid' },
    },
  },
};
let configDir: string;
const children = new Set<{ kill(): void; exited: Promise<number> }>();

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'omni-auth-login-'));
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(initialConfig));
});

afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      child.kill();
      await child.exited;
    }),
  );
  rmSync(configDir, { recursive: true, force: true });
});

async function login(
  args: string[] = [],
  options: {
    stdin?: string;
    envKey?: string;
    primaryKey?: string;
    expectedKey?: string;
    tty?: boolean;
    valid?: boolean;
    json?: boolean;
    holdStdinOpen?: boolean;
  } = {},
) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
import { mock } from 'bun:test';
import { writeFileSync } from 'node:fs';
mock.module('@omni/sdk', () => ({
  createOmniClient: (options) => {
    writeFileSync(process.env.OMNI_CONFIG_DIR + '/request.json', JSON.stringify({
      keyMatches: options.apiKey === process.env.EXPECTED_AUTH_KEY, baseUrl: options.baseUrl,
    }));
    return { auth: { validate: async () => ({ valid: ${options.valid !== false}, keyName: 'fixture', keyPrefix: 'fixture-', scopes: [] }) } };
  },
}));
${options.tty ? "Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });" : ''}
const { setRuntimeServer } = await import(${JSON.stringify(CONFIG_PATH)});
setRuntimeServer('prod');
const { createAuthCommand } = await import(${JSON.stringify(AUTH_PATH)});
await createAuthCommand().parseAsync(['login', ...${JSON.stringify(args)}], { from: 'user' });
`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: configDir,
        OMNI_CONFIG_DIR: configDir,
        EXPECTED_AUTH_KEY: options.expectedKey ?? KEY,
        ...(options.envKey === undefined ? {} : { OMNI_CLI_API_KEY: options.envKey }),
        ...(options.primaryKey === undefined ? {} : { OMNI_API_KEY: options.primaryKey }),
        ...(options.json ? { OMNI_FORMAT: 'json' } : {}),
      },
      stdin: options.holdStdinOpen ? 'pipe' : new Blob([options.stdin ?? '']),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  children.add(child);
  try {
    if (options.holdStdinOpen && child.stdin) {
      child.stdin.write(options.stdin ?? '');
      await child.stdin.flush();
      // Deliberately no end(): oversized input must fail without waiting for EOF.
    }
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stdout + stderr).not.toContain(options.expectedKey ?? KEY);
    expect(stdout + stderr).not.toContain(PRIMARY_KEY);
    return { exitCode, stdout, stderr };
  } finally {
    if (options.holdStdinOpen && child.stdin) child.stdin.end();
    if (child.exitCode === null) child.kill();
    await child.exited;
    children.delete(child);
  }
}

function assertSaved(baseUrl = 'https://prod.invalid', key = KEY) {
  expect(JSON.parse(readFileSync(join(configDir, 'request.json'), 'utf8'))).toEqual({ keyMatches: true, baseUrl });
  const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'));
  expect(config.servers.list.prod).toEqual({ url: baseUrl, apiKey: key });
  expect(config.servers.list.default).toEqual(initialConfig.servers.list.default);
  expect(config.servers.active).toBe('default');
  expect(config.apiKey).toBe('test-local-key');
}

function assertUnchanged() {
  expect(existsSync(join(configDir, 'request.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))).toEqual(initialConfig);
}

describe('auth login safe input', () => {
  for (const newline of ['\n', '\r\n']) {
    test(`reads piped stdin with ${JSON.stringify(newline)} without echoing the key`, async () => {
      const result = await login(['--api-key-stdin'], { stdin: KEY + newline });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Logged in successfully');
      expect(result.stdout).toContain('"keySource": "stdin"');
      assertSaved();
    });
  }

  test('uses OMNI_CLI_API_KEY without an argument and retains --api-url', async () => {
    const result = await login(['--api-url', 'https://override.invalid'], { envKey: KEY });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"keySource": "env"');
    assertSaved('https://override.invalid');
  });

  test('keeps the legacy key flag working and prefers it over the ambient env', async () => {
    const result = await login(['--api-key', KEY], { envKey: 'test-env-key' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"keySource": "flag"');
    assertSaved();
  });

  test('explicit stdin overrides ambient OMNI_CLI_API_KEY', async () => {
    const result = await login(['--api-key-stdin'], { stdin: KEY, envKey: 'test-env-key' });
    expect(result.exitCode).toBe(0);
    assertSaved();
  });

  test('never sends the server primary key to a targeted remote server', async () => {
    const result = await login([], { primaryKey: PRIMARY_KEY });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('OMNI_CLI_API_KEY');
    assertUnchanged();
  });

  test('selects only the CLI env key when both server and CLI keys exist', async () => {
    const result = await login([], { envKey: KEY, primaryKey: PRIMARY_KEY });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"keySource": "env"');
    assertSaved();
  });

  test('includes only the source label in JSON success output', async () => {
    const result = await login(['--api-key-stdin'], { stdin: KEY, json: true });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).keySource).toBe('stdin');
    assertSaved();
  });

  for (const [label, stdin] of [
    ['ASCII overflow', 'x'.repeat(8193)],
    ['UTF-8 byte overflow', 'é'.repeat(4097)],
    ['overflow including newline', `${'x'.repeat(8192)}\n`],
  ]) {
    test(`refuses ${label} before validation or config writes`, async () => {
      const result = await login(['--api-key-stdin'], { stdin });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('8 KB');
      assertUnchanged();
    });
  }

  test('rejects an oversized pipe while the writer is still open', async () => {
    const result = await login(['--api-key-stdin'], { stdin: 'x'.repeat(8193), holdStdinOpen: true });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('8 KB');
    assertUnchanged();
  });

  test('accepts exactly 8 KB of stdin', async () => {
    const key = 'x'.repeat(8192);
    const result = await login(['--api-key-stdin'], { stdin: key, expectedKey: key });
    expect(result.exitCode).toBe(0);
    assertSaved('https://prod.invalid', key);
  });

  test('refuses conflicting flags before validation or writing config', async () => {
    const result = await login(['--api-key', KEY, '--api-key-stdin'], { stdin: KEY });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Use only one login input flag: --api-key-stdin or --api-key');
    assertUnchanged();
  });

  test('does not silently read stdin or reuse a stored key without an input source', async () => {
    const result = await login([], { stdin: KEY });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('OMNI_CLI_API_KEY');
    assertUnchanged();
  });

  for (const stdin of ['', '   ', `${KEY}\nextra`, `${KEY}\n\n`]) {
    test(`refuses invalid stdin ${JSON.stringify(stdin === '' ? 'empty' : stdin.length)} without echoing it`, async () => {
      const result = await login(['--api-key-stdin'], { stdin, envKey: KEY });
      expect(result.exitCode).toBe(2);
      assertUnchanged();
    });
  }

  test('refuses an empty environment key', async () => {
    const result = await login([], { envKey: '' });
    expect(result.exitCode).toBe(2);
    assertUnchanged();
  });

  test('refuses an empty explicit key rather than falling back to env', async () => {
    const result = await login(['--api-key', ''], { envKey: KEY });
    expect(result.exitCode).toBe(2);
    assertUnchanged();
  });

  test('refuses --api-key-stdin on a TTY before reading it', async () => {
    const result = await login(['--api-key-stdin'], { tty: true });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('requires piped stdin');
    assertUnchanged();
  });

  test('an invalid API response still leaves stored credentials unchanged', async () => {
    const result = await login(['--api-key-stdin'], { stdin: KEY, valid: false });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('API key is invalid');
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))).toEqual(initialConfig);
  });
});
