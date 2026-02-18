/**
 * Update Command
 *
 * omni update [--yes] [--no-restart]
 *
 * Self-update from npm: checks latest @automagik/omni version, prompts the
 * user (unless --yes), installs with `bun add -g`, and restarts PM2 services
 * if they were running.
 */

import { createInterface } from 'node:readline';
import { Command } from 'commander';
import ora from 'ora';
import * as output from '../output.js';
import { VERSION } from '../version.js';

const PACKAGE_NAME = '@automagik/omni';
const PM2_PROCESSES = ['omni-api', 'omni-nats'];
const HEALTH_URL = 'http://localhost:8882/api/v2/health';
const HEALTH_TIMEOUT_MS = 10_000;
const HEALTH_POLL_INTERVAL_MS = 500;

interface UpdateOptions {
  yes?: boolean;
  restart?: boolean;
}

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

/** Check whether any of the tracked PM2 processes are online. */
function arePm2ServicesRunning(): boolean {
  try {
    const result = Bun.spawnSync({
      cmd: ['pm2', 'jlist'],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      return false;
    }

    const raw = new TextDecoder().decode(result.stdout).trim();
    if (!raw || raw === '[]') return false;

    const list = JSON.parse(raw) as Array<{ name?: string; pm2_env?: { status?: string } }>;
    return list.some((proc) => PM2_PROCESSES.includes(proc.name ?? '') && proc.pm2_env?.status === 'online');
  } catch {
    // pm2 not installed or parse error — skip restart
    return false;
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

/** Restart PM2 processes, ignoring errors. */
async function restartPm2Services(): Promise<void> {
  for (const name of PM2_PROCESSES) {
    const proc = Bun.spawn({
      cmd: ['pm2', 'restart', name],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
  }
}

/** Poll health endpoint until it responds or timeout is reached. */
async function waitForHealth(): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return true;
    } catch {
      // not ready yet
    }

    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }

  return false;
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

  const servicesWereRunning = options.restart !== false && arePm2ServicesRunning();

  const installSpinner = ora(`Updating ${PACKAGE_NAME}...`).start();
  const installed = await installLatest();
  installSpinner.stop();

  if (!installed) {
    output.warn(`Installation failed. Your current version (v${currentClean}) is still intact.`);
    process.exit(1);
  }

  if (servicesWereRunning) {
    const restartSpinner = ora('Restarting services...').start();
    await restartPm2Services();
    restartSpinner.stop();

    const healthy = await waitForHealth();
    if (healthy) {
      output.success('Services restarted successfully.');
    } else {
      output.warn('Services may still be starting up. Run `omni status` to verify.');
    }
  }

  output.success(`omni updated to v${latest}`);
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description(`Update ${PACKAGE_NAME} to the latest version`)
    .option('-y, --yes', 'Skip confirmation prompts (non-interactive)')
    .option('--no-restart', 'Skip service restart even if services are running')
    .action(runUpdate);
}
