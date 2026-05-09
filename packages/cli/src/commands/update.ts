/**
 * Update Command
 *
 * omni update [--yes] [--no-restart]
 *
 * Self-update from npm: checks latest @automagik/omni version, prompts the
 * user (unless --yes), installs with `bun add -g`, and restarts PM2 services
 * only if they were already running. When that restart path runs, update
 * performs a 3-step visible verification:
 *
 *   1. CLI version matches `package.json` (trivial — known at compile time).
 *   2. Server version matches the newly-installed CLI version (fetched from
 *      `/api/v2/health`). If not, update exits non-zero and tells the
 *      operator to run `omni doctor`.
 *   3. The stored API key still validates against the (restarted) server. If
 *      not, update exits non-zero and tells the operator to run
 *      `omni doctor --fix`.
 *
 * This replaces the previous silent-success path where the CLI would report
 * "updated to vX" even when the server was still running the old version or
 * when the stored key no longer validated.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createOmniClient } from '@omni/sdk';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { type Config, loadConfig, loadServerConfig, saveConfig } from '../config.js';
import { getHealthCheckUrl } from '../health.js';
import { type CleanupReport, cleanupLegacyArtifacts } from '../legacy-cleanup.js';
import * as output from '../output.js';
import { PM2_PROCESSES } from '../pm2.js';
import { buildRuntimeEnv } from '../runtime-env.js';
import {
  type ParallelInstallReport,
  type UpdateDiagnostics,
  createDiagnostics,
  writeDiagnostics,
} from '../update-diagnostics.js';
import { VERSION } from '../version.js';
import { type DoctorReport, runDoctor } from './doctor.js';

const PACKAGE_NAME = '@automagik/omni';

/** update uses a shorter timeout — services should restart quickly */
const UPDATE_HEALTH_TIMEOUT_MS = 10_000;
/** Pause between poll attempts while waiting for the server to come back up */
const VERIFY_POLL_INTERVAL_MS = 500;

interface UpdateOptions {
  yes?: boolean;
  restart?: boolean;
  /**
   * Primary name for the post-restart legacy artifact cleanup. Default true.
   * When false, the registry call is skipped entirely.
   */
  legacyCleanup?: boolean;
  /**
   * Deprecated alias of `legacyCleanup`. Retained so existing scripts /
   * runbooks referencing `--no-sidecar-cleanup` keep working. When the
   * operator passes `--no-sidecar-cleanup`, commander surfaces this as
   * `sidecarCleanup === false`; we forward the value to `legacyCleanup`
   * and emit a one-line deprecation note.
   */
  sidecarCleanup?: boolean;
  /**
   * Comma-separated list of registry entry names to skip. Empty / undefined
   * means "skip nothing". Names are matched against `LegacyArtifact.name`.
   */
  skipCleanup?: string;
  next?: boolean;
  stable?: boolean;
  /**
   * Skip the post-update maintenance hook (read-only `omni doctor` sweep
   * that runs after a successful restart + verify). Also honored via the
   * `OMNI_UPDATE_SKIP_MAINTENANCE` env var. The flag is non-fatal in
   * either direction — a failing maintenance call already exits 0 with a
   * banner warning; this flag suppresses the call entirely (e.g. CI
   * pipelines that run their own health probe).
   */
  skipMaintenance?: boolean;
  /**
   * Restart services but skip the post-restart probe. Useful when a release
   * has a broken `/api/v2/health` and operators need to roll forward
   * without the verify gate failing the run. Distinct from `--no-restart`,
   * which skips the entire post-install path. With `--no-verify`, services
   * still restart, the legacy-cleanup registry still runs, and the verify
   * outcome lands in diagnostics as
   * `{ kind: 'skipped', reason: 'no-verify-flag' }`.
   */
  verify?: boolean;
}

export type UpdateChannel = 'latest' | 'next';

/**
 * Resolve the npm dist-tag to install. Priority:
 *   1. --next / --stable flag (explicit override)
 *   2. Saved `updateChannel` in ~/.omni/config.json
 *   3. Default to 'latest'
 */
export function resolveChannel(options: { next?: boolean; stable?: boolean }, config?: Config): UpdateChannel {
  if (options.next) return 'next';
  if (options.stable) return 'latest';

  const saved = (config ?? loadConfig()).updateChannel;
  if (saved === 'latest' || saved === 'next') return saved;

  return 'latest';
}

/**
 * Persist the chosen channel to ~/.omni/config.json. Only called when the user
 * passed --next or --stable explicitly — so subsequent `omni update` calls stay
 * on the chosen track until switched again.
 */
function persistChannel(channel: UpdateChannel): void {
  try {
    const config = loadConfig();
    config.updateChannel = channel;
    saveConfig(config);
  } catch {
    // Non-fatal — channel preference lost but update still works
  }
}

type Pm2ProcessName = (typeof PM2_PROCESSES)[keyof typeof PM2_PROCESSES];

/**
 * Fetch the latest published version for the given channel from the npm registry.
 * `channel='latest'` returns the stable release; `channel='next'` returns the
 * most recent dev build.
 */
async function fetchLatestVersion(channel: UpdateChannel): Promise<string | null> {
  try {
    const proc = Bun.spawn({
      cmd: ['bunx', 'npm', 'view', `${PACKAGE_NAME}@${channel}`, 'version'],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    if (exitCode !== 0) {
      return null;
    }

    const text = stdout.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** Return tracked PM2 process names that are currently online. */
function getRunningPm2Services(): Pm2ProcessName[] {
  try {
    const result = Bun.spawnSync({
      cmd: ['pm2', 'jlist'],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      return [];
    }

    const raw = new TextDecoder().decode(result.stdout).trim();
    if (!raw || raw === '[]') return [];

    const pm2Names = new Set<Pm2ProcessName>(Object.values(PM2_PROCESSES));
    const list = JSON.parse(raw) as Array<{ name?: string; pm2_env?: { status?: string } }>;
    const running = new Set<Pm2ProcessName>();
    for (const proc of list) {
      const name = proc.name as Pm2ProcessName | undefined;
      if (name && pm2Names.has(name) && proc.pm2_env?.status === 'online') {
        running.add(name);
      }
    }
    return [...running];
  } catch {
    // pm2 not installed or parse error — skip restart
    return [];
  }
}

/**
 * Install the given channel globally via bun. Returns true on success.
 *
 * Uses `--force --no-cache` to work around bun's global lockfile pinning —
 * without these flags, switching channels (e.g. next → latest) may silently
 * reuse a cached version. Mirrors the genie CLI update behavior.
 */
async function installLatest(channel: UpdateChannel): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ['bun', 'add', '-g', '--force', '--no-cache', `${PACKAGE_NAME}@${channel}`],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

/**
 * Restart provided PM2 processes. Returns true when all restarts succeed.
 *
 * The pm2 invocation runs in a sanitized environment built from
 * `~/.omni/config.json` (via `buildRuntimeEnv`). We do NOT inherit the
 * calling shell's DATABASE_URL / OMNI_API_KEY — that's the exact leakage
 * that caused the 2026-04-06 cross-DB incident.
 */
async function restartPm2Services(processNames: Pm2ProcessName[]): Promise<boolean> {
  const serverConfig = loadServerConfig();
  const cliConfig = loadConfig();
  const runtimeEnv = buildRuntimeEnv(serverConfig, cliConfig);

  let allSucceeded = true;
  for (const name of processNames) {
    const proc = Bun.spawn({
      cmd: ['pm2', 'restart', name],
      stdout: 'pipe',
      stderr: 'pipe',
      // Spread process.env so PATH / HOME are preserved for the pm2 binary
      // itself, then apply our hermetic overrides last — this guarantees
      // the load-bearing keys come from config, not the shell.
      env: { ...process.env, ...runtimeEnv },
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      allSucceeded = false;
    }
  }
  return allSucceeded;
}

/** Shape of the `/api/v2/health` response we care about. */
export interface HealthBody {
  status?: string;
  version?: string;
}

/**
 * Normalize a version string for comparison. Strips a git-hash suffix
 * (e.g. `2.20260218.18+abc1234` → `2.20260218.18`) so build metadata doesn't
 * trigger a spurious mismatch.
 */
export function normalizeVersion(version: string): string {
  return version.split('+')[0] ?? version;
}

/**
 * Reasons the verify step can be skipped without a server probe. Aligned
 * byte-for-byte with the genie-side `VerifyResult.skipped.reason` shape so
 * cross-CLI diagnostics tooling can read either repo's output uniformly
 * (see `.genie/wishes/update-unify-stages/SHARED-DESIGN.md`).
 *
 * - `no-restart`: operator passed `--no-restart`, so no service was touched.
 * - `no-verify-flag`: operator passed `--no-verify`, restart ran but probe was suppressed.
 * - `no-running-services`: no tracked PM2 services were online before the install.
 */
export type VerifySkipReason = 'no-restart' | 'no-verify-flag' | 'no-running-services';

/**
 * Result of the pure 3-step update verification. Exported so tests can
 * exercise the logic without mocking pm2 / fetch / process.exit.
 *
 * Public-shape parity with the genie wish — each variant's keys match
 * `automagik-dev/genie` exactly so a shared diagnostics consumer can decode
 * either CLI's output without per-repo branching.
 */
export type VerifyResult =
  | { kind: 'ok'; cliVersion: string; serverVersion: string }
  | { kind: 'health-unreachable'; apiPort: number }
  | { kind: 'version-mismatch'; cliVersion: string; serverVersion: string | null }
  | { kind: 'auth-invalid' }
  | { kind: 'skipped'; reason: VerifySkipReason };

/**
 * @deprecated Use {@link VerifyResult}. Retained for backward compatibility
 * with any external consumer that imported the original name.
 */
export type UpdateVerifyResult = VerifyResult;

/**
 * Args accepted by {@link decideVerify}. Either `skipReason` is set (the
 * verify step short-circuits to `{ kind: 'skipped' }`) or all of `latest` /
 * `apiPort` / `healthBody` / `keyValid` are provided for the full decision.
 */
export type DecideVerifyArgs =
  | {
      latest: string;
      apiPort: number;
      healthBody: HealthBody | null;
      keyValid: boolean;
      skipReason?: undefined;
    }
  | { skipReason: VerifySkipReason };

/**
 * Pure decision function for update verification. Given the raw inputs
 * (health body + key-valid flag + CLI version + port), return a tagged
 * union describing the outcome. The caller decides how to render and
 * whether to exit non-zero.
 *
 * When `skipReason` is provided, the function short-circuits to
 * `{ kind: 'skipped', reason }` without inspecting the other fields. This
 * is the path used by `--no-restart`, `--no-verify`, and the
 * no-running-services case.
 */
export function decideVerify(args: DecideVerifyArgs): VerifyResult {
  if (args.skipReason !== undefined) {
    return { kind: 'skipped', reason: args.skipReason };
  }
  const cliVersion = normalizeVersion(args.latest);
  if (args.healthBody === null) {
    return { kind: 'health-unreachable', apiPort: args.apiPort };
  }
  const serverVersion = args.healthBody.version ? normalizeVersion(args.healthBody.version) : null;
  if (!serverVersion || serverVersion !== cliVersion) {
    return { kind: 'version-mismatch', cliVersion, serverVersion };
  }
  if (!args.keyValid) {
    return { kind: 'auth-invalid' };
  }
  return { kind: 'ok', cliVersion, serverVersion };
}

/**
 * @deprecated Use {@link decideVerify}. Pointer-equal alias retained for
 * backward compatibility with any external consumer that imported the
 * original name.
 */
export const decideUpdateVerify = decideVerify;

/** Error message strings — exported for tests and documentation. */
export function updateErrorVersionMismatch(cli: string, server: string | null): string {
  return `Server version mismatch: cli=v${cli} server=v${server ?? 'unknown'}. Run: omni doctor`;
}

export const UPDATE_ERROR_AUTH_INVALID = 'Auth key invalid after restart. Run: omni doctor --fix';

/**
 * Poll the health endpoint until it responds with a parseable JSON body
 * or the deadline passes. Returns the parsed body, or null on failure.
 *
 * We hit the endpoint with `Accept-Encoding: identity` so any brotli/gzip
 * proxy in front of us doesn't mangle the body on a short-lived fetch.
 */
async function fetchHealthBody(apiPort: number, timeoutMs: number): Promise<HealthBody | null> {
  const url = getHealthCheckUrl(apiPort);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(1500),
        headers: { 'Accept-Encoding': 'identity' },
      });
      if (resp.ok) {
        const body = (await resp.json()) as HealthBody;
        return body;
      }
    } catch {
      // keep polling
    }
    await Bun.sleep(VERIFY_POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Validate the stored CLI API key against the just-restarted server.
 * Returns true if the key validates, false otherwise. The caller decides
 * what to do on failure (typically exit non-zero and point at `omni doctor`).
 */
async function validateStoredKey(apiPort: number): Promise<boolean> {
  const cliConfig = loadConfig();
  if (!cliConfig.apiKey) {
    return false;
  }
  const baseUrl = cliConfig.apiUrl ?? `http://localhost:${apiPort}`;
  try {
    const client = createOmniClient({ baseUrl, apiKey: cliConfig.apiKey, cliVersion: VERSION });
    const result = await client.auth.validate();
    return result.valid === true;
  } catch {
    return false;
  }
}

/** Print the three-line success banner (cli + server + auth). */
function printVerifyBanner(latest: string): void {
  // biome-ignore lint/suspicious/noConsole: CLI output — green checks are the product
  console.log(`${chalk.green('✓')} CLI:    v${latest}`);
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`${chalk.green('✓')} Server: v${latest} (healthy)`);
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`${chalk.green('✓')} Auth:   key valid`);
}

/**
 * Variant of `printVerifyBanner` used when the operator passed `--no-verify`.
 * The CLI line stays a green check (we know our own version), but the server
 * and auth lines are tagged `(skipped)` in yellow so operators don't misread
 * the output as a confirmed match. Format matches the wish acceptance
 * criteria: "emits `Server: v… (skipped)` in the banner".
 */
function printVerifySkippedBanner(latest: string): void {
  // biome-ignore lint/suspicious/noConsole: CLI output — banner is the product
  console.log(`${chalk.green('✓')} CLI:    v${latest}`);
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`${chalk.yellow('-')} Server: v${latest} (skipped)`);
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`${chalk.yellow('-')} Auth:   skipped`);
}

/**
 * Detect a parallel npm-global install of `@automagik/omni`. Omni doesn't
 * support npm-global server (we install via `bun add -g`), but a parallel
 * install hides stale binaries on PATH and confuses `which omni`. When
 * detected, the operator gets a one-line warning naming the offending path
 * with the recommended remediation: `npm uninstall -g @automagik/omni`.
 *
 * Pure-ish: probes `npm root -g`, then checks if `<root>/@automagik/omni`
 * exists. Never throws — when `npm` is absent the probe simply reports
 * `skipped: 'npm-not-on-path'` and the warning never fires.
 *
 * Exported for tests so we can exercise both paths without spawning npm.
 */
export function detectParallelNpmGlobalInstall(deps?: {
  npmRoot?: () => string | null;
  exists?: (p: string) => boolean;
}): ParallelInstallReport {
  const npmRootFn = deps?.npmRoot ?? defaultNpmRoot;
  const existsFn = deps?.exists ?? existsSync;
  let root: string | null;
  try {
    root = npmRootFn();
  } catch {
    return { detected: false, skipped: 'npm-root-failed' };
  }
  if (root === null || root.length === 0) {
    return { detected: false, skipped: 'npm-not-on-path' };
  }
  const candidate = join(root, '@automagik', 'omni');
  if (existsFn(candidate)) {
    return { detected: true, path: candidate };
  }
  return { detected: false };
}

function defaultNpmRoot(): string | null {
  try {
    const result = Bun.spawnSync({
      cmd: ['npm', 'root', '-g'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5000,
    });
    if (result.exitCode !== 0) return null;
    const text = new TextDecoder().decode(result.stdout).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Run every registered legacy-artifact cleanup that isn't in `skipList`.
 * Always returns — never throws.
 *
 * Day-one registry entry is `nats-reply-sidecar`, which detects pm2-managed
 * and raw sidecar processes and stops them. The output of
 * `formatCleanupSummary()` is preserved byte-for-byte via
 * `LegacyArtifact.summary()`.
 *
 * This runs AFTER the restart so the new in-process subscription is already
 * active when the sidecar exits. The brief overlap (typically <2s) produces
 * at-most-once duplicate replies, which is preferable to the alternative
 * (stop sidecar first → silent reply loss until restart finishes).
 *
 * See docs/migration/nats-genie-sidecar-decommission.md for the manual
 * runbook operators can fall back to.
 */
async function runLegacyCleanup(skipList: Set<string>): Promise<CleanupReport> {
  const cleanupSpinner = ora('Checking for legacy artifacts to clean up...').start();
  const report = await cleanupLegacyArtifacts(skipList);
  cleanupSpinner.stop();

  for (const outcome of report.outcomes) {
    if (outcome.state === 'ran' && outcome.summary.length > 0) {
      // biome-ignore lint/suspicious/noConsole: CLI output — operator-visible cleanup report
      console.log(outcome.summary);
    }
  }
  return report;
}

/**
 * Reasons the post-update maintenance hook can be skipped.
 *
 * - `cli-flag`:      operator passed `--skip-maintenance`.
 * - `env`:           `OMNI_UPDATE_SKIP_MAINTENANCE` was set in the environment.
 * - `verify-failed`: upstream `decideVerify` outcome was not `ok`, so probing
 *                    further is pointless (the operator already has a
 *                    `Run: omni doctor` pointer from the verify step).
 */
export type MaintenanceSkipReason = 'cli-flag' | 'env' | 'verify-failed';

/**
 * Outcome of a single post-update maintenance run. Public-shape parity with
 * the genie wish — the same field names land in diagnostics so a shared
 * consumer can read either CLI's output uniformly.
 *
 * - `completed`: `runDoctor` returned a report (regardless of WARN/FAIL counts).
 * - `failed`:    `runDoctor` threw; the call was non-blocking, exit code stays 0.
 * - `skipped`:   maintenance was opted out (flag/env) or upstream verify wasn't OK.
 */
export type MaintenanceOutcome = 'completed' | 'failed' | 'skipped';

/**
 * Captured shape of the post-update maintenance hook. Always populated, even
 * when skipped — diagnostics (Group 4) consumes the same struct on every
 * code path so the JSON file shape is invariant.
 */
export interface MaintenanceReport {
  outcome: MaintenanceOutcome;
  /** Wall time spent inside `runDoctor` (or 0 when skipped). */
  durationMs: number;
  /** Present only when `outcome === 'completed'`. */
  doctorReport?: DoctorReport;
  /** Present only when `outcome === 'skipped'`. */
  skipReason?: MaintenanceSkipReason;
  /** Present only when `outcome === 'failed'` — the thrown error message. */
  error?: string;
}

/** Env-var name that opts out of the post-update maintenance hook. */
export const OMNI_UPDATE_SKIP_MAINTENANCE_ENV = 'OMNI_UPDATE_SKIP_MAINTENANCE';

/**
 * Resolve the effective skip reason for the post-update maintenance hook.
 * Returns `null` when maintenance should run. Pure — exported for tests so
 * we can exercise the precedence logic without spinning up `runDoctor`.
 *
 * Precedence (first match wins):
 *   1. `verify-failed` — upstream verify wasn't `ok`; nothing to probe.
 *   2. `cli-flag`      — operator passed `--skip-maintenance`.
 *   3. `env`           — `OMNI_UPDATE_SKIP_MAINTENANCE` is set to a truthy value.
 *
 * The truthy check for the env var matches the same loose semantics as
 * `--yes`/CI flags elsewhere: any non-empty value other than `0`/`false`
 * counts as opt-out.
 */
export function resolveMaintenanceSkipReason(args: {
  verifyOk: boolean;
  skipMaintenance: boolean | undefined;
  env: Record<string, string | undefined>;
}): MaintenanceSkipReason | null {
  if (!args.verifyOk) return 'verify-failed';
  if (args.skipMaintenance === true) return 'cli-flag';
  const raw = args.env[OMNI_UPDATE_SKIP_MAINTENANCE_ENV];
  if (raw !== undefined && raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false') {
    return 'env';
  }
  return null;
}

/**
 * Format the one-line summary printed after a completed maintenance run.
 * Pure — exported so tests can lock the exact shape and so diagnostics
 * (Group 4) can reuse it without re-deriving the format.
 *
 * Shape: `Maintenance: <ok> ok, <warn> warn, <fail> fail`.
 */
export function formatMaintenanceSummary(report: DoctorReport): string {
  const { ok, warn, fail } = report.summary;
  return `Maintenance: ${ok} ok, ${warn} warn, ${fail} fail`;
}

/**
 * Run the post-update maintenance hook — a read-only `omni doctor` sweep
 * that captures a `DoctorReport` for diagnostics.
 *
 * The call is non-blocking by contract: any thrown error is captured into
 * the returned `MaintenanceReport` (`outcome: 'failed'`) and the caller
 * proceeds with exit code 0. This matches the shared exit-code contract
 * (see `SHARED-DESIGN.md` §4.5: "Maintenance failed (non-blocking) → 0,
 * with banner warning").
 *
 * `runDoctor({ json: true, dryRun: true })` is the canonical call shape:
 * `dryRun: true` defeats any accidental `fix: true` injection so the probe
 * never mutates pm2 / config / DB state. `omni doctor --fix` remains the
 * explicit operator action for repair (decision #4).
 *
 * `runDoctorImpl` is injected for tests so we can stub the doctor surface
 * without monkey-patching the module — module-level mocks leak across
 * test files in bun and would pollute `doctor.test.ts`.
 */
export async function runPostUpdateMaintenance(args: {
  skipReason: MaintenanceSkipReason | null;
  runDoctorImpl?: typeof runDoctor;
}): Promise<MaintenanceReport> {
  if (args.skipReason !== null) {
    return { outcome: 'skipped', durationMs: 0, skipReason: args.skipReason };
  }
  const impl = args.runDoctorImpl ?? runDoctor;
  const startedAt = Date.now();
  try {
    const doctorReport = await impl({ json: true, dryRun: true });
    return {
      outcome: 'completed',
      durationMs: Date.now() - startedAt,
      doctorReport,
    };
  } catch (err) {
    return {
      outcome: 'failed',
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Restart selected services, then run the three-step verification.
 *
 * The orchestration here is impure (spawns pm2, fetches, exits) but the
 * decision logic lives in `decideVerify` so tests can exercise every
 * branch without spinning up the network. The provided `diagnostics`
 * accumulator is mutated in place so the eventual `update-diagnostics-*.json`
 * file captures restart / cleanup / verify / maintenance outcomes regardless
 * of which exit branch this function takes.
 */
async function restartServicesAndVerify(
  servicesToRestart: Pm2ProcessName[],
  latest: string,
  options: {
    legacyCleanup: boolean;
    skipList: Set<string>;
    skipMaintenance: boolean;
    skipVerify: boolean;
  },
  diagnostics: UpdateDiagnostics,
  finalize: (exitCode: number) => never,
): Promise<void> {
  const apiPort = loadServerConfig().port;
  diagnostics.restart.attempted = true;
  diagnostics.restart.services = [...servicesToRestart];
  const restartSpinner = ora('Restarting services...').start();
  const restartSucceeded = await restartPm2Services(servicesToRestart);
  restartSpinner.stop();
  diagnostics.restart.succeeded = restartSucceeded;

  if (!restartSucceeded) {
    output.warn(`omni CLI updated to v${latest}, but one or more service restarts failed. Run \`omni status\`.`);
    finalize(1);
  }

  // Run registry-based legacy artifact cleanup AFTER the restart so any
  // freshly-started in-process subscriptions are already handling traffic
  // before legacy backstops are stopped — prevents silent loss during
  // the cleanup window. This block is opt-out via --no-legacy-cleanup
  // (or its deprecated alias --no-sidecar-cleanup).
  let cleanupReport: CleanupReport | null = null;
  if (options.legacyCleanup) {
    cleanupReport = await runLegacyCleanup(options.skipList);
    diagnostics.cleanups = cleanupReport;
  }

  // --no-verify path: short-circuit to the `skipped` variant. Banner shows
  // the new CLI version on both lines but tags the server line as skipped
  // so operators don't mis-read it as a confirmed match.
  if (options.skipVerify) {
    const result = decideVerify({ skipReason: 'no-verify-flag' });
    diagnostics.verify = result;
    printVerifySkippedBanner(latest);
    if (cleanupReport !== null && !cleanupReport.succeeded) {
      output.warn(
        'One or more legacy artifacts could not be cleaned up automatically. ' +
          'See messages above and docs/migration/nats-genie-sidecar-decommission.md.',
      );
    }
    // Maintenance also auto-skips when verify is not OK (see
    // resolveMaintenanceSkipReason — `verify-failed` precedence wins). The
    // skip reason is `verify-failed` rather than `cli-flag` because the
    // user-visible explanation is "we never confirmed health, so probing
    // doctor would be misleading".
    const maintenance = await runPostUpdateMaintenance({ skipReason: 'verify-failed' });
    diagnostics.maintenance = maintenance;
    return;
  }

  const verifySpinner = ora('Verifying server version...').start();
  const healthBody = await fetchHealthBody(apiPort, UPDATE_HEALTH_TIMEOUT_MS);
  verifySpinner.stop();

  // Only probe auth once we have a reachable health endpoint — no point
  // calling /auth/validate against a server that isn't up.
  const keyValid = healthBody !== null ? await validateStoredKey(apiPort) : false;

  const result = decideVerify({ latest, apiPort, healthBody, keyValid });
  diagnostics.verify = result;

  switch (result.kind) {
    case 'ok': {
      printVerifyBanner(result.cliVersion);
      // If a legacy-artifact cleanup partially failed we still consider the
      // update healthy (server is up + auth works), but warn loudly so the
      // operator can finish the manual cleanup.
      if (cleanupReport !== null && !cleanupReport.succeeded) {
        output.warn(
          'One or more legacy artifacts could not be cleaned up automatically. ' +
            'See messages above and docs/migration/nats-genie-sidecar-decommission.md.',
        );
      }
      // Post-update maintenance (read-only `omni doctor` sweep). Non-blocking
      // by contract — the report is consumed by Group 4 (diagnostics) and
      // surfaced inline as a one-line summary. A failing doctor never
      // changes the exit code (see SHARED-DESIGN.md §4.5).
      const skipReason = resolveMaintenanceSkipReason({
        verifyOk: true,
        skipMaintenance: options.skipMaintenance,
        env: process.env,
      });
      const maintenance = await runPostUpdateMaintenance({ skipReason });
      diagnostics.maintenance = maintenance;
      if (maintenance.outcome === 'completed' && maintenance.doctorReport) {
        output.info(formatMaintenanceSummary(maintenance.doctorReport));
      } else if (maintenance.outcome === 'failed') {
        output.warn(`Maintenance: skipped (runDoctor failed: ${maintenance.error ?? 'unknown error'})`);
      }
      return;
    }
    case 'health-unreachable':
      output.warn(
        `omni CLI updated to v${latest}, but health check failed on port ${result.apiPort}. Run \`omni status\`.`,
      );
      finalize(1);
      break;
    case 'version-mismatch':
      // biome-ignore lint/suspicious/noConsole: CLI output — user-facing failure marker
      console.error(`${chalk.red('✗')} ${updateErrorVersionMismatch(result.cliVersion, result.serverVersion)}`);
      finalize(1);
      break;
    case 'auth-invalid':
      // biome-ignore lint/suspicious/noConsole: CLI output — user-facing failure marker
      console.error(`${chalk.red('✗')} ${UPDATE_ERROR_AUTH_INVALID}`);
      finalize(1);
      break;
  }
}

/** Prompt the user for y/n confirmation. Returns true if user confirms. */
async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
    });
  });
}

// Phase-2 canonical-pgserve preflight (`checkCanonicalPgservePreflight`)
// was deleted by `pgserve-singleton-no-proxy` G3. The phase-2 cutoff
// guard is obsolete in phase-3 architecture: omni-api no longer spawns
// embedded pgserve at all (G2 removed `packages/api/src/pgserve.ts`),
// so there is no upgrade hazard tied to the embedded-mode default flip.
// Peer-version enforcement now lives in `packages/cli/src/lib/requirements.ts`
// (G6) and will be wired into the self-healing update pipeline as
// `preInstallPeerCheck` (G4, follow-up).

async function runUpdate(options: UpdateOptions): Promise<void> {
  const channel = resolveChannel(options);

  // Persist explicit channel switch so subsequent `omni update` stays on the
  // chosen track until switched again.
  if (options.next || options.stable) {
    persistChannel(channel);
  }

  // Diagnostics accumulator — mutated in place as the run advances. Written
  // out to ~/.omni/logs/update-diagnostics-*.json on every exit (success,
  // failure, or operator cancel) via `finalize()`.
  const currentClean = VERSION.split('+')[0];
  const diagnostics = createDiagnostics({ runningVersion: currentClean, channel });

  // `finalize` wraps `process.exit` so every termination path persists
  // diagnostics. Typed `never` to satisfy control-flow on the exit branches.
  const finalize = (exitCode: number): never => {
    const path = writeDiagnostics(diagnostics, exitCode);
    if (path !== null && process.env.OMNI_UPDATE_DIAGNOSTICS_VERBOSE === '1') {
      output.info(`Diagnostics written: ${path}`);
    }
    process.exit(exitCode);
  };

  // Parallel npm-global install — warn early so the operator can act on the
  // smoking-gun PATH conflict before the install runs. Recorded in
  // diagnostics either way.
  const parallelInstall = detectParallelNpmGlobalInstall();
  diagnostics.parallelNpmGlobal = parallelInstall;
  if (parallelInstall.detected && parallelInstall.path) {
    output.warn(
      `Parallel npm-global install of ${PACKAGE_NAME} detected at ${parallelInstall.path}. This may shadow the bun-installed binary on PATH. Recommended: npm uninstall -g ${PACKAGE_NAME}`,
    );
  }

  output.info(`Channel: ${channel}${channel === 'next' ? ' (dev builds)' : ' (stable)'}`);

  // Check latest version on the resolved channel
  const versionSpinner = ora(`Checking ${channel} version of ${PACKAGE_NAME}...`).start();
  const latest = await fetchLatestVersion(channel);
  versionSpinner.stop();
  diagnostics.registry.latestVersion = latest;

  if (latest === null) {
    output.warn('Could not reach npm registry. Check your network connection and try again.');
    return finalize(1);
  }

  if (currentClean === latest) {
    output.success(`Already up to date (v${latest}, channel: ${channel})`);
    return finalize(0);
  }

  // Phase-2 canonical-pgserve preflight removed (G3 of
  // pgserve-singleton-no-proxy). The diagnostics.preflight slot is
  // preserved (always {ran: false}) for rolling back the diagnostics
  // schema change separately if needed; future preInstallPeerCheck
  // (G4) will repopulate it with peer-version data.

  output.info(`Update available: v${currentClean} → v${latest} (${channel})`);

  if (!options.yes) {
    const confirmed = await promptConfirm(`Update from v${currentClean} to v${latest}? [Y/n] `);
    if (!confirmed) {
      output.info('Update cancelled.');
      return finalize(0);
    }
  }

  const servicesToRestart = options.restart !== false ? getRunningPm2Services() : [];

  const installSpinner = ora(`Updating ${PACKAGE_NAME}@${channel}...`).start();
  diagnostics.install.attempted = true;
  diagnostics.install.targetVersion = latest;
  const installed = await installLatest(channel);
  installSpinner.stop();
  diagnostics.install.succeeded = installed;

  if (!installed) {
    output.warn(`Installation failed. Your current version (v${currentClean}) is still intact.`);
    return finalize(1);
  }

  // Resolve the legacy-cleanup flag set. `--no-sidecar-cleanup` is the
  // deprecated alias of `--no-legacy-cleanup`; if the operator passed it
  // (commander sets `sidecarCleanup === false`) we honor the value and emit
  // a one-line deprecation note exactly once.
  const sidecarCleanupExplicit = options.sidecarCleanup === false;
  if (sidecarCleanupExplicit) {
    output.info('--no-sidecar-cleanup (deprecated alias for --no-legacy-cleanup)');
  }
  const legacyCleanupEnabled = options.legacyCleanup !== false && options.sidecarCleanup !== false;
  const skipList = parseSkipCleanupList(options.skipCleanup);

  if (servicesToRestart.length > 0) {
    // On success, restartServicesAndVerify prints the success banner (or the
    // skipped-banner when `--no-verify` is set) and returns. On failure it
    // calls finalize(1) before returning so diagnostics is persisted.
    await restartServicesAndVerify(
      servicesToRestart,
      latest,
      {
        legacyCleanup: legacyCleanupEnabled,
        skipList,
        skipMaintenance: options.skipMaintenance === true,
        skipVerify: options.verify === false,
      },
      diagnostics,
      finalize,
    );
    return finalize(0);
  }

  // --no-restart path: nothing to verify server-side. We deliberately skip
  // legacy-artifact cleanup here too — `--no-restart` means "don't touch
  // services" and the registry entries are services. Operators using
  // `--no-restart` are expected to manage them themselves.
  diagnostics.verify = decideVerify({ skipReason: 'no-restart' });
  output.success(`omni updated to v${latest}`);
  return finalize(0);
}

/**
 * Parse the `--skip-cleanup=name1,name2` value into a Set. Empty / undefined
 * yields an empty set. Whitespace and empty entries are tolerated.
 */
export function parseSkipCleanupList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  const names = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(names);
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description(`Update ${PACKAGE_NAME} to the latest version (restart only services already running)`)
    .option('-y, --yes', 'Skip confirmation prompts (non-interactive)')
    .option('--no-restart', 'Update CLI only; skip service restarts and verification')
    .option(
      '--no-verify',
      'Restart services but skip the post-restart probe (use when a release ships a broken /api/v2/health and operators need to roll forward)',
    )
    .option('--no-legacy-cleanup', 'Skip every registered legacy-artifact cleanup (e.g. nats-reply-sidecar)')
    .option('--no-sidecar-cleanup', 'Deprecated alias for --no-legacy-cleanup')
    .option(
      '--skip-cleanup <names>',
      'Comma-separated list of legacy-cleanup registry entries to skip (e.g. "nats-reply-sidecar")',
    )
    .option('--next', 'Switch to dev builds (npm @next tag) and persist as default')
    .option('--stable', 'Switch to stable releases (npm @latest tag) and persist as default')
    .option(
      '--skip-maintenance',
      `Skip the post-update maintenance hook (read-only \`omni doctor\` sweep). Also honored via the ${OMNI_UPDATE_SKIP_MAINTENANCE_ENV} env var.`,
    )
    .addHelpText(
      'after',
      `
Channels:
  - stable (default) — tracks the npm @latest tag, bumped from main branch releases.
  - next (dev builds) — tracks the npm @next tag, bumped on every CI-green dev merge.

  Use --next to switch to dev builds; --stable to switch back. The choice is
  persisted to ~/.omni/config.json under 'updateChannel' so subsequent
  'omni update' calls stay on the selected track. Check or change manually:
    omni config get updateChannel
    omni config set updateChannel next
    omni config set updateChannel latest

Behavior:
  - Installs the latest CLI package first.
  - Restarts tracked Omni services only when they were online before the update.
  - When that restart path runs, update performs 3-step verification:
      1. Server version matches the new CLI version (via /api/v2/health).
      2. Stored CLI API key still validates against the server.
      3. On success, prints:
           ✓ CLI:    v<latest>
           ✓ Server: v<latest> (healthy)
           ✓ Auth:   key valid
  - On mismatch, exits non-zero with:
      "Server version mismatch: cli=v<X> server=v<Y>. Run: omni doctor"
  - On auth failure, exits non-zero with:
      "Auth key invalid after restart. Run: omni doctor --fix"
  - After a successful restart, runs every registered legacy-artifact cleanup.
    The day-one entry is nats-reply-sidecar: it scans for any legacy
    nats-reply-sidecar.mjs process (PM2-managed or raw) and stops it. The
    sidecar was an external workaround for bugs that were fixed in #362;
    leaving it running causes every agent reply to be delivered twice.
    Skip every cleanup with --no-legacy-cleanup, or skip a single registry
    entry with --skip-cleanup=<name1,name2>. The deprecated alias
    --no-sidecar-cleanup still works and behaves identically. Manual runbook:
      docs/migration/nats-genie-sidecar-decommission.md
  - Use --no-restart to skip restart + verification entirely. --no-restart
    also skips legacy-artifact cleanup; manage those services manually.
  - Use --no-verify to restart services but skip the post-restart probe.
    The banner shows the new CLI version on both lines but tags Server /
    Auth as "(skipped)"; maintenance is auto-skipped because verify never
    confirmed health.
  - Detects parallel npm-global installs of ${PACKAGE_NAME} (omni installs
    via bun-global; an npm-global install hides stale binaries on PATH and
    confuses 'which omni'). When found, prints a one-line warning naming
    the offending path; recommended remediation: npm uninstall -g ${PACKAGE_NAME}.
  - Every invocation writes a diagnostics record to
    ~/.omni/logs/update-diagnostics-<iso>.json (schemaVersion: 1). Captures
    install attempt, registry probe, restart outcome, verify result, cleanup
    registry result, maintenance hook, and a tail of pm2 log signals. Set
    OMNI_UPDATE_DIAGNOSTICS_VERBOSE=1 to print the path on completion. A
    failed write never changes the update exit code.
  - On a successful restart + verify, runs a post-update maintenance hook:
    a read-only \`omni doctor\` sweep that prints a one-line summary
    ("Maintenance: <ok> ok, <warn> warn, <fail> fail"). The probe never
    mutates pm2 / config / DB state (\`omni doctor --fix\` remains the
    explicit operator action for repair). A failing maintenance call is
    non-fatal — exit code stays 0 with a banner warning. Skip with
    --skip-maintenance or ${OMNI_UPDATE_SKIP_MAINTENANCE_ENV}=1.
  - Verify runtime health after update with: omni status
`,
    )
    .action(runUpdate);
}
