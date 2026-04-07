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
import { FAKE_EXTERNAL_DB_URL, FAKE_EXTERNAL_DB_URL_2, POLLUTED_DATABASE_URL } from './_fixtures/polluted-env.js';

/**
 * External-DB sentinel that literally matches the pre-embedded 5432 default.
 * Before the HIGH-1 fix, resolveDatabaseUrl silently rewrote this URL to the
 * embedded 8432 port, which broke operators who passed this exact string via
 * `omni install --database-url` to opt into an external database running on
 * the conventional 5432 port. The resolver must now honor it verbatim.
 */
const EXPLICIT_5432_URL = 'postgresql://postgres:postgres@localhost:5432/omni';

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
  test('preserves an explicit 5432 URL (opt-in external DB, HIGH-1 regression)', () => {
    // Before the fix, this literal string matched LEGACY_DEFAULT_DATABASE_URL
    // and was silently rewritten to the embedded :8432 URL. After the fix,
    // any non-empty stored URL is honored verbatim — the operator opted into
    // this by passing --database-url, and we must not second-guess them.
    const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: EXPLICIT_5432_URL };
    expect(resolveDatabaseUrl(config)).toBe(EXPLICIT_5432_URL);
  });

  test('returns the embedded URL when server.databaseUrl is empty', () => {
    const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: '' };
    expect(resolveDatabaseUrl(config)).toBe(buildEmbeddedDatabaseUrl());
  });

  test('returns the embedded URL when server.databaseUrl is whitespace-only', () => {
    const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: '   ' };
    expect(resolveDatabaseUrl(config)).toBe(buildEmbeddedDatabaseUrl());
  });

  test('passes a non-default configured URL through verbatim', () => {
    const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: FAKE_EXTERNAL_DB_URL };
    expect(resolveDatabaseUrl(config)).toBe(FAKE_EXTERNAL_DB_URL);
  });

  test('ignores process.env.DATABASE_URL (hermeticity)', () => {
    clearShellDbUrl();
    process.env.DATABASE_URL = POLLUTED_DATABASE_URL;
    try {
      // Empty stored URL → should fall through to the embedded URL,
      // regardless of the polluted shell env.
      const config = { ...DEFAULT_SERVER_CONFIG, databaseUrl: '' };
      expect(resolveDatabaseUrl(config)).toBe(buildEmbeddedDatabaseUrl());
    } finally {
      clearShellDbUrl();
    }
  });
});

describe('buildRuntimeEnv', () => {
  test('produces the full hermetic env for embedded mode (empty stored URL)', () => {
    const serverConfig = {
      ...DEFAULT_SERVER_CONFIG,
      port: 8882,
      databaseUrl: '',
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
    expect(env.PGSERVE_EMBEDDED).toBe('true');
    expect(env.PGSERVE_DATA).toBe('/tmp/omni-test/pgserve');
    expect(env.PGSERVE_PORT).toBe(String(DEFAULT_PGSERVE_PORT));
    expect(env.NATS_URL).toBe('nats://localhost:4222');
    expect(env.NODE_ENV).toBe('production');
    expect(env.LOG_LEVEL).toBe('info');
  });

  test('respects an explicit external-DB URL from config', () => {
    const serverConfig = { ...DEFAULT_SERVER_CONFIG, databaseUrl: FAKE_EXTERNAL_DB_URL_2 };
    const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
    expect(env.DATABASE_URL).toBe(FAKE_EXTERNAL_DB_URL_2);
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
    const serverConfig = { ...DEFAULT_SERVER_CONFIG, databaseUrl: '' };

    const first = buildRuntimeEnv(serverConfig, { apiKey: 'k' });

    process.env.DATABASE_URL = POLLUTED_DATABASE_URL;
    const second = buildRuntimeEnv(serverConfig, { apiKey: 'k' });

    clearShellDbUrl();
    const third = buildRuntimeEnv(serverConfig, { apiKey: 'k' });

    // All three must be identical — the shell env mutation is a no-op.
    expect(first.DATABASE_URL).toBe(buildEmbeddedDatabaseUrl());
    expect(second.DATABASE_URL).toBe(first.DATABASE_URL);
    expect(third.DATABASE_URL).toBe(first.DATABASE_URL);
  });
});
