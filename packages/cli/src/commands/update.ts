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
import { VERSION } from '../version.js';

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
   * Bypass the canonical-pgserve phase-2 pre-flight check. Use only when
   * the operator knows what they're doing — e.g., they've manually
   * pre-installed pgserve via a different path the auto-detector misses.
   * Defaults to false (the check runs).
   */
  skipCanonicalPreflight?: boolean;
  /**
   * Skip the post-update maintenance hook (read-only `omni doctor` sweep
   * that runs after a successful restart + verify). Also honored via the
   * `OMNI_UPDATE_SKIP_MAINTENANCE` env var. The flag is non-fatal in
   * either direction — a failing maintenance call already exits 0 with a
   * banner warning; this flag suppresses the call entirely (e.g. CI
   * pipelines that run their own health probe).
   */
  skipMaintenance?: boolean;
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
 * Restart selected services, then run the three-step verification.
 *
 * The orchestration here is impure (spawns pm2, fetches, exits) but the
 * decision logic lives in `decideVerify` so tests can exercise every
 * branch without spinning up the network.
 */
async function restartServicesAndVerify(
  servicesToRestart: Pm2ProcessName[],
  latest: string,
  options: { legacyCleanup: boolean; skipList: Set<string> },
): Promise<void> {
  const apiPort = loadServerConfig().port;
  const restartSpinner = ora('Restarting services...').start();
  const restartSucceeded = await restartPm2Services(servicesToRestart);
  restartSpinner.stop();

  if (!restartSucceeded) {
    output.warn(`omni CLI updated to v${latest}, but one or more service restarts failed. Run \`omni status\`.`);
    process.exit(1);
  }

  // Run registry-based legacy artifact cleanup AFTER the restart so any
  // freshly-started in-process subscriptions are already handling traffic
  // before legacy backstops are stopped — prevents silent loss during
  // the cleanup window. This block is opt-out via --no-legacy-cleanup
  // (or its deprecated alias --no-sidecar-cleanup).
  let cleanupReport: CleanupReport | null = null;
  if (options.legacyCleanup) {
    cleanupReport = await runLegacyCleanup(options.skipList);
  }

  const verifySpinner = ora('Verifying server version...').start();
  const healthBody = await fetchHealthBody(apiPort, UPDATE_HEALTH_TIMEOUT_MS);
  verifySpinner.stop();

  // Only probe auth once we have a reachable health endpoint — no point
  // calling /auth/validate against a server that isn't up.
  const keyValid = healthBody !== null ? await validateStoredKey(apiPort) : false;

  const result = decideVerify({ latest, apiPort, healthBody, keyValid });

  switch (result.kind) {
    case 'ok':
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
      return;
    case 'health-unreachable':
      output.warn(
        `omni CLI updated to v${latest}, but health check failed on port ${result.apiPort}. Run \`omni status\`.`,
      );
      process.exit(1);
      break;
    case 'version-mismatch':
      // biome-ignore lint/suspicious/noConsole: CLI output — user-facing failure marker
      console.error(`${chalk.red('✗')} ${updateErrorVersionMismatch(result.cliVersion, result.serverVersion)}`);
      process.exit(1);
      break;
    case 'auth-invalid':
      // biome-ignore lint/suspicious/noConsole: CLI output — user-facing failure marker
      console.error(`${chalk.red('✗')} ${UPDATE_ERROR_AUTH_INVALID}`);
      process.exit(1);
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

/**
 * Phase-2 canonical-pgserve cutoff (omni#596, 2026-05-02). Versions at or
 * after this date flipped the embedded-mode default OFF. Operators who
 * never migrated to canonical pgserve (useCanonicalPgserve undefined) AND
 * don't have the `pgserve` binary installed would have omni-api fail at
 * boot post-upgrade because PGSERVE_EMBEDDED=false but no canonical
 * backbone exists.
 *
 * Compared as YYYYMMDD (the minor of the omni semver). 260502 = 2026-05-02.
 */
const PHASE_2_CUTOFF_MINOR = 260502;

function isAtOrPastPhase2(version: string): boolean {
  const [_major, minorStr] = version.split('.');
  const minor = Number.parseInt(minorStr ?? '', 10);
  if (!Number.isFinite(minor)) return false;
  return minor >= PHASE_2_CUTOFF_MINOR;
}

function isPgserveOnPath(): boolean {
  try {
    const result = Bun.spawnSync({
      cmd: ['pgserve', 'port'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 3000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Halt updates that would cross the phase-2 default-flip cutoff on hosts
 * still running legacy embedded pgserve without the canonical binary
 * available.
 *
 * Returns null when safe to proceed; otherwise an actionable error message.
 */
export function checkCanonicalPgservePreflight(args: {
  currentVersion: string;
  targetVersion: string;
  useCanonicalPgserve: boolean | undefined;
  pgserveOnPath: boolean;
}): string | null {
  // Already past the cutoff or not yet at it — no upgrade-time hazard.
  if (isAtOrPastPhase2(args.currentVersion)) return null;
  if (!isAtOrPastPhase2(args.targetVersion)) return null;
  // Operator has migrated → omni-api will use canonical successfully.
  if (args.useCanonicalPgserve === true) return null;
  // Operator has explicitly opted INTO embedded → they keep working as-is.
  if (args.useCanonicalPgserve === false) return null;
  // Canonical binary is reachable → omni-api will discover and use it.
  if (args.pgserveOnPath) return null;

  // Danger: undefined flag (legacy never migrated) + no canonical binary →
  // omni-api would boot with PGSERVE_EMBEDDED=false and no DB to connect to.
  return [
    'Refusing to upgrade — this would break omni-api on next restart.',
    '',
    `  Target version v${args.targetVersion} ships the phase-2 canonical-pgserve default flip`,
    '  (omni#596). Your current install has `useCanonicalPgserve` unset and no `pgserve`',
    '  binary on PATH, so omni-api would boot with PGSERVE_EMBEDDED=false and fail to',
    '  connect to a non-existent canonical pgserve.',
    '',
    '  Pick one of:',
    '',
    '    (recommended) Migrate to canonical pgserve:',
    '      bun add -g pgserve@^2.1.0',
    '      omni doctor --fix      # automated pg_dump → install → restore',
    '      omni update            # then re-run',
    '',
    '    (transitional) Pin embedded explicitly:',
    "      omni config set server.useCanonicalPgserve 'false'",
    '      omni update            # then re-run',
    '',
    '  Bypass this check (NOT recommended) with: omni update --skip-canonical-preflight',
  ].join('\n');
}

async function runUpdate(options: UpdateOptions): Promise<void> {
  const channel = resolveChannel(options);

  // Persist explicit channel switch so subsequent `omni update` stays on the
  // chosen track until switched again.
  if (options.next || options.stable) {
    persistChannel(channel);
  }

  output.info(`Channel: ${channel}${channel === 'next' ? ' (dev builds)' : ' (stable)'}`);

  // Check latest version on the resolved channel
  const versionSpinner = ora(`Checking ${channel} version of ${PACKAGE_NAME}...`).start();
  const latest = await fetchLatestVersion(channel);
  versionSpinner.stop();

  if (latest === null) {
    output.warn('Could not reach npm registry. Check your network connection and try again.');
    process.exit(1);
  }

  // Strip any git hash suffix (e.g. "2.20260218.18+abc1234" → "2.20260218.18") for comparison
  const currentClean = VERSION.split('+')[0];

  if (currentClean === latest) {
    output.success(`Already up to date (v${latest}, channel: ${channel})`);
    process.exit(0);
  }

  // Pre-flight: refuse to cross the phase-2 cutoff on legacy embedded hosts
  // without canonical pgserve installed. Operators get a clear remediation
  // path BEFORE the install completes (vs discovering the boot failure
  // hours later when omni-api restarts).
  if (!options.skipCanonicalPreflight) {
    const serverConfig = loadServerConfig();
    const preflightError = checkCanonicalPgservePreflight({
      currentVersion: currentClean,
      targetVersion: latest,
      useCanonicalPgserve: serverConfig.useCanonicalPgserve,
      pgserveOnPath: isPgserveOnPath(),
    });
    if (preflightError !== null) {
      output.warn(preflightError);
      process.exit(1);
    }
  }

  output.info(`Update available: v${currentClean} → v${latest} (${channel})`);

  if (!options.yes) {
    const confirmed = await promptConfirm(`Update from v${currentClean} to v${latest}? [Y/n] `);
    if (!confirmed) {
      output.info('Update cancelled.');
      process.exit(0);
    }
  }

  const servicesToRestart = options.restart !== false ? getRunningPm2Services() : [];

  const installSpinner = ora(`Updating ${PACKAGE_NAME}@${channel}...`).start();
  const installed = await installLatest(channel);
  installSpinner.stop();

  if (!installed) {
    output.warn(`Installation failed. Your current version (v${currentClean}) is still intact.`);
    process.exit(1);
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
    // On success, restartServicesAndVerify prints the three-line banner and
    // returns. On failure it exits non-zero before returning here, so we
    // deliberately skip the legacy `omni updated` summary in that path.
    await restartServicesAndVerify(servicesToRestart, latest, {
      legacyCleanup: legacyCleanupEnabled,
      skipList,
    });
    return;
  }

  // --no-restart path: nothing to verify server-side. We deliberately skip
  // legacy-artifact cleanup here too — `--no-restart` means "don't touch
  // services" and the registry entries are services. Operators using
  // `--no-restart` are expected to manage them themselves.
  output.success(`omni updated to v${latest}`);
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
    .option('--no-legacy-cleanup', 'Skip every registered legacy-artifact cleanup (e.g. nats-reply-sidecar)')
    .option('--no-sidecar-cleanup', 'Deprecated alias for --no-legacy-cleanup')
    .option(
      '--skip-cleanup <names>',
      'Comma-separated list of legacy-cleanup registry entries to skip (e.g. "nats-reply-sidecar")',
    )
    .option('--next', 'Switch to dev builds (npm @next tag) and persist as default')
    .option('--stable', 'Switch to stable releases (npm @latest tag) and persist as default')
    .option(
      '--skip-canonical-preflight',
      'Bypass the canonical-pgserve phase-2 pre-flight (NOT recommended; for operators who pre-installed pgserve via a path the auto-detector misses)',
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
  - Verify runtime health after update with: omni status
`,
    )
    .action(runUpdate);
}
