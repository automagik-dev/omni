import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from './client';
import { assertPgTestRole, assertPgTestTarget, ensureSqlTemplate, pgRoleUrl } from './pg-migrated-template';

const socketDir = mkdtempSync(join(tmpdir(), 'omni-pg-target-test-'));
const socketEnv = { PGHOST: socketDir, PGPORT: '7777' };
const gateEnv = { OMNI_PG_TEST_TARGET: '127.0.0.1:7777' };
afterAll(() => rmSync(socketDir, { recursive: true, force: true }));

const role = { name: 'omni_runtime', password: 'disposable password' };

describe('disposable PostgreSQL role URLs', () => {
  test('hostless socket input keeps the role in the startup user parameter', () => {
    const url = new URL(pgRoleUrl('postgresql:///postgres', 'test_db', role, socketEnv));
    expect(url.hostname).toBe('');
    expect(url.pathname).toBe('/test_db');
    expect(url.searchParams.get('user')).toBe(role.name);
    expect(url.toString()).not.toContain(role.password);
  });

  test('an inherited startup user cannot override a hosted role', () => {
    const url = new URL(
      pgRoleUrl('postgresql://super:secret@127.0.0.1:7777/postgres?user=super', 'test_db', role, gateEnv),
    );
    expect(url.username).toBe(role.name);
    expect(decodeURIComponent(url.password)).toBe(role.password);
    expect(url.searchParams.has('user')).toBe(false);
    expect(url.port).toBe('7777');
  });

  test('an inherited startup user is replaced for a hostless role', () => {
    expect(
      new URL(pgRoleUrl('postgresql:///postgres?user=super', 'test_db', role, socketEnv)).searchParams.get('user'),
    ).toBe(role.name);
  });

  test('a superuser fixture without a requested role keeps its original connection options', () => {
    expect(pgRoleUrl('postgresql:///postgres?user=fixture', 'test_db', undefined, socketEnv)).toBe(
      'postgresql:///test_db?user=fixture',
    );
  });
});

describe('PostgreSQL test target guard', () => {
  test('G1 rejects a hostless target at load before its direct psql hooks can run', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', new URL('./multitenancy-postgres.test.ts', import.meta.url).pathname],
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        OMNI_G1_POSTGRES_URL: 'postgresql:///postgres',
        OMNI_G1_PSQL_BIN: 'must-never-run',
        PGPORT: '7777',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('hostless URLs require PGHOST');
    expect(result.stderr.toString()).not.toContain('ENOENT');
  });

  test.each([
    'postgresql://u:x@localhost:5432,127.0.0.1:7777/db',
    'postgresql://u:x@localhost:5432,y@127.0.0.1:7777/db',
    'postgresql://u:x@y@127.0.0.1:7777/db',
  ])('refuses ambiguous raw authorities before parsing: %s', (url) => {
    expect(() => assertPgTestTarget(url, gateEnv)).toThrow('single-host URLs');
    expect(() => pgRoleUrl(url, 'test_db', role, gateEnv)).toThrow('single-host URLs');
  });

  test.each([
    'postgresql://127.0.0.1:7777#,localhost:5432/db',
    'postgresql://127.0.0.1:65432#,localhost:5432/db',
    'postgresql:///postgres#ignored',
  ])('refuses URL fragments before either driver can interpret them: %s', (url) => {
    expect(() => assertPgTestTarget(url, gateEnv)).toThrow('URL fragments');
    expect(() => pgRoleUrl(url, 'test_db', role, gateEnv)).toThrow('URL fragments');
  });

  test.each([
    { url: 'postgresql://?@localhost:5432/db?user=postgres', env: socketEnv },
    { url: 'postgresql://127.0.0.1:7777?@localhost:5432/db', env: gateEnv },
  ])('refuses a raw @ outside the authority before libpq can choose another host: $url', ({ url, env }) => {
    expect(() => assertPgTestTarget(url, env)).toThrow('inside the authority');
    expect(() => pgRoleUrl(url, 'test_db', role, env)).toThrow('inside the authority');
  });

  test.each([
    'OMNI_G1_POSTGRES_URL',
    'OMNI_G2_POSTGRES_URL',
    'OMNI_G3_POSTGRES_URL',
    'OMNI_G4_POSTGRES_URL',
    'OMNI_G6_POSTGRES_URL',
  ])('rejects unsafe %s before a suite can register cleanup hooks', (variable) => {
    const moduleUrl = new URL('./pg-migrated-template.ts', import.meta.url).href;
    const result = Bun.spawnSync({
      cmd: [process.execPath, '-e', `await import(${JSON.stringify(moduleUrl)}); console.log('hooks registered');`],
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        [variable]: 'postgresql:///postgres?host=/tmp/disposable&port=7777',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Unsafe PostgreSQL test target');
    expect(result.stdout.toString()).not.toContain('hooks registered');
  });

  test('accepts only an explicit temporary socket target or gate-registered loopback target', () => {
    expect(() => assertPgTestTarget('postgresql:///postgres', socketEnv)).not.toThrow();
    expect(() => assertPgTestTarget('postgresql://127.0.0.1:7777/postgres', gateEnv)).not.toThrow();
  });

  test('the actual driver must resolve only the declared socket target', () => {
    const ambiguousSocket = mkdtempSync(join(socketDir, 'driver,localhost-'));
    expect(() => assertPgTestTarget('postgresql:///postgres', { ...socketEnv, PGHOST: ambiguousSocket })).toThrow(
      'postgres.js resolved a different host, port or socket path',
    );
  });

  test.each(['5432', '15432'])('refuses shared port %s on both transports even when registered', (port) => {
    expect(() => assertPgTestTarget('postgresql:///postgres', { ...socketEnv, PGPORT: port })).toThrow('forbidden');
    expect(() =>
      assertPgTestTarget(`postgresql://127.0.0.1:${port}/postgres`, {
        OMNI_PG_TEST_TARGET: `127.0.0.1:${port}`,
      }),
    ).toThrow('forbidden');
  });

  test.each(['host=/tmp/disposable', 'port=7777', 'hostaddr=127.0.0.1', 'service=disposable'])(
    'rejects ambiguous query selectors before building role URLs: %s',
    (query) => {
      expect(() => pgRoleUrl(`postgresql:///postgres?${query}`, 'test_db', role, socketEnv)).toThrow(
        'query host/port/service',
      );
    },
  );

  test('refuses the unsafe query-host shape before template provisioning can spawn psql', () => {
    expect(() =>
      ensureSqlTemplate(
        {
          superUrl: 'postgresql:///postgres?host=/tmp/disposable&port=7777',
          psqlBin: 'must-never-run',
        },
        'unused',
        '',
      ),
    ).toThrow('query host/port/service');
  });

  const invalidEnvs: Record<string, string | undefined>[] = [
    {},
    { PGHOST: 'localhost', PGPORT: '7777' },
    { PGHOST: socketDir },
    { ...socketEnv, PGPORT: '7777invalid' },
    { ...socketEnv, PGHOST: '/does-not-exist' },
    { ...socketEnv, PGHOSTADDR: '127.0.0.1' },
    { ...socketEnv, PGSERVICE: 'shared' },
  ];
  test.each(invalidEnvs)('rejects default, non-socket, or overridden hostless targets: %j', (env) => {
    expect(() => assertPgTestTarget('postgresql:///postgres', env)).toThrow('Unsafe PostgreSQL test target');
  });

  test('refuses socket symlinks escaping the temporary directory', () => {
    const escaped = join(socketDir, 'escape');
    symlinkSync('/', escaped);
    expect(() => assertPgTestTarget('postgresql:///postgres', { ...socketEnv, PGHOST: escaped })).toThrow(
      'temporary directory',
    );
  });

  test.each([
    'postgresql://127.0.0.1:7777/postgres',
    'postgresql://127.0.0.1/postgres',
    'postgresql://localhost:7777/postgres',
    'postgresql://example.com:7777/postgres',
  ])('rejects unregistered, default-port or non-gate TCP targets: %s', (url) => {
    expect(() => assertPgTestTarget(url, {})).toThrow('Unsafe PostgreSQL test target');
  });
});

function identityDb(row?: Record<string, unknown>): Database {
  return { execute: async () => (row ? [row] : []) } as unknown as Database;
}

describe('live test-role assertion', () => {
  test('accepts only the expected non-superuser without RLS bypass', async () => {
    await assertPgTestRole(identityDb({ name: role.name, rolsuper: false, rolbypassrls: false }), role.name);
  });

  test.each([
    { name: 'postgres', rolsuper: true, rolbypassrls: true },
    { name: role.name, rolsuper: true, rolbypassrls: false },
    { name: role.name, rolsuper: false, rolbypassrls: true },
    { name: 'another_role', rolsuper: false, rolbypassrls: false },
    { name: role.name },
  ])('rejects wrong or bypassing connected identities: %j', async (row) => {
    await expect(assertPgTestRole(identityDb(row), role.name)).rejects.toThrow('PostgreSQL test role mismatch');
  });

  test('rejects a missing catalog row', async () => {
    await expect(assertPgTestRole(identityDb(), role.name)).rejects.toThrow('no row');
  });
});
