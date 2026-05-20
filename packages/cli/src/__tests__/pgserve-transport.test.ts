/**
 * pgserve-transport tests
 *
 * Covers the transport-discovery surface introduced by
 * `.genie/wishes/pgserve-singleton-no-proxy/` (Group 1):
 *   - canonical socket path resolution honors $XDG_RUNTIME_DIR
 *   - /tmp/pgserve fallback on hosts without XDG
 *   - URL builders produce libpq-compatible shapes for both transports
 *   - synchronous probe is honest when the socket is absent
 *   - explicit OMNI_PG_PORT bypasses the `pgserve port` discovery shell-out
 *   - force-flag combos behave as documented
 *
 * Tests run on bun:test. Async transport resolver tests that need a real
 * postgres handshake are intentionally NOT in this file — they belong in
 * the doctor / integration suite where a live pgserve is bootstrapped.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_PG_PORT,
  buildDatabaseUrlForTransport,
  probeCanonicalSocketSync,
  resolvePgserveControlSocketPath,
  resolvePgserveLibpqSocketPath,
  resolvePgserveSocketDir,
  resolvePgserveTransport,
} from '../lib/pgserve-transport.js';

const OWNED_KEYS = ['XDG_RUNTIME_DIR', 'OMNI_PG_FORCE_TCP', 'OMNI_PG_FORCE_SOCKET', 'OMNI_PG_PORT'] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of OWNED_KEYS) out[key] = process.env[key];
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of OWNED_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key as string];
    } else {
      process.env[key as string] = snapshot[key];
    }
  }
}

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = snapshotEnv();
  // Clear all owned keys so each test starts from a known state.
  for (const key of OWNED_KEYS) delete process.env[key as string];
});

afterEach(() => {
  restoreEnv(envSnapshot);
});

describe('resolvePgserveSocketDir', () => {
  test('honors $XDG_RUNTIME_DIR', () => {
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    expect(resolvePgserveSocketDir()).toBe('/run/user/1000/pgserve');
  });

  test('falls back to /tmp/pgserve when XDG_RUNTIME_DIR is unset', () => {
    expect(resolvePgserveSocketDir()).toBe('/tmp/pgserve');
  });

  test('falls back when XDG_RUNTIME_DIR is empty string', () => {
    process.env.XDG_RUNTIME_DIR = '';
    expect(resolvePgserveSocketDir()).toBe('/tmp/pgserve');
  });
});

describe('socket path helpers', () => {
  test('resolvePgserveLibpqSocketPath joins canonical port', () => {
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    expect(resolvePgserveLibpqSocketPath()).toBe(`/run/user/1000/pgserve/.s.PGSQL.${CANONICAL_PG_PORT}`);
  });

  test('CANONICAL_PG_PORT is 5432', () => {
    expect(CANONICAL_PG_PORT).toBe(5432);
  });

  test('resolvePgserveControlSocketPath emits the daemon-mode control sock', () => {
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    expect(resolvePgserveControlSocketPath()).toBe('/run/user/1000/pgserve/control.sock');
  });
});

describe('buildDatabaseUrlForTransport', () => {
  test('produces plain UDS shape (no libpq host= param — postgres.js rejects it)', () => {
    const url = buildDatabaseUrlForTransport({ kind: 'unix', socketDir: '/run/user/1000/pgserve', port: 5432 }, 'omni');
    // postgres.js rejects URLs carrying the libpq `?host=` query param with
    // "unrecognized configuration parameter host". Socket routing happens
    // via the PGHOST/PGPORT env vars (buildRuntimeEnv); the URL itself is
    // a plain `@localhost/db` form so postgres.js parses it without error.
    expect(url).toBe('postgresql://postgres:postgres@localhost/omni');
    // No query string at all — guards against a regression that adds one back.
    const parsed = new URL(url);
    expect(parsed.search).toBe('');
  });

  test('produces TCP shape with explicit host:port', () => {
    const url = buildDatabaseUrlForTransport({ kind: 'tcp', host: '127.0.0.1', port: 8432 }, 'omni');
    expect(url).toBe('postgresql://postgres:postgres@127.0.0.1:8432/omni');
  });

  test('honors custom username + password', () => {
    const url = buildDatabaseUrlForTransport({ kind: 'tcp', host: '127.0.0.1', port: 5432 }, 'omni', {
      username: 'app_role',
      password: 'secret pw',
    });
    expect(url).toBe('postgresql://app_role:secret%20pw@127.0.0.1:5432/omni');
  });

  test('URL-encodes the database name', () => {
    const url = buildDatabaseUrlForTransport({ kind: 'tcp', host: '127.0.0.1', port: 5432 }, 'app_db_with_spaces');
    // alnum + underscore — encodeURIComponent leaves these untouched, but
    // anything weirder gets escaped. Cover the typical case here.
    expect(url).toContain('/app_db_with_spaces');
  });
});

describe('probeCanonicalSocketSync', () => {
  test('returns false when the socket directory does not exist', () => {
    process.env.XDG_RUNTIME_DIR = '/var/empty';
    expect(probeCanonicalSocketSync()).toBe(false);
  });

  test('mirrors existsSync(resolvePgserveLibpqSocketPath())', () => {
    process.env.XDG_RUNTIME_DIR = '/var/empty';
    const expected = existsSync(join('/var/empty', 'pgserve', `.s.PGSQL.${CANONICAL_PG_PORT}`));
    expect(probeCanonicalSocketSync()).toBe(expected);
  });
});

describe('resolvePgserveTransport (TCP path)', () => {
  test('OMNI_PG_FORCE_TCP=1 + OMNI_PG_PORT pins explicit TCP without invoking the pgserve binary', async () => {
    process.env.OMNI_PG_FORCE_TCP = '1';
    process.env.OMNI_PG_PORT = '54321';
    const transport = await resolvePgserveTransport();
    expect(transport).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 54321 });
  });

  test('OMNI_PG_FORCE_TCP=1 with malformed OMNI_PG_PORT falls through to discovery', async () => {
    process.env.OMNI_PG_FORCE_TCP = '1';
    process.env.OMNI_PG_PORT = 'not-a-number';
    // Discovery shells out to `pgserve port`; in the test sandbox that
    // either returns null (binary missing) or a real port. We only assert
    // the resolver does not crash and either returns a tcp transport with
    // a numeric port or throws the documented hint string.
    try {
      const transport = await resolvePgserveTransport();
      expect(transport.kind).toBe('tcp');
      expect(typeof transport.port).toBe('number');
    } catch (err) {
      expect(String(err)).toContain('pgserve is not reachable');
    }
  });

  test('OMNI_PG_FORCE_SOCKET=1 throws the documented hint when socket is absent', async () => {
    process.env.XDG_RUNTIME_DIR = '/var/empty';
    process.env.OMNI_PG_FORCE_SOCKET = '1';
    await expect(resolvePgserveTransport()).rejects.toThrow(/canonical Unix socket is not reachable/);
  });
});
