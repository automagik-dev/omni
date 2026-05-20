/**
 * Doctor Command
 *
 * omni doctor [--fix] [--json] [--verbose]
 *
 * In-place diagnose + repair for the embedded-omni runtime. This is the
 * command operators are pointed at when `omni update` reports a version
 * mismatch or an auth failure after a restart.
 *
 * Checks performed, in order:
 *   1. pm2-env-drift           — pm2-stored env for omni-api vs. buildRuntimeEnv()
 *   2. cli-key-valid           — stored CLI key still validates against the server
 *   3. pgserve-reachable       — TCP connect to localhost:PGSERVE_PORT
 *   4. omni-db-exists          — `omni` database exists on the embedded pgserve
 *   5. orphaned-data-dirs      — `.pgserve-data/` directories under cwd
 *   6. version-match           — CLI version vs. /api/v2/health `version` field
 *   7. pm2-status              — omni-api and omni-nats both `online` in pm2
 *   8. pm2-max-restarts        — omni-api + omni-nats have bounded restarts
 *   9. pm2-logrotate-installed — pm2-logrotate module configured correctly
 *  10. port-canonical-owner    — canonical ports owned by pm2-managed PIDs
 *
 * Each check returns OK / WARN / FAIL with a one-line detail. `--fix`
 * attempts repair for checks with a known repair path. The fix flow
 * NEVER touches `~/.omni/data/pgserve/` — that safety constraint is
 * load-bearing and has a dedicated mutation-safety test.
 *
 * Repair paths:
 *   - pm2-env-drift:           `pm2 delete omni-api` + re-launch with a
 *                              sanitized env via `buildPm2StartArgs()`.
 *   - cli-key-valid:           Delete `__primary__` from api_keys, restart
 *                              with a freshly generated OMNI_API_KEY, re-
 *                              validate, write new key to ~/.omni/config.json.
 *   - orphaned-data-dirs:      Print `rm -rf` commands for the user to review
 *                              (we never auto-delete data directories).
 *   - pm2-max-restarts:        `pm2 delete` + re-launch via `buildPm2StartArgs()`
 *                              so the hardened `--max-restarts` flag takes effect.
 *   - pm2-logrotate-installed: Re-run `pm2 install pm2-logrotate` + the four
 *                              `pm2 set pm2-logrotate:*` commands.
 *   - port-canonical-owner:    SIGTERM (then SIGKILL) the non-pm2 squatter
 *                              holding 4222 / api port, then `pm2 restart`
 *                              the managed entry. Refuses to act when the
 *                              squatter PID matches another pm2-managed entry.
 *   - pm2-status:              Reconcile port ownership (above) then `pm2
 *                              restart` any non-online managed process.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createOmniClient } from '@omni/sdk';
import { Command } from 'commander';
import {
  type Config,
  type ServerConfig,
  loadConfig,
  loadServerConfig,
  saveConfig,
  saveServerConfig,
} from '../config.js';
import { getHealthCheckUrl } from '../health.js';
import { PM2_LOGROTATE_SETTINGS } from '../install-helpers.js';
import {
  type EmbeddedDumpResult,
  dumpEmbeddedDb,
  getCanonicalPgserveDataDir,
  restoreSnapshotToCanonical,
  setupCanonicalPgserve,
} from '../lib/canonical-pgserve.js';
import { EMBEDDED_PGSERVE_DATA_DIR, migrateUnmountedEmbeddedToCanonical } from '../lib/embedded-canonical-migration.js';
import * as output from '../output.js';
import { PM2_HARDENED_DEFAULTS, PM2_PROCESSES, buildPm2StartArgs, capturePm2, isPm2Available, runPm2 } from '../pm2.js';
import { buildRuntimeEnv, resolvePgservePort } from '../runtime-env.js';
import { getServerLauncherPath } from '../server-bundle.js';
import { loadSigningContext } from '../signing.js';
import { generateApiKey } from '../utils/keys.js';
import { VERSION } from '../version.js';

// ============================================================================
// TYPES
// ============================================================================

/** Severity levels reported by each check. */
export type CheckLevel = 'OK' | 'WARN' | 'FAIL';

/** Identifier used in tests and --json output. */
export type CheckId =
  | 'pm2-env-drift'
  | 'cli-key-valid'
  | 'pgserve-reachable'
  | 'omni-db-exists'
  | 'orphaned-data-dirs'
  | 'version-match'
  | 'pm2-status'
  | 'pm2-max-restarts'
  | 'pm2-logrotate-installed'
  | 'cli-signing-key-for-locked-instances'
  | 'pgserve-canonical'
  | 'port-canonical-owner'
  | 'embedded-data-orphaned';

export interface CheckResult {
  id: CheckId;
  level: CheckLevel;
  detail: string;
}

export interface DoctorReport {
  checks: CheckResult[];
  summary: { ok: number; warn: number; fail: number };
  fixesApplied: string[];
}

export interface DoctorOptions {
  fix?: boolean;
  json?: boolean;
  verbose?: boolean;
  /**
   * Force read-only mode. When true, any `fix: true` is suppressed and
   * `runDoctor` only collects the check report. Used by `omni update`'s
   * post-update maintenance hook (`runPostUpdateMaintenance`) so the
   * probe stays read-only — `omni doctor --fix` remains the explicit
   * operator action for repair.
   */
  dryRun?: boolean;
}

/**
 * Narrow shape of a pm2 process entry from `pm2 jlist`. We only care about
 * fields relevant to env-drift and status checks.
 */
interface Pm2Entry {
  name?: string;
  pm_id?: number;
  /** Top-level OS PID of the spawned child. Used by port-canonical-owner. */
  pid?: number;
  pm2_env?: {
    status?: string;
    env?: Record<string, string | undefined>;
    pm_exec_path?: string;
    args?: string[];
    interpreter?: string;
    max_restarts?: number;
    OMNI_API_KEY?: string;
    DATABASE_URL?: string;
    PGSERVE_DATA?: string;
    API_PORT?: string;
    NODE_ENV?: string;
    LOG_LEVEL?: string;
  } & Record<string, unknown>;
}

// ============================================================================
// PM2 HELPERS
// ============================================================================

/** Parse `pm2 jlist` into a typed array; null on failure. */
async function getPm2Processes(): Promise<Pm2Entry[] | null> {
  const { code, stdout } = await capturePm2('jlist');
  if (code !== 0 || !stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(stdout) as Pm2Entry[];
  } catch {
    return null;
  }
}

/**
 * Read a key from a pm2 entry's stored env. pm2 exposes the env both as
 * `pm2_env` top-level (flat) and `pm2_env.env` (nested). We check both.
 */
function readPm2EnvKey(entry: Pm2Entry, key: string): string | undefined {
  if (!entry.pm2_env) return undefined;
  const nested = entry.pm2_env.env?.[key];
  if (typeof nested === 'string') return nested;
  const flat = (entry.pm2_env as Record<string, unknown>)[key];
  if (typeof flat === 'string') return flat;
  return undefined;
}

// ============================================================================
// CHECKS
// ============================================================================

/** Shape injected by the test harness to mock slow/external inputs. */
export interface DoctorDeps {
  /** Return all pm2 processes (or null on error). */
  getPm2Processes: () => Promise<Pm2Entry[] | null>;
  /** Return true if a TCP connect to localhost:port succeeds. */
  canConnect: (port: number) => Promise<boolean>;
  /** Return true if the omni database exists on the embedded pgserve. */
  omniDbExists: () => Promise<boolean>;
  /** Walk the filesystem for orphaned `.pgserve-data` directories. */
  findOrphanedDataDirs: () => string[];
  /** Fetch the health body from the running server. */
  fetchHealthVersion: (apiPort: number) => Promise<string | null>;
  /** Validate the stored CLI key against the running server. */
  validateStoredKey: (apiPort: number) => Promise<boolean>;
  /** Return the current `~/.omni/` configs. */
  loadState: () => { serverConfig: ServerConfig; cliConfig: Config };
  /**
   * Run a pm2 command. Returns the exit code. Tests stub this with a no-op
   * to prevent fix handlers from actually mutating the host's pm2 state.
   */
  runPm2: (args: string[], env?: Record<string, string>) => Promise<number>;
  /** Persist a new CLI config. Tests stub this to in-memory state. */
  saveCliConfig: (config: Config) => void;
  /** Re-read the CLI config from disk (stubbed in tests). */
  reloadCliConfig: () => Config;
  /** Generate a new API key. Tests stub for determinism. */
  generateApiKey: () => string;
  /** Sleep briefly after a pm2 restart. Tests stub to zero-delay. */
  sleepMs: (ms: number) => Promise<void>;
  /** Capture `pm2 conf` stdout (or null on error). Used by pm2-logrotate check. */
  capturePm2Conf: () => Promise<string | null>;
  /**
   * List instances that have `requireGenieSignature: true` set. Used by the
   * signature-key-for-locked-instances check (omni-host-fingerprint-trust
   * P2). Returns an empty array when the API is unreachable — the check
   * then becomes a no-op rather than false-positive WARN.
   */
  listLockedInstances: () => Promise<{ id: string; name: string }[]>;
  /**
   * Return true when the running CLI has a usable ed25519 keypair (i.e.
   * `omni trust handshake` has been run). Locked instances refuse
   * bearer-only requests, so an operator without a key can only do the
   * unlock-only PATCH escape — anything else fails with 401. We surface
   * that as a WARN so it's caught before the operator hits the wall.
   */
  cliHasSigningKey: () => boolean;
  /**
   * Run canonical pgserve setup (probe binary → `pgserve install` →
   * `pgserve url`). Returns the canonical URL on success or null on
   * failure. Stubbed in tests.
   */
  setupCanonicalPgserve: () => Promise<string | null>;
  /**
   * `pg_dump` the embedded omni DB → gzip → snapshot file. Called BEFORE
   * the caller stops omni-api so the embedded pgserve is still live for
   * pg_dump to connect. Returns a status so the caller can decide whether
   * to attempt a restore later. Stubbed in tests.
   */
  dumpEmbeddedDb: (currentDatabaseUrl: string) => Promise<EmbeddedDumpResult>;
  /**
   * Pipe a dumped snapshot into the canonical pgserve via `psql`. Called
   * AFTER `pgserve install` has brought canonical online. No-op when the
   * dump status was anything but `dumped`. Stubbed in tests.
   */
  restoreSnapshotToCanonical: (
    dump: EmbeddedDumpResult,
    canonicalDatabaseUrl: string,
  ) => Promise<{ status: 'restored' | 'skipped'; snapshotPath?: string }>;
  /** Resolve canonical pgserve's on-disk data dir for operator-facing logs. */
  getCanonicalPgserveDataDir: () => string;
  /**
   * Persist a partial server config (merges with existing). Stubbed in
   * tests so the canonical-pgserve fix can be validated without writing
   * to ~/.omni/config.json.
   */
  saveServerConfig: (partial: Partial<ServerConfig>) => void;
  /**
   * Resolve the OS PID currently bound to a TCP port (LISTEN). Returns
   * null when nothing is listening, when the lookup fails, or when the
   * platform tool (`ss`) is unavailable. Used by the port-canonical-owner
   * check + fixer to detect non-pm2 squatters on canonical ports.
   */
  findPortOwner: (port: number) => Promise<number | null>;
  /**
   * Send a signal to a PID. Returns true when the signal was delivered,
   * false on EPERM/ESRCH/etc. We never throw — callers treat falsy as
   * "could not signal, fall through to next strategy". Tests stub this
   * so they don't actually kill anything.
   */
  processKill: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => boolean;
}

/** Default production deps — each is a thin shim around the real call. */
function productionDeps(): DoctorDeps {
  return {
    getPm2Processes,
    canConnect: async (port: number) => {
      try {
        const socket = await Bun.connect({
          hostname: '127.0.0.1',
          port,
          socket: { data() {} },
        });
        socket.end();
        return true;
      } catch {
        return false;
      }
    },
    omniDbExists: async () => {
      // We don't have a direct DB client in the CLI; probe via the health
      // endpoint instead. If health returns 200, the DB is reachable and
      // the `omni` database exists (health does a SELECT 1).
      try {
        const serverConfig = loadServerConfig();
        const resp = await fetch(getHealthCheckUrl(serverConfig.port), {
          signal: AbortSignal.timeout(1500),
          headers: { 'Accept-Encoding': 'identity' },
        });
        if (!resp.ok) return false;
        const body = (await resp.json()) as { checks?: { database?: { status?: string } } };
        return body?.checks?.database?.status === 'ok';
      } catch {
        return false;
      }
    },
    findOrphanedDataDirs: () => {
      const roots = [process.cwd(), join(homedir(), 'workspace'), join(homedir(), 'repos')];
      const found: string[] = [];
      for (const root of roots) {
        if (!existsSync(root)) continue;
        try {
          scanForOrphans(root, found, 0);
        } catch {
          // swallow — filesystem scan is best-effort
        }
      }
      return found;
    },
    fetchHealthVersion: async (apiPort: number) => {
      try {
        const resp = await fetch(getHealthCheckUrl(apiPort), {
          signal: AbortSignal.timeout(1500),
          headers: { 'Accept-Encoding': 'identity' },
        });
        if (!resp.ok) return null;
        const body = (await resp.json()) as { version?: string };
        return body.version ?? null;
      } catch {
        return null;
      }
    },
    validateStoredKey: async (apiPort: number) => {
      const cliConfig = loadConfig();
      if (!cliConfig.apiKey) return false;
      const baseUrl = cliConfig.apiUrl ?? `http://localhost:${apiPort}`;
      try {
        const client = createOmniClient({ baseUrl, apiKey: cliConfig.apiKey, cliVersion: VERSION });
        const result = await client.auth.validate();
        return result.valid === true;
      } catch {
        return false;
      }
    },
    loadState: () => ({
      serverConfig: loadServerConfig(),
      cliConfig: loadConfig(),
    }),
    runPm2,
    saveCliConfig: saveConfig,
    reloadCliConfig: loadConfig,
    generateApiKey,
    sleepMs: (ms: number) => Bun.sleep(ms),
    capturePm2Conf: async () => {
      const { code, stdout } = await capturePm2('conf');
      if (code !== 0) return null;
      return stdout;
    },
    listLockedInstances: async () => {
      const cliConfig = loadConfig();
      // Without a stored CLI key we can't even reach /instances. Fall
      // back to "no locked instances visible" rather than crash; the
      // cli-key-valid check already FAILs and surfaces the real problem.
      if (!cliConfig.apiKey) return [];
      try {
        const apiPort = loadServerConfig().port;
        const baseUrl = cliConfig.apiUrl ?? `http://localhost:${apiPort}`;
        const client = createOmniClient({ baseUrl, apiKey: cliConfig.apiKey, cliVersion: VERSION });
        const { items } = await client.instances.list({ limit: 200 });
        return items
          .filter((i) => (i as unknown as { requireGenieSignature?: boolean }).requireGenieSignature === true)
          .map((i) => ({ id: i.id, name: i.name }));
      } catch {
        // API unreachable / network blip → no-op the check rather than
        // false-positive WARN. Other doctor checks already cover the
        // "API unreachable" failure mode (pgserve-reachable, omni-db-exists).
        return [];
      }
    },
    cliHasSigningKey: () => loadSigningContext() !== null,
    setupCanonicalPgserve,
    dumpEmbeddedDb,
    restoreSnapshotToCanonical,
    getCanonicalPgserveDataDir,
    saveServerConfig,
    findPortOwner: async (port: number): Promise<number | null> => {
      // `ss -tlnpH "sport = :PORT"` always present on modern Linux; lsof
      // is not. Output looks like:
      //   LISTEN 0 4096 *:4222 *:* users:(("nats-server",pid=2342077,fd=4))
      // We only care about the first pid= match.
      try {
        const proc = Bun.spawn(['ss', '-tlnpH', `sport = :${port}`], {
          stdout: 'pipe',
          stderr: 'ignore',
        });
        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        if (exitCode !== 0) return null;
        const match = stdout.match(/pid=(\d+)/);
        return match ? Number.parseInt(match[1], 10) : null;
      } catch {
        return null;
      }
    },
    processKill: (pid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean => {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        // EPERM (no permission), ESRCH (no such process), EINVAL (bad signal).
        return false;
      }
    },
  };
}

/**
 * Recursively scan for `.pgserve-data` directories (bounded depth). Used by
 * `findOrphanedDataDirs`. Skips node_modules and hidden siblings for speed.
 */
function scanForOrphans(dir: string, acc: string[], depth: number, maxDepth = 4): void {
  if (depth > maxDepth) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    if (name === '.pgserve-data') {
      acc.push(resolve(full));
      continue;
    }
    scanForOrphans(full, acc, depth + 1, maxDepth);
  }
}

/** Check 1: pm2 stored env vs. buildRuntimeEnv() output. */
async function checkPm2EnvDrift(deps: DoctorDeps): Promise<CheckResult> {
  const processes = await deps.getPm2Processes();
  if (!processes) {
    return { id: 'pm2-env-drift', level: 'WARN', detail: 'pm2 not reachable — cannot compare env' };
  }
  const apiEntry = processes.find((p) => p.name === PM2_PROCESSES.api);
  if (!apiEntry) {
    return { id: 'pm2-env-drift', level: 'WARN', detail: `${PM2_PROCESSES.api} not found in pm2` };
  }
  const { serverConfig, cliConfig } = deps.loadState();
  const expected = buildRuntimeEnv(serverConfig, cliConfig);

  const storedDbUrl = readPm2EnvKey(apiEntry, 'DATABASE_URL');
  const storedPgserveData = readPm2EnvKey(apiEntry, 'PGSERVE_DATA');

  if (storedPgserveData && storedPgserveData !== expected.PGSERVE_DATA) {
    return {
      id: 'pm2-env-drift',
      level: 'FAIL',
      detail: `PGSERVE_DATA drift: pm2="${storedPgserveData}" expected="${expected.PGSERVE_DATA}"`,
    };
  }
  if (storedDbUrl && storedDbUrl !== expected.DATABASE_URL) {
    return {
      id: 'pm2-env-drift',
      level: 'WARN',
      detail: `DATABASE_URL drift: pm2="${storedDbUrl}" expected="${expected.DATABASE_URL}"`,
    };
  }
  return { id: 'pm2-env-drift', level: 'OK', detail: 'pm2 stored env matches config' };
}

/** Check 2: CLI key still validates against the running server. */
async function checkCliKeyValid(deps: DoctorDeps): Promise<CheckResult> {
  const { serverConfig } = deps.loadState();
  const valid = await deps.validateStoredKey(serverConfig.port);
  if (valid) {
    return { id: 'cli-key-valid', level: 'OK', detail: 'stored CLI key validates against server' };
  }
  return { id: 'cli-key-valid', level: 'FAIL', detail: 'stored CLI key does not validate' };
}

/** Check 3: pgserve is reachable on its configured port. */
async function checkPgserveReachable(deps: DoctorDeps): Promise<CheckResult> {
  const { serverConfig } = deps.loadState();
  const port = resolvePgservePort(serverConfig);
  const ok = await deps.canConnect(port);
  if (ok) {
    return { id: 'pgserve-reachable', level: 'OK', detail: `pgserve listening on :${port}` };
  }
  return { id: 'pgserve-reachable', level: 'FAIL', detail: `cannot connect to pgserve on :${port}` };
}

/** Check 4: `omni` database exists on embedded pgserve. */
async function checkOmniDbExists(deps: DoctorDeps): Promise<CheckResult> {
  const exists = await deps.omniDbExists();
  if (exists) {
    return { id: 'omni-db-exists', level: 'OK', detail: 'omni database is reachable' };
  }
  return { id: 'omni-db-exists', level: 'FAIL', detail: 'omni database is not reachable' };
}

/**
 * Check 13: embedded pgserve data dir holds data the canonical DB doesn't.
 *
 * Failure signal: `useCanonicalPgserve: true` (operator is committed to
 * canonical), canonical `omni` DB exists but is EMPTY (no instances rows),
 * AND `~/.omni/data/pgserve/` looks like a valid Postgres data dir. This is
 * the regression state every operator hits when they upgraded past
 * pgserve-singleton-no-proxy G2 without an in-flight embedded-API to feed
 * the legacy fixPgserveCanonical migration.
 *
 * --fix runs migrateUnmountedEmbeddedToCanonical (spawns a temp postmaster
 * against the embedded dir, copies tables to canonical, shuts down).
 */
async function checkEmbeddedDataOrphaned(deps: DoctorDeps): Promise<CheckResult> {
  const { serverConfig } = deps.loadState();
  if (serverConfig.useCanonicalPgserve !== true) {
    return { id: 'embedded-data-orphaned', level: 'OK', detail: 'embedded mode — no orphan check needed' };
  }
  if (!existsSync(join(EMBEDDED_PGSERVE_DATA_DIR, 'PG_VERSION'))) {
    return { id: 'embedded-data-orphaned', level: 'OK', detail: 'no embedded data dir present' };
  }
  // If canonical isn't reachable we can't say either way — defer to
  // omni-db-exists FAIL and let the operator fix that first.
  if (!(await deps.omniDbExists())) {
    return {
      id: 'embedded-data-orphaned',
      level: 'OK',
      detail: 'canonical not reachable yet — embedded check deferred',
    };
  }
  // Read instance count via the API health endpoint already deployed at
  // omni-api. If canonical has zero instances and embedded dir exists →
  // FAIL with the actionable migration hint.
  try {
    const resp = await fetch(`http://127.0.0.1:${serverConfig.port}/api/v2/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await resp.json()) as { instances?: { total?: number } };
    const total = body?.instances?.total ?? 0;
    if (total === 0) {
      return {
        id: 'embedded-data-orphaned',
        level: 'FAIL',
        detail: `embedded dir at ${EMBEDDED_PGSERVE_DATA_DIR} holds data but canonical omni is empty — run \`omni doctor --fix\` to migrate`,
      };
    }
    return {
      id: 'embedded-data-orphaned',
      level: 'OK',
      detail: `canonical omni already has ${total} instance(s)`,
    };
  } catch {
    // Health unreachable — be silent rather than red-cross.
    return { id: 'embedded-data-orphaned', level: 'OK', detail: 'health endpoint unreachable — defer' };
  }
}

/** Fix handler for the embedded-data-orphaned check. */
async function fixEmbeddedDataOrphaned(_deps: DoctorDeps): Promise<string> {
  output.raw('  Migrating unmounted embedded pgserve → canonical autopg...');
  const result = await migrateUnmountedEmbeddedToCanonical({
    log: (line) => output.raw(line),
  });
  if (result.status === 'skipped') {
    throw new Error(`migration skipped: ${result.reason}`);
  }
  output.raw(`  ✓ migrated ${result.tables} tables in ${result.durationMs}ms`);
  output.raw('    Re-run `omni install --non-interactive` to re-apply scoped-role grants on the restored data.');
  return `migrated ${result.tables} tables from embedded to canonical (${result.durationMs}ms)`;
}

/** Check 5: look for orphaned `.pgserve-data` directories. */
function checkOrphanedDataDirs(deps: DoctorDeps): CheckResult {
  const found = deps.findOrphanedDataDirs();
  if (found.length === 0) {
    return { id: 'orphaned-data-dirs', level: 'OK', detail: 'no orphaned data directories found' };
  }
  return {
    id: 'orphaned-data-dirs',
    level: 'WARN',
    detail: `orphaned data dirs: ${found.join(', ')}`,
  };
}

/** Check 6: CLI version matches server. */
async function checkVersionMatch(deps: DoctorDeps): Promise<CheckResult> {
  const { serverConfig } = deps.loadState();
  const serverVersion = await deps.fetchHealthVersion(serverConfig.port);
  if (!serverVersion) {
    return { id: 'version-match', level: 'WARN', detail: 'could not reach /api/v2/health' };
  }
  const cliClean = VERSION.split('+')[0];
  const serverClean = serverVersion.split('+')[0];
  if (cliClean === serverClean) {
    return { id: 'version-match', level: 'OK', detail: `cli=v${cliClean} server=v${serverClean}` };
  }
  return {
    id: 'version-match',
    level: 'WARN',
    detail: `version mismatch: cli=v${cliClean} server=v${serverClean}`,
  };
}

/** Check 7: pm2 shows omni-api and omni-nats both online. */
async function checkPm2Status(deps: DoctorDeps): Promise<CheckResult> {
  const processes = await deps.getPm2Processes();
  if (!processes) {
    return { id: 'pm2-status', level: 'WARN', detail: 'pm2 not reachable' };
  }
  const api = processes.find((p) => p.name === PM2_PROCESSES.api);
  const nats = processes.find((p) => p.name === PM2_PROCESSES.nats);
  const apiStatus = api?.pm2_env?.status ?? 'missing';
  const natsStatus = nats?.pm2_env?.status ?? 'missing';
  if (apiStatus === 'online' && natsStatus === 'online') {
    return { id: 'pm2-status', level: 'OK', detail: 'omni-api and omni-nats online' };
  }
  return {
    id: 'pm2-status',
    level: 'FAIL',
    detail: `pm2 status: omni-api=${apiStatus} omni-nats=${natsStatus}`,
  };
}

/**
 * Check 8: pm2 max_restarts on omni-api AND omni-nats is in the hardened range.
 *
 * The 2026-04-09 incident crash-looped omni-api and grew logs to 283 GB
 * because pm2 had `max_restarts: 0` (the default = unbounded). The
 * hardened flag sets it to 10. Values 5..50 pass; 0 or >= 1000 FAIL;
 * other values WARN.
 *
 * The 2026-05-07 incident (port-canonical-owner wish) repeated the same
 * pattern on omni-nats — 75 restarts in tight backoff because the prior
 * orphan held 4222. omni-nats is now covered too.
 */
async function checkPm2MaxRestarts(deps: DoctorDeps): Promise<CheckResult> {
  const processes = await deps.getPm2Processes();
  if (!processes) {
    return { id: 'pm2-max-restarts', level: 'WARN', detail: 'pm2 not reachable' };
  }
  const issues: string[] = [];
  let hasFail = false;
  const targets = [PM2_PROCESSES.api, PM2_PROCESSES.nats];
  for (const name of targets) {
    const entry = processes.find((p) => p.name === name);
    if (!entry) {
      issues.push(`${name} not found in pm2`);
      continue;
    }
    const v = entry.pm2_env?.max_restarts;
    if (typeof v !== 'number') {
      hasFail = true;
      issues.push(`${name} has no max_restarts set — crash loops are unbounded`);
      continue;
    }
    if (v === 0 || v >= 1000) {
      hasFail = true;
      issues.push(`${name} max_restarts=${v} — crash loops are effectively unbounded`);
      continue;
    }
    if (!(v >= 5 && v <= 50)) {
      issues.push(`${name} max_restarts=${v} — expected 5..50`);
    }
  }
  if (issues.length === 0) {
    return {
      id: 'pm2-max-restarts',
      level: 'OK',
      detail: `${PM2_PROCESSES.api} and ${PM2_PROCESSES.nats} max_restarts in hardened range`,
    };
  }
  return {
    id: 'pm2-max-restarts',
    level: hasFail ? 'FAIL' : 'WARN',
    detail: issues.join('; '),
  };
}

/**
 * Check 9: pm2-logrotate module installed with the expected settings.
 *
 * The install command wires logrotate during boot. If pm2 conf drifts
 * (operator ran `pm2 unset ...` or reinstalled pm2), logs will grow
 * unbounded. FAIL if the module is missing or any required key is wrong.
 */
async function checkPm2LogrotateInstalled(deps: DoctorDeps): Promise<CheckResult> {
  const conf = await deps.capturePm2Conf();
  if (conf === null) {
    return { id: 'pm2-logrotate-installed', level: 'WARN', detail: 'pm2 conf unreachable' };
  }
  if (!conf.includes('pm2-logrotate')) {
    return {
      id: 'pm2-logrotate-installed',
      level: 'FAIL',
      detail: 'pm2-logrotate module not installed — logs will grow unbounded',
    };
  }
  const missing: string[] = [];
  for (const [key, value] of Object.entries(PM2_LOGROTATE_SETTINGS)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${key}\\s+${escaped}`);
    if (!pattern.test(conf)) missing.push(key);
  }
  if (missing.length > 0) {
    return {
      id: 'pm2-logrotate-installed',
      level: 'FAIL',
      detail: `pm2-logrotate misconfigured: ${missing.join(', ')}`,
    };
  }
  return {
    id: 'pm2-logrotate-installed',
    level: 'OK',
    detail: 'pm2-logrotate installed with expected settings',
  };
}

/**
 * Build the list of (process, port) pairs whose listener PID must match
 * the pm2-managed PID. Centralized so check + fixer agree on scope.
 *
 * - omni-api: serverConfig.port (operator-configurable; default 8882).
 * - omni-nats: 4222 — NATS_PORT env override exists in ecosystem.config.cjs
 *   but defaults to 4222 across the fleet. We do not read process.env here
 *   (env pollution is the bug we're fixing in adjacent checks).
 */
function canonicalPortTargets(serverConfig: ServerConfig): Array<{ name: string; port: number }> {
  return [
    { name: PM2_PROCESSES.api, port: serverConfig.port },
    { name: PM2_PROCESSES.nats, port: 4222 },
  ];
}

/**
 * Check 12: each canonical port (4222 for nats, serverConfig.port for api)
 * is owned by the pm2-managed PID — not a non-pm2 squatter.
 *
 * Detects the 2026-05-07 incident: an orphan `nats-server` from a prior
 * session held 4222, so pm2's omni-nats crash-looped 75 times trying to
 * bind. omni-api was happily talking to the orphan, so the system "worked"
 * but pm2 was incinerating CPU + log space restarting forever.
 *
 * Returns OK when all canonical ports map to their pm2-managed PIDs.
 * Returns FAIL listing each squatter (port + non-pm2 PID + pm2 PID).
 * Returns WARN when no listener exists yet (pm2 may be in startup window).
 */
async function checkPortCanonicalOwner(deps: DoctorDeps): Promise<CheckResult> {
  const processes = await deps.getPm2Processes();
  if (!processes) {
    return { id: 'port-canonical-owner', level: 'WARN', detail: 'pm2 not reachable' };
  }
  const { serverConfig } = deps.loadState();
  const targets = canonicalPortTargets(serverConfig);
  const issues: string[] = [];
  for (const { name, port } of targets) {
    const pm2Entry = processes.find((p) => p.name === name);
    const pm2Pid = pm2Entry?.pid;
    const ownerPid = await deps.findPortOwner(port);
    if (ownerPid === null) {
      // No listener — pm2-status check will flag this if the managed
      // process isn't online. Don't double-report here.
      continue;
    }
    if (typeof pm2Pid !== 'number' || pm2Pid <= 0) {
      issues.push(`${name}:${port} owned by pid=${ownerPid} but pm2 has no PID for ${name}`);
      continue;
    }
    if (ownerPid !== pm2Pid) {
      issues.push(`${name}:${port} owned by non-pm2 pid=${ownerPid} (pm2 child pid=${pm2Pid})`);
    }
  }
  if (issues.length === 0) {
    return {
      id: 'port-canonical-owner',
      level: 'OK',
      detail: 'all canonical ports owned by pm2-managed processes',
    };
  }
  return {
    id: 'port-canonical-owner',
    level: 'FAIL',
    detail: issues.join('; '),
  };
}

// ============================================================================
// FIX HANDLERS
// ============================================================================

/**
 * Relaunch omni-api via pm2 delete + pm2 start with a hermetic env.
 *
 * SAFETY: This function must NEVER touch `~/.omni/data/pgserve/`. We only
 * operate on the pm2-managed process lifecycle and the stored env. A
 * mutation-safety test guards this invariant.
 */
async function fixPm2EnvDrift(deps: DoctorDeps): Promise<string> {
  const { serverConfig, cliConfig } = deps.loadState();
  const env = buildRuntimeEnv(serverConfig, cliConfig);
  // Best-effort delete — if the process doesn't exist we still want the
  // subsequent start to succeed.
  await deps.runPm2(['delete', PM2_PROCESSES.api], env);
  const startArgs = buildPm2StartArgs({
    kind: 'api',
    script: getServerLauncherPath(),
    name: PM2_PROCESSES.api,
    interpreter: 'bash',
  });
  const startCode = await deps.runPm2(startArgs, env);
  if (startCode !== 0) {
    throw new Error(`pm2 start ${PM2_PROCESSES.api} exited ${startCode}`);
  }
  return `relaunched ${PM2_PROCESSES.api} with sanitized env and hardened flags`;
}

/**
 * Fix pm2-max-restarts by deleting and re-launching omni-api with the
 * hardened `buildPm2StartArgs()` flags. Identical in structure to
 * fixPm2EnvDrift — the difference is the failure signal that triggers it.
 */
async function fixPm2MaxRestarts(deps: DoctorDeps): Promise<string> {
  const { serverConfig, cliConfig } = deps.loadState();
  const env = buildRuntimeEnv(serverConfig, cliConfig);
  await deps.runPm2(['delete', PM2_PROCESSES.api], env);
  const startArgs = buildPm2StartArgs({
    kind: 'api',
    script: getServerLauncherPath(),
    name: PM2_PROCESSES.api,
    interpreter: 'bash',
  });
  const startCode = await deps.runPm2(startArgs, env);
  if (startCode !== 0) {
    throw new Error(`pm2 start ${PM2_PROCESSES.api} exited ${startCode}`);
  }
  return `relaunched ${PM2_PROCESSES.api} with --max-restarts ${PM2_HARDENED_DEFAULTS.maxRestarts}`;
}

/**
 * Fix pm2-logrotate-installed by re-running `pm2 install pm2-logrotate` and
 * the four `pm2 set pm2-logrotate:*` commands. Matches the installer.
 */
async function fixPm2LogrotateInstalled(deps: DoctorDeps): Promise<string> {
  const installCode = await deps.runPm2(['install', 'pm2-logrotate']);
  if (installCode !== 0) {
    throw new Error(`pm2 install pm2-logrotate exited ${installCode}`);
  }
  const failures: string[] = [];
  for (const [key, value] of Object.entries(PM2_LOGROTATE_SETTINGS)) {
    const code = await deps.runPm2(['set', `pm2-logrotate:${key}`, value]);
    if (code !== 0) failures.push(key);
  }
  if (failures.length > 0) {
    throw new Error(`pm2-logrotate set failed for: ${failures.join(', ')}`);
  }
  return 'reinstalled and configured pm2-logrotate';
}

/**
 * Rotate the CLI/server auth key. Requires the operator to have already
 * deleted the `__primary__` row from api_keys (we cannot do that from the
 * CLI without a raw DB connection). We DO generate a new key, restart the
 * API with it in the env, re-validate, and persist the new key to
 * ~/.omni/config.json on success.
 */
async function fixCliKeyValid(deps: DoctorDeps): Promise<string> {
  const { serverConfig, cliConfig } = deps.loadState();
  const newKey = deps.generateApiKey();
  const env = { ...buildRuntimeEnv(serverConfig, { ...cliConfig, apiKey: newKey }), OMNI_API_KEY: newKey };
  await deps.runPm2(['set', `${PM2_PROCESSES.api}:OMNI_API_KEY`, newKey]);
  const restartCode = await deps.runPm2(['restart', PM2_PROCESSES.api], env);
  if (restartCode !== 0) {
    throw new Error(`pm2 restart ${PM2_PROCESSES.api} exited ${restartCode}`);
  }

  // Give the API a moment to come back up, then re-validate.
  await deps.sleepMs(1000);
  const valid = await deps.validateStoredKey(serverConfig.port);
  if (!valid) {
    // Persist anyway — the operator may need the key to run manual DB ops.
    const updated = deps.reloadCliConfig();
    updated.apiKey = newKey;
    deps.saveCliConfig(updated);
    throw new Error('rotated key does not validate; manually delete __primary__ from api_keys and rerun');
  }

  const updated = deps.reloadCliConfig();
  updated.apiKey = newKey;
  deps.saveCliConfig(updated);
  return 'rotated CLI key and re-validated';
}

/**
 * Migrate an embedded install onto canonical pgserve via `pg_dump` + `psql`,
 * mirroring genie's `db backup` / `db restore` pattern.
 *
 * Sequence:
 *   1. Pre-flight: dump the embedded `omni` DB to a gzipped snapshot at
 *      `~/.omni/backups/embedded-migration-<ISO>.sql.gz`. omni-api MUST be
 *      running here so pg_dump can connect — that's why dump is step 1, not
 *      step 3.
 *   2. Stop omni-api → frees :8432 + releases the embedded data dir's locks.
 *   3. `pgserve install` → canonical pgserve at canonical data dir
 *      (`~/.pgserve/data` by default; surfaced explicitly to the operator).
 *   4. Restore the snapshot into canonical via `psql ON_ERROR_STOP=1`.
 *   5. Persist `useCanonicalPgserve: true` + canonical `databaseUrl`.
 *   6. Relaunch omni-api with the new env so `PGSERVE_EMBEDDED=false` takes
 *      effect.
 *
 * SAFETY:
 *   - Embedded data dir at `~/.omni/data/pgserve` is never modified. On
 *     any failure the operator can roll back by removing
 *     `useCanonicalPgserve` from `~/.omni/config.json` and restarting
 *     omni-api — embedded mode picks the data right back up.
 *   - The snapshot is preserved at the path printed at step 1. If restore
 *     fails, operators can replay it manually with
 *     `gunzip -c <snapshot> | psql <canonical-url>` once they've fixed
 *     whatever blocked psql.
 *
 * On any failure (dump error, pgserve install failed, restore failed,
 * omni-api relaunch failed) we restart omni-api on embedded so operators
 * are not left with a dead API. Config is only persisted after the
 * complete dump → install → restore → relaunch chain succeeds.
 */
async function fixPgserveCanonical(deps: DoctorDeps): Promise<string> {
  const { serverConfig, cliConfig } = deps.loadState();

  // Step 1: dump embedded DB FIRST while omni-api (and its embedded pgserve)
  // is still running. pg_dump needs a live target. The snapshot is written
  // outside any pgserve data dir so it survives the migration regardless of
  // outcome.
  let dumpResult: EmbeddedDumpResult;
  try {
    dumpResult = await deps.dumpEmbeddedDb(serverConfig.databaseUrl);
  } catch (err) {
    throw new Error(
      `pg_dump of embedded omni DB failed (${err instanceof Error ? err.message : String(err)}); omni-api still running on embedded — install postgresql-client (apt install postgresql-client) if pg_dump is missing, then retry`,
    );
  }

  // Step 2: stop omni-api so the embedded pgserve releases port 8432 AND
  // the data dir's postmaster lock. After this point the embedded DB is no
  // longer reachable; we rely on the snapshot from step 1.
  await deps.runPm2(['stop', PM2_PROCESSES.api]);

  // Step 3: provision canonical pgserve.
  const url = await deps.setupCanonicalPgserve();
  if (!url) {
    // Bring omni-api back up on embedded — operator isn't left dead.
    await deps.runPm2(['start', PM2_PROCESSES.api]);
    throw new Error(
      'canonical pgserve setup failed (autopg v3 / pgserve v2 binary unavailable or install failed) — install autopg:\n  curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash\nthen re-run: omni doctor --fix',
    );
  }

  // Step 4: restore the snapshot. No-op when nothing was dumped (fresh
  // install). On failure: rollback omni-api to embedded, preserve the
  // snapshot path so operators can investigate / replay manually.
  let restoreOutcome: { status: 'restored' | 'skipped'; snapshotPath?: string };
  try {
    restoreOutcome = await deps.restoreSnapshotToCanonical(dumpResult, url);
  } catch (err) {
    await deps.runPm2(['start', PM2_PROCESSES.api]);
    const snapshotHint = dumpResult.status === 'dumped' ? ` snapshot preserved at ${dumpResult.snapshotPath}` : '';
    throw new Error(
      `psql restore into canonical pgserve failed (${err instanceof Error ? err.message : String(err)}); omni-api restarted on embedded —${snapshotHint} retry by replaying the dump manually or re-running \`omni doctor --fix\``,
    );
  }

  // Step 5: persist config first so a relaunch failure leaves the operator
  // on canonical (the new recommended state) rather than half-migrated.
  deps.saveServerConfig({ databaseUrl: url, useCanonicalPgserve: true });

  // Step 6: relaunch omni-api with the new env so PGSERVE_EMBEDDED=false
  // takes effect. delete + start (instead of restart) so the new env is
  // picked up — pm2's restart preserves stored env in some configurations.
  const env = buildRuntimeEnv({ ...serverConfig, databaseUrl: url, useCanonicalPgserve: true }, cliConfig);
  await deps.runPm2(['delete', PM2_PROCESSES.api], env);
  const startArgs = buildPm2StartArgs({
    kind: 'api',
    script: getServerLauncherPath(),
    name: PM2_PROCESSES.api,
    interpreter: 'bash',
  });
  const startCode = await deps.runPm2(startArgs, env);
  if (startCode !== 0) {
    throw new Error(`pm2 start ${PM2_PROCESSES.api} exited ${startCode} after canonical migration`);
  }

  // Compose a result message that surfaces every concrete path so the
  // operator can verify the migration without grepping logs:
  //   - canonical data dir (where the cluster lives on disk)
  //   - canonical URL (where omni-api connects)
  //   - snapshot path (rollback artifact)
  const canonicalDir = deps.getCanonicalPgserveDataDir();
  const dataNote =
    dumpResult.status === 'dumped' && restoreOutcome.status === 'restored'
      ? `restored ${dumpResult.snapshotPath} into ${canonicalDir} (omni-api → ${url})`
      : dumpResult.status === 'no-embedded-data'
        ? `no embedded data to migrate; canonical started empty at ${canonicalDir} (omni-api → ${url})`
        : `embedded data dir invalid; canonical started empty at ${canonicalDir} (omni-api → ${url})`;
  return `migrated to canonical pgserve@^2.1.0; ${dataNote}`;
}

/**
 * Wait up to ~5s for a PID to release a port. Returns true when the
 * port owner changes (process exited or was reaped); false when the
 * PID is still bound.
 */
async function waitForPortRelease(deps: DoctorDeps, pid: number, port: number): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    await deps.sleepMs(500);
    const stillOwner = await deps.findPortOwner(port);
    if (stillOwner !== pid) return true;
  }
  return false;
}

/**
 * Reconcile a single (service, port) pair. Returns a human-readable
 * outcome ("reclaimed ...", "SKIPPED ...", "FAILED ...") or null when
 * nothing needed to be done (port healthy or no listener at all).
 *
 * Extracted from `fixPortCanonicalOwner` to keep that function below
 * the cognitive-complexity ceiling.
 */
async function reclaimPortFromSquatter(
  deps: DoctorDeps,
  target: { name: string; port: number },
  pm2Pid: number | undefined,
  managedPids: Set<number>,
): Promise<string | null> {
  const { name, port } = target;
  const ownerPid = await deps.findPortOwner(port);
  if (ownerPid === null) return null; // no listener → nothing to reclaim
  if (typeof pm2Pid === 'number' && ownerPid === pm2Pid) return null; // healthy
  if (managedPids.has(ownerPid)) {
    return `SKIPPED ${name}:${port} squatter pid=${ownerPid} is itself pm2-managed`;
  }
  if (!deps.processKill(ownerPid, 'SIGTERM')) {
    return `FAILED ${name}:${port} could not signal pid=${ownerPid} (EPERM/ESRCH)`;
  }
  const released = await waitForPortRelease(deps, ownerPid, port);
  if (!released) {
    deps.processKill(ownerPid, 'SIGKILL');
    await deps.sleepMs(500);
  }
  // pm2 restart so the managed entry can bind. Idempotent against
  // status=online (pm2 just rolls the process).
  const code = await deps.runPm2(['restart', name]);
  if (code !== 0) {
    return `FAILED ${name}:${port} pm2 restart exited ${code} after killing pid=${ownerPid}`;
  }
  return `reclaimed ${name}:${port} from non-pm2 pid=${ownerPid}`;
}

/**
 * Reclaim canonical ports from non-pm2 squatters.
 *
 * For each (service, port) target where the listener PID is not the
 * pm2-managed PID:
 *   1. Refuse if the squatter PID matches another pm2-managed entry
 *      (foot-gun guard — never murder a sibling channel process).
 *   2. Send SIGTERM and poll for up to 5s for the squatter to exit.
 *   3. Escalate to SIGKILL if still alive.
 *   4. `pm2 restart <name>` so the managed process can finally bind.
 *
 * Idempotent: a pass with no conflicts is a no-op. Returns a human-
 * readable summary of every reclaim, skip, and failure.
 */
async function fixPortCanonicalOwner(deps: DoctorDeps): Promise<string> {
  const processes = await deps.getPm2Processes();
  if (!processes) {
    throw new Error('pm2 not reachable — cannot reconcile port ownership');
  }
  const { serverConfig } = deps.loadState();
  const targets = canonicalPortTargets(serverConfig);
  // Set of all current pm2 child PIDs across every managed entry — used
  // to refuse killing a sibling pm2 process by mistake.
  const managedPids = new Set(processes.map((p) => p.pid).filter((p): p is number => typeof p === 'number' && p > 0));
  const repairs: string[] = [];
  for (const target of targets) {
    const pm2Entry = processes.find((p) => p.name === target.name);
    const outcome = await reclaimPortFromSquatter(deps, target, pm2Entry?.pid, managedPids);
    if (outcome !== null) repairs.push(outcome);
  }
  if (repairs.length === 0) return 'no port-ownership conflicts to reconcile';
  return repairs.join('; ');
}

/**
 * Restart any pm2-managed process that is not `online`. Used by
 * `fixPm2Status` as the fall-through after port-ownership reconciliation.
 */
async function restartNonOnlineProcesses(deps: DoctorDeps): Promise<string[]> {
  const processes = await deps.getPm2Processes();
  if (!processes) return [];
  const restarted: string[] = [];
  for (const name of [PM2_PROCESSES.api, PM2_PROCESSES.nats]) {
    const entry = processes.find((p) => p.name === name);
    if (entry?.pm2_env?.status !== 'online') {
      const code = await deps.runPm2(['restart', name]);
      if (code === 0) restarted.push(name);
    }
  }
  return restarted;
}

/**
 * Fix `pm2-status` FAIL: reconcile port ownership first (most common
 * cause of `waiting restart` is a port squatter), then `pm2 restart` any
 * managed process that is still not `online`. Idempotent.
 */
async function fixPm2Status(deps: DoctorDeps): Promise<string> {
  const portRepairs = await fixPortCanonicalOwner(deps);
  const restarted = await restartNonOnlineProcesses(deps);
  const parts: string[] = [];
  if (portRepairs !== 'no port-ownership conflicts to reconcile') parts.push(portRepairs);
  if (restarted.length > 0) parts.push(`restarted ${restarted.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : 'no pm2 status remediation needed';
}

/** Print `rm -rf` instructions for orphaned dirs — we never auto-delete. */
function fixOrphanedDataDirs(deps: DoctorDeps): string {
  const found = deps.findOrphanedDataDirs();
  if (found.length === 0) {
    return 'no orphaned data dirs to clean';
  }
  output.raw('');
  output.warn('Review these commands before running them — orphaned dirs are not auto-deleted:');
  for (const dir of found) {
    output.raw(`  rm -rf ${dir}`);
  }
  output.raw('');
  return `printed ${found.length} rm-rf suggestion(s)`;
}

/**
 * Check 10: when one or more instances are locked
 * (require_genie_signature = true) but this CLI doesn't have a signing
 * keypair, warn that bearer-only admin will fail and tell the operator
 * how to fix it.
 *
 * Three cases:
 *   - No locked instances → OK (signature pipeline may or may not be
 *     in use; nothing for this check to assert).
 *   - Locked instances + key present → OK (signed admin works).
 *   - Locked instances + no key → WARN with the exact recovery command.
 *
 * The kill-switch unlock PATCH (omni#568) still works without a key,
 * so this is genuinely a WARN (operator can recover) rather than FAIL.
 */
async function checkSigningKeyForLockedInstances(deps: DoctorDeps): Promise<CheckResult> {
  const locked = await deps.listLockedInstances();
  if (locked.length === 0) {
    return {
      id: 'cli-signing-key-for-locked-instances',
      level: 'OK',
      detail: 'no instances require signed requests (or API unreachable — check pgserve-reachable / omni-db-exists)',
    };
  }
  const hasKey = deps.cliHasSigningKey();
  if (hasKey) {
    return {
      id: 'cli-signing-key-for-locked-instances',
      level: 'OK',
      detail: `${locked.length} instance(s) require signing; CLI has a signing key — admin will sign automatically`,
    };
  }
  const names = locked
    .slice(0, 3)
    .map((i) => i.name || i.id.slice(0, 8))
    .join(', ');
  const more = locked.length > 3 ? ` (+${locked.length - 3} more)` : '';
  return {
    id: 'cli-signing-key-for-locked-instances',
    level: 'WARN',
    detail: `${locked.length} instance(s) require signing (${names}${more}) but this CLI has no key in ~/.omni/keys/. Bearer-only admin against these instances will fail with 401 GENIE_SIGNATURE_REQUIRED. Run \`omni trust handshake\` to enable signed requests. (The unlock-only PATCH escape from omni#568 still works without a key.)`,
  };
}

/**
 * Check 11: pgserve has grown up — operators on embedded mode get a WARN
 * pointing them at the canonical-pgserve@^2.1.0 path. `--fix` migrates by
 * running `pgserve install`, writing the canonical url into config, and
 * relaunching omni-api with `PGSERVE_EMBEDDED=false`.
 *
 * Three states:
 *   - `useCanonicalPgserve === true`           → OK (already canonical).
 *   - field absent OR `false`                  → WARN with the migration hint.
 *
 * The check NEVER fails — embedded still works; canonical is the
 * recommended path. We will tighten this to FAIL once canonical is proven
 * across the fleet.
 */
function checkPgserveCanonical(deps: DoctorDeps): CheckResult {
  const { serverConfig } = deps.loadState();
  if (serverConfig.useCanonicalPgserve === true) {
    return {
      id: 'pgserve-canonical',
      level: 'OK',
      detail: 'using canonical pgserve@^2.1.0 (single shared backbone with genie + others)',
    };
  }
  return {
    id: 'pgserve-canonical',
    level: 'WARN',
    detail:
      'using embedded pgserve — DEPRECATED. Canonical pgserve@^2.1.0 is the supported path; embedded mode will be removed in a future release. Run `omni doctor --fix` to migrate (idempotent; pg_dump → pgserve install → restore → relaunch).',
  };
}

// ============================================================================
// MAIN
// ============================================================================

/** Run the full check battery sequentially. */
async function runAllChecks(deps: DoctorDeps): Promise<CheckResult[]> {
  return [
    await checkPm2EnvDrift(deps),
    await checkCliKeyValid(deps),
    await checkPgserveReachable(deps),
    await checkOmniDbExists(deps),
    checkOrphanedDataDirs(deps),
    await checkVersionMatch(deps),
    await checkPm2Status(deps),
    await checkPm2MaxRestarts(deps),
    await checkPm2LogrotateInstalled(deps),
    await checkSigningKeyForLockedInstances(deps),
    checkPgserveCanonical(deps),
    await checkPortCanonicalOwner(deps),
    await checkEmbeddedDataOrphaned(deps),
  ];
}

/** Dispatch to the appropriate fix handler for a single failing check. */
async function applyFix(deps: DoctorDeps, check: CheckResult): Promise<string | null> {
  try {
    if (check.id === 'pm2-env-drift') return await fixPm2EnvDrift(deps);
    if (check.id === 'cli-key-valid') return await fixCliKeyValid(deps);
    if (check.id === 'orphaned-data-dirs') return fixOrphanedDataDirs(deps);
    if (check.id === 'pm2-max-restarts') return await fixPm2MaxRestarts(deps);
    if (check.id === 'pm2-logrotate-installed') return await fixPm2LogrotateInstalled(deps);
    if (check.id === 'pgserve-canonical') return await fixPgserveCanonical(deps);
    if (check.id === 'port-canonical-owner') return await fixPortCanonicalOwner(deps);
    if (check.id === 'pm2-status') return await fixPm2Status(deps);
    if (check.id === 'embedded-data-orphaned') return await fixEmbeddedDataOrphaned(deps);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `FAILED ${check.id}: ${msg}`;
  }
}

/** Aggregate OK/WARN/FAIL counts from a check list. */
function summarizeChecks(checks: CheckResult[]): { ok: number; warn: number; fail: number } {
  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) {
    if (c.level === 'OK') summary.ok++;
    else if (c.level === 'WARN') summary.warn++;
    else summary.fail++;
  }
  return summary;
}

/**
 * Cascade-prone fix ids: each depends on omni-api being reachable and on
 * DB+env being in sync. When the canonical-pgserve migration FAILS,
 * omni-api is still recovering on embedded; running these would rotate
 * keys / restart with bad env and reproduce the pre-#580 401-cascade.
 * See omni#583.
 */
const CASCADE_PRONE_FIXES: ReadonlySet<CheckId> = new Set<CheckId>([
  'cli-key-valid',
  'omni-db-exists',
  'pgserve-reachable',
]);

/**
 * Phase 1 of `runDoctor` --fix: run the canonical-pgserve migration in
 * isolation, then re-evaluate all checks against the post-migration
 * state. Returns whether the migration FAILED (so Phase 2 can gate
 * cascade-prone fixes) plus the refreshed check list.
 */
async function runPhase1MigrationFix(
  deps: DoctorDeps,
  checks: CheckResult[],
  fixesApplied: string[],
): Promise<{ canonicalFailed: boolean; checks: CheckResult[] }> {
  const canonicalCheck = checks.find((c) => c.id === 'pgserve-canonical');
  if (!canonicalCheck || canonicalCheck.level === 'OK') {
    return { canonicalFailed: false, checks };
  }
  const result = await applyFix(deps, canonicalCheck);
  if (result !== null) fixesApplied.push(result);
  const canonicalFailed = typeof result === 'string' && result.startsWith('FAILED ');
  // Re-run all checks against the post-migration state before any other
  // fix gets to see them.
  const refreshed = await runAllChecks(deps);
  return { canonicalFailed, checks: refreshed };
}

/**
 * Phase 2 of `runDoctor` --fix: iterate the remaining failing checks and
 * apply each fix. When Phase 1 reported FAILED, cascade-prone fixes are
 * skipped with an actionable message — without this gating, cli-key-valid
 * (and friends) rotate destructively while the API is still recovering.
 */
async function runPhase2Fixes(
  deps: DoctorDeps,
  checks: CheckResult[],
  canonicalFailed: boolean,
  fixesApplied: string[],
): Promise<void> {
  for (const check of checks) {
    if (check.level === 'OK') continue;
    if (check.id === 'pgserve-canonical') continue; // already handled in Phase 1
    if (canonicalFailed && CASCADE_PRONE_FIXES.has(check.id)) {
      fixesApplied.push(
        `SKIPPED ${check.id}: blocked by failed canonical-pgserve migration — fix manually after \`pgserve install\``,
      );
      continue;
    }
    const result = await applyFix(deps, check);
    if (result !== null) fixesApplied.push(result);
  }
}

/**
 * Run all checks and optionally apply fixes. Returns a structured
 * DoctorReport — the caller decides how to render it (human vs. JSON).
 */
export async function runDoctor(options: DoctorOptions, depsOverride?: DoctorDeps): Promise<DoctorReport> {
  const deps = depsOverride ?? productionDeps();
  let checks = await runAllChecks(deps);
  const fixesApplied: string[] = [];

  // dryRun is the explicit "read-only" lever used by `omni update`'s
  // post-update maintenance hook. It defeats any caller-supplied
  // `fix: true` so the probe never mutates pm2 / config / DB state.
  if (options.fix && options.dryRun !== true) {
    const phase1 = await runPhase1MigrationFix(deps, checks, fixesApplied);
    checks = phase1.checks;
    await runPhase2Fixes(deps, checks, phase1.canonicalFailed, fixesApplied);
    // Final re-check so the report reflects post-fix state.
    checks = await runAllChecks(deps);
  }

  return { checks, summary: summarizeChecks(checks), fixesApplied };
}

/** Render a human-readable doctor report. */
function renderHuman(report: DoctorReport): void {
  output.raw('');
  output.raw('  omni doctor — checks:');
  output.raw('');
  for (const check of report.checks) {
    const marker = check.level === 'OK' ? '✓' : check.level === 'WARN' ? '⚠' : '✗';
    output.raw(`  ${marker} ${check.id.padEnd(20)} ${check.detail}`);
  }
  output.raw('');
  output.raw(`  summary: ${report.summary.ok} OK, ${report.summary.warn} WARN, ${report.summary.fail} FAIL`);
  if (report.fixesApplied.length > 0) {
    output.raw('');
    output.raw('  fixes applied:');
    for (const fix of report.fixesApplied) {
      output.raw(`    - ${fix}`);
    }
  }
  output.raw('');
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Diagnose and repair the embedded omni runtime (env drift, stale keys, version mismatch)')
    .option('--fix', 'Attempt to repair WARN/FAIL checks in-place (never touches ~/.omni/data/pgserve)')
    .option('--json', 'Emit the full report as structured JSON')
    .option('--verbose', 'Include additional diagnostic detail')
    .addHelpText(
      'after',
      `
Checks:
  pm2-env-drift            pm2 stored env vs. buildRuntimeEnv() from config
  cli-key-valid            CLI-stored key validates against running server
  pgserve-reachable        TCP connect to embedded pgserve port
  omni-db-exists           omni database is reachable on embedded pgserve
  orphaned-data-dirs       .pgserve-data directories outside ~/.omni
  version-match            CLI version vs. /api/v2/health version field
  pm2-status               omni-api and omni-nats both online in pm2
  pm2-max-restarts         omni-api + omni-nats max_restarts in hardened range
  pm2-logrotate-installed  pm2-logrotate module installed with expected settings
  pgserve-canonical        using canonical pgserve@^2.1.0 (shared backbone) vs. embedded
  port-canonical-owner     canonical ports (NATS, API) owned by pm2-managed PIDs

Safety:
  --fix NEVER touches ~/.omni/data/pgserve — it only operates on the pm2
  process lifecycle, stored env, and ~/.omni/config.json. Data directories
  are never auto-deleted; orphaned dirs print rm-rf commands for review.
`,
    )
    .action(async (options: DoctorOptions) => {
      // Ensure pm2 is available for checks that need it; warn rather than
      // fail so the non-pm2 checks still run.
      if (!(await isPm2Available())) {
        output.warn('pm2 is not available in PATH — pm2-dependent checks will be WARN.');
      }

      const report = await runDoctor(options);

      if (options.json === true) {
        // biome-ignore lint/suspicious/noConsole: CLI JSON output
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      renderHuman(report);

      if (report.summary.fail > 0) {
        process.exit(1);
      }
    });
}
