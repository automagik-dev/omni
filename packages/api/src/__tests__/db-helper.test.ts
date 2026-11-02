import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const helper = new URL('./db-helper.ts', import.meta.url).href;
const target = 'postgresql://127.0.0.1:55143/fixture';

// Keep module mocks in a child so the helper is tested without connecting to
// any database or contaminating the API suite's shared @omni/db module.
function runHelper(env: Record<string, string> = {}, getDb = false) {
  const child = Bun.spawnSync({
    cmd: [
      process.execPath,
      '--eval',
      `import { describe, mock } from 'bun:test';
      const calls = [];
      let queries = 0;
      const db = { execute: async () => {
        queries++;
        if (process.env.FAKE_DB_DOWN === 'true') throw new Error('mock database unavailable');
        return [];
      }};
      mock.module('@omni/db', () => ({ createDb: (config) => { calls.push(config.url); return db; } }));
      try {
        const helper = await import(${JSON.stringify(helper)});
        const cached = ${getDb} ? helper.getTestDb() === helper.getTestDb() : null;
        console.log(JSON.stringify({ enabled: helper.describeWithDb === describe, cached, calls, queries }));
      } catch (error) {
        console.log(JSON.stringify({ error: error.message, calls, queries }));
      }`,
    ],
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LOG_LEVEL: 'silent', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(child.exitCode).toBe(0);
  return JSON.parse(child.stdout.toString()) as {
    error?: string;
    enabled?: boolean;
    cached?: boolean | null;
    calls: string[];
    queries: number;
  };
}

describe('legacy DB helper target safety (mocked, always runs)', () => {
  test('the explicit opt-in remains disabled by default without probing ambient DATABASE_URL', () => {
    expect(runHelper({ DATABASE_URL: target })).toEqual({ enabled: false, cached: null, calls: [], queries: 0 });
  });

  test('an opted-in suite requires TEST_DATABASE_URL instead of ambient DATABASE_URL or a default', () => {
    const result = runHelper({ ENABLE_DB_TESTS: 'true', DATABASE_URL: target });
    expect(result.error).toContain('TEST_DATABASE_URL');
    expect(result.calls).toEqual([]);
    expect(result.queries).toBe(0);
  });

  for (const url of [
    'postgresql://localhost:8432/fixture',
    'postgresql://127.0.0.1:5432/fixture',
    'postgresql://127.0.0.1:15432/fixture',
    'postgresql://db.example.com:55143/fixture',
    'postgresql://127.0.0.1:55143/fixture?host=localhost',
  ])
    test(`refuses unsafe explicit target before creating a handle: ${url}`, () => {
      const result = runHelper({ ENABLE_DB_TESTS: 'true', TEST_DATABASE_URL: url });
      expect(result.error).toContain('Unsafe PostgreSQL test target');
      expect(result.calls).toEqual([]);
      expect(result.queries).toBe(0);
    });

  test('an unregistered loopback target cannot be used through getTestDb either', () => {
    const result = runHelper({ TEST_DATABASE_URL: target }, true);
    expect(result.error).toContain('Unsafe PostgreSQL test target');
    expect(result.calls).toEqual([]);
  });

  test('getTestDb never falls back to DATABASE_URL when TEST_DATABASE_URL is missing', () => {
    const result = runHelper({ DATABASE_URL: target }, true);
    expect(result.error).toContain('TEST_DATABASE_URL');
    expect(result.calls).toEqual([]);
  });

  test('an explicitly registered disposable target enables the suite and reuses its handle', () => {
    expect(
      runHelper({ ENABLE_DB_TESTS: 'true', TEST_DATABASE_URL: target, OMNI_PG_TEST_TARGET: '127.0.0.1:55143' }, true),
    ).toEqual({ enabled: true, cached: true, calls: [target], queries: 1 });
  });

  test('a temporary socket target also enables the suite without using the ambient database', () => {
    const socket = mkdtempSync(join(tmpdir(), 'omni-db-helper-'));
    const url = 'postgresql:///fixture?user=fixture';
    try {
      expect(runHelper({ ENABLE_DB_TESTS: 'true', TEST_DATABASE_URL: url, PGHOST: socket, PGPORT: '55143' })).toEqual({
        enabled: true,
        cached: null,
        calls: [url],
        queries: 1,
      });
    } finally {
      rmSync(socket, { recursive: true, force: true });
    }
  });

  test('an unavailable guarded database still skips as before', () => {
    expect(
      runHelper({
        ENABLE_DB_TESTS: 'true',
        TEST_DATABASE_URL: target,
        OMNI_PG_TEST_TARGET: '127.0.0.1:55143',
        FAKE_DB_DOWN: 'true',
      }),
    ).toEqual({ enabled: false, cached: null, calls: [target], queries: 1 });
  });
});
