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

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_SERVER_CONFIG } from '../config.js';
import {
  CANONICAL_PG_PORT,
  DEFAULT_PGSERVE_PORT,
  buildCanonicalSocketDatabaseUrl,
  buildEmbeddedDatabaseUrl,
  buildRuntimeEnv,
  resolveDatabaseUrl,
  resolvePgservePort,
} from '../runtime-env.js';

const LEGACY_DEFAULT = 'postgresql://postgres:postgres@localhost:5432/omni';
const LEGACY_PHASE2 = 'postgresql://postgres:postgres@localhost:8432/omni';

function clearShellDbUrl(): void {
  // Use computed-key form so biome's noDelete lint (which only fires on
  // static property deletes) is happy — matches history.test.ts pattern.
  const key = 'DATABASE_URL';
  delete process.env[key];
}

/**
 * Pin XDG_RUNTIME_DIR to a guaranteed-empty path so the new UDS-preference
 * codepath in `resolveDatabaseUrl` always falls through to the legacy TCP
 * URL during tests. CI machines and dev boxes routinely have a live
 * pgserve at `/run/user/<uid>/pgserve/.s.PGSQL.5432`; without this pin,
 * the assertions that target the embedded URL would flake on those hosts.
 */
let prevXdg: string | undefined;
let prevCutover: string | undefined;
beforeEach(() => {
  prevXdg = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = '/var/empty';
  // Disable role-cutover sentinel reads for the legacy hermetic-env
  // assertions. Tests that need to verify the cutover credential
  // override can opt back in by setting OMNI_ROLE_CUTOVER unset.
  prevCutover = process.env.OMNI_ROLE_CUTOVER;
  process.env.OMNI_ROLE_CUTOVER = '0';
});
afterEach(() => {
  if (prevXdg === undefined) {
    // Computed-key form bypasses biome's noDelete lint (matches the
    // `clearShellDbUrl` helper above). Pure assignment to undefined would
    // leave the key materialized as the literal string 'undefined' for
    // downstream env-snapshot consumers, which is worse than removal.
    const key = 'XDG_RUNTIME_DIR';
    delete process.env[key];
  } else {
    process.env.XDG_RUNTIME_DIR = prevXdg;
  }
  if (prevCutover === undefined) {
    const key = 'OMNI_ROLE_CUTOVER';
    delete process.env[key];
  } else {
    process.env.OMNI_ROLE_CUTOVER = prevCutover;
  }
});

describe('buildEmbeddedDatabaseUrl', () => {
  test('uses the default pgserve port when no port is provided', () => {
    expect(buildEmbeddedDatabaseUrl()).toBe(`postgresql://postgres:postgres@localhost:${DEFAULT_PGSERVE_PORT}/omni`);
  });

  test('honors a custom port', () => {
    expect(buildEmbeddedDatabaseUrl(9999)).toBe('postgresql://postgres:postgres@localhost:9999/omni');
  });
});

describe('resolvePgservePort', () => {
  test('falls back to the CANONICAL port (5432), NOT the legacy 8432', () => {
    // Regression guard: the fallback feeds the PGSERVE_PORT env that
    // `omni doctor` probes. Defaulting to 8432 false-FAILed pgserve-reachable
    // on every healthy canonical host.
    expect(resolvePgservePort(DEFAULT_SERVER_CONFIG)).toBe(CANONICAL_PG_PORT);
    expect(resolvePgservePort(DEFAULT_SERVER_CONFIG)).toBe(5432);
  });

  test('honors an explicit server.pgservePort override', () => {
    const config = { ...DEFAULT_SERVER_CONFIG, pgservePort: 6543 } as typeof DEFAULT_SERVER_CONFIG & {
      pgservePort: number;
    };
    expect(resolvePgservePort(config)).toBe(6543);
  });

  test('ignores a non-positive / non-finite override and uses canonical', () => {
    const bad = { ...DEFAULT_SERVER_CONFIG, pgservePort: 0 } as typeof DEFAULT_SERVER_CONFIG & {
      pgservePort: number;
    };
    expect(resolvePgservePort(bad)).toBe(CANONICAL_PG_PORT);
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

  test('PGSERVE_EMBEDDED is pinned to "false" regardless of useCanonicalPgserve (phase-3 consumer-only)', () => {
    // pgserve-singleton-no-proxy G2 deleted the API-side embedded boot
    // path entirely. The env key remains in RuntimeEnv for back-compat
    // with stale pm2 entries, but the value is hard-wired to 'false'.
    // Operators with legacy `useCanonicalPgserve: false` configs get a
    // one-shot warning from `omni doctor --fix`; the env is otherwise
    // a no-op since omni-api no longer reads it.
    for (const value of [true, false, undefined]) {
      const serverConfig = { ...DEFAULT_SERVER_CONFIG, useCanonicalPgserve: value };
      const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
      expect(env.PGSERVE_EMBEDDED).toBe('false');
    }
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

  test('CANONICAL_PG_PORT is re-exported from pgserve-transport (5432)', () => {
    expect(CANONICAL_PG_PORT).toBe(5432);
  });
});

describe('UDS-preference (pgserve-singleton-no-proxy G1)', () => {
  let prevXdg: string | undefined;
  beforeEach(() => {
    prevXdg = process.env.XDG_RUNTIME_DIR;
  });
  afterEach(() => {
    if (prevXdg === undefined) {
      const key = 'XDG_RUNTIME_DIR';
      delete process.env[key];
    } else {
      process.env.XDG_RUNTIME_DIR = prevXdg;
    }
  });

  test('buildCanonicalSocketDatabaseUrl produces a plain @localhost/db form (no libpq host= param)', () => {
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    const url = buildCanonicalSocketDatabaseUrl();
    // postgres.js rejects URLs carrying the libpq `?host=` query param
    // ("unrecognized configuration parameter host"). Socket routing happens
    // via the PGHOST/PGPORT env vars (buildRuntimeEnv); URL is a plain
    // `@localhost/db` form so postgres.js parses it without error.
    expect(url).toBe('postgresql://postgres:postgres@localhost/omni');
    const parsed = new URL(url);
    expect(parsed.search).toBe('');
  });

  test('resolveDatabaseUrl falls back to TCP embedded URL when UDS is absent', () => {
    process.env.XDG_RUNTIME_DIR = '/var/empty';
    const cfg = { ...DEFAULT_SERVER_CONFIG, databaseUrl: '' };
    expect(resolveDatabaseUrl(cfg)).toBe(buildEmbeddedDatabaseUrl());
  });

  test('non-default operator URL is preserved verbatim regardless of UDS state', () => {
    process.env.XDG_RUNTIME_DIR = '/var/empty';
    const external = 'postgresql://omni:omni@db.example.com:5432/omni_prod';
    const cfg = { ...DEFAULT_SERVER_CONFIG, databaseUrl: external };
    expect(resolveDatabaseUrl(cfg)).toBe(external);
  });

  test('legacy phase-2 URL (localhost:8432) is treated as a stale default and re-resolved', () => {
    // pgserve-singleton-no-proxy G1: when an operator's stored databaseUrl
    // points at the phase-2 bun-bridge port `8432`, treat it as a legacy
    // default and re-resolve to the canonical embedded URL on the
    // currently-configured port. Once G2 ships the doctor port-rewrite,
    // this codepath is the safety net for hosts that haven't run doctor.
    const serverConfig = { ...DEFAULT_SERVER_CONFIG, databaseUrl: LEGACY_PHASE2 };
    const env = buildRuntimeEnv(serverConfig, { apiKey: 'k' });
    expect(env.DATABASE_URL).toBe(buildEmbeddedDatabaseUrl());
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
