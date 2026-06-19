/**
 * Update diagnostics capture.
 *
 * Every `omni update` invocation writes a structured JSON report to
 * `~/.omni/logs/update-diagnostics-<iso>.json` capturing the install attempt,
 * registry probe, restart, verify outcome, cleanup registry result,
 * maintenance hook, and a tail of recent pm2 log signals. The file is the
 * canonical post-mortem artifact: operators paste it into bug reports; the
 * shape mirrors the genie wish (independent code, parity per
 * `SHARED-DESIGN.md` decision #3) so a shared diagnostics consumer can read
 * either CLI's output uniformly. omni starts at `schemaVersion: 1` (decision
 * #4 in the wish: per-repo schema versions are intentionally asymmetric).
 *
 * The writer is best-effort: any failure (no perms, disk full, etc.) is
 * swallowed so update never exits non-zero because diagnostics couldn't be
 * persisted.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { MaintenanceReport, UpdateChannel, VerifyResult } from './commands/update.js';
import type { CleanupReport } from './legacy-cleanup.js';
import { PM2_PROCESSES } from './pm2.js';
import { getPm2LogPaths } from './pm2.js';

/** Stable schema version for omni-side update diagnostics. */
export const UPDATE_DIAGNOSTICS_SCHEMA_VERSION = 1 as const;

/** Captured tail of one pm2 log file (best-effort). */
export interface LogSignal {
  /** Tracked pm2 process name (e.g. `omni-v2-api`). */
  source: string;
  /** Which file (`out` or `error`). */
  stream: 'out' | 'error';
  /** Up to N most recent lines, oldest first. Empty when the file does not exist. */
  lines: string[];
}

/**
 * Outcome of the parallel npm-global install probe (Group 5a). Omni doesn't
 * support npm-global server, but a parallel install hides stale binaries on
 * PATH and confuses `which omni`. Captured here so a future bug report
 * includes the smoking-gun path.
 */
export interface ParallelInstallReport {
  detected: boolean;
  /** Filesystem path to the parallel install (when detected). */
  path?: string;
  /** Reason detection couldn't run, e.g. `npm` not on PATH. */
  skipped?: string;
}

/** Top-level diagnostics record. */
export interface UpdateDiagnostics {
  readonly schemaVersion: typeof UPDATE_DIAGNOSTICS_SCHEMA_VERSION;
  /** ISO-8601 timestamp the run started at (filename derives from this). */
  startedAt: string;
  /** ISO-8601 timestamp diagnostics was finalized (= just before write). */
  finishedAt: string;
  cli: {
    /** CLI version executing this update (the previous one — install hasn't restarted us). */
    runningVersion: string;
    channel: UpdateChannel;
  };
  registry: {
    latestVersion: string | null;
  };
  preflight: {
    /** Did the canonical-pgserve phase-2 check run? False when `--skip-canonical-preflight`. */
    ran: boolean;
    /** Did the check return a blocking error? When true, the run aborted. */
    blocked: boolean;
    /** First line of the rendered error message, when blocked. */
    reason?: string;
  };
  install: {
    attempted: boolean;
    succeeded: boolean | null;
    targetVersion: string | null;
  };
  restart: {
    attempted: boolean;
    succeeded: boolean | null;
    services: string[];
  };
  verify: VerifyResult | null;
  cleanups: CleanupReport | null;
  maintenance: MaintenanceReport | null;
  parallelNpmGlobal: ParallelInstallReport | null;
  recentLogSignals: LogSignal[];
  /** Final exit code — populated by the writer; useful for bug-report triage. */
  exitCode: number;
}

/**
 * Build a fresh diagnostics state with the invariant fields populated.
 * Mutated in-place by `runUpdate` as it advances through the pipeline.
 */
export function createDiagnostics(args: {
  runningVersion: string;
  channel: UpdateChannel;
}): UpdateDiagnostics {
  const startedAt = new Date().toISOString();
  return {
    schemaVersion: UPDATE_DIAGNOSTICS_SCHEMA_VERSION,
    startedAt,
    finishedAt: startedAt,
    cli: { runningVersion: args.runningVersion, channel: args.channel },
    registry: { latestVersion: null },
    preflight: { ran: false, blocked: false },
    install: { attempted: false, succeeded: null, targetVersion: null },
    restart: { attempted: false, succeeded: null, services: [] },
    verify: null,
    cleanups: null,
    maintenance: null,
    parallelNpmGlobal: null,
    recentLogSignals: [],
    exitCode: 0,
  };
}

/** Get the directory diagnostics are written to. Honors `OMNI_CONFIG_DIR`. */
export function getDiagnosticsDir(): string {
  const base = process.env.OMNI_CONFIG_DIR ?? join(homedir(), '.omni');
  return join(base, 'logs');
}

/**
 * Compute the canonical filename for a diagnostics record. The ISO timestamp
 * is sanitized to be filename-safe (`:` → `-`).
 */
export function getDiagnosticsPath(startedAt: string): string {
  const safe = startedAt.replace(/:/g, '-');
  return join(getDiagnosticsDir(), `update-diagnostics-${safe}.json`);
}

/**
 * Read the last `maxLines` lines of a UTF-8 text file. Best-effort: returns
 * an empty array on any error (missing file, perms, decoding issue).
 *
 * Implementation notes:
 *   - We slurp the whole file (pm2 log files are small in steady state and
 *     log-rotated by pm2-logrotate; reading the whole thing is simpler than
 *     a reverse-byte tail and avoids edge cases on multi-byte UTF-8).
 *   - Trailing empty line from a trailing newline is dropped.
 */
export function tailFileLines(path: string, maxLines: number): string[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Collect the most recent log lines from each tracked pm2 process. Skips
 * processes whose log files don't exist (i.e. that have never run on this
 * host). Limited to `maxLinesPerStream` per file to keep diagnostics small.
 *
 * `logPathsFor` is injectable so tests can point at a tmp dir without
 * touching the developer's real `~/.omni/logs` (pm2 log paths don't honor
 * `OMNI_CONFIG_DIR` and we'd rather not change that surface here).
 *
 * This is best-effort and called from the diagnostics writer; never throws.
 */
export function collectRecentLogSignals(
  maxLinesPerStream = 30,
  logPathsFor: (name: string) => { out: string; error: string } = getPm2LogPaths,
): LogSignal[] {
  const signals: LogSignal[] = [];
  for (const name of Object.values(PM2_PROCESSES)) {
    const { out, error } = logPathsFor(name);
    const outLines = tailFileLines(out, maxLinesPerStream);
    if (outLines.length > 0) {
      signals.push({ source: name, stream: 'out', lines: outLines });
    }
    const errLines = tailFileLines(error, maxLinesPerStream);
    if (errLines.length > 0) {
      signals.push({ source: name, stream: 'error', lines: errLines });
    }
  }
  return signals;
}

/**
 * Persist the diagnostics record to `~/.omni/logs/update-diagnostics-*.json`.
 * Returns the path that was written (or null on failure). Never throws —
 * diagnostics is observability, not load-bearing for the update outcome.
 *
 * The exit code is captured into `state.exitCode` and the timestamp into
 * `state.finishedAt` before serialization so the JSON file is a complete
 * snapshot at write time.
 */
export function writeDiagnostics(state: UpdateDiagnostics, exitCode: number): string | null {
  state.exitCode = exitCode;
  state.finishedAt = new Date().toISOString();
  if (state.recentLogSignals.length === 0) {
    state.recentLogSignals = collectRecentLogSignals();
  }
  const dir = getDiagnosticsDir();
  const path = getDiagnosticsPath(state.startedAt);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    return path;
  } catch {
    return null;
  }
}
