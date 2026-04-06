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
import { loadConfig, loadServerConfig } from '../config.js';
import { getHealthCheckUrl } from '../health.js';
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
}

type Pm2ProcessName = (typeof PM2_PROCESSES)[keyof typeof PM2_PROCESSES];

/** Fetch the latest published version from the npm registry via bunx. */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn({
      cmd: ['bunx', 'npm', 'view', PACKAGE_NAME, 'version'],
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

/** Run `bun add -g @automagik/omni@latest`. Returns true on success. */
async function installLatest(): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ['bun', 'add', '-g', `${PACKAGE_NAME}@latest`],
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
 * Result of the pure 3-step update verification. Exported so tests can
 * exercise the logic without mocking pm2 / fetch / process.exit.
 */
export type UpdateVerifyResult =
  | { kind: 'ok'; cliVersion: string; serverVersion: string }
  | { kind: 'health-unreachable'; apiPort: number }
  | { kind: 'version-mismatch'; cliVersion: string; serverVersion: string | null }
  | { kind: 'auth-invalid' };

/**
 * Pure decision function for update verification. Given the raw inputs
 * (health body + key-valid flag + CLI version + port), return a tagged
 * union describing the outcome. The caller decides how to render and
 * whether to exit non-zero.
 */
export function decideUpdateVerify(args: {
  latest: string;
  apiPort: number;
  healthBody: HealthBody | null;
  keyValid: boolean;
}): UpdateVerifyResult {
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
 * Restart selected services, then run the three-step verification.
 *
 * The orchestration here is impure (spawns pm2, fetches, exits) but the
 * decision logic lives in `decideUpdateVerify` so tests can exercise every
 * branch without spinning up the network.
 */
async function restartServicesAndVerify(servicesToRestart: Pm2ProcessName[], latest: string): Promise<void> {
  const apiPort = loadServerConfig().port;
  const restartSpinner = ora('Restarting services...').start();
  const restartSucceeded = await restartPm2Services(servicesToRestart);
  restartSpinner.stop();

  if (!restartSucceeded) {
    output.warn(`omni CLI updated to v${latest}, but one or more service restarts failed. Run \`omni status\`.`);
    process.exit(1);
  }

  const verifySpinner = ora('Verifying server version...').start();
  const healthBody = await fetchHealthBody(apiPort, UPDATE_HEALTH_TIMEOUT_MS);
  verifySpinner.stop();

  // Only probe auth once we have a reachable health endpoint — no point
  // calling /auth/validate against a server that isn't up.
  const keyValid = healthBody !== null ? await validateStoredKey(apiPort) : false;

  const result = decideUpdateVerify({ latest, apiPort, healthBody, keyValid });

  switch (result.kind) {
    case 'ok':
      printVerifyBanner(result.cliVersion);
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

async function runUpdate(options: UpdateOptions): Promise<void> {
  // Check latest version from npm
  const versionSpinner = ora(`Checking latest version of ${PACKAGE_NAME}...`).start();
  const latest = await fetchLatestVersion();
  versionSpinner.stop();

  if (latest === null) {
    output.warn('Could not reach npm registry. Check your network connection and try again.');
    process.exit(1);
  }

  // Strip any git hash suffix (e.g. "2.20260218.18+abc1234" → "2.20260218.18") for comparison
  const currentClean = VERSION.split('+')[0];

  if (currentClean === latest) {
    output.success(`Already up to date (v${latest})`);
    process.exit(0);
  }

  output.info(`Update available: v${currentClean} → v${latest}`);

  if (!options.yes) {
    const confirmed = await promptConfirm(`Update from v${currentClean} to v${latest}? [Y/n] `);
    if (!confirmed) {
      output.info('Update cancelled.');
      process.exit(0);
    }
  }

  const servicesToRestart = options.restart !== false ? getRunningPm2Services() : [];

  const installSpinner = ora(`Updating ${PACKAGE_NAME}...`).start();
  const installed = await installLatest();
  installSpinner.stop();

  if (!installed) {
    output.warn(`Installation failed. Your current version (v${currentClean}) is still intact.`);
    process.exit(1);
  }

  if (servicesToRestart.length > 0) {
    // On success, restartServicesAndVerify prints the three-line banner and
    // returns. On failure it exits non-zero before returning here, so we
    // deliberately skip the legacy `omni updated` summary in that path.
    await restartServicesAndVerify(servicesToRestart, latest);
    return;
  }

  // --no-restart path: nothing to verify server-side.
  output.success(`omni updated to v${latest}`);
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description(`Update ${PACKAGE_NAME} to the latest version (restart only services already running)`)
    .option('-y, --yes', 'Skip confirmation prompts (non-interactive)')
    .option('--no-restart', 'Update CLI only; skip service restarts and verification')
    .addHelpText(
      'after',
      `
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
  - Use --no-restart to skip restart + verification entirely.
  - Verify runtime health after update with: omni status
`,
    )
    .action(runUpdate);
}
