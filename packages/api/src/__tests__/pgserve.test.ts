/**
 * Tests for embedded pgserve lifecycle — focus on orphan-process guards.
 *
 * Each test injects a fake `SystemCalls` so real `ss`/`lsof`/`ps`/`process.kill`
 * are never executed. This makes the tests deterministic, CI-safe, and fast.
 *
 * Covers the acceptance criteria for wish `omni-install-resilience` Group 1:
 *   - findProcessOnPort parses ss + lsof outputs
 *   - killPostgresByPid refuses non-pgserve cmdlines (word-boundary + path prefix)
 *   - ensureInternalPortFree throws PgserveInternalPortConflict by default
 *   - ensureInternalPortFree kills orphan when OMNI_PGSERVE_FORCE_CLEANUP=true
 *   - killOrphanedPostgres (postmaster.pid path) still works
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PgserveDataDirMissingError,
  PgserveInternalPortConflict,
  PgserveRelativeDataPathError,
  type SystemCalls,
  ensureInternalPortFree,
  findProcessOnPort,
  isAddressInUse,
  isPopulatedPgserveDir,
  killOrphanedPostgres,
  killPostgresByPid,
  resolvePgserveConfig,
  validatePgserveDataDir,
} from '../pgserve';

/**
 * Build a SystemCalls fake with deterministic behavior. Each field defaults to
 * a no-op or throw so tests only have to override what they care about.
 */
interface FakeSysArgs {
  runCommand?: (file: string, args: string[]) => string;
  sendSignal?: (pid: number, signal: NodeJS.Signals | 0) => void;
  sleep?: (ms: number) => Promise<void>;
}

function makeFakeSys(overrides: FakeSysArgs = {}): SystemCalls {
  return {
    runCommand:
      overrides.runCommand ??
      (() => {
        throw new Error('runCommand not stubbed');
      }),
    sendSignal: overrides.sendSignal ?? (() => {}),
    sleep: overrides.sleep ?? (async () => {}),
  };
}

describe('findProcessOnPort', () => {
  test('parses ss -tlnp output and returns pid + cmdline', async () => {
    const sys = makeFakeSys({
      runCommand: (file, _args) => {
        if (file === 'ss') {
          return (
            'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n' +
            'LISTEN 0      128    0.0.0.0:9432        0.0.0.0:*         users:(("postgres",pid=12345,fd=6))\n'
          );
        }
        if (file === 'ps') {
          return `${join(homedir(), '.pgserve', 'bin', 'linux-x64', 'bin', 'postgres')} -D /home/user/.omni/data/pgserve\n`;
        }
        throw new Error(`unexpected command: ${file}`);
      },
    });

    const result = await findProcessOnPort(9432, sys);
    expect(result).not.toBeNull();
    expect(result?.pid).toBe(12345);
    expect(result?.cmdline).toContain('postgres');
  });

  test('returns null when ss reports no listeners and lsof is absent', async () => {
    const sys = makeFakeSys({
      runCommand: (file, _args) => {
        if (file === 'ss') return 'State  Recv-Q Send-Q Local Address:Port\n'; // header only
        if (file === 'lsof') throw new Error('command not found');
        throw new Error(`unexpected command: ${file}`);
      },
    });

    const result = await findProcessOnPort(9432, sys);
    expect(result).toBeNull();
  });

  test('falls back to lsof when ss is unavailable (macOS path)', async () => {
    const sys = makeFakeSys({
      runCommand: (file, _args) => {
        if (file === 'ss') throw new Error('ss: command not found');
        if (file === 'lsof') {
          return (
            'COMMAND   PID USER   FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
            'postgres 67890 user    6u IPv4 0x1234       0t0  TCP *:9432 (LISTEN)\n'
          );
        }
        if (file === 'ps') {
          return `${join(homedir(), '.pgserve', 'bin', 'darwin-arm64', 'bin', 'postgres')} -D /Users/user/.omni/data/pgserve\n`;
        }
        throw new Error(`unexpected command: ${file}`);
      },
    });

    const result = await findProcessOnPort(9432, sys);
    expect(result).not.toBeNull();
    expect(result?.pid).toBe(67890);
    expect(result?.cmdline).toContain('postgres');
  });

  test('returns null when both ss and lsof fail', async () => {
    const sys = makeFakeSys({
      runCommand: () => {
        throw new Error('tool missing');
      },
    });

    const result = await findProcessOnPort(9432, sys);
    expect(result).toBeNull();
  });
});

describe('killPostgresByPid — cmdline validation', () => {
  test('refuses to kill when cmdline has postgres only as substring in shell echo', async () => {
    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    const sys = makeFakeSys({
      sendSignal: (pid, signal) => {
        sentSignals.push({ pid, signal });
      },
    });

    // Shell script that echoes "postgres" — word boundary matches but no pgserve bin path
    const killed = await killPostgresByPid(9999, '/bin/sh -c "echo postgres /tmp/foo"', sys);

    expect(killed).toBe(false);
    expect(sentSignals.length).toBe(0);
  });

  test('refuses to kill a system-installed postgres outside pgserve cache', async () => {
    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    const sys = makeFakeSys({
      sendSignal: (pid, signal) => {
        sentSignals.push({ pid, signal });
      },
    });

    const killed = await killPostgresByPid(
      9999,
      '/usr/lib/postgresql/15/bin/postgres -D /var/lib/postgresql/15/main',
      sys,
    );

    expect(killed).toBe(false);
    expect(sentSignals.length).toBe(0);
  });

  test('refuses to kill when cmdline contains no postgres word', async () => {
    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    const sys = makeFakeSys({
      sendSignal: (pid, signal) => {
        sentSignals.push({ pid, signal });
      },
    });

    const killed = await killPostgresByPid(9999, 'mypostgreslike --daemon', sys);

    expect(killed).toBe(false);
    expect(sentSignals.length).toBe(0);
  });

  test('kills when cmdline points to pgserve binary cache (SIGTERM, exits cleanly)', async () => {
    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    let alive = true;
    const sys = makeFakeSys({
      sendSignal: (pid, signal) => {
        sentSignals.push({ pid, signal });
        if (signal === 'SIGTERM') alive = false;
        if (signal === 0 && !alive) throw new Error('ESRCH');
      },
    });

    const pgserveCmd = `${join(homedir(), '.pgserve', 'bin', 'linux-x64', 'bin', 'postgres')} -D ${join(homedir(), '.omni', 'data', 'pgserve')}`;
    const killed = await killPostgresByPid(12345, pgserveCmd, sys);

    expect(killed).toBe(true);
    expect(sentSignals[0]).toEqual({ pid: 12345, signal: 'SIGTERM' });
  });

  test('escalates to SIGKILL when SIGTERM is ignored for 5+ seconds', async () => {
    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    const sys = makeFakeSys({
      sendSignal: (pid, signal) => {
        sentSignals.push({ pid, signal });
        // Process refuses to die — liveness probes always succeed
      },
    });

    const pgserveCmd = `${join(homedir(), '.pgserve', 'bin', 'linux-x64', 'bin', 'postgres')} -D /tmp/foo`;
    const killed = await killPostgresByPid(12345, pgserveCmd, sys);

    expect(killed).toBe(true);
    const signals = sentSignals.map((s) => s.signal);
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGKILL');
  });

  test('treats ESRCH on SIGTERM (process already dead) as success', async () => {
    const sys = makeFakeSys({
      sendSignal: (_pid, signal) => {
        if (signal === 'SIGTERM') throw new Error('ESRCH: no such process');
      },
    });

    const pgserveCmd = `${join(homedir(), '.pgserve', 'bin', 'linux-x64', 'bin', 'postgres')} -D /tmp/foo`;
    const killed = await killPostgresByPid(12345, pgserveCmd, sys);

    expect(killed).toBe(true);
  });
});

describe('ensureInternalPortFree', () => {
  const originalEnv = process.env.OMNI_PGSERVE_FORCE_CLEANUP;

  beforeEach(() => {
    process.env.OMNI_PGSERVE_FORCE_CLEANUP = undefined;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OMNI_PGSERVE_FORCE_CLEANUP = originalEnv;
    } else {
      process.env.OMNI_PGSERVE_FORCE_CLEANUP = undefined;
    }
  });

  test('no-op when internal port is free', async () => {
    const sys = makeFakeSys({
      runCommand: () => '', // empty output — no listeners
    });

    await expect(ensureInternalPortFree(8432, sys)).resolves.toBeUndefined();
  });

  test('throws PgserveInternalPortConflict when orphan is listening and force-cleanup is off', async () => {
    const sys = makeFakeSys({
      runCommand: (file) => {
        if (file === 'ss') {
          return 'LISTEN 0 128 0.0.0.0:9432 0.0.0.0:* users:(("postgres",pid=12345,fd=6))\n';
        }
        if (file === 'ps') {
          return '/usr/lib/postgresql/15/bin/postgres -D /var/lib/postgresql\n';
        }
        return '';
      },
    });

    let caught: PgserveInternalPortConflict | undefined;
    try {
      await ensureInternalPortFree(8432, sys);
    } catch (err) {
      caught = err as PgserveInternalPortConflict;
    }

    expect(caught).toBeInstanceOf(PgserveInternalPortConflict);
    expect(caught?.port).toBe(9432);
    expect(caught?.pid).toBe(12345);
    expect(caught?.message).toContain('omni install --force-cleanup');
    expect(caught?.message).toContain('OMNI_PGSERVE_FORCE_CLEANUP=true');
  });

  test('kills orphan and proceeds when OMNI_PGSERVE_FORCE_CLEANUP=true', async () => {
    process.env.OMNI_PGSERVE_FORCE_CLEANUP = 'true';

    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    let alive = true;
    let pollCount = 0;

    const pgserveCmd = `${join(homedir(), '.pgserve', 'bin', 'linux-x64', 'bin', 'postgres')} -D ${join(homedir(), '.omni', 'data', 'pgserve')}`;

    const sys = makeFakeSys({
      runCommand: (file) => {
        if (file === 'ss') {
          // First two calls: orphan present. After kill + one post-kill probe: port free.
          pollCount++;
          if (!alive) return ''; // port free after kill
          return 'LISTEN 0 128 0.0.0.0:9432 0.0.0.0:* users:(("postgres",pid=12345,fd=6))\n';
        }
        if (file === 'ps') return `${pgserveCmd}\n`;
        return '';
      },
      sendSignal: (pid, signal) => {
        sentSignals.push({ pid, signal });
        if (signal === 'SIGTERM') alive = false;
        if (signal === 0 && !alive) throw new Error('ESRCH');
      },
    });

    await expect(ensureInternalPortFree(8432, sys)).resolves.toBeUndefined();
    expect(sentSignals.some((s) => s.signal === 'SIGTERM')).toBe(true);
    expect(pollCount).toBeGreaterThan(0);
  });

  test('throws PgserveInternalPortConflict when force-cleanup is on but cmdline fails validation', async () => {
    process.env.OMNI_PGSERVE_FORCE_CLEANUP = 'true';

    const sys = makeFakeSys({
      runCommand: (file) => {
        if (file === 'ss') {
          return 'LISTEN 0 128 0.0.0.0:9432 0.0.0.0:* users:(("weird",pid=54321,fd=6))\n';
        }
        if (file === 'ps') {
          // A system postgres — word boundary matches but not in pgserve cache
          return '/usr/lib/postgresql/15/bin/postgres -D /var/lib/postgresql/15/main\n';
        }
        return '';
      },
    });

    let caught: PgserveInternalPortConflict | undefined;
    try {
      await ensureInternalPortFree(8432, sys);
    } catch (err) {
      caught = err as PgserveInternalPortConflict;
    }

    expect(caught).toBeInstanceOf(PgserveInternalPortConflict);
    expect(caught?.pid).toBe(54321);
  });
});

describe('killOrphanedPostgres — postmaster.pid path (preserved legacy behavior)', () => {
  let tmpDataDir: string;

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'pgserve-test-'));
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  test('kills a valid postgres orphan discovered via postmaster.pid', async () => {
    const pid = 77777;
    writeFileSync(join(tmpDataDir, 'postmaster.pid'), `${pid}\n/some/data/dir\n`);

    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    let alive = true;

    const sys = makeFakeSys({
      runCommand: (file, args) => {
        if (file === 'ps' && args[0] === '-o') {
          return '/home/user/.pgserve/bin/linux-x64/bin/postgres -D /home/user/.omni/data/pgserve\n';
        }
        if (file === 'ss') return ''; // no internal-port orphan
        return '';
      },
      sendSignal: (p, signal) => {
        sentSignals.push({ pid: p, signal });
        if (signal === 0) {
          if (!alive) throw new Error('ESRCH');
          return;
        }
        if (signal === 'SIGTERM') alive = false;
      },
    });

    await killOrphanedPostgres(tmpDataDir, sys);

    // SIGTERM was sent (once liveness check via signal=0 passed, then the kill)
    expect(sentSignals.some((s) => s.pid === pid && s.signal === 'SIGTERM')).toBe(true);
  });

  test('skips kill when postmaster.pid is absent (clean state)', async () => {
    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    const sys = makeFakeSys({
      runCommand: (file) => {
        if (file === 'ss') return '';
        return '';
      },
      sendSignal: (p, signal) => {
        sentSignals.push({ pid: p, signal });
      },
    });

    await killOrphanedPostgres(tmpDataDir, sys);
    // Only possible signal calls would come from the port-scan path finding nothing
    expect(sentSignals.length).toBe(0);
  });

  test('refuses to kill when postmaster.pid points to a non-postgres process', async () => {
    const pid = 88888;
    writeFileSync(join(tmpDataDir, 'postmaster.pid'), `${pid}\n`);

    const sentSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    const sys = makeFakeSys({
      runCommand: (file) => {
        if (file === 'ps') return '/usr/bin/firefox --no-sandbox\n';
        if (file === 'ss') return '';
        return '';
      },
      sendSignal: (p, signal) => {
        sentSignals.push({ pid: p, signal });
      },
    });

    await killOrphanedPostgres(tmpDataDir, sys);

    // Only the liveness probe (signal 0) should have fired — never SIGTERM
    const termSent = sentSignals.some((s) => s.signal === 'SIGTERM' || s.signal === 'SIGKILL');
    expect(termSent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #412 — PGSERVE_DATA path + require-existing guards
// ---------------------------------------------------------------------------

describe('resolvePgserveConfig — #412 env surface', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ['PGSERVE_EMBEDDED', 'PGSERVE_DATA', 'PGSERVE_REQUIRE_EXISTING', 'PGSERVE_ALLOW_RELATIVE_DATA'];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('defaults requireExisting and allowRelativeData to false', () => {
    const cfg = resolvePgserveConfig();
    expect(cfg.requireExisting).toBe(false);
    expect(cfg.allowRelativeData).toBe(false);
  });

  test('reads PGSERVE_REQUIRE_EXISTING=true', () => {
    process.env.PGSERVE_REQUIRE_EXISTING = 'true';
    expect(resolvePgserveConfig().requireExisting).toBe(true);
  });

  test('reads PGSERVE_ALLOW_RELATIVE_DATA=true', () => {
    process.env.PGSERVE_ALLOW_RELATIVE_DATA = 'true';
    expect(resolvePgserveConfig().allowRelativeData).toBe(true);
  });

  // Phase 2 (2026-05-01): embedded mode is now an explicit opt-in.
  // The default flipped from `(PGSERVE_EMBEDDED ?? 'true') === 'true'`
  // (default ON) to `PGSERVE_EMBEDDED === 'true'` (default OFF).
  test('embedded mode defaults to OFF when PGSERVE_EMBEDDED is unset (phase 2)', () => {
    expect(resolvePgserveConfig().enabled).toBe(false);
  });

  test('embedded mode is OFF when PGSERVE_EMBEDDED is anything other than the literal "true"', () => {
    for (const value of ['false', '0', '', 'TRUE', 'yes', 'no']) {
      process.env.PGSERVE_EMBEDDED = value;
      expect(resolvePgserveConfig().enabled).toBe(false);
    }
  });

  test('embedded mode is ON only when PGSERVE_EMBEDDED is exactly "true"', () => {
    process.env.PGSERVE_EMBEDDED = 'true';
    expect(resolvePgserveConfig().enabled).toBe(true);
  });
});

describe('validatePgserveDataDir — relative path rejection (#412)', () => {
  test('accepts absolute path and returns resolved value', () => {
    const result = validatePgserveDataDir({
      enabled: true,
      port: 8432,
      dataDir: '/tmp/pg-abs',
      requireExisting: false,
      allowRelativeData: false,
    });
    expect(result).toBe('/tmp/pg-abs');
  });

  test('throws PgserveRelativeDataPathError when path is relative and opt-in is off', () => {
    let caught: PgserveRelativeDataPathError | undefined;
    try {
      validatePgserveDataDir({
        enabled: true,
        port: 8432,
        dataDir: './.pgserve-data',
        requireExisting: false,
        allowRelativeData: false,
      });
    } catch (err) {
      caught = err as PgserveRelativeDataPathError;
    }

    expect(caught).toBeInstanceOf(PgserveRelativeDataPathError);
    expect(caught?.rawPath).toBe('./.pgserve-data');
    expect(caught?.message).toContain('PGSERVE_ALLOW_RELATIVE_DATA=true');
    expect(caught?.message).toContain('#412');
  });

  test('allows relative path when PGSERVE_ALLOW_RELATIVE_DATA escape hatch is set', () => {
    const result = validatePgserveDataDir({
      enabled: true,
      port: 8432,
      dataDir: './.pgserve-data',
      requireExisting: false,
      allowRelativeData: true,
    });
    // Relative path is resolved against cwd for logging purposes
    expect(result).toContain('.pgserve-data');
  });

  test('memory mode (dataDir=null) passes through without validation', () => {
    const result = validatePgserveDataDir({
      enabled: true,
      port: 8432,
      dataDir: null,
      requireExisting: true, // even with this set, memory mode short-circuits
      allowRelativeData: false,
    });
    expect(result).toBeNull();
  });
});

describe('validatePgserveDataDir — require-existing guard (#412)', () => {
  let tmpDataDir: string;

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'pgserve-412-'));
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  test('throws PgserveDataDirMissingError (missing) when dir does not exist', () => {
    const missingDir = join(tmpdir(), `pgserve-does-not-exist-${Date.now()}`);

    let caught: PgserveDataDirMissingError | undefined;
    try {
      validatePgserveDataDir({
        enabled: true,
        port: 8432,
        dataDir: missingDir,
        requireExisting: true,
        allowRelativeData: false,
      });
    } catch (err) {
      caught = err as PgserveDataDirMissingError;
    }

    expect(caught).toBeInstanceOf(PgserveDataDirMissingError);
    expect(caught?.reason).toBe('missing');
    expect(caught?.message).toContain('does not exist');
  });

  test('throws PgserveDataDirMissingError (not-initialized) when dir exists but has no PG_VERSION', () => {
    // tmpDataDir exists but is empty — mirrors the #412 scenario where a
    // fresh cwd-relative dir was created before pgserve initdb'd it.
    let caught: PgserveDataDirMissingError | undefined;
    try {
      validatePgserveDataDir({
        enabled: true,
        port: 8432,
        dataDir: tmpDataDir,
        requireExisting: true,
        allowRelativeData: false,
      });
    } catch (err) {
      caught = err as PgserveDataDirMissingError;
    }

    expect(caught).toBeInstanceOf(PgserveDataDirMissingError);
    expect(caught?.reason).toBe('not-initialized');
    expect(caught?.message).toContain('PG_VERSION');
  });

  test('accepts populated data dir (with PG_VERSION marker)', () => {
    writeFileSync(join(tmpDataDir, 'PG_VERSION'), '17\n');

    const result = validatePgserveDataDir({
      enabled: true,
      port: 8432,
      dataDir: tmpDataDir,
      requireExisting: true,
      allowRelativeData: false,
    });
    expect(result).toBe(tmpDataDir);
  });

  test('no-op when requireExisting=false even if dir is empty', () => {
    const result = validatePgserveDataDir({
      enabled: true,
      port: 8432,
      dataDir: tmpDataDir,
      requireExisting: false,
      allowRelativeData: false,
    });
    expect(result).toBe(tmpDataDir);
  });
});

describe('isPopulatedPgserveDir', () => {
  test('returns false for empty dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pgserve-empty-'));
    try {
      expect(isPopulatedPgserveDir(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns true when PG_VERSION marker file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pgserve-populated-'));
    try {
      writeFileSync(join(dir, 'PG_VERSION'), '17\n');
      expect(isPopulatedPgserveDir(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns false when dir does not exist at all', () => {
    expect(isPopulatedPgserveDir(join(tmpdir(), `pgserve-missing-${Date.now()}`))).toBe(false);
  });
});

/**
 * Regression guard for automagik-dev/omni#469.
 *
 * `tryStartOnPort` relies on `isAddressInUse` to convert a port-conflict throw
 * into a `null` return, so the `MAX_PORT_RETRIES` loop can advance to port+1.
 * If this check drifts behind Bun's error wording, the fallback silently
 * disengages and a simple port collision surfaces as a fatal main() crash.
 *
 * Both wordings below are observed in production:
 *   - Bun.listen (bun ≥ 1.3.11): "Failed to listen at 127.0.0.1"
 *   - pgserve wrapper:           "Failed to listen on 0.0.0.0:54321"
 */
describe('isAddressInUse', () => {
  test('matches Bun.listen wording ("Failed to listen at <hostname>", no port)', () => {
    expect(isAddressInUse(new Error('Failed to listen at 127.0.0.1'))).toBe(true);
  });

  test('matches pgserve wrapper wording ("Failed to listen on <hostname>:<port>")', () => {
    expect(isAddressInUse(new Error('Failed to listen on 0.0.0.0:54321'))).toBe(true);
  });

  test('matches canonical Node/libuv EADDRINUSE errno string', () => {
    expect(isAddressInUse(new Error('listen EADDRINUSE: address already in use 0.0.0.0:54321'))).toBe(true);
  });

  test('matches lowercase "address already in use" fragment alone', () => {
    expect(isAddressInUse(new Error('bind failed: address already in use'))).toBe(true);
  });

  test('accepts non-Error throwables by stringifying them', () => {
    expect(isAddressInUse('Failed to listen at ::1')).toBe(true);
    expect(isAddressInUse({ toString: () => 'EADDRINUSE' })).toBe(true);
  });

  test('returns false for unrelated errors so they propagate as fatal', () => {
    expect(isAddressInUse(new Error('ENOENT: no such file or directory'))).toBe(false);
    expect(isAddressInUse(new Error('permission denied'))).toBe(false);
    expect(isAddressInUse(undefined)).toBe(false);
    expect(isAddressInUse(null)).toBe(false);
  });
});
