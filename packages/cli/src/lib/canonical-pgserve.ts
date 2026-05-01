/**
 * Canonical pgserve helpers — single shared pgserve@^2.1.0 backbone.
 *
 * Background
 * ----------
 * Up through omni 2.260430, omni-api spawned its own embedded pgserve
 * via `await import('pgserve')`. That worked, but every other service
 * (genie-serve, future agents) that wanted Postgres span its own copy,
 * so a single host could end up with 3+ pgserve instances on different
 * ports with scattered data dirs. Canonical pgserve fixes this:
 *
 *   - `pgserve install` (from pgserve@^2.1.0) registers ONE pm2-supervised
 *     pgserve instance on the canonical port (8432).
 *   - `pgserve url` returns its connection string — every downstream
 *     service (omni, genie, ...) reads this and connects there.
 *   - `omni install` calls `pgserve install` first, writes the URL into
 *     `~/.omni/config.json`, and starts omni-api with `PGSERVE_EMBEDDED=false`
 *     so the API skips its own embedded boot path.
 *
 * Embedded mode is NOT removed. It stays as the active path on existing
 * installs (where `serverConfig.useCanonicalPgserve` is undefined or
 * false) until the operator opts in via `omni doctor --fix`. Fresh
 * installs default to canonical.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { loadServerConfig } from '../config.js';
import * as output from '../output.js';

/**
 * Minimum pgserve binary version required for the canonical install
 * subcommands (`install`, `url`, `port`, `status`). Wave 1 of the
 * canonical-pgserve-pm2-supervision wish landed in 2.1.0; anything older
 * lacks the install command.
 */
const PGSERVE_REQUIRED_VERSION = '^2.1.0';

/**
 * Probe the `pgserve` binary by running its `--help` subcommand. Returns
 * true when the binary is callable.
 *
 * History
 * -------
 * 1. First attempt used `pgserve --version`. That flag does not exist in
 *    pgserve@2.1.0 — the wrapper exits non-zero with "Unknown option:
 *    --version" and dumps the help. False-negatived on every install.
 *    Replaced with `pgserve port` in the followup.
 *
 * 2. `pgserve port` exits 0 ONLY when pgserve has been registered under
 *    pm2 via `pgserve install`. On a clean machine right after
 *    `bun add -g pgserve@^2.1.0`, the binary IS callable but `pgserve
 *    port` exits non-zero with "pgserve: not installed (run: pgserve
 *    install)". `ensurePgserveBinary()` then never reaches
 *    `runPgserveInstall()`, `setupCanonicalPgserve()` returns null, and
 *    the migration aborts with the misleading "Canonical pgserve binary
 *    unavailable" error. See omni#582.
 *
 * 3. `pgserve --help` exits 0 whenever the binary is on PATH and runnable,
 *    regardless of registration state. We probe with that — any further
 *    capability (registration, port discovery) is asserted by the
 *    subsequent `pgserve install` and `pgserve port` calls in the setup
 *    flow.
 */
async function isPgserveInstalled(): Promise<boolean> {
  try {
    const code = await Bun.spawn({ cmd: ['pgserve', '--help'], stdout: 'pipe', stderr: 'pipe' }).exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Ensure the global `pgserve` binary is installed and on PATH. Best-effort:
 * - If already installed, return true immediately.
 * - Otherwise try `bun add -g pgserve@<PGSERVE_REQUIRED_VERSION>`.
 * - Returns false on failure (caller decides whether to fall back to
 *   embedded or fail hard).
 */
async function ensurePgserveBinary(): Promise<boolean> {
  if (await isPgserveInstalled()) return true;
  output.raw(`  Installing pgserve@${PGSERVE_REQUIRED_VERSION} globally (bun add -g)...`);
  const installCode = await Bun.spawn({
    cmd: ['bun', 'add', '-g', `pgserve@${PGSERVE_REQUIRED_VERSION}`],
    stdout: 'inherit',
    stderr: 'inherit',
  }).exited;
  if (installCode !== 0) {
    output.warn(`bun add -g pgserve@${PGSERVE_REQUIRED_VERSION} exited with code ${installCode}`);
    return false;
  }
  // Re-probe — bun's global bin may not be on PATH yet for the running shell
  // but `pgserve --version` should still resolve via the absolute global path.
  return isPgserveInstalled();
}

/**
 * Run `pgserve install` (idempotent — exits 0 with "already installed"
 * on subsequent invocations). Returns true on success.
 */
async function runPgserveInstall(): Promise<boolean> {
  output.raw('  Registering canonical pgserve under pm2 (idempotent)...');
  const installCode = await Bun.spawn({ cmd: ['pgserve', 'install'], stdout: 'inherit', stderr: 'inherit' }).exited;
  if (installCode !== 0) {
    output.warn(`pgserve install exited with code ${installCode}`);
    return false;
  }
  return true;
}

/**
 * Database name omni-api expects on the canonical pgserve. pgserve@2.1.0
 * auto-provisions databases on first connection, so this can be anything;
 * we keep `omni` to match the historical embedded-mode default.
 */
const OMNI_DATABASE_NAME = 'omni';

/**
 * Read the canonical pgserve port via `pgserve port`. Returns null when
 * the call fails or the output isn't a number.
 *
 * History
 * -------
 * The first attempt called `pgserve url` and used its output verbatim.
 * pgserve@2.1.0's `url` returns `postgres://localhost:<port>/postgres`
 * — no credentials, generic `postgres` database — which is fine for a
 * generic discovery API but NOT what omni-api expects. omni-api connects
 * with `postgres:postgres` credentials to the `omni` database (auto-
 * provisioned by pgserve on first connect). We now read just the port
 * and compose the URL ourselves so the connection string matches what
 * the embedded path used.
 */
async function readPgservePort(): Promise<number | null> {
  const proc = Bun.spawn({ cmd: ['pgserve', 'port'], stdout: 'pipe', stderr: 'inherit' });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    output.warn(`pgserve port exited with code ${code}`);
    return null;
  }
  const port = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    output.warn(`pgserve port returned unexpected output ("${stdout.trim()}")`);
    return null;
  }
  return port;
}

/**
 * Compose the omni-api connection string from a canonical port. Mirrors
 * the embedded-mode default so omni-api / drizzle migrations don't see
 * a connection-shape change across the migration.
 */
function buildOmniDatabaseUrl(port: number): string {
  return `postgresql://postgres:postgres@localhost:${port}/${OMNI_DATABASE_NAME}`;
}

/**
 * Full canonical pgserve setup: ensure binary → `pgserve install` → read
 * the canonical url. Returns the URL on success, null on any failure.
 *
 * The caller (omni install) writes this URL into serverConfig.databaseUrl
 * so omni-api connects there with `PGSERVE_EMBEDDED=false`.
 */
export async function setupCanonicalPgserve(): Promise<string | null> {
  if (!(await ensurePgserveBinary())) {
    output.warn('Canonical pgserve binary unavailable — install manually: bun add -g pgserve@^2.1.0');
    return null;
  }
  if (!(await runPgserveInstall())) return null;
  const port = await readPgservePort();
  if (port === null) return null;
  return buildOmniDatabaseUrl(port);
}

/**
 * Decide whether an install run should use canonical pgserve and, when yes,
 * mutate `cfg.databaseUrl` to the canonical url.
 *
 * Semantics:
 *   - Fresh install → ALWAYS canonical (auto-installs `pgserve` globally
 *     when missing, runs `pgserve install`, reads `pgserve url`). If
 *     canonical setup completely fails, falls back to embedded with a warn
 *     — the install still completes.
 *   - Reinstall → preserves the operator's existing
 *     `serverConfig.useCanonicalPgserve`. If `true`, re-runs setup
 *     (idempotent) to refresh the canonical url. If `false`/undefined,
 *     leaves embedded mode alone — operator migrates via `omni doctor --fix`.
 */
export async function resolveCanonicalPgservePreference(
  isReinstall: boolean,
  cfg: { databaseUrl: string },
): Promise<boolean> {
  if (isReinstall) {
    const existing = loadServerConfig().useCanonicalPgserve === true;
    if (!existing) return false;
    output.raw('  Canonical pgserve mode (preserved from previous install)');
    const url = await setupCanonicalPgserve();
    if (!url) {
      output.warn('Canonical pgserve refresh failed — keeping previous databaseUrl.');
      return true;
    }
    cfg.databaseUrl = url;
    output.raw(`    ✓ omni-api will connect to ${url}`);
    output.raw('');
    return true;
  }
  output.raw('  Canonical pgserve mode (default for new installs)');
  const url = await setupCanonicalPgserve();
  if (!url) {
    output.warn(
      'Canonical pgserve setup did not complete — falling back to embedded pgserve. Run `omni doctor --fix` later to migrate.',
    );
    output.raw('');
    return false;
  }
  cfg.databaseUrl = url;
  output.raw(`    ✓ omni-api will connect to ${url}`);
  output.raw('    ✓ embedded pgserve will be skipped (PGSERVE_EMBEDDED=false)');
  output.raw('');
  return true;
}

// ---------------------------------------------------------------------------
// Embedded → canonical data migration (pg_dump + psql, mirrors genie pattern)
// ---------------------------------------------------------------------------
//
// `pgserve install` boots an empty postgres cluster at the canonical data
// dir (default `~/.pgserve/data`, override via `pgserve install --data`).
// For operators upgrading from embedded mode we have to ETL the existing
// `omni` database from the embedded pgserve into the canonical one —
// otherwise omni-api connects to a freshly-provisioned empty database and
// the operator stares at zero messages.
//
// We use `pg_dump --clean --if-exists --no-owner --no-acl` → gzip → `psql
// ON_ERROR_STOP=1`, the same pattern as `genie db backup` / `genie db
// restore` (`packages/cli/src/lib/db-backup.ts` in the genie repo). Why:
//
//   - Standard Postgres tooling. Battle-tested, schema-aware, version-tolerant.
//   - `--clean --if-exists` makes restore idempotent: the dump's prelude
//     drops every object before recreating it, so a partial-restore retry
//     is safe and a non-empty canonical target is fine (we DON'T need to
//     dance around archiving the canonical data dir before the copy).
//   - Compressed snapshot is preserved at a known path for rollback /
//     forensics — no data ever sits ONLY in the canonical cluster's heap
//     pages mid-migration.
//   - System pg_dump / psql are required (`apt install postgresql-client`).
//     genie has the same dependency. We pre-flight-check both.
//
// Sequence (caller is doctor.fixPgserveCanonical):
//   1. Caller verifies omni-api is running with embedded pgserve at :8432.
//   2. dumpEmbeddedDb(currentUrl) → snapshot at ~/.omni/backups/migration-<ts>.sql.gz.
//      Embedded MUST still be running here so pg_dump can connect.
//   3. Caller stops omni-api → frees :8432 → embedded pgserve dies.
//   4. Caller runs `pgserve install` → canonical pgserve at :8432 (empty).
//   5. restoreSnapshotToCanonical(snapshotPath, canonicalUrl) →
//      gunzip + psql against the canonical URL. Auto-provisions the
//      `omni` database via pgserve's connect-time provisioning if the
//      restore connects to it, then pipes the dump.
//   6. Caller persists config + restarts omni-api on the canonical URL.
//
// SAFETY: the embedded data dir at `~/.omni/data/pgserve` is never touched
// by this module. If anything fails, embedded is intact and the operator
// rolls back by removing `useCanonicalPgserve` from `~/.omni/config.json`
// and restarting omni-api. The snapshot file is preserved on every
// successful dump — operators can replay it manually if needed.

const OMNI_EMBEDDED_PGSERVE_DATA_DIR = join(homedir(), '.omni', 'data', 'pgserve');
const PGSERVE_DEFAULT_DATA_DIR = join(homedir(), '.pgserve', 'data');
const PGSERVE_CONFIG_PATH = join(homedir(), '.pgserve', 'config.json');
const OMNI_BACKUPS_DIR = join(homedir(), '.omni', 'backups');

/** Path of omni's embedded pgserve data dir. Surfaced in operator output. */
function getEmbeddedPgserveDataDir(): string {
  return OMNI_EMBEDDED_PGSERVE_DATA_DIR;
}

/**
 * Resolve the canonical pgserve data dir from `~/.pgserve/config.json`.
 * pgserve writes `{dataDir, port, registeredAt}` during `pgserve install`.
 * Falls back to `~/.pgserve/data` (pgserve's documented default) when the
 * config file doesn't exist yet.
 *
 * Surfaced in operator output so the migration's destination is explicit:
 * the operator can `du -sh` and `ls` that path post-migration to verify
 * the cluster is on disk where they expect.
 */
export function getCanonicalPgserveDataDir(): string {
  if (!existsSync(PGSERVE_CONFIG_PATH)) return PGSERVE_DEFAULT_DATA_DIR;
  try {
    const raw = readFileSync(PGSERVE_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { dataDir?: unknown };
    return typeof parsed.dataDir === 'string' && parsed.dataDir.length > 0 ? parsed.dataDir : PGSERVE_DEFAULT_DATA_DIR;
  } catch {
    return PGSERVE_DEFAULT_DATA_DIR;
  }
}

/** Quick sanity check that a path looks like a real Postgres data dir. */
function looksLikePgDataDir(path: string): boolean {
  return existsSync(join(path, 'PG_VERSION')) && existsSync(join(path, 'base'));
}

/** Resolve the snapshot path for this migration. ISO timestamp keeps history. */
function getSnapshotPath(timestamp: Date = new Date()): string {
  const ts = timestamp.toISOString().replace(/[:.]/g, '-');
  return join(OMNI_BACKUPS_DIR, `embedded-migration-${ts}.sql.gz`);
}

/** Test whether `cmd` is on PATH and returns 0 to its --version probe. */
function commandIsAvailable(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Parse a postgres URL into libpq env. Skips PGPASSWORD if absent so callers
 * can rely on .pgpass / peer auth for daemon-mode connections.
 */
function pgEnvFromUrl(url: string): Record<string, string> {
  const parsed = new URL(url);
  const env: Record<string, string> = {
    PGHOST: parsed.hostname,
    PGUSER: decodeURIComponent(parsed.username || 'postgres'),
    PGDATABASE: parsed.pathname.replace(/^\//, '') || 'omni',
  };
  if (parsed.port) env.PGPORT = parsed.port;
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  return env;
}

/**
 * Outcome of the dump step. Caller decides whether to proceed with restore.
 */
export type EmbeddedDumpResult =
  | { status: 'no-embedded-data'; embeddedDir: string }
  | { status: 'embedded-data-invalid'; embeddedDir: string }
  | { status: 'dumped'; embeddedDir: string; snapshotPath: string; bytes: number };

/**
 * Dump the embedded `omni` database to a gzipped SQL snapshot. Called BEFORE
 * the caller stops omni-api — embedded pgserve must still be live so pg_dump
 * can connect.
 *
 * Returns:
 *   - `no-embedded-data` when there's no embedded data dir (fresh install
 *     case — caller proceeds with an empty canonical).
 *   - `embedded-data-invalid` when the dir exists but isn't a Postgres data
 *     dir (corrupt / partial init — caller warns + proceeds empty).
 *   - `dumped` with snapshot path + size on success.
 *
 * Throws when pg_dump is missing from PATH or exits non-zero. Caller is
 * responsible for catching and rolling back omni-api to embedded.
 */
export async function dumpEmbeddedDb(currentDatabaseUrl: string): Promise<EmbeddedDumpResult> {
  const embeddedDir = getEmbeddedPgserveDataDir();

  if (!existsSync(embeddedDir)) {
    return { status: 'no-embedded-data', embeddedDir };
  }
  if (!looksLikePgDataDir(embeddedDir)) {
    output.warn(
      `Embedded pgserve dir at ${embeddedDir} is missing PG_VERSION or base/ — does not look like a Postgres data dir. Skipping dump; canonical will start empty.`,
    );
    return { status: 'embedded-data-invalid', embeddedDir };
  }

  if (!commandIsAvailable('pg_dump')) {
    throw new Error(
      'pg_dump not found in PATH — install postgresql-client (apt install postgresql-client / brew install postgresql) and retry',
    );
  }

  const snapshotPath = getSnapshotPath();
  mkdirSync(OMNI_BACKUPS_DIR, { recursive: true, mode: 0o700 });

  output.raw('  Dumping embedded database via pg_dump...');
  output.raw(`    source data dir: ${embeddedDir}`);
  output.raw(`    snapshot:        ${snapshotPath}`);

  // `--clean --if-exists` makes the restore self-contained — drops every
  // object idempotently before recreating, so the canonical target can be
  // empty (fresh install) or non-empty (retry / pre-existing) and the
  // restore converges to the embedded snapshot regardless. No DROP DATABASE
  // dance needed. Mirrors genie's db-backup.ts.
  // `--no-owner --no-acl` strips ownership/grants so a restore against a
  // different superuser (canonical's `postgres`) doesn't fail on missing
  // roles.
  const result = spawnSync('pg_dump', ['--no-owner', '--no-acl', '--clean', '--if-exists'], {
    env: { ...process.env, ...pgEnvFromUrl(currentDatabaseUrl) },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 600_000,
    maxBuffer: 1024 * 1024 * 1024 * 4, // 4 GB; should be enough for any single omni DB
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || 'unknown error';
    throw new Error(`pg_dump failed (exit ${result.status}): ${stderr}`);
  }

  // Compress with node:zlib (synchronous — data already in memory) and write
  // atomically (.tmp → rename) so a partial dump never lands at the final path.
  const compressed = gzipSync(result.stdout);
  const tmpPath = `${snapshotPath}.tmp`;
  writeFileSync(tmpPath, compressed, { mode: 0o600 });
  // Atomic on POSIX since both paths are on the same filesystem.
  renameSync(tmpPath, snapshotPath);

  const bytes = statSync(snapshotPath).size;
  output.raw(`    snapshot size:   ${formatBytes(bytes)}`);

  // Promise return shape kept so DoctorDeps.dumpEmbeddedDb and its test stubs
  // share one signature, even though spawnSync + writeFileSync are sync.
  await Promise.resolve();
  return { status: 'dumped', embeddedDir, snapshotPath, bytes };
}

/**
 * Restore a dumped snapshot into the canonical pgserve. Called AFTER the
 * caller has run `pgserve install` and confirmed canonical is reachable
 * at the URL. No-op when the snapshot status was anything but `dumped`.
 *
 * Uses `psql ON_ERROR_STOP=1` so a partial failure surfaces a non-zero exit
 * instead of leaving the canonical DB half-restored. Throws on any psql
 * error — caller rolls back to embedded.
 */
export async function restoreSnapshotToCanonical(
  dump: EmbeddedDumpResult,
  canonicalDatabaseUrl: string,
): Promise<{ status: 'restored' | 'skipped'; snapshotPath?: string }> {
  if (dump.status !== 'dumped') {
    return { status: 'skipped' };
  }

  if (!commandIsAvailable('psql')) {
    throw new Error(
      'psql not found in PATH — install postgresql-client (apt install postgresql-client / brew install postgresql) and retry',
    );
  }

  output.raw('  Restoring snapshot into canonical pgserve via psql...');
  output.raw(`    snapshot:           ${dump.snapshotPath}`);
  output.raw(`    canonical data dir: ${getCanonicalPgserveDataDir()}`);
  output.raw(`    canonical URL:      ${canonicalDatabaseUrl}`);

  const compressed = readFileSync(dump.snapshotPath);
  const sql = gunzipSync(compressed);

  const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1'], {
    env: { ...process.env, ...pgEnvFromUrl(canonicalDatabaseUrl) },
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 600_000,
    maxBuffer: 1024 * 1024 * 1024 * 4,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || 'unknown error';
    throw new Error(`psql restore failed (exit ${result.status}): ${stderr}`);
  }

  // Promise return shape kept so DoctorDeps.restoreSnapshotToCanonical and
  // its test stubs share one signature, even though spawnSync is sync.
  await Promise.resolve();
  return { status: 'restored', snapshotPath: dump.snapshotPath };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
