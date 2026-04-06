/**
 * install-env-leak tests
 *
 * Verifies the install command never reads `process.env.DATABASE_URL`
 * when computing the default database URL. Before the fix, install.ts
 * had a module-top `DEFAULT_DATABASE_URL = process.env.DATABASE_URL ?? ...`
 * which baked the calling shell's `DATABASE_URL` into pm2's stored env.
 *
 * These tests mutate `process.env.DATABASE_URL` between calls and assert
 * that the resolved install default is unchanged.
 *
 * The tests use the exported pure helpers `computeDefaultDatabaseUrl`
 * and `resolveInstallDatabaseUrl` — running the full install flow would
 * require mocking the entire pm2 + filesystem + prompt subsystems, which
 * is overkill for the hermeticity invariant we actually care about.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { buildEmbeddedDatabaseUrl } from '../runtime-env.js';
import { POLLUTED_DATABASE_URL } from './_fixtures/polluted-env.js';

function clearShellDbUrl(): void {
  // Computed-key form keeps biome's noDelete lint quiet (it only fires on
  // static property deletes). Matches history.test.ts / react-context.test.ts.
  const key = 'DATABASE_URL';
  delete process.env[key];
}

describe('install command — DATABASE_URL leak prevention', () => {
  afterEach(() => {
    clearShellDbUrl();
  });

  test('computeDefaultDatabaseUrl returns the embedded URL regardless of shell env', async () => {
    const { computeDefaultDatabaseUrl } = await import('../commands/install.js');

    clearShellDbUrl();
    const baseline = computeDefaultDatabaseUrl();
    expect(baseline).toBe(buildEmbeddedDatabaseUrl());

    process.env.DATABASE_URL = POLLUTED_DATABASE_URL;
    const polluted = computeDefaultDatabaseUrl();
    expect(polluted).toBe(baseline);
    // Spot-check fragments of the sentinel — if any of these leak into the
    // resolved URL, hermeticity is broken and the test should fail loudly.
    expect(polluted).not.toContain('GARBAGE');
    expect(polluted).not.toContain('evil.invalid');
    expect(polluted).not.toContain('/wrong');
  });

  test('resolveInstallDatabaseUrl returns the embedded default when --database-url is absent', async () => {
    const { resolveInstallDatabaseUrl } = await import('../commands/install.js');

    process.env.DATABASE_URL = POLLUTED_DATABASE_URL;
    const resolved = resolveInstallDatabaseUrl({});
    expect(resolved).toBe(buildEmbeddedDatabaseUrl());
    expect(resolved).not.toContain('GARBAGE');
  });

  test('resolveInstallDatabaseUrl passes through an explicit --database-url flag', async () => {
    const { resolveInstallDatabaseUrl } = await import('../commands/install.js');

    process.env.DATABASE_URL = POLLUTED_DATABASE_URL;
    const explicit = 'postgresql://omni:hunter2@db.example.com:5432/omni_prod';
    const resolved = resolveInstallDatabaseUrl({ databaseUrlFlag: explicit });
    expect(resolved).toBe(explicit);
    // The explicit URL is what the operator opted into, NOT the shell env.
    expect(resolved).not.toContain('GARBAGE');
  });

  test('resolveInstallDatabaseUrl treats whitespace-only flag as absent', async () => {
    const { resolveInstallDatabaseUrl } = await import('../commands/install.js');

    clearShellDbUrl();
    expect(resolveInstallDatabaseUrl({ databaseUrlFlag: '   ' })).toBe(buildEmbeddedDatabaseUrl());
    expect(resolveInstallDatabaseUrl({ databaseUrlFlag: undefined })).toBe(buildEmbeddedDatabaseUrl());
  });

  test('createInstallCommand exposes --database-url flag', async () => {
    const { createInstallCommand } = await import('../commands/install.js');

    const cmd = createInstallCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain('--database-url');
  });
});
