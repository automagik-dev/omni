/**
 * runtime-env tests
 *
 * Covers the hermeticity contract of `buildRuntimeEnv`:
 *   - embedded-mode default is derived from PGSERVE_PORT, not the shell
 *   - an explicit external-DB URL (from config) is passed through verbatim
 *   - mutating `process.env.DATABASE_URL` between calls has NO effect on the
 *     output (the module must never read from the shell)
 *   - all drift-fix fields (OMNI_PACKAGES_DIR, NODE_ENV, LOG_LEVEL) are set
 *
 * This file does NOT mock output.js — it only exercises pure builders.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_SERVER_CONFIG } from '../config.js';
import { DEFAULT_PGSERVE_PORT, buildEmbeddedDatabaseUrl, buildRuntimeEnv, resolveDatabaseUrl } from '../runtime-env.js';

const LEGACY_DEFAULT = 'postgresql://postgres:postgres@localhost:5432/omni';

function clearShellDbUrl(): void {
  // Use computed-key form so biome's noDelete lint (which only fires on
  // static property deletes) is happy — matches history.test.ts pattern.
  const key = 'DATABASE_URL';
  delete process.env[key];
}

describe('buildEmbeddedDatabaseUrl', () => {
  test('uses the default pgserve port when no port is provided', () => {
    expect(buildEmbeddedDatabaseUrl()).toBe(`postgresql://postgres:postgres@localhost:${DEFAULT_PGSERVE_PORT}/omni`);
  });

  test('honors a custom port', () => {
    expect(buildEmbeddedDatabaseUrl(9999)).toBe('postgresql://postgres:postgres@localhost:9999/omni');
  });
});

describe('resolveDatabaseUrl', () => {
  test('returns the embedded URL when server.databaseUrl is the legacy 5432 default', () => {
    const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: LEGACY_DEFAULT };
    expect(resolveDatabaseUrl(config)).toBe(buildEmbeddedDatabaseUrl());
  });

  test('returns the embedded URL when server.databaseUrl is empty', () => {
    const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: '' };
    expect(resolveDatabaseUrl(config)).toBe(buildEmbeddedDatabaseUrl());
  });

  test('passes a non-default configured URL through verbatim', () => {
    const external = 'postgresql://omni:omni@db.example.com:5432/omni_prod';
    const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: external };
    expect(resolveDatabaseUrl(config)).toBe(external);
  });

  test('ignores process.env.DATABASE_URL (hermeticity)', () => {
    clearShellDbUrl();
    process.env.DATABASE_URL = 'postgresql://garbage:1234@evil.invalid/wrong';
    try {
      const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: LEGACY_DEFAULT };
      expect(resolveDatabaseUrl(config)).toBe(buildEmbeddedDatabaseUrl());
    } finally {
      clearShellDbUrl();
    }
  });
});

describe('buildRuntimeEnv', () => {
  test('produces the full hermetic env (canonical default — useCanonicalPgserve undefined)', () => {
    const serverConfig = {
      ...DEFAULT_SERVER_CONFIG,
      port: 8882,
      databaseUrl: LEGACY_DEFAULT,
      dataDir: '/tmp/omni-test',
      nodeEnv: 'production',
      logLevel: 'info',
    };
    const cliConfig = { apiKey: 'omni_sk_test-key' };

    const env = buildRuntimeEnv(serverConfig, cliConfig);

    expect(env.API_PORT).toBe('8882');
    expect(env.DATABASE_URL).toBe(buildEmbeddedDatabaseUrl());
    expect(env.OMNI_API_KEY).toBe('omni_sk_test-key');
    expect(env.MEDIA_STORAGE_PATH).toBe('/tmp/omni-test/media');
    expect(env.OMNI_PACKAGES_DIR).toBe('/tmp/omni-test/packages');
    // Phase 2 (2026-05-01): default flipped. Undefined useCanonicalPgserve
    // now means CANONICAL, not embedded. Operators on legacy who want
    // embedded must explicitly set `useCanonicalPgserve: false`.
    expect(env.PGSERVE_EMBEDDED).toBe('false');
    expect(env.PGSERVE_DATA).toBe('/tmp/omni-test/pgserve');
    expect(env.PGSERVE_PORT).toBe(String(DEFAULT_PGSERVE_PORT));
    expect(env.NATS_URL).toBe('nats://localhost:4222');
    expect(env.NODE_ENV).toBe('production');
    expect(env.LOG_LEVEL).toBe('info');
  });

  test('PGSERVE_EMBEDDED=true only when useCanonicalPgserve is explicitly false (legacy opt-out)', () => {
    const serverConfig = { ...DEFAULT_SERVER_CONFIG, useCanonicalPgserve: false };
    const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
    expect(env.PGSERVE_EMBEDDED).toBe('true');
  });

  test('PGSERVE_EMBEDDED=false when useCanonicalPgserve is explicitly true', () => {
    const serverConfig = { ...DEFAULT_SERVER_CONFIG, useCanonicalPgserve: true };
    const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
    expect(env.PGSERVE_EMBEDDED).toBe('false');
  });

  test('PGSERVE_EMBEDDED=false when useCanonicalPgserve is undefined (default flipped in phase 2)', () => {
    const serverConfig = { ...DEFAULT_SERVER_CONFIG };
    expect(serverConfig.useCanonicalPgserve).toBeUndefined();
    const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
    expect(env.PGSERVE_EMBEDDED).toBe('false');
  });

  test('respects an explicit external-DB URL from config', () => {
    const external = 'postgresql://omni:hunter2@db.prod.example.com:5432/omni';
    const serverConfig = { ...DEFAULT_SERVER_CONFIG, databaseUrl: external };
    const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
    expect(env.DATABASE_URL).toBe(external);
  });

  test('honors dynamic nodeEnv and logLevel from server config (drift-fix)', () => {
    const serverConfig = {
      ...DEFAULT_SERVER_CONFIG,
      nodeEnv: 'development',
      logLevel: 'debug',
    };
    const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('debug');
  });

  test('uses empty string when apiKey is missing from cliConfig', () => {
    const env = buildRuntimeEnv(DEFAULT_SERVER_CONFIG, {});
    expect(env.OMNI_API_KEY).toBe('');
  });

  test('does NOT read process.env.DATABASE_URL — mutation mid-test has no effect', () => {
    clearShellDbUrl();
    const serverConfig = { ...DEFAULT_SERVER_CONFIG, databaseUrl: LEGACY_DEFAULT };

    const first = buildRuntimeEnv(serverConfig, { apiKey: 'k' });

    process.env.DATABASE_URL = 'postgresql://not-real:0000@nowhere/junk';
    const second = buildRuntimeEnv(serverConfig, { apiKey: 'k' });

    clearShellDbUrl();
    const third = buildRuntimeEnv(serverConfig, { apiKey: 'k' });

    // All three must be identical — the shell env mutation is a no-op.
    expect(first.DATABASE_URL).toBe(buildEmbeddedDatabaseUrl());
    expect(second.DATABASE_URL).toBe(first.DATABASE_URL);
    expect(third.DATABASE_URL).toBe(first.DATABASE_URL);
  });
});
