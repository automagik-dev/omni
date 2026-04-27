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
 *   8. pm2-max-restarts        — omni-api has bounded restarts (not 0 or >= 1000)
 *   9. pm2-logrotate-installed — pm2-logrotate module configured correctly
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
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createOmniClient } from '@automagik/omni-sdk';
import { Command } from 'commander';
import { type Config, type ServerConfig, loadConfig, loadServerConfig, saveConfig } from '../config.js';
import { getHealthCheckUrl } from '../health.js';
import { PM2_LOGROTATE_SETTINGS } from '../install-helpers.js';
import * as output from '../output.js';
import { PM2_HARDENED_DEFAULTS, PM2_PROCESSES, buildPm2StartArgs, capturePm2, isPm2Available, runPm2 } from '../pm2.js';
import { buildRuntimeEnv, resolvePgservePort } from '../runtime-env.js';
import { getServerLauncherPath } from '../server-bundle.js';
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
  | 'pm2-logrotate-installed';

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
}

/**
 * Narrow shape of a pm2 process entry from `pm2 jlist`. We only care about
 * fields relevant to env-drift and status checks.
 */
interface Pm2Entry {
  name?: string;
  pm_id?: number;
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
 * Check 8: omni-api pm2 max_restarts is in the hardened range.
 *
 * The 2026-04-09 incident crash-looped omni-api and grew logs to 283 GB
 * because pm2 had `max_restarts: 0` (the default = unbounded). The
 * hardened flag sets it to 10. Values 5..50 pass; 0 or >= 1000 fail.
 */
async function checkPm2MaxRestarts(deps: DoctorDeps): Promise<CheckResult> {
  const processes = await deps.getPm2Processes();
  if (!processes) {
    return { id: 'pm2-max-restarts', level: 'WARN', detail: 'pm2 not reachable' };
  }
  const apiEntry = processes.find((p) => p.name === PM2_PROCESSES.api);
  if (!apiEntry) {
    return { id: 'pm2-max-restarts', level: 'WARN', detail: `${PM2_PROCESSES.api} not found in pm2` };
  }
  const maxRestarts = apiEntry.pm2_env?.max_restarts;
  if (typeof maxRestarts !== 'number') {
    return {
      id: 'pm2-max-restarts',
      level: 'FAIL',
      detail: `${PM2_PROCESSES.api} has no max_restarts set — crash loops are unbounded`,
    };
  }
  if (maxRestarts === 0 || maxRestarts >= 1000) {
    return {
      id: 'pm2-max-restarts',
      level: 'FAIL',
      detail: `${PM2_PROCESSES.api} max_restarts=${maxRestarts} — crash loops are effectively unbounded`,
    };
  }
  if (maxRestarts >= 5 && maxRestarts <= 50) {
    return {
      id: 'pm2-max-restarts',
      level: 'OK',
      detail: `${PM2_PROCESSES.api} max_restarts=${maxRestarts}`,
    };
  }
  return {
    id: 'pm2-max-restarts',
    level: 'WARN',
    detail: `${PM2_PROCESSES.api} max_restarts=${maxRestarts} — expected 5..50`,
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

// ============================================================================
// MAIN
// ============================================================================

/** Run the full 9-check battery sequentially. */
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
 * Run all checks and optionally apply fixes. Returns a structured
 * DoctorReport — the caller decides how to render it (human vs. JSON).
 */
export async function runDoctor(options: DoctorOptions, depsOverride?: DoctorDeps): Promise<DoctorReport> {
  const deps = depsOverride ?? productionDeps();
  let checks = await runAllChecks(deps);
  const fixesApplied: string[] = [];

  if (options.fix) {
    for (const check of checks) {
      if (check.level === 'OK') continue;
      const result = await applyFix(deps, check);
      if (result !== null) {
        fixesApplied.push(result);
      }
    }
    // Re-run checks after fixes so the final report reflects post-repair state.
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
  pm2-max-restarts         omni-api max_restarts is in the hardened range
  pm2-logrotate-installed  pm2-logrotate module installed with expected settings

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
