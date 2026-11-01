import { describe, expect, test } from 'bun:test';
import type { Database } from './client';
import { assertPgTestRole, pgRoleUrl } from './pg-migrated-template';

const role = { name: 'omni_runtime', password: 'disposable password' };

describe('disposable PostgreSQL role URLs', () => {
  test('hostless socket input keeps the role in the startup user parameter', () => {
    const url = new URL(pgRoleUrl('postgresql:///postgres', 'test_db', role));
    expect(url.hostname).toBe('');
    expect(url.pathname).toBe('/test_db');
    expect(url.searchParams.get('user')).toBe(role.name);
    expect(url.toString()).not.toContain(role.password);
  });

  test('an inherited startup user cannot override a hosted role', () => {
    const url = new URL(pgRoleUrl('postgresql://super:secret@127.0.0.1:7777/postgres?user=super', 'test_db', role));
    expect(url.username).toBe(role.name);
    expect(decodeURIComponent(url.password)).toBe(role.password);
    expect(url.searchParams.has('user')).toBe(false);
    expect(url.port).toBe('7777');
  });

  test('an inherited startup user is replaced for a hostless role', () => {
    expect(new URL(pgRoleUrl('postgresql:///postgres?user=super', 'test_db', role)).searchParams.get('user')).toBe(
      role.name,
    );
  });

  test('a superuser fixture without a requested role keeps its original connection options', () => {
    expect(pgRoleUrl('postgresql:///postgres?user=fixture', 'test_db')).toBe('postgresql:///test_db?user=fixture');
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
