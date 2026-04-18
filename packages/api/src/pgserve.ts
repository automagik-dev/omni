/**
 * Embedded pgserve lifecycle
 *
 * Starts an embedded PostgreSQL 17 server (via pgserve) in-process so the API owns the database.
 * Eliminates orphan-process / EADDRINUSE issues from running pgserve as a
 * separate PM2 service.
 *
 * Controlled by env vars:
 *   PGSERVE_EMBEDDED            — 'true' (default) to start in-process, 'false' to skip
 *   PGSERVE_PORT                — port for the embedded PostgreSQL proxy (default 8432)
 *   PGSERVE_DATA                — data directory path; defaults to ~/.omni/data/pgserve (set to empty string for memory mode)
 *   PGSERVE_ALLOW_RELATIVE_DATA — when 'true', allows PGSERVE_DATA to be a relative path (DANGEROUS — PM2 cwd drift can swap data dirs). Default: reject.
 *   PGSERVE_REQUIRE_EXISTING    — when 'true', refuse to start if the data dir is missing or not an initialized PostgreSQL cluster (no PG_VERSION file). Prevents silent initdb after PM2 cwd drift.
 *   OMNI_PGSERVE_FORCE_CLEANUP  — when 'true', aggressively kills any postgres holding the internal port (PGSERVE_PORT + 1000) at startup
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createLogger } from '@omni/core';
import { getDefaultDatabaseUrl } from '@omni/db';

const log = createLogger('api:pgserve');

const MAX_PORT_RETRIES = 10;
/** Internal postgres port offset: pgserve exposes a proxy on P and runs postgres on P + 1000 */
const INTERNAL_PORT_OFFSET = 1000;

/**
 * ICU libraries whose soname links the bundled postgres binary's DT_NEEDED
 * entries require. Used by `ensureLibicuSymlinks` below.
 */
const ICU_LIBS = ['libicui18n', 'libicuuc', 'libicudata'] as const;

export interface PgserveConfig {
  enabled: boolean;
  port: number;
  dataDir: string | null;
  /**
   * When true, abort startup if the data dir does not exist or is not a
   * populated PostgreSQL cluster. Set via PGSERVE_REQUIRE_EXISTING=true.
   */
  requireExisting: boolean;
  /**
   * When true, allow a relative PGSERVE_DATA path. By default relative paths
   * are rejected because PM2's persisted cwd can drift (see #412), causing
   * pgserve to silently initdb a fresh data dir under the new cwd.
   */
  allowRelativeData: boolean;
}

/**
 * Thrown when PGSERVE_DATA is a relative path and the explicit opt-in flag
 * PGSERVE_ALLOW_RELATIVE_DATA=true is not set. Prevents the PM2 cwd-drift
 * failure mode from #412 (silent switch to a fresh, empty data dir).
 */
export class PgserveRelativeDataPathError extends Error {
  public readonly rawPath: string;
  public readonly resolvedPath: string;

  constructor(rawPath: string, resolvedPath: string) {
    super(
      `PGSERVE_DATA is a relative path ("${rawPath}" → resolved to "${resolvedPath}" against cwd "${process.cwd()}"). Relative data paths are rejected because PM2's persisted cwd can drift across restarts, causing the embedded PostgreSQL to silently initdb a fresh, empty data dir in the wrong location (see #412). To remediate:\n  1. Set PGSERVE_DATA to an absolute path (e.g. /home/<user>/.omni/data/pgserve).\n  2. Or, if you truly want a cwd-relative dev path, set PGSERVE_ALLOW_RELATIVE_DATA=true.`,
    );
    this.name = 'PgserveRelativeDataPathError';
    this.rawPath = rawPath;
    this.resolvedPath = resolvedPath;
  }
}

/**
 * Thrown when PGSERVE_REQUIRE_EXISTING=true is set and the configured data
 * dir is missing or has no `PG_VERSION` marker (i.e. pgserve would initdb).
 * Fails closed so an accidental cwd/path swap does not bring the API up on
 * an empty database.
 */
export class PgserveDataDirMissingError extends Error {
  public readonly dataDir: string;
  public readonly reason: 'missing' | 'not-initialized';

  constructor(dataDir: string, reason: 'missing' | 'not-initialized') {
    const detail =
      reason === 'missing'
        ? 'directory does not exist'
        : 'directory exists but has no PG_VERSION file — this is NOT an initialized PostgreSQL cluster';
    super(
      `PGSERVE_REQUIRE_EXISTING=true is set but PGSERVE_DATA="${dataDir}" ${detail}. Refusing to initdb a fresh data dir (see #412). To remediate:\n  1. Verify PGSERVE_DATA points to the canonical data dir (absolute path).\n  2. Check PM2's persisted cwd — \`pm2 describe omni-v2-api\` → \`exec cwd\`.\n  3. If this IS a first-run install, unset PGSERVE_REQUIRE_EXISTING.`,
    );
    this.name = 'PgserveDataDirMissingError';
    this.dataDir = dataDir;
    this.reason = reason;
  }
}

/** Minimal shape of the pgserve server instance (pgserve ships no type declarations). */
interface PgserveInstance {
  stop(): Promise<void>;
}

/**
 * Thrown when an unrelated process is holding the pgserve internal port at startup.
 * Causes the API process to fail fast instead of silently proxying to an unknown postgres.
 */
export class PgserveInternalPortConflict extends Error {
  public readonly port: number;
  public readonly pid: number;
  public readonly cmdline: string;

  constructor(port: number, pid: number, cmdline: string) {
    const shortCmd = cmdline.length > 200 ? `${cmdline.slice(0, 200)}…` : cmdline;
    super(
      `Pgserve internal port ${port} held by PID ${pid} (${shortCmd}). Refusing to start to avoid silently proxying to an unrelated postgres process. To remediate:\n  operator path:    omni install --force-cleanup\n  automation path:  OMNI_PGSERVE_FORCE_CLEANUP=true omni start`,
    );
    this.name = 'PgserveInternalPortConflict';
    this.port = port;
    this.pid = pid;
    this.cmdline = cmdline;
  }
}

let serverInstance: PgserveInstance | null = null;

/**
 * Read pgserve-related env vars and return a typed config object.
 *
 * Does NOT validate the path here — call `validatePgserveDataDir` after
 * resolving so tests can exercise parsing independently from filesystem
 * checks. Falls back to the canonical `~/.omni/data/pgserve` when
 * `PGSERVE_DATA` is unset (the default is always absolute).
 */
export function resolvePgserveConfig(): PgserveConfig {
  const enabled = (process.env.PGSERVE_EMBEDDED ?? 'true') === 'true';
  const port = Number.parseInt(process.env.PGSERVE_PORT ?? '8432', 10);
  const raw = process.env.PGSERVE_DATA;
  // Default to persistent storage inside ~/.omni/data/pgserve — never memory mode unless explicitly empty
  const defaultDataDir = join(homedir(), '.omni', 'data', 'pgserve');
  const dataDir = raw?.trim() === '' ? null : raw?.trim() || defaultDataDir;
  const requireExisting = process.env.PGSERVE_REQUIRE_EXISTING === 'true';
  const allowRelativeData = process.env.PGSERVE_ALLOW_RELATIVE_DATA === 'true';

  return { enabled, port, dataDir, requireExisting, allowRelativeData };
}

/**
 * Return true when `dataDir` contains a PostgreSQL `PG_VERSION` marker.
 * That file is written by `initdb` and is the canonical signal that a
 * directory is a populated cluster (not just an empty dir a fresh initdb
 * is about to fill).
 *
 * Exported so tests can exercise the guard without touching real directories.
 */
export function isPopulatedPgserveDir(dataDir: string): boolean {
  return existsSync(join(dataDir, 'PG_VERSION'));
}

/**
 * Validate the resolved PGSERVE_DATA path against operator intent:
 *
 *   1. Relative paths are rejected unless PGSERVE_ALLOW_RELATIVE_DATA=true.
 *      Rationale: PM2 persists its cwd across restarts; if the operator ran
 *      `pm2 save` from a different directory, a relative path resolves to a
 *      different filesystem location and pgserve silently initdb's a fresh
 *      cluster there — the 2026-04-14 incident (#412).
 *
 *   2. If PGSERVE_REQUIRE_EXISTING=true, the dir must exist AND contain a
 *      `PG_VERSION` file (i.e. it is an initialized cluster, not an empty
 *      placeholder). Fails closed so a wrong-cwd restart never brings the
 *      API up against an empty migrations-applied database.
 *
 * Both checks write a structured fatal log before throwing so the condition
 * is obvious in PM2's log feed.
 */
export function validatePgserveDataDir(config: PgserveConfig): string | null {
  if (config.dataDir === null) return null; // memory mode — nothing to validate

  const raw = config.dataDir;
  const resolved = resolve(raw);

  if (!isAbsolute(raw) && !config.allowRelativeData) {
    log.error('Refusing to start: PGSERVE_DATA is a relative path', {
      rawPath: raw,
      resolvedPath: resolved,
      cwd: process.cwd(),
      hint: 'Set PGSERVE_DATA to an absolute path, or set PGSERVE_ALLOW_RELATIVE_DATA=true for dev.',
    });
    throw new PgserveRelativeDataPathError(raw, resolved);
  }

  if (config.requireExisting) {
    if (!existsSync(resolved)) {
      log.error('Refusing to start: PGSERVE_REQUIRE_EXISTING=true but data dir is missing', {
        dataDir: resolved,
        cwd: process.cwd(),
      });
      throw new PgserveDataDirMissingError(resolved, 'missing');
    }
    if (!isPopulatedPgserveDir(resolved)) {
      log.error(
        'Refusing to start: PGSERVE_REQUIRE_EXISTING=true but data dir is not an initialized PostgreSQL cluster (no PG_VERSION)',
        {
          dataDir: resolved,
          cwd: process.cwd(),
        },
      );
      throw new PgserveDataDirMissingError(resolved, 'not-initialized');
    }
  }

  return resolved;
}

function isAddressInUse(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // pgserve throws "Failed to listen on 0.0.0.0:<port>" when the proxy port is taken
  return msg.includes('EADDRINUSE') || msg.includes('address already in use') || msg.includes('Failed to listen on');
}

function buildDatabaseUrl(port: number): string {
  return `postgresql://postgres:postgres@localhost:${port}/omni`;
}

/**
 * System-call surface extracted so tests can inject fakes for `ss`, `lsof`, `ps`,
 * `process.kill`, and timing without touching the real OS.
 */
export interface SystemCalls {
  /** Run a command and return stdout as a string. Throws on non-zero exit. */
  runCommand: (file: string, args: string[]) => string;
  /** Send a signal to a PID. Signal 0 is a liveness probe (throws ESRCH when dead). */
  sendSignal: (pid: number, signal: NodeJS.Signals | 0) => void;
  /** Async sleep — abstracted so tests can control timing. */
  sleep: (ms: number) => Promise<void>;
}

const defaultSys: SystemCalls = {
  runCommand: (file, args) => execFileSync(file, args, { encoding: 'utf-8' }),
  sendSignal: (pid, signal) => {
    process.kill(pid, signal as NodeJS.Signals);
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Look up the command line of a running PID via `ps -o command= -p <pid>`.
 * Returns empty string if the process is gone or ps fails.
 */
function getCmdlineForPid(pid: number, sys: SystemCalls): string {
  try {
    return sys.runCommand('ps', ['-o', 'command=', '-p', String(pid)]).trim();
  } catch {
    return '';
  }
}

/**
 * Find the process currently listening on a TCP port.
 *
 * Tries Linux `ss -tlnp` first, then falls back to macOS `lsof`.
 * Returns null when the port is free (or when tooling fails — fail-open is safe
 * because the subsequent bind will report EADDRINUSE).
 */
export async function findProcessOnPort(
  port: number,
  sys: SystemCalls = defaultSys,
): Promise<{ pid: number; cmdline: string } | null> {
  // Strategy 1: Linux `ss -tlnp sport = :<port>`
  // Sample output: LISTEN 0 128 0.0.0.0:9432 0.0.0.0:* users:(("postgres",pid=12345,fd=6))
  try {
    const ssOut = sys.runCommand('ss', ['-tlnp', `sport = :${port}`]);
    const match = ssOut.match(/pid=(\d+)/);
    if (match?.[1]) {
      const pid = Number.parseInt(match[1], 10);
      if (!Number.isNaN(pid) && pid > 0) {
        return { pid, cmdline: getCmdlineForPid(pid, sys) };
      }
    }
  } catch {
    // `ss` not available (macOS) or no rows — fall through to lsof
  }

  // Strategy 2: macOS / BSD `lsof -iTCP:<port> -sTCP:LISTEN -P -n`
  // Sample output:
  //   COMMAND   PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
  //   postgres 12345 user  6u IPv4 0x1234 0t0 TCP *:9432 (LISTEN)
  try {
    const lsofOut = sys.runCommand('lsof', [`-iTCP:${port}`, '-sTCP:LISTEN', '-P', '-n']);
    const lines = lsofOut.split('\n').filter((l) => l.trim().length > 0);
    // Skip header line
    for (const line of lines.slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 2) {
        const pid = Number.parseInt(cols[1] ?? '', 10);
        if (!Number.isNaN(pid) && pid > 0) {
          return { pid, cmdline: getCmdlineForPid(pid, sys) };
        }
      }
    }
  } catch {
    // lsof not available or no listeners — port is free (or we can't tell, either way let caller proceed)
  }

  return null;
}

/**
 * Validate that a cmdline refers to an actual pgserve-managed postgres binary
 * (not a shell script that happens to contain the word "postgres", and not a
 * system-installed postgres outside pgserve's cache directory).
 *
 * Two conditions must BOTH hold:
 *   1. `\bpostgres\b` — word boundary match (not a substring like "mypostgreslike")
 *   2. The cmdline contains the canonical pgserve bin path prefix
 *      (`~/.pgserve/bin/…/postgres`) OR is running against our data dir
 *
 * This prevents `killPostgresByPid` from ever killing `/bin/sh -c "echo postgres ..."`
 * or `/usr/lib/postgresql/15/bin/postgres` (system package, not ours).
 */
function isPgserveManagedPostgres(cmdline: string): boolean {
  // Condition 1: word-boundary match for "postgres"
  if (!/\bpostgres\b/.test(cmdline)) return false;

  // Condition 2: canonical pgserve bin path prefix
  const pgserveBinRoot = join(homedir(), '.pgserve', 'bin');
  if (cmdline.includes(pgserveBinRoot)) return true;

  // Alternative signature: the postgres binary is being pointed at our data dir.
  // Covers cases where the binary path is an absolute resolution of the pgserve cache.
  const pgserveDataRoot = join(homedir(), '.omni', 'data', 'pgserve');
  if (cmdline.includes(pgserveDataRoot)) return true;

  return false;
}

/**
 * Kill a process by PID after verifying it is a pgserve-managed postgres.
 *
 * Workflow: validate cmdline → SIGTERM → wait up to 5 s → SIGKILL.
 * Returns true if the process was killed (or already dead), false if the cmdline
 * check refused the kill.
 */
export async function killPostgresByPid(pid: number, cmdline: string, sys: SystemCalls = defaultSys): Promise<boolean> {
  if (!isPgserveManagedPostgres(cmdline)) {
    log.warn('Refusing to kill process — cmdline is not a pgserve-managed postgres', {
      pid,
      cmdline: cmdline.slice(0, 200),
    });
    return false;
  }

  log.info('Killing orphan pgserve postgres by PID', {
    pid,
    cmdline: cmdline.slice(0, 120),
  });

  try {
    sys.sendSignal(pid, 'SIGTERM');
  } catch {
    return true; // already dead — treat as success
  }

  // Wait up to 5 s for graceful exit (50 × 100 ms)
  for (let i = 0; i < 50; i++) {
    await sys.sleep(100);
    try {
      sys.sendSignal(pid, 0);
    } catch {
      return true; // exited cleanly
    }
  }

  try {
    sys.sendSignal(pid, 'SIGKILL');
  } catch {
    // already dead
  }
  return true;
}

/**
 * Ensure the internal port for a given proxy port is free before pgserve tries
 * to bind it. When an unrelated process holds it, either:
 *   - throw `PgserveInternalPortConflict` (default — fail loud)
 *   - kill it via `killPostgresByPid` (when OMNI_PGSERVE_FORCE_CLEANUP=true)
 *
 * Exported for testing.
 */
export async function ensureInternalPortFree(proxyPort: number, sys: SystemCalls = defaultSys): Promise<void> {
  const internalPort = proxyPort + INTERNAL_PORT_OFFSET;
  const holder = await findProcessOnPort(internalPort, sys);
  if (!holder) return;

  const forceCleanup = process.env.OMNI_PGSERVE_FORCE_CLEANUP === 'true';
  if (!forceCleanup) {
    log.error('Pgserve internal port held by external process — refusing to start', {
      proxyPort,
      internalPort,
      pid: holder.pid,
      cmdline: holder.cmdline.slice(0, 200),
    });
    throw new PgserveInternalPortConflict(internalPort, holder.pid, holder.cmdline);
  }

  log.warn('OMNI_PGSERVE_FORCE_CLEANUP=true — killing process on pgserve internal port', {
    proxyPort,
    internalPort,
    pid: holder.pid,
    cmdline: holder.cmdline.slice(0, 120),
  });

  const killed = await killPostgresByPid(holder.pid, holder.cmdline, sys);
  if (!killed) {
    // Refused to kill (cmdline didn't validate) — surface the conflict so the operator can act
    throw new PgserveInternalPortConflict(internalPort, holder.pid, holder.cmdline);
  }

  // Wait for the port to actually free up (up to 5 s)
  for (let i = 0; i < 50; i++) {
    await sys.sleep(100);
    const stillHeld = await findProcessOnPort(internalPort, sys);
    if (!stillHeld) return;
  }
  throw new PgserveInternalPortConflict(internalPort, holder.pid, holder.cmdline);
}

/**
 * Kill any orphaned postgres process left over from a previous run.
 *
 * Two discovery strategies, run in order:
 *
 *   1. Read `postmaster.pid` inside the current data dir (primary — catches unclean
 *      shutdowns where bun crashed but its postgres child survived).
 *   2. Scan the pgserve internal port via `findProcessOnPort` (secondary — catches
 *      cross-CWD and cross-install orphans whose postmaster.pid lives in a different
 *      data dir we can't see).
 *
 * Both strategies validate the cmdline before issuing SIGTERM/SIGKILL, so a PID
 * belonging to an unrelated process (recycled by the OS, or a system postgres) is
 * left alone.
 */
export async function killOrphanedPostgres(dataDir: string, sys: SystemCalls = defaultSys): Promise<void> {
  // Strategy 1: postmaster.pid inside the data dir
  const pidFile = join(dataDir, 'postmaster.pid');
  if (existsSync(pidFile)) {
    await killOrphanedByPidFile(pidFile, dataDir, sys);
  }

  // Strategy 2: internal-port scan — catches cross-CWD orphans
  const config = resolvePgserveConfig();
  const internalPort = config.port + INTERNAL_PORT_OFFSET;
  const holder = await findProcessOnPort(internalPort, sys);
  if (holder) {
    log.info('Discovered orphan postgres on pgserve internal port (cross-CWD cleanup)', {
      internalPort,
      pid: holder.pid,
      cmdline: holder.cmdline.slice(0, 120),
    });
    // killPostgresByPid validates cmdline — safe to call even if it's not ours
    await killPostgresByPid(holder.pid, holder.cmdline, sys);
  }
}

/**
 * Primary orphan-cleanup path: read postmaster.pid and kill if it's a postgres
 * process we own. Extracted so tests can exercise it independently.
 */
async function killOrphanedByPidFile(pidFile: string, dataDir: string, sys: SystemCalls): Promise<void> {
  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim().split('\n')[0] ?? '', 10);
    if (Number.isNaN(pid) || pid <= 0) return;
    sys.sendSignal(pid, 0); // throws ESRCH if not running — nothing to do
  } catch {
    return; // process not running or file unreadable — clean state
  }

  // Validate the PID actually belongs to a postgres process to avoid killing
  // an unrelated process if the OS recycled the PID after a crash/reboot.
  let cmd: string;
  try {
    cmd = sys.runCommand('ps', ['-o', 'command=', '-p', String(pid)]).trim();
  } catch {
    // ps failed — process may have just exited, safe to return
    return;
  }

  if (!/\bpostgres\b/i.test(cmd)) {
    log.warn('PID from postmaster.pid is not a postgres process, skipping kill', {
      pid,
      dataDir,
      cmd: cmd.slice(0, 80),
    });
    return;
  }

  log.info('Killing orphaned postgres from previous run', { pid, dataDir });
  try {
    sys.sendSignal(pid, 'SIGTERM');
  } catch {
    return;
  }

  // Wait up to 5 s for graceful exit, then SIGKILL
  for (let i = 0; i < 50; i++) {
    await sys.sleep(100);
    try {
      sys.sendSignal(pid, 0);
    } catch {
      return; // exited cleanly
    }
  }
  try {
    sys.sendSignal(pid, 'SIGKILL');
  } catch {
    // already dead
  }
}

/**
 * Ensure `@embedded-postgres/linux-x64/native/lib/` has the libicu soname
 * symlinks (`libicuXXX.so.60`) that the bundled postgres binary's DT_NEEDED
 * entries require. The upstream package occasionally ships only the
 * fully-versioned files (`libicuXXX.so.60.N`), causing startup to fail with
 * "cannot open shared object file: libicui18n.so.60".
 *
 * This runs BEFORE `await import('pgserve')` in `startEmbeddedPgserve` to
 * catch the gap before the native binary is loaded. Synchronous by design.
 *
 * Strategy:
 *   1. Prefer the canonical CJS script at `scripts/ensure-libicu-symlinks.cjs`
 *      — loaded via `createRequire` when available (dev / monorepo path).
 *   2. Fall back to inline logic when the CJS script can't be located
 *      (e.g., bundled CLI builds where `scripts/` isn't shipped alongside
 *      the bundle output).
 *
 * KEEP IN SYNC with `scripts/ensure-libicu-symlinks.cjs`. Both implementations
 * must agree on: which libraries to patch (ICU_LIBS), how source files are
 * matched (`libXXX.so.60.N`), and how the symlink is created (relative basename).
 */
type LibicuShimResult = {
  libDir: string | null;
  created: string[];
  errors: Array<{ step: string; file?: string; error: string }>;
};

/** Try the canonical CJS script. Returns true if it was found and executed. */
function tryLibicuShimScript(requireFn: NodeJS.Require): boolean {
  const candidates = [
    // dev / monorepo: packages/api/src → <repo>/scripts/
    '../../../scripts/ensure-libicu-symlinks.cjs',
    // bundled CLI: script copied next to the bundle output (if ever shipped)
    './ensure-libicu-symlinks.cjs',
  ];
  for (const rel of candidates) {
    try {
      const shim = requireFn(rel) as { ensureLibicuSymlinks: () => LibicuShimResult };
      const result = shim.ensureLibicuSymlinks();
      if (result.created.length > 0) {
        log.info('libicu shim: created missing soname symlinks', {
          libDir: result.libDir,
          created: result.created,
        });
      }
      for (const err of result.errors) {
        log.warn('libicu shim: error creating symlink', err);
      }
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

/**
 * Walk up from the resolved package main to find the package root containing
 * a package.json. Handles bun's isolated-install symlink layout.
 */
function resolveEmbeddedPostgresLibDir(requireFn: NodeJS.Require): string | null {
  try {
    const main = requireFn.resolve('@embedded-postgres/linux-x64');
    let cur = dirname(main);
    for (let i = 0; i < 20 && cur !== '/' && cur !== '.'; i++) {
      if (existsSync(join(cur, 'package.json'))) {
        return join(cur, 'native', 'lib');
      }
      cur = dirname(cur);
    }
    return null;
  } catch {
    return null; // package not installed
  }
}

/** Create the `.so.60` symlink for a single libicu family if missing. */
function linkSingleLib(libName: string, entries: string[], libDir: string, created: string[]): void {
  const sourceRe = new RegExp(`^${libName}\\.so\\.60\\.\\d+$`);
  const sourceFile = entries.find((f) => sourceRe.test(f));
  if (!sourceFile) return;

  const sonameLink = `${libName}.so.60`;
  const linkPath = join(libDir, sonameLink);
  if (existsSync(linkPath)) return;

  try {
    symlinkSync(sourceFile, linkPath);
    created.push(sonameLink);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') return;
    log.warn('libicu inline fallback: error creating symlink', {
      file: sonameLink,
      libDir,
      error: String(err),
      hint: `If permission denied, run manually: ln -s ${sourceFile} ${linkPath}`,
    });
  }
}

/** Inline fallback — mirrors scripts/ensure-libicu-symlinks.cjs. */
function runLibicuInlineFallback(requireFn: NodeJS.Require): void {
  const libDir = resolveEmbeddedPostgresLibDir(requireFn);
  if (!libDir || !existsSync(libDir)) return;

  let entries: string[];
  try {
    entries = readdirSync(libDir);
  } catch (err) {
    log.warn('libicu inline fallback: failed to read native lib dir (non-fatal)', {
      libDir,
      error: String(err),
    });
    return;
  }

  const created: string[] = [];
  for (const libName of ICU_LIBS) {
    linkSingleLib(libName, entries, libDir, created);
  }
  if (created.length > 0) {
    log.info('libicu inline fallback: created missing soname symlinks', { libDir, created });
  }
}

function ensureLibicuSymlinks(): void {
  if (process.platform !== 'linux') return;

  const requireFn = createRequire(import.meta.url);

  // Preferred path: delegate to the canonical CJS script when available.
  if (tryLibicuShimScript(requireFn)) return;

  // Inline fallback — mirrors scripts/ensure-libicu-symlinks.cjs.
  // Resolution notes: `@embedded-postgres/linux-x64/package.json` cannot be
  // resolved directly because the package's `exports` field blocks subpath
  // access. Instead: resolve the package main, walk up to find the package
  // root. Also handle bun's isolated-install symlink layout.
  try {
    runLibicuInlineFallback(requireFn);
  } catch (error) {
    log.warn('libicu shim failed (non-fatal — pgserve will surface a clearer error if symlinks are missing)', {
      error: String(error),
    });
  }
}

type StartServerFn = (opts: Record<string, unknown>) => Promise<PgserveInstance>;

async function tryStartOnPort(startFn: StartServerFn, port: number, config: PgserveConfig): Promise<string | null> {
  try {
    serverInstance = await startFn({
      port,
      baseDir: config.dataDir,
      autoProvision: true,
      enablePgvector: true,
      logLevel: 'warn',
    });
    return buildDatabaseUrl(port);
  } catch (error: unknown) {
    if (isAddressInUse(error)) return null;
    throw error;
  }
}

/**
 * Start the embedded pgserve server.
 *
 * Returns the DATABASE_URL to use for connections.
 * If PGSERVE_EMBEDDED is false, returns the existing DATABASE_URL / default.
 */
export async function startEmbeddedPgserve(config: PgserveConfig): Promise<string> {
  if (!config.enabled) {
    const url = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();
    log.info('Embedded pgserve disabled, using external database', { url: url.replace(/\/\/.*@/, '//***@') });
    return url;
  }

  // Validate PGSERVE_DATA before doing anything else. Throws PgserveRelativeDataPathError
  // or PgserveDataDirMissingError when invariants are violated (#412).
  const resolvedDataDir = validatePgserveDataDir(config);

  log.info('Starting embedded pgserve', {
    port: config.port,
    mode: config.dataDir ? 'persistent' : 'memory',
    dataDir: config.dataDir ?? '(in-memory)',
    // Always log the fully resolved absolute path so operators can spot cwd drift in logs.
    PGSERVE_DATA_RESOLVED: resolvedDataDir ?? '(in-memory)',
    cwd: process.cwd(),
    requireExisting: config.requireExisting,
  });

  // Loud fresh-initdb warning — catches the cwd-drift scenario even when
  // PGSERVE_REQUIRE_EXISTING is not set. Normal first install will still see
  // this warning once, which is acceptable.
  if (resolvedDataDir && !isPopulatedPgserveDir(resolvedDataDir)) {
    log.warn(
      'Creating new pgserve data dir — previous data will NOT be present. If this is not a first install, STOP and verify PGSERVE_DATA + PM2 cwd (see #412).',
      {
        dataDir: resolvedDataDir,
        cwd: process.cwd(),
      },
    );
  }

  // Terminate any orphaned postgres left by a previous unclean shutdown before
  // pgserve tries to start (avoids the socket-dir mismatch crash loop).
  if (config.dataDir) {
    await killOrphanedPostgres(config.dataDir);
  }

  // Ensure libicu soname symlinks exist before the native postgres binary is
  // loaded. The upstream `@embedded-postgres/linux-x64` package sometimes ships
  // only fully-versioned files (.so.60.N) without the .so.60 links postgres'
  // DT_NEEDED entries require. Synchronous, non-fatal — worst case pgserve
  // surfaces a clearer error if the shim can't write.
  ensureLibicuSymlinks();

  const { startMultiTenantServer } = await import('pgserve');

  // Try the configured port first, then increment up to MAX_PORT_RETRIES times
  for (let offset = 0; offset <= MAX_PORT_RETRIES; offset++) {
    const port = config.port + offset;

    // Guard: refuse to start if an unrelated process holds the internal port (P + 1000).
    // This throws `PgserveInternalPortConflict` unless OMNI_PGSERVE_FORCE_CLEANUP=true,
    // in which case it kills the holder and proceeds. Never falls through to
    // tryStartOnPort with an orphan still listening.
    await ensureInternalPortFree(port);

    const result = await tryStartOnPort(startMultiTenantServer, port, config);

    if (result) {
      if (offset > 0) {
        log.info('Embedded pgserve ready on alternate port', { originalPort: config.port, port });
      } else {
        log.info('Embedded pgserve ready', { port, databaseUrl: result.replace(/\/\/.*@/, '//***@') });
      }
      return result;
    }

    log.warn('Port already in use, trying next', { port, nextPort: port + 1 });
  }

  // All ports exhausted — fall back to assuming external pgserve on original port
  log.warn('All port attempts exhausted, assuming external pgserve', { port: config.port });
  return buildDatabaseUrl(config.port);
}

/**
 * Stop the embedded pgserve server (safe to call if never started).
 */
export async function stopEmbeddedPgserve(): Promise<void> {
  if (!serverInstance) return;

  log.info('Stopping embedded pgserve');
  try {
    await serverInstance.stop();
    log.info('Embedded pgserve stopped');
  } catch (error) {
    log.warn('Error stopping pgserve (non-fatal)', { error: String(error) });
  } finally {
    serverInstance = null;
  }
}
