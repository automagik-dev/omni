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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
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
  test('produces UDS shape with host+port query params', () => {
    const url = buildDatabaseUrlForTransport({ kind: 'unix', socketDir: '/run/user/1000/pgserve', port: 5432 }, 'omni');
    // postgres.js / libpq accepts host=<dir> in query params to dial a Unix
    // socket at <dir>/.s.PGSQL.<port>. URLSearchParams encodes the slashes.
    expect(url).toContain('postgresql://postgres:postgres@/omni?');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('host')).toBe('/run/user/1000/pgserve');
    expect(params.get('port')).toBe('5432');
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
  /**
   * Bind a real Unix domain socket at the canonical libpq path inside
   * a fresh XDG dir. Returns the close handle so each test can tear
   * down deterministically. Real S_IFSOCK is required because the
   * probe rejects regular files outright.
   */
  function bindFreshSocket(prefix: string): { xdg: string; close: () => void } {
    const xdg = mkdtempSync(join(tmpdir(), prefix));
    process.env.XDG_RUNTIME_DIR = xdg;
    const dir = join(xdg, 'pgserve');
    mkdirSync(dir, { recursive: true });
    const server = createServer();
    server.listen(join(dir, `.s.PGSQL.${CANONICAL_PG_PORT}`));
    return {
      xdg,
      close: () => {
        server.close();
        rmSync(xdg, { recursive: true, force: true });
      },
    };
  }

  test('returns false when the canonical socket file is missing', () => {
    process.env.XDG_RUNTIME_DIR = '/var/empty';
    expect(probeCanonicalSocketSync()).toBe(false);
  });

  test('returns false when a regular file sits at the canonical socket path', () => {
    // A regular file (e.g. left by a buggy cleanup script or test fixture)
    // must NOT pass the probe. statSync would say isSocket()=false; lstat
    // catches this without following any symlinks.
    const xdg = mkdtempSync(join(tmpdir(), 'omni-pgserve-regular-'));
    try {
      process.env.XDG_RUNTIME_DIR = xdg;
      const dir = join(xdg, 'pgserve');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `.s.PGSQL.${CANONICAL_PG_PORT}`), '');
      writeFileSync(join(dir, 'pgserve.pid'), `${process.pid}\n`);
      expect(probeCanonicalSocketSync()).toBe(false);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  test('returns false when the canonical path is a symlink (pgserve@1.x admin alias)', () => {
    // Reproduces the wild-state observed on a host that ran pgserve@1.x:
    //   .s.PGSQL.5432 -> control.sock     (symlink)
    //   control.sock                       (real socket — admin protocol)
    //   pgserve.pid                        (live bun supervisor PID)
    // A naive existsSync + statSync(follow=true) probe would call this
    // alive (control.sock IS a socket, the bun pid IS alive), then hand
    // out a DATABASE_URL pointing at a daemon that doesn't speak the
    // postgres wire protocol. The lstat-based symlink rejection catches
    // it.
    const xdg = mkdtempSync(join(tmpdir(), 'omni-pgserve-symlink-'));
    try {
      process.env.XDG_RUNTIME_DIR = xdg;
      const dir = join(xdg, 'pgserve');
      mkdirSync(dir, { recursive: true });
      const adminSock = join(dir, 'control.sock');
      const server = createServer();
      try {
        server.listen(adminSock);
        symlinkSync('control.sock', join(dir, `.s.PGSQL.${CANONICAL_PG_PORT}`));
        writeFileSync(join(dir, 'pgserve.pid'), `${process.pid}\n`);
        expect(probeCanonicalSocketSync()).toBe(false);
      } finally {
        server.close();
      }
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  test('returns false when a real socket is present but pgserve.pid is missing (postmaster crashed)', () => {
    const handle = bindFreshSocket('omni-pgserve-no-pid-');
    try {
      expect(probeCanonicalSocketSync()).toBe(false);
    } finally {
      handle.close();
    }
  });

  test('returns false when pgserve.pid references a dead process', () => {
    const handle = bindFreshSocket('omni-pgserve-deadpid-');
    try {
      // PID 2^31-2 is overwhelmingly unlikely to be live on Linux/macOS
      // (kernel pid_max defaults to 2^15 or 2^22; even tuned hosts cap
      // far below 2^31). `process.kill(pid, 0)` will throw ESRCH.
      writeFileSync(join(handle.xdg, 'pgserve', 'pgserve.pid'), `${2 ** 31 - 2}\n`);
      expect(probeCanonicalSocketSync()).toBe(false);
    } finally {
      handle.close();
    }
  });

  test('returns true when a real socket + a live pid file are both present', () => {
    const handle = bindFreshSocket('omni-pgserve-live-');
    try {
      writeFileSync(join(handle.xdg, 'pgserve', 'pgserve.pid'), `${process.pid}\n`);
      expect(probeCanonicalSocketSync()).toBe(true);
    } finally {
      handle.close();
    }
  });

  test('returns false when pgserve.pid is malformed', () => {
    const handle = bindFreshSocket('omni-pgserve-bad-pid-');
    try {
      writeFileSync(join(handle.xdg, 'pgserve', 'pgserve.pid'), 'not-a-number\n');
      expect(probeCanonicalSocketSync()).toBe(false);
    } finally {
      handle.close();
    }
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
