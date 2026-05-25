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
 * Spawn a matching-major `postgres` reader against the unmounted embedded
 * data dir on a free TCP port, copy the shared public-schema tables over to
 * canonical via psql `\copy`, then shut the temp postmaster down.
 *
 * Cross-major + cross-schema seamless: a PostgreSQL server can only open a
 * data dir of its OWN major, so the reader major MUST match the embedded
 * cluster (e.g. legacy PG17 data → reader PG17 even though canonical is PG18).
 * {@link resolveReaderForMajor} finds an installed autopg binary of that major
 * or AUTO-FETCHES one (`@embedded-postgres/<platform>@<major>`, cached under
 * `~/.omni/cache/`) — the operator never deals with PG versions. The copy is
 * TEXT format over the INTERSECTION of each table's columns, so it survives
 * both the major-version wire gap and schema drift between an old embedded
 * schema and the current canonical one. Install-local auth tables are
 * preserved (see SKIP_TABLES) so the live CLI key keeps working.
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

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/** Read the catalog major (e.g. 17, 18) recorded in a data dir's PG_VERSION. */
export function readDataDirMajor(dataDir: string): number | null {
  try {
    const major = Number.parseInt(readFileSync(join(dataDir, 'PG_VERSION'), 'utf8').trim(), 10);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

/** Resolve the server major of a `postgres` binary via `postgres --version`. */
function binaryMajor(binary: string): number | null {
  try {
    // e.g. "postgres (PostgreSQL) 17.4" / "... 18.3.0-beta.17"
    const out = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/(\d+)(?:[.\s]|$)/);
    return m ? Number.parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Locate an autopg-bundled `postgres` binary whose server major MATCHES the
 * embedded data dir's catalog version. A PostgreSQL server refuses to open a
 * data dir from a different major ("database files are incompatible with
 * server"), so the temp-postmaster reader MUST match exactly.
 *
 * Previously this returned the *last* binary found under
 * `~/.local/share/autopg/<version>/postgres/bin/postgres` regardless of major.
 * On a v3-only host (PG 18) reading a legacy PG 17 dir, that handed back PG 18
 * and the temp postmaster died — surfacing as
 * "temp postmaster exited before ready" / orphaned data. Now we pick the
 * matching-major binary and return null when none is installed, so the caller
 * can tell the operator to install a PG<major> reader instead of silently
 * failing.
 *
 * `wantMajor === null` (unknown data-dir version) falls back to the
 * newest installed binary.
 *
 * Candidates are sorted by their `~/.local/share/autopg/<version>` dir name
 * (newest first, version-aware) so selection is deterministic regardless of
 * the OS-dependent `readdirSync` order — picking the highest patch within the
 * wanted major, and the newest overall when the major is unknown.
 */
function findAutopgPostgresBinary(wantMajor: number | null): string | null {
  const autopgRoot = join(homedir(), '.local', 'share', 'autopg');
  if (!existsSync(autopgRoot)) return null;
  const candidates = safeReaddir(autopgRoot)
    .sort((a, b) => compareVersionDesc(a, b))
    .map((entry) => join(autopgRoot, entry, 'postgres', 'bin', 'postgres'))
    .filter((candidate) => existsSync(candidate));
  if (candidates.length === 0) return null;
  if (wantMajor === null) return candidates[0];
  for (const candidate of candidates) {
    if (binaryMajor(candidate) === wantMajor) return candidate;
  }
  return null;
}

/** Compare two `vX.Y.Z`-ish dir names numerically, newest first. */
export function compareVersionDesc(a: string, b: string): number {
  const parse = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Tables NOT copied embedded→canonical.
 *  - media_content: large blobs that overflow the COPY pipe; omni-api re-syncs
 *    media from the source channel on next message.
 *  - api_keys / api_key_audit_logs: INSTALL-LOCAL auth state the canonical
 *    install created fresh (the operator's live CLI key). Overwriting them with
 *    the stale embedded `__primary__` key breaks `omni` CLI auth immediately,
 *    and copying the audit logs would violate their FK to the preserved keys.
 */
export const MIGRATION_SKIP_TABLES = new Set(['media_content', 'api_keys', 'api_key_audit_logs']);

/** A postgres binary plus the lib dir it needs on LD_LIBRARY_PATH (fetched readers). */
export interface ReaderHandle {
  binary: string;
  /** Set as LD_LIBRARY_PATH when spawning (undefined for self-contained autopg binaries). */
  libDir?: string;
}

/** Map the host to its `@embedded-postgres/<platform>` package name. */
export function embeddedPostgresPackage(): string | null {
  const a = arch() === 'arm64' ? 'arm64' : arch() === 'x64' ? 'x64' : null;
  if (!a) return null;
  if (platform() === 'linux') return `@embedded-postgres/linux-${a}`;
  if (platform() === 'darwin') return `@embedded-postgres/darwin-${a}`;
  if (platform() === 'win32' && a === 'x64') return '@embedded-postgres/windows-x64';
  return null;
}

/** Highest published `<major>.x` version of the embedded-postgres package. */
function latestReaderVersion(pkg: string, major: number): string | null {
  try {
    const raw = execFileSync('npm', ['view', pkg, 'versions', '--json'], { encoding: 'utf8', timeout: 30_000 });
    const versions = JSON.parse(raw) as string[] | string;
    const list = Array.isArray(versions) ? versions : [versions];
    // Sort explicitly (newest first) rather than trusting npm's ordering —
    // string order mis-ranks multi-digit components (17.10 vs 17.2).
    const matching = list.filter((v) => v.startsWith(`${major}.`)).sort(compareVersionDesc);
    return matching.length ? matching[0] : null;
  } catch {
    return null;
  }
}

/**
 * Materialize the `.so` symlinks the embedded-postgres binary needs to run
 * outside its packaged layout: the major-version sonames its DT_NEEDED list
 * references (e.g. `libicui18n.so.60` → the shipped `libicui18n.so.60.2`)
 * plus anything the package's own `pg-symlinks.json` declares. Idempotent.
 */
function materializeReaderLibs(nativeDir: string): void {
  const libDir = join(nativeDir, 'lib');
  // pg-symlinks.json (authoritative, package-relative source/target pairs).
  try {
    const pkgRoot = dirname(nativeDir);
    const pairs = JSON.parse(readFileSync(join(nativeDir, 'pg-symlinks.json'), 'utf8')) as {
      source: string;
      target: string;
    }[];
    for (const { source, target } of pairs) {
      const tgt = join(pkgRoot, target);
      if (!existsSync(tgt)) {
        try {
          symlinkSync(join(pkgRoot, source), tgt);
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* no pg-symlinks.json — fall through to heuristic */
  }
  // Heuristic major-soname links (libfoo.so.N -> libfoo.so.N.M) for ICU/SSL.
  for (const f of safeReaddir(libDir)) {
    const m = f.match(/^(.*\.so\.\d+)\.\d+/);
    if (!m) continue;
    const base = join(libDir, m[1]);
    if (!existsSync(base)) {
      try {
        symlinkSync(join(libDir, f), base);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Fetch a matching-major `postgres` reader on the operator's behalf when no
 * installed autopg binary matches the embedded cluster's major. This is what
 * makes a cross-major upgrade (e.g. legacy PG17 embedded data → canonical
 * PG18) SEAMLESS: the user never has to know about PG versions or hand-install
 * an old reader. The binary is cached under `~/.omni/cache/pg-reader-<major>/`
 * so repeat runs are instant. Returns null (caller skips with a clear reason)
 * if the platform is unsupported or the download fails.
 */
function fetchEmbeddedReader(major: number, log: (line: string) => void): ReaderHandle | null {
  const pkg = embeddedPostgresPackage();
  if (!pkg) return null;
  const cacheDir = join(homedir(), '.omni', 'cache', `pg-reader-${major}`);
  const nativeDir = join(cacheDir, 'node_modules', pkg, 'native');
  const binary = join(nativeDir, 'bin', 'postgres');
  if (existsSync(binary) && binaryMajor(binary) === major) {
    materializeReaderLibs(nativeDir);
    return { binary, libDir: join(nativeDir, 'lib') };
  }
  const version = latestReaderVersion(pkg, major);
  if (!version) return null;
  log(`  fetching PG ${major} reader (${pkg}@${version}) — one-time, cached at ${cacheDir}`);
  try {
    mkdirSync(cacheDir, { recursive: true });
    const res = spawnSync('bun', ['add', `${pkg}@${version}`], { cwd: cacheDir, encoding: 'utf8', timeout: 180_000 });
    if (res.status !== 0 || !existsSync(binary)) return null;
    materializeReaderLibs(nativeDir);
    return binaryMajor(binary) === major ? { binary, libDir: join(nativeDir, 'lib') } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a postgres reader whose major matches the embedded cluster:
 * prefer an installed autopg binary (self-contained), else auto-fetch a
 * matching-major embedded-postgres reader. Returns null only when neither is
 * available (unsupported platform / offline).
 */
export function resolveReaderForMajor(wantMajor: number | null, log: (line: string) => void): ReaderHandle | null {
  const installed = findAutopgPostgresBinary(wantMajor);
  if (installed) return { binary: installed };
  if (wantMajor === null) return null;
  return fetchEmbeddedReader(wantMajor, log);
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
  reader: ReaderHandle,
  dataDir: string,
  port: number,
  log: (line: string) => void,
): Promise<{ pid: number; socketDir: string; stop: () => Promise<void> }> {
  const socketDir = mkdtempSync(join(tmpdir(), 'omni-migrate-pg-'));
  log(`  spawning temp postmaster: pid=… port=${port} socket=${socketDir}`);
  // Fetched readers ship their ICU/SSL libs alongside the binary; put that dir
  // first on the platform's dynamic-loader search path so the postmaster
  // resolves them — Linux: LD_LIBRARY_PATH, macOS: DYLD_LIBRARY_PATH, Windows:
  // PATH (DLLs also resolve from the binary's own dir).
  let env = process.env;
  if (reader.libDir) {
    const loaderVar =
      platform() === 'darwin' ? 'DYLD_LIBRARY_PATH' : platform() === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH';
    const sep = platform() === 'win32' ? ';' : ':';
    const prev = process.env[loaderVar];
    env = { ...process.env, [loaderVar]: prev ? `${reader.libDir}${sep}${prev}` : reader.libDir };
  }
  const child = spawn(
    reader.binary,
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
      env,
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

/** List public tables on a server. */
function listTables(args: string[]): string[] {
  return psqlCapture([...args, '-tAc', `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * List a table's columns. `insertableOnly` excludes STORED generated columns
 * (`is_generated='ALWAYS'`) which COPY cannot populate; identity columns are
 * kept (the migrate path runs under `session_replication_role='replica'`,
 * which permits explicit identity values so PKs/FKs stay intact).
 */
function listColumns(args: string[], table: string, insertableOnly = false): string[] {
  const filter = insertableOnly ? `AND is_generated <> 'ALWAYS'` : '';
  return psqlCapture([
    ...args,
    '-tAc',
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ${filter} ORDER BY ordinal_position`,
  ])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
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
 * COPY one table source → file → dest. Two phases:
 *   1. psql `\copy table TO file WITH BINARY` (src) — writes to disk
 *   2. psql `\copy table FROM file WITH BINARY` (dst) — reads from disk
 *
 * Why not stream the pipe directly: Node's child_process pipe between two
 * spawned processes hits EPIPE / "unexpected EOF in COPY data" on rows
 * whose serialized binary payload exceeds the OS pipe buffer (observed
 * on Felipe's host with media_content blobs and messages.raw_payload
 * Buffer-serialized JSON at rows 60822 + 53288). The OS-level pipe has
 * no flow control beyond its 64KB buffer; once full, the writer EAGAINs
 * and Node's stream.pipe() either silently drops or aborts depending on
 * how the libuv handle was wired. File buffering is bulletproof: each
 * stage is sequential, disk has no buffer-size cliff, and on failure the
 * file is preserved at `/tmp/omni-migrate-<table>.copy` for inspection.
 *
 * Format is TEXT (not BINARY) and the column list is the INTERSECTION of the
 * columns present on both sides. This makes the copy correct across a major
 * gap (binary wire format is not guaranteed identical 17↔18) AND across schema
 * drift (a legacy embedded schema rarely matches the current canonical one):
 * we copy only the columns both sides share, in an explicit order, so added /
 * dropped / reordered columns can't corrupt or abort the load. Columns only on
 * the destination take their defaults; columns only on the source are dropped.
 *
 * The temp file gets cleaned up in `finally`. Caller is expected to have
 * stopped omni-api so the table isn't being written to mid-COPY.
 */
async function copyTable(
  table: string,
  columns: string[],
  srcArgs: string[],
  dstArgs: string[],
  log: (line: string) => void,
): Promise<void> {
  if (columns.length === 0) {
    log(`  skip ${table} (no shared columns)`);
    return;
  }
  const colList = columns.map((c) => `"${c}"`).join(', ');
  const tmpFile = join(tmpdir(), `omni-migrate-${table}-${process.pid}.copy`);
  try {
    // Phase 1: source → file. `\copy ... TO '<file>'` is psql's
    // client-side variant (vs server-side `COPY TO '<file>'` which would
    // require the postgres process to have FS write perms on that path).
    const srcResult = spawnSync(
      'psql',
      [...srcArgs, '-c', `\\copy public."${table}" (${colList}) TO '${tmpFile}' WITH (FORMAT text)`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PGPASSWORD: 'postgres' },
        timeout: 600_000,
        maxBuffer: 16 * 1024 * 1024, // 16 MB — only the COPY summary line lands in stdout
      },
    );
    if (srcResult.status !== 0) {
      throw new Error(
        `dump ${table} failed (psql exit ${srcResult.status}): ${srcResult.stderr?.toString().trim() ?? ''}`,
      );
    }
    // Phase 2: file → dest. Same client-side `\copy ... FROM '<file>'`.
    const dstResult = spawnSync(
      'psql',
      [
        ...dstArgs,
        '-c',
        `SET session_replication_role='replica';`,
        '-c',
        `\\copy public."${table}" (${colList}) FROM '${tmpFile}' WITH (FORMAT text)`,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PGPASSWORD: 'postgres' },
        timeout: 600_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (dstResult.status !== 0) {
      throw new Error(
        `restore ${table} failed (psql exit ${dstResult.status}): ${dstResult.stderr?.toString().trim() ?? ''}`,
      );
    }
    log(`  copied ${table}`);
  } finally {
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(tmpFile);
    } catch {
      // Best-effort cleanup; leave the file for inspection if unlink fails.
    }
  }
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
  const wantMajor = readDataDirMajor(EMBEDDED_DIR);
  const reader = resolveReaderForMajor(wantMajor, () => {});
  if (!reader) {
    return {
      kind: 'skipped',
      reason: wantMajor
        ? `no PostgreSQL ${wantMajor} reader available (autopg or fetchable embedded-postgres) for the PG ${wantMajor} embedded dir`
        : 'autopg postgres binary not found',
    };
  }
  const tempPort = await findFreePort();
  let temp: { stop: () => Promise<void> } | null = null;
  try {
    temp = await spawnTempPostmaster(reader, EMBEDDED_DIR, tempPort, () => {});
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
        const em = Number.parseInt(psqlCapture([...srcArgs, '-tAc', `SELECT count(*) FROM public."${t}"`]).trim(), 10);
        const ca = Number.parseInt(psqlCapture([...dstArgs, '-tAc', `SELECT count(*) FROM public."${t}"`]).trim(), 10);
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

  const wantMajor = readDataDirMajor(EMBEDDED_DIR);
  const reader = resolveReaderForMajor(wantMajor, log);
  if (!reader) {
    return {
      status: 'skipped',
      reason: wantMajor
        ? `could not obtain a PostgreSQL ${wantMajor} reader (no installed autopg match and embedded-postgres fetch unavailable — unsupported platform or offline)`
        : 'autopg postgres binary not found — install autopg first',
    };
  }
  log(
    `  using postgres binary: ${reader.binary} (matched PG ${wantMajor ?? '?'}${reader.libDir ? ', fetched reader' : ''})`,
  );

  // Stop omni-api during the copy. Otherwise omni-api's bootstrap (default
  // global_settings, Baileys instance reattach, etc.) races our COPYs and
  // causes `duplicate key value violates unique constraint` errors after
  // the TRUNCATE — observed on Felipe's host with the global_settings row
  // for elevenlabs.api_key. Restart on success OR failure (finally).
  log('  stopping omni-api during data copy');
  spawnSync('pm2', ['stop', 'omni-api'], { stdio: 'inherit' });

  const tempPort = await findFreePort();
  const t0 = Date.now();
  const temp = await spawnTempPostmaster(reader, EMBEDDED_DIR, tempPort, log);
  let apiRestarted = false;
  try {
    // Verify the temp instance has the `omni` database.
    const srcBaseArgs = ['-h', '127.0.0.1', '-p', String(tempPort), '-U', 'postgres', '-d', 'omni'];
    const dstBaseArgs = ['-h', '127.0.0.1', '-p', String(canonicalPort), '-U', 'postgres', '-d', 'omni'];

    // Enumerate tables on BOTH sides and copy only the intersection. The
    // canonical (dst) schema is authoritative for what omni-api needs; tables
    // that exist in the legacy embedded dir but not in canonical are obsolete
    // and skipped, tables only in canonical stay empty (no source data).
    const srcTables = new Set(listTables(srcBaseArgs));
    if (srcTables.size === 0) {
      return { status: 'skipped', reason: 'embedded omni has no public tables' };
    }
    const dstTables = listTables(dstBaseArgs);
    const tables = dstTables.filter((t) => srcTables.has(t));
    const onlyEmbedded = [...srcTables].filter((t) => !dstTables.includes(t));
    if (onlyEmbedded.length > 0) {
      log(`  ${onlyEmbedded.length} obsolete embedded-only table(s) skipped: ${onlyEmbedded.join(', ')}`);
    }
    if (tables.length === 0) {
      return { status: 'skipped', reason: 'no tables shared between embedded and canonical schemas' };
    }
    // Tables to skip during migration.
    //
    // media_content holds large binary blobs (image / video / audio
    // attachments) that frequently exceed Node's child_process pipe buffer
    // limits and abort the COPY stream with "unexpected EOF in COPY data".
    // Skipping is safe because omni-api re-syncs media from the source channel
    // (WhatsApp Baileys restores media on next message arrival per chat).
    // Operators who need the blobs preserved can re-run with
    // OMNI_MIGRATE_INCLUDE_MEDIA=1 (TODO: wire flag).
    //
    // See MIGRATION_SKIP_TABLES for why each table is preserved/skipped.
    const filteredTables = tables.filter((t) => !MIGRATION_SKIP_TABLES.has(t));
    const skipped = tables.filter((t) => MIGRATION_SKIP_TABLES.has(t));
    if (skipped.length > 0) log(`  skipping ${skipped.length} table(s) (rebuilt at runtime): ${skipped.join(', ')}`);
    log(`  ${filteredTables.length} tables to migrate`);

    // TRUNCATE canonical with replica role so FKs don't block.
    const truncateList = filteredTables.map((t) => `public."${t}"`).join(',');
    psqlCapture([
      ...dstBaseArgs,
      '-c',
      `SET session_replication_role='replica'; TRUNCATE ${truncateList} RESTART IDENTITY CASCADE;`,
    ]);
    log('  truncated canonical (CASCADE)');

    // COPY each table using the intersection of its columns on both sides
    // (text format) — robust to cross-major wire differences and schema drift.
    for (const t of filteredTables) {
      const srcCols = new Set(listColumns(srcBaseArgs, t));
      const sharedCols = listColumns(dstBaseArgs, t, true).filter((c) => srcCols.has(c));
      await copyTable(t, sharedCols, srcBaseArgs, dstBaseArgs, log);
    }

    // Reset sequences.
    resetSequences(dstBaseArgs, log);

    return { status: 'migrated', tables: filteredTables.length, durationMs: Date.now() - t0 };
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
