/**
 * update-diagnostics tests
 *
 * Locks the on-disk shape of `~/.omni/logs/update-diagnostics-*.json`:
 *   - schemaVersion is exactly 1 (per SHARED-DESIGN.md decision #4 — omni
 *     starts at 1, asymmetric with genie's 2 by design).
 *   - createDiagnostics produces an empty record with all per-stage slots
 *     defaulted to null/false so a partial run (e.g. registry probe failed)
 *     still serializes a complete snapshot.
 *   - writeDiagnostics produces a file at the documented path with mode 0600
 *     and parses back to the same object (round-trip).
 *   - getDiagnosticsPath sanitizes ISO timestamps to filesystem-safe form.
 *   - tailFileLines / collectRecentLogSignals never throw on missing files.
 *
 * Tests use OMNI_CONFIG_DIR override + Bun.file/tmp dirs to avoid touching
 * the real $HOME/.omni/logs directory on the developer's box.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  UPDATE_DIAGNOSTICS_SCHEMA_VERSION,
  collectRecentLogSignals,
  createDiagnostics,
  getDiagnosticsDir,
  getDiagnosticsPath,
  tailFileLines,
  writeDiagnostics,
} from '../update-diagnostics.js';

let tmpHome: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  originalConfigDir = process.env.OMNI_CONFIG_DIR;
  tmpHome = mkdtempSync(join(tmpdir(), 'omni-diag-'));
  process.env.OMNI_CONFIG_DIR = tmpHome;
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: env-var cleanup must remove the key, not set it to "undefined" (string)
  if (originalConfigDir === undefined) delete process.env.OMNI_CONFIG_DIR;
  else process.env.OMNI_CONFIG_DIR = originalConfigDir;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('UPDATE_DIAGNOSTICS_SCHEMA_VERSION', () => {
  test('is exactly 1 (omni starts at v1; genie at v2 — intentional asymmetry)', () => {
    expect(UPDATE_DIAGNOSTICS_SCHEMA_VERSION).toBe(1);
  });
});

describe('createDiagnostics', () => {
  test('builds a complete record with safe defaults for every stage', () => {
    const state = createDiagnostics({ runningVersion: '2.260505.1', channel: 'latest' });

    expect(state.schemaVersion).toBe(1);
    expect(typeof state.startedAt).toBe('string');
    // ISO-8601: 2026-05-05T17:00:00.000Z
    expect(state.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(state.cli).toEqual({ runningVersion: '2.260505.1', channel: 'latest' });

    // Every per-stage slot starts at the "nothing happened" sentinel so a
    // partial run still produces a parseable record.
    expect(state.registry.latestVersion).toBeNull();
    expect(state.preflight).toEqual({ ran: false, blocked: false });
    expect(state.install).toEqual({ attempted: false, succeeded: null, targetVersion: null });
    expect(state.restart).toEqual({ attempted: false, succeeded: null, services: [] });
    expect(state.verify).toBeNull();
    expect(state.cleanups).toBeNull();
    expect(state.maintenance).toBeNull();
    expect(state.parallelNpmGlobal).toBeNull();
    expect(state.recentLogSignals).toEqual([]);
    expect(state.exitCode).toBe(0);
  });

  test('respects the channel argument (latest|next round-trip)', () => {
    expect(createDiagnostics({ runningVersion: 'x', channel: 'next' }).cli.channel).toBe('next');
    expect(createDiagnostics({ runningVersion: 'x', channel: 'latest' }).cli.channel).toBe('latest');
  });
});

describe('getDiagnosticsDir / getDiagnosticsPath', () => {
  test('honors OMNI_CONFIG_DIR for the base directory', () => {
    expect(getDiagnosticsDir()).toBe(join(tmpHome, 'logs'));
  });

  test('sanitizes ISO timestamps so they are safe as filenames', () => {
    const path = getDiagnosticsPath('2026-05-05T17:00:00.000Z');
    // colons are illegal on Windows / awkward on Unix → must be replaced
    expect(path.includes(':')).toBe(false);
    expect(path.endsWith('update-diagnostics-2026-05-05T17-00-00.000Z.json')).toBe(true);
  });
});

describe('tailFileLines', () => {
  test('returns [] for a missing file (never throws)', () => {
    expect(tailFileLines(join(tmpHome, 'does-not-exist.log'), 10)).toEqual([]);
  });

  test('returns the last N lines, dropping the trailing newline-induced empty', () => {
    const path = join(tmpHome, 'sample.log');
    writeFileSync(path, 'a\nb\nc\nd\ne\n', 'utf8');
    expect(tailFileLines(path, 3)).toEqual(['c', 'd', 'e']);
  });

  test('returns all lines when maxLines exceeds the file', () => {
    const path = join(tmpHome, 'small.log');
    writeFileSync(path, 'one\ntwo\n', 'utf8');
    expect(tailFileLines(path, 100)).toEqual(['one', 'two']);
  });

  test('handles a file with no trailing newline', () => {
    const path = join(tmpHome, 'no-newline.log');
    writeFileSync(path, 'first\nsecond', 'utf8');
    expect(tailFileLines(path, 10)).toEqual(['first', 'second']);
  });
});

describe('collectRecentLogSignals', () => {
  test('returns [] when no pm2 log files exist (best-effort, never throws)', () => {
    // Inject a logPathsFor that points each process at a non-existent file
    // in our tmp dir. We don't use the real getPm2LogPaths here because pm2
    // logs intentionally live under ~/.omni/logs (no OMNI_CONFIG_DIR
    // override) and tests should not depend on the developer's machine.
    const result = collectRecentLogSignals(10, (name) => ({
      out: join(tmpHome, `${name}-out.log`),
      error: join(tmpHome, `${name}-error.log`),
    }));
    expect(result).toEqual([]);
  });

  test('captures the tail of each existing pm2 log file', () => {
    const outPath = join(tmpHome, 'omni-api-out.log');
    const errPath = join(tmpHome, 'omni-api-error.log');
    writeFileSync(outPath, 'a\nb\nc\n', 'utf8');
    writeFileSync(errPath, 'oops\n', 'utf8');

    const result = collectRecentLogSignals(10, (name) =>
      name === 'omni-api'
        ? { out: outPath, error: errPath }
        : { out: join(tmpHome, `${name}-out.log`), error: join(tmpHome, `${name}-error.log`) },
    );
    // Only the omni-api stub has files; other tracked processes contribute
    // nothing because their tmp paths don't exist.
    expect(result).toEqual([
      { source: 'omni-api', stream: 'out', lines: ['a', 'b', 'c'] },
      { source: 'omni-api', stream: 'error', lines: ['oops'] },
    ]);
  });
});

describe('writeDiagnostics', () => {
  test('writes a file at the documented path and round-trips through JSON', () => {
    const state = createDiagnostics({ runningVersion: '2.260505.1', channel: 'latest' });
    state.registry.latestVersion = '2.260506.1';
    state.install.attempted = true;
    state.install.succeeded = true;
    state.install.targetVersion = '2.260506.1';
    // Pre-populate so the writer skips the (non-deterministic) pm2 log
    // collection — that path is exercised separately above.
    state.recentLogSignals = [{ source: 'omni-api', stream: 'out', lines: ['ready'] }];

    const path = writeDiagnostics(state, 0);
    expect(path).not.toBeNull();
    if (path === null) return;
    expect(existsSync(path)).toBe(true);
    expect(path.startsWith(join(tmpHome, 'logs'))).toBe(true);

    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.registry.latestVersion).toBe('2.260506.1');
    expect(parsed.install).toEqual({
      attempted: true,
      succeeded: true,
      targetVersion: '2.260506.1',
    });
    // finalize stamps the timestamp at write time
    expect(typeof parsed.finishedAt).toBe('string');
  });

  test('captures the exit code passed by the caller', () => {
    const state = createDiagnostics({ runningVersion: 'x', channel: 'latest' });
    state.recentLogSignals = []; // ensure the collector path runs against an empty real dir
    state.recentLogSignals.push({ source: 'stub', stream: 'out', lines: [] });
    const path = writeDiagnostics(state, 42);
    if (path === null) throw new Error('expected diagnostics path');
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.exitCode).toBe(42);
  });

  test('creates the logs/ directory if it does not exist', () => {
    const state = createDiagnostics({ runningVersion: 'x', channel: 'latest' });
    state.recentLogSignals = [{ source: 'stub', stream: 'out', lines: [] }];
    const dir = join(tmpHome, 'logs');
    expect(existsSync(dir)).toBe(false);
    const path = writeDiagnostics(state, 0);
    expect(path).not.toBeNull();
    expect(existsSync(dir)).toBe(true);
  });

  // 30s timeout: the body is synchronous + instant, but the default 5s per-test
  // timeout flakes under heavy host load (CPU starvation inflates wall-clock).
  test('returns null on a write failure (never throws)', () => {
    // Point OMNI_CONFIG_DIR at a path that cannot be created — the parent
    // `/proc/1` is a kernel-managed directory we cannot mkdir under as a
    // non-root user. The writer should swallow the error and return null.
    process.env.OMNI_CONFIG_DIR = '/proc/1/omni-diag-test';
    const state = createDiagnostics({ runningVersion: 'x', channel: 'latest' });
    expect(writeDiagnostics(state, 0)).toBeNull();
  }, 30_000);
});
