/**
 * Update Command
 *
 * omni update [--yes] [--no-restart]
 *
 * Self-update from npm: checks latest @automagik/omni version, prompts the
 * user (unless --yes), installs with `bun add -g`, and restarts PM2 services
 * only if they were already running. When that restart path runs, update
 * checks API health on the configured API port; if restart or health checks
 * fail, exits non-zero and points operators to `omni status`.
 */

import { createInterface } from 'node:readline';
import { Command } from 'commander';
import ora from 'ora';
import { loadServerConfig } from '../config.js';
import { waitForHealth } from '../health.js';
import * as output from '../output.js';
import { PM2_PROCESSES } from '../pm2.js';
import { VERSION } from '../version.js';

const PACKAGE_NAME = '@automagik/omni';

/** update uses a shorter timeout — services should restart quickly */
const UPDATE_HEALTH_TIMEOUT_MS = 10_000;

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

/** Restart provided PM2 processes. Returns true when all restarts succeed. */
async function restartPm2Services(processNames: Pm2ProcessName[]): Promise<boolean> {
  let allSucceeded = true;
  for (const name of processNames) {
    const proc = Bun.spawn({
      cmd: ['pm2', 'restart', name],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      allSucceeded = false;
    }
  }
  return allSucceeded;
}

/** Restart selected services and verify API health; exits non-zero on partial failure. */
async function restartServicesAndVerify(servicesToRestart: Pm2ProcessName[], latest: string): Promise<void> {
  const apiPort = loadServerConfig().port;
  const restartSpinner = ora('Restarting services...').start();
  const restartSucceeded = await restartPm2Services(servicesToRestart);
  restartSpinner.stop();

  const healthy = await waitForHealth(apiPort, UPDATE_HEALTH_TIMEOUT_MS);
  if (restartSucceeded && healthy) {
    output.success('Services restarted successfully.');
    return;
  }

  const failures: string[] = [];
  if (!restartSucceeded) failures.push('one or more service restarts failed');
  if (!healthy) failures.push(`health check failed on port ${apiPort}`);
  output.warn(`omni CLI updated to v${latest}, but ${failures.join(' and ')}. Run \`omni status\`.`);
  process.exit(1);
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
    await restartServicesAndVerify(servicesToRestart, latest);
  }

  output.success(`omni updated to v${latest}`);
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description(`Update ${PACKAGE_NAME} to the latest version (restart only services already running)`)
    .option('-y, --yes', 'Skip confirmation prompts (non-interactive)')
    .option('--no-restart', 'Update CLI only; skip service restarts and API health check on configured API port')
    .addHelpText(
      'after',
      `
Behavior:
  - Installs the latest CLI package first.
  - Restarts tracked Omni services only when they were online before the update.
  - When that restart path runs, update checks API health on the configured API port.
  - Use --no-restart to skip restart and API health-check steps.
  - Exits non-zero if install succeeds but restart or API health check fails in that restart path.
  - Verify runtime health after update with: omni status
`,
    )
    .action(runUpdate);
}
