/**
 * Embedded → canonical migration for the "unmounted embedded dir" path.
 *
 * Background
 * ----------
 * The original `fixPgserveCanonical` flow (canonical-pgserve.ts +
 * doctor.ts) assumes the embedded pgserve is LIVE: omni-api is running
 * against it, pg_dump connects to the live instance, then we stop
 * omni-api, set up canonical, restore, restart on canonical. That
 * worked through the singleton-no-proxy cutover when omni-api could
 * still spawn embedded.
 *
 * Phase 3 (`pgserve-singleton-no-proxy` G2) deleted omni-api's
 * embedded-spawn code. That leaves a regression for any operator who:
 *   - Has `useCanonicalPgserve: true` in config (cutover already
 *     "succeeded" structurally) but
 *   - Never actually moved data — their 8.4 GB sits at
 *     `~/.omni/data/pgserve/` as an unmounted postmaster data dir
 *   - The canonical `omni` database on autopg is empty
 *
 * Found during Felipe's 2026-05-20 dogfood: omni-api boots cleanly on
 * canonical but `omni instances list` returns nothing — the data is
 * stranded.
 *
 * Solution
 * --------
 * Spawn autopg's bundled `postgres` binary against the unmounted embedded
 * data dir on a free TCP port, copy every public-schema table over to
 * canonical via psql `COPY ... TO STDOUT | COPY ... FROM STDIN` pipes
 * (psql 17 happily connects to a PG18 server — only pg_dump is strict),
 * then shut the temp postmaster down. Postgres version compatibility is
 * sidestepped: both embedded and canonical use the same autopg-bundled
 * postgres binary on this host.
 *
 * Idempotency: caller is expected to gate on `canonical omni DB is
 * empty + embedded dir has data` so re-running this isn't destructive.
 * Within this function: TRUNCATE CASCADE before COPY, sequence reset
 * after.
 *
 * Safety:
 *   - Temp postmaster binds 127.0.0.1 only, on a free ephemeral port
 *   - Spawned with `unix_socket_directories=/tmp/<unique>` to avoid
 *     colliding with canonical's socket dir
 *   - Caller takes a snapshot of `~/.omni/data/pgserve/` before invoking
 *     (recommended) — this code does NOT mutate the embedded dir
 *   - Temp postmaster gets SIGTERM in `finally`; on hard crash the
 *     leftover postmaster.pid is recovered by the next spawn attempt
 *     (postgres self-heals stale pidfiles on startup)
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const EMBEDDED_DIR = join(homedir(), '.omni', 'data', 'pgserve');

export type MigrationResult =
  | { status: 'migrated'; tables: number; durationMs: number }
  | { status: 'skipped'; reason: string };

export interface MigrateOptions {
  /** TCP port the canonical postmaster is bound on (autopg default 5432). */
  canonicalPort?: number;
  /** Logger sink — defaults to writing prefixed lines to process.stdout. */
  log?: (line: string) => void;
}

function defaultLog(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Locate autopg's bundled `postgres` binary. Required for the temp spawn
 * because the embedded data dir's catalog version must match the binary's
 * server version exactly. Returns null when not found — caller surfaces
 * the install-autopg-first hint.
 */
function findAutopgPostgresBinary(): string | null {
  const autopgRoot = join(homedir(), '.local', 'share', 'autopg');
  if (!existsSync(autopgRoot)) return null;
  // Walk to find the highest-version postgres binary at
  // ~/.local/share/autopg/<version>/postgres/bin/postgres.
  let bestPath: string | null = null;
  for (const entry of safeReaddir(autopgRoot)) {
    const candidate = join(autopgRoot, entry, 'postgres', 'bin', 'postgres');
    if (existsSync(candidate)) bestPath = candidate;
  }
  return bestPath;
}

function safeReaddir(path: string): string[] {
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** Find a free TCP port on 127.0.0.1 by binding ':0' and reading the port. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('failed to discover free port'));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Spawn the temp postmaster. Returns the pid + socket-dir on success;
 * throws on bind / startup failure.
 */
async function spawnTempPostmaster(
  binary: string,
  dataDir: string,
  port: number,
  log: (line: string) => void,
): Promise<{ pid: number; socketDir: string; stop: () => Promise<void> }> {
  const socketDir = mkdtempSync(join(tmpdir(), 'omni-migrate-pg-'));
  log(`  spawning temp postmaster: pid=… port=${port} socket=${socketDir}`);
  const child = spawn(
    binary,
    [
      '-D',
      dataDir,
      '-p',
      String(port),
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      `unix_socket_directories=${socketDir}`,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    },
  );
  let started = false;
  let crashed: Error | null = null;
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf-8');
    if (!started && /database system is ready to accept connections/.test(line)) started = true;
    // Keep diagnostic stderr quiet unless we crash.
  });
  child.on('exit', (code) => {
    if (!started) {
      crashed = new Error(`temp postmaster exited with code ${code} before ready`);
    }
  });
  // Wait up to 20s for the "ready" line.
  for (let i = 0; i < 200; i++) {
    if (started) break;
    if (crashed) throw crashed;
    await sleep(100);
  }
  if (!started) {
    child.kill('SIGTERM');
    throw new Error('temp postmaster failed to become ready within 20s');
  }
  log(`  temp postmaster ready (pid=${child.pid})`);
  return {
    pid: child.pid ?? -1,
    socketDir,
    async stop(): Promise<void> {
      log('  stopping temp postmaster (SIGTERM)');
      child.kill('SIGTERM');
      // Wait for clean shutdown.
      await new Promise<void>((resolve) => {
        const onExit = () => resolve();
        child.once('exit', onExit);
        setTimeout(() => {
          child.kill('SIGKILL');
          onExit();
        }, 10_000);
      });
    },
  };
}

/** psql wrapper. Returns stdout on success; throws on non-zero exit. */
function psqlCapture(args: string[]): string {
  const result = spawnSync('psql', args, {
    encoding: 'utf-8',
    env: { ...process.env, PGPASSWORD: 'postgres' },
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`psql exited ${result.status}: ${result.stderr?.trim() ?? ''}`);
  }
  return result.stdout ?? '';
}

/**
 * COPY one table from source psql to dest psql via pipe. Returns row count
 * reported by the destination. FK / trigger gating handled by the caller
 * via `session_replication_role=replica` in the destination session.
 */
async function copyTable(
  table: string,
  srcArgs: string[],
  dstArgs: string[],
  log: (line: string) => void,
): Promise<void> {
  // Use child_process.spawnSync with stdio piping — chained shells are
  // fragile across psql versions, so we plumb the pipe ourselves.
  const src = spawn('psql', [...srcArgs, '-c', `\\copy public.${table} TO STDOUT`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PGPASSWORD: 'postgres' },
  });
  const dst = spawn(
    'psql',
    [...dstArgs, '-c', `SET session_replication_role='replica';`, '-c', `\\copy public.${table} FROM STDIN`],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: 'postgres' },
    },
  );
  if (!src.stdout || !dst.stdin) throw new Error(`copy stream not available for ${table}`);
  src.stdout.pipe(dst.stdin);
  let dstErr = '';
  dst.stderr?.on('data', (b: Buffer) => {
    dstErr += b.toString('utf-8');
  });
  const srcExited = new Promise<number>((resolve) => src.once('exit', (code) => resolve(code ?? -1)));
  const dstExited = new Promise<number>((resolve) => dst.once('exit', (code) => resolve(code ?? -1)));
  const [sc, dc] = await Promise.all([srcExited, dstExited]);
  if (sc !== 0 || dc !== 0) {
    throw new Error(`copy ${table} failed (src=${sc} dst=${dc}): ${dstErr.trim()}`);
  }
  log(`  copied ${table}`);
}

/**
 * Reset sequences on the canonical DB after a bulk INSERT (COPY does not
 * advance sequences). Computes setval per (table, sequence) pair via
 * pg_get_serial_sequence. Idempotent.
 */
function resetSequences(dstArgs: string[], log: (line: string) => void): void {
  const script = `
SELECT format(
  'SELECT setval(%L::regclass, GREATEST(COALESCE((SELECT max(%I) FROM %I.%I), 1), 1));',
  pg_get_serial_sequence(c.table_schema || '.' || c.table_name, c.column_name),
  c.column_name, c.table_schema, c.table_name
)
FROM information_schema.columns c
WHERE pg_get_serial_sequence(c.table_schema || '.' || c.table_name, c.column_name) IS NOT NULL
  AND c.table_schema = 'public';
`.trim();
  const lines = psqlCapture([...dstArgs, '-tAc', script])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;
  log(`  resetting ${lines.length} sequence(s)`);
  psqlCapture([...dstArgs, '-c', lines.join('\n')]);
}

/**
 * Public entry point — call this from `omni doctor --fix` when the
 * `embedded-data-orphaned` check FAILs (canonical omni DB empty AND
 * embedded dir has valid pg data).
 *
 * Returns `{ status: 'skipped', reason }` for any precondition mismatch
 * so callers can present an actionable diagnostic without aborting the
 * larger --fix run.
 */
/**
 * Result of comparing embedded vs canonical row counts. Used by the
 * doctor `embedded-data-orphaned` check to detect partial migrations
 * (e.g. Baileys re-attach copies instance rows but the bulk historical
 * tables stay empty until the ETL runs).
 */
export type CompareResult =
  | { kind: 'in-sync' }
  | { kind: 'embedded-has-more'; divergentTables: string[]; embeddedRows: number }
  | { kind: 'skipped'; reason: string };

export interface CompareOptions {
  canonicalPort?: number;
}

/**
 * Count rows in every public table on both the embedded data dir and the
 * canonical postmaster, return which tables have MORE rows on embedded.
 * Boots a temp postmaster against the embedded dir (5s ready window),
 * runs two count queries, shuts it down. Best-effort: any spawn / query
 * failure returns `{ kind: 'skipped' }`.
 */
export async function compareEmbeddedVsCanonicalCounts(opts: CompareOptions = {}): Promise<CompareResult> {
  const canonicalPort = opts.canonicalPort ?? 5432;
  if (!existsSync(EMBEDDED_DIR) || !existsSync(join(EMBEDDED_DIR, 'PG_VERSION'))) {
    return { kind: 'skipped', reason: 'embedded dir absent' };
  }
  const binary = findAutopgPostgresBinary();
  if (!binary) return { kind: 'skipped', reason: 'autopg postgres binary not found' };
  const tempPort = await findFreePort();
  let temp: { stop: () => Promise<void> } | null = null;
  try {
    temp = await spawnTempPostmaster(binary, EMBEDDED_DIR, tempPort, () => {});
    const srcArgs = ['-h', '127.0.0.1', '-p', String(tempPort), '-U', 'postgres', '-d', 'omni'];
    const dstArgs = ['-h', '127.0.0.1', '-p', String(canonicalPort), '-U', 'postgres', '-d', 'omni'];
    // Enumerate then count per-table in a loop (simpler + portable across
    // schema variations than a one-shot aggregate).
    const tablesRaw = psqlCapture([
      ...srcArgs,
      '-tAc',
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
    ]);
    const tables = tablesRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tables.length === 0) return { kind: 'skipped', reason: 'embedded has no public tables' };
    const divergent: string[] = [];
    let totalExtra = 0;
    for (const t of tables) {
      try {
        const em = Number.parseInt(psqlCapture([...srcArgs, '-tAc', `SELECT count(*) FROM public.${t}`]).trim(), 10);
        const ca = Number.parseInt(psqlCapture([...dstArgs, '-tAc', `SELECT count(*) FROM public.${t}`]).trim(), 10);
        if (Number.isFinite(em) && Number.isFinite(ca) && em > ca) {
          divergent.push(t);
          totalExtra += em - ca;
        }
      } catch {
        // Schema mismatch — table on embedded missing on canonical or vice
        // versa. Treat as "needs migration" by adding to divergent if it
        // came from embedded enumeration.
        divergent.push(t);
      }
    }
    if (divergent.length === 0) return { kind: 'in-sync' };
    return { kind: 'embedded-has-more', divergentTables: divergent, embeddedRows: totalExtra };
  } catch (err) {
    return { kind: 'skipped', reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (temp) await temp.stop();
  }
}

export async function migrateUnmountedEmbeddedToCanonical(opts: MigrateOptions = {}): Promise<MigrationResult> {
  const log = opts.log ?? defaultLog;
  const canonicalPort = opts.canonicalPort ?? 5432;

  if (!existsSync(EMBEDDED_DIR)) {
    return { status: 'skipped', reason: 'no embedded data dir' };
  }
  if (!existsSync(join(EMBEDDED_DIR, 'PG_VERSION'))) {
    return { status: 'skipped', reason: 'embedded dir missing PG_VERSION' };
  }

  const binary = findAutopgPostgresBinary();
  if (!binary) {
    return { status: 'skipped', reason: 'autopg postgres binary not found — install autopg first' };
  }
  log(`  using postgres binary: ${binary}`);

  // Stop omni-api during the copy. Otherwise omni-api's bootstrap (default
  // global_settings, Baileys instance reattach, etc.) races our COPYs and
  // causes `duplicate key value violates unique constraint` errors after
  // the TRUNCATE — observed on Felipe's host with the global_settings row
  // for elevenlabs.api_key. Restart on success OR failure (finally).
  log('  stopping omni-api during data copy');
  spawnSync('pm2', ['stop', 'omni-api'], { stdio: 'inherit' });

  const tempPort = await findFreePort();
  const t0 = Date.now();
  const temp = await spawnTempPostmaster(binary, EMBEDDED_DIR, tempPort, log);
  let apiRestarted = false;
  try {
    // Verify the temp instance has the `omni` database.
    const srcBaseArgs = ['-h', '127.0.0.1', '-p', String(tempPort), '-U', 'postgres', '-d', 'omni'];
    const dstBaseArgs = ['-h', '127.0.0.1', '-p', String(canonicalPort), '-U', 'postgres', '-d', 'omni'];

    // Enumerate tables (alphabetical; FK checks are off for the copy).
    const tablesRaw = psqlCapture([
      ...srcBaseArgs,
      '-tAc',
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
    ]);
    const tables = tablesRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tables.length === 0) {
      return { status: 'skipped', reason: 'embedded omni has no public tables' };
    }
    log(`  ${tables.length} tables to migrate`);

    // TRUNCATE canonical with replica role so FKs don't block.
    const truncateList = tables.map((t) => `public.${t}`).join(',');
    psqlCapture([
      ...dstBaseArgs,
      '-c',
      `SET session_replication_role='replica'; TRUNCATE ${truncateList} RESTART IDENTITY CASCADE;`,
    ]);
    log('  truncated canonical (CASCADE)');

    // COPY each table.
    for (const t of tables) {
      // copyTable is sync-looking but pipes — caller awaits via shared loop.
      // We synchronize per-table here so a mid-table failure surfaces immediately.
      await copyTable(t, srcBaseArgs, dstBaseArgs, log);
    }

    // Reset sequences.
    resetSequences(dstBaseArgs, log);

    return { status: 'migrated', tables: tables.length, durationMs: Date.now() - t0 };
  } finally {
    await temp.stop();
    // Restart omni-api on the now-populated canonical DB.
    log('  restarting omni-api');
    spawnSync('pm2', ['start', 'omni-api'], { stdio: 'inherit' });
    apiRestarted = true;
    void apiRestarted; // satisfy ts no-unused while keeping the variable for future logging
  }
}

/** Re-export the constant so callers / tests can probe the same path. */
export const EMBEDDED_PGSERVE_DATA_DIR = EMBEDDED_DIR;
