/**
 * Install Command
 *
 * omni install [--non-interactive] [--systemd] [--port <port>]
 *
 * Interactive setup wizard that bootstraps a full Omni server from zero:
 *   1. Banner + version
 *   2. System check (bun, port availability)
 *   3. NATS download (if not present)
 *   4. Process manager choice (PM2 or systemd or manual)
 *   5. Config (port, data dir)
 *   6. API key (generate or provide)
 *   7. Start services via PM2 (or write systemd unit)
 *   8. Health check
 *   9. Write ~/.omni/config.json
 *  10. Done banner + next steps
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import ora from 'ora';
import { saveConfig } from '../config.js';
import { DEFAULT_API_PORT, HEALTH_TIMEOUT_MS, waitForHealth } from '../health.js';
import * as output from '../output.js';
import { PM2_PROCESSES, isPm2Available, runPm2 } from '../pm2.js';
import { getServerBundlePath } from '../server-bundle.js';
import { VERSION } from '../version.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_DATA_DIR = join(homedir(), '.omni', 'data');
const DEFAULT_DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/omni';
const OMNI_DIR = join(homedir(), '.omni');
const NATS_BINARY_PATH = join(OMNI_DIR, 'nats-server');
const NATS_VERSION = 'v2.10.24';

// ============================================================================
// TYPES
// ============================================================================

type ProcessManager = 'pm2' | 'systemd' | 'manual';

interface InstallOptions {
  nonInteractive?: boolean;
  systemd?: boolean;
  port?: string;
}

interface WizardConfig {
  port: number;
  dataDir: string;
  databaseUrl: string;
  apiKey: string;
  processManager: ProcessManager;
}

// ============================================================================
// HELPERS - SYSTEM CHECKS
// ============================================================================

/** Check if bun is in PATH */
async function isBunAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ['bun', '--version'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/** Check if a TCP port is free (attempt to connect — if refused, it's free) */
async function isPortFree(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port,
      socket: {
        data() {},
      },
    });
    server.stop();
    return true;
  } catch {
    // Port is already in use
    return false;
  }
}

// ============================================================================
// HELPERS - NATS DOWNLOAD
// ============================================================================

/** Detect platform and architecture for NATS download */
function getNatsPlatformInfo(): { os: string; arch: string } | null {
  const platform = process.platform;
  const arch = process.arch;

  let os: string;
  if (platform === 'linux') {
    os = 'linux';
  } else if (platform === 'darwin') {
    os = 'darwin';
  } else {
    return null; // unsupported
  }

  let natsArch: string;
  if (arch === 'x64') {
    natsArch = 'amd64';
  } else if (arch === 'arm64') {
    natsArch = 'arm64';
  } else {
    return null; // unsupported
  }

  return { os, arch: natsArch };
}

/** Download and install NATS binary to ~/.omni/nats-server */
async function downloadNats(): Promise<boolean> {
  const platformInfo = getNatsPlatformInfo();
  if (!platformInfo) {
    output.warn('Unsupported platform for automatic NATS download — install manually');
    return false;
  }

  const { os, arch } = platformInfo;
  const fileName = `nats-server-${NATS_VERSION}-${os}-${arch}.tar.gz`;
  const downloadUrl = `https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/${fileName}`;

  const spinner = ora(`Downloading NATS ${NATS_VERSION} for ${os}/${arch}...`).start();

  try {
    // Ensure ~/.omni exists
    mkdirSync(OMNI_DIR, { recursive: true, mode: 0o700 });

    const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) {
      spinner.fail(`NATS download failed: HTTP ${resp.status}`);
      return false;
    }

    const arrayBuf = await resp.arrayBuffer();
    const tarPath = join(OMNI_DIR, fileName);
    writeFileSync(tarPath, Buffer.from(arrayBuf));

    spinner.text = 'Extracting NATS binary...';

    // Extract tar.gz using Bun.spawn (tar is universally available on Linux/macOS)
    const tmpDir = join(OMNI_DIR, 'nats-tmp');
    mkdirSync(tmpDir, { recursive: true });

    const tarProc = Bun.spawn({
      cmd: ['tar', '-xzf', tarPath, '-C', tmpDir],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const tarCode = await tarProc.exited;

    if (tarCode !== 0) {
      spinner.fail('Failed to extract NATS archive');
      return false;
    }

    // Find the binary inside the extracted directory
    const findProc = Bun.spawn({
      cmd: ['find', tmpDir, '-name', 'nats-server', '-type', 'f'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const foundBin = (await new Response(findProc.stdout).text()).trim();
    await findProc.exited;

    if (!foundBin) {
      spinner.fail('Could not find nats-server binary in archive');
      return false;
    }

    // Move to final location
    const mvProc = Bun.spawn({
      cmd: ['mv', foundBin, NATS_BINARY_PATH],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await mvProc.exited;

    chmodSync(NATS_BINARY_PATH, 0o755);

    // Cleanup
    const rmProc = Bun.spawn({
      cmd: ['rm', '-rf', tarPath, tmpDir],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await rmProc.exited;

    spinner.succeed(`NATS ${NATS_VERSION} installed to ${NATS_BINARY_PATH}`);
    return true;
  } catch (err) {
    spinner.fail(`NATS download error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ============================================================================
// HELPERS - INTERACTIVE PROMPT
// ============================================================================

/** Prompt for a line of input with a default value */
async function promptLine(question: string, defaultValue = ''): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === '' ? defaultValue : trimmed);
    });
  });
}

/** Prompt for y/n — default is yes */
async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') return resolve(defaultYes);
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

/** Generate a random API key: omni_sk_ + 32 hex chars */
function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `omni_sk_${hex}`;
}

/** Mask an API key for display: show first 12 chars + ... */
function maskApiKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 12)}...`;
}

type ApiKeyPromptResult = {
  apiKey: string;
  generated: boolean;
};

function buildApiRuntimeEnv(cfg: WizardConfig): Record<string, string> {
  return {
    API_PORT: String(cfg.port),
    DATABASE_URL: cfg.databaseUrl,
    OMNI_API_KEY: cfg.apiKey,
    MEDIA_STORAGE_PATH: join(cfg.dataDir, 'media'),
  };
}

function formatSystemdEnvironment(name: string, value: string): string {
  const escaped = value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `Environment="${name}=${escaped}"`;
}

// ============================================================================
// HELPERS - SYSTEMD UNIT
// ============================================================================

/** Write a systemd unit file to /etc/systemd/system/omni-api.service */
async function writeSystemdUnit(cfg: WizardConfig): Promise<boolean> {
  const bundlePath = getServerBundlePath();
  const runtimeEnv = buildApiRuntimeEnv(cfg);
  const unitContent = `[Unit]
Description=Omni API Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env bun ${bundlePath}
Restart=on-failure
${formatSystemdEnvironment('API_PORT', runtimeEnv.API_PORT)}
${formatSystemdEnvironment('DATABASE_URL', runtimeEnv.DATABASE_URL)}
${formatSystemdEnvironment('OMNI_API_KEY', runtimeEnv.OMNI_API_KEY)}
${formatSystemdEnvironment('MEDIA_STORAGE_PATH', runtimeEnv.MEDIA_STORAGE_PATH)}

[Install]
WantedBy=multi-user.target
`;

  const unitPath = '/etc/systemd/system/omni-api.service';

  try {
    writeFileSync(unitPath, unitContent, { mode: 0o644 });
    output.success(`Systemd unit written to ${unitPath}`);
    output.raw('\n  Enable and start with:');
    output.raw('    sudo systemctl enable --now omni-api\n');
    return true;
  } catch {
    output.warn(`Could not write ${unitPath} — run with sudo or write it manually`);
    output.raw('\n  Unit file contents:');
    output.raw(unitContent);
    return false;
  }
}

// ============================================================================
// WIZARD STEPS
// ============================================================================

/** Step 1: Print the Omni banner */
function printBanner(): void {
  output.raw(`
   ___  __  __ _  _ ___
  / _ \\|  \\/  | \\| |_ _|
 | (_) | |\\/| | .\` || |
  \\___/|_|  |_|_|\\_|___|

  Universal Event-Driven Omnichannel Platform
  v${VERSION} — setup wizard
`);
}

/** Step 2: System checks */
async function runSystemChecks(port: number): Promise<{ bunOk: boolean; portOk: boolean }> {
  output.raw('  System checks:');

  const bunOk = await isBunAvailable();
  output.raw(`    ${bunOk ? '✓' : '✗'} bun available`);

  const portOk = await isPortFree(port);
  output.raw(`    ${portOk ? '✓' : '✗'} port ${port} is free`);

  output.raw('');
  return { bunOk, portOk };
}

/** Step 3: NATS — download if not present */
async function ensureNats(): Promise<void> {
  if (existsSync(NATS_BINARY_PATH)) {
    output.raw(`  ✓ NATS binary found at ${NATS_BINARY_PATH}`);
    return;
  }

  output.raw('  NATS binary not found — downloading...');
  await downloadNats();
}

/** Step 4+5: Process manager choice */
async function chooseProcessManager(nonInteractive: boolean, forceSystemd: boolean): Promise<ProcessManager> {
  if (forceSystemd) return 'systemd';
  if (nonInteractive) return 'pm2';

  output.raw('  Process manager:');
  output.raw('    1) PM2      — recommended, cross-platform, survives terminal close');
  output.raw('    2) systemd  — native Linux, starts on boot (requires sudo)');
  output.raw("    3) Manual   — I'll start it myself");
  output.raw('');

  const choice = await promptLine('  Choice [1]: ', '1');

  if (choice === '2') return 'systemd';
  if (choice === '3') return 'manual';
  return 'pm2';
}

/** Step 6: Config prompts */
async function promptConfig(
  nonInteractive: boolean,
  portOverride: number | undefined,
): Promise<{ port: number; dataDir: string; databaseUrl: string }> {
  if (nonInteractive) {
    return {
      port: portOverride ?? DEFAULT_API_PORT,
      dataDir: DEFAULT_DATA_DIR,
      databaseUrl: DEFAULT_DATABASE_URL,
    };
  }

  const portStr = await promptLine(`  API port [${DEFAULT_API_PORT}]: `, String(portOverride ?? DEFAULT_API_PORT));
  const port = Number.parseInt(portStr, 10);

  const dataDir = await promptLine(`  Data directory [${DEFAULT_DATA_DIR}]: `, DEFAULT_DATA_DIR);
  const databaseUrl = await promptLine(`  Database URL [${DEFAULT_DATABASE_URL}]: `, DEFAULT_DATABASE_URL);

  return {
    port: Number.isNaN(port) ? DEFAULT_API_PORT : port,
    dataDir: dataDir || DEFAULT_DATA_DIR,
    databaseUrl: databaseUrl || DEFAULT_DATABASE_URL,
  };
}

/** Step 7: API key */
async function promptApiKey(nonInteractive: boolean): Promise<ApiKeyPromptResult> {
  if (nonInteractive) {
    return { apiKey: generateApiKey(), generated: true };
  }

  const provided = await promptLine('  API key (leave blank to generate): ', '');
  if (provided === '') {
    return { apiKey: generateApiKey(), generated: true };
  }
  return { apiKey: provided, generated: false };
}

/** Step 8: Start services */
async function startServices(cfg: WizardConfig): Promise<void> {
  if (cfg.processManager === 'manual') {
    output.info('Skipping service start. Run: omni server start');
    return;
  }

  if (cfg.processManager === 'systemd') {
    await writeSystemdUnit(cfg);
    return;
  }

  // PM2 path
  const pm2Ok = await isPm2Available();
  if (!pm2Ok) {
    output.warn('PM2 not found in PATH.\n  Install it with: bun add -g pm2\n  Then run: omni server start');
    return;
  }

  const bundlePath = getServerBundlePath();
  if (!existsSync(bundlePath)) {
    output.warn(
      `Server bundle not found at: ${bundlePath}\n  Install @automagik/omni from npm: bun add -g @automagik/omni\n  Or build locally: make cli-build-full`,
    );
    return;
  }

  const runtimeEnv = buildApiRuntimeEnv(cfg);
  const apiSpinner = ora(`Starting ${PM2_PROCESSES.api} on port ${cfg.port}...`).start();
  const apiCode = await runPm2(['start', bundlePath, '--name', PM2_PROCESSES.api, '--interpreter', 'bun'], runtimeEnv);
  if (apiCode !== 0) {
    apiSpinner.fail(`Failed to start ${PM2_PROCESSES.api} (pm2 exit code ${apiCode})`);
  } else {
    apiSpinner.succeed(`${PM2_PROCESSES.api} started`);
  }

  if (existsSync(NATS_BINARY_PATH)) {
    const natsSpinner = ora(`Starting ${PM2_PROCESSES.nats}...`).start();
    const natsCode = await runPm2(['start', NATS_BINARY_PATH, '--name', PM2_PROCESSES.nats]);
    if (natsCode !== 0) {
      natsSpinner.warn(`${PM2_PROCESSES.nats} failed to start — check NATS binary`);
    } else {
      natsSpinner.succeed(`${PM2_PROCESSES.nats} started`);
    }
  } else {
    output.warn(`NATS binary not found at ${NATS_BINARY_PATH} — skipping`);
  }
}

/** Step 9: Health check */
async function checkHealth(port: number): Promise<boolean> {
  const spinner = ora(`Checking health at http://localhost:${port}/api/v2/health...`).start();
  const healthy = await waitForHealth(port);
  if (healthy) {
    spinner.succeed('Server is healthy');
  } else {
    spinner.warn(`Health check failed after ${HEALTH_TIMEOUT_MS / 1000}s — check: omni server logs api`);
  }
  return healthy;
}

/** Step 10: Write config */
function writeConfigFile(port: number, apiKey: string): void {
  const config = {
    apiUrl: `http://localhost:${port}`,
    apiKey,
    format: 'human' as const,
  };
  saveConfig(config);
  output.success(`Config written to ${join(homedir(), '.omni', 'config.json')}`);
}

/** Step 11: Done banner */
async function printDoneBanner(
  port: number,
  apiKey: string,
  nonInteractive: boolean,
  showFullGeneratedKey: boolean,
): Promise<void> {
  const displayedKey = showFullGeneratedKey ? apiKey : maskApiKey(apiKey);
  const keyHint = showFullGeneratedKey ? ' <- save this (shown once)' : ' <- configured';

  output.raw(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Omni v${VERSION} is running!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  API:    http://localhost:${port}
  Key:    ${displayedKey}${keyHint}

  omni status              Check connection
  omni server logs api     View API logs
  omni instances list      Manage channels
`);

  if (!nonInteractive) {
    const setupChannel = await promptYesNo('? Set up your first channel now? [Y/n] ', true);
    if (setupChannel) {
      output.raw('\n  Run: omni instances create --help\n');
    }
  }
}

// ============================================================================
// MAIN ACTION
// ============================================================================

async function runInstall(options: InstallOptions): Promise<void> {
  const nonInteractive = options.nonInteractive === true;
  const forceSystemd = options.systemd === true;
  const portOverride = options.port !== undefined ? Number.parseInt(options.port, 10) : undefined;

  // Step 1: Banner
  printBanner();

  // Step 2: System checks
  const effectivePort = portOverride ?? DEFAULT_API_PORT;
  const { bunOk, portOk } = await runSystemChecks(effectivePort);

  if (!bunOk) {
    output.warn('bun is not available — some features may not work correctly');
  }
  if (!portOk) {
    output.warn(`Port ${effectivePort} appears to be in use — continuing anyway`);
  }

  // Step 3: NATS
  await ensureNats();

  // Step 4+5: Process manager
  const processManager = await chooseProcessManager(nonInteractive, forceSystemd);

  // Step 6: Config
  const { port, dataDir, databaseUrl } = await promptConfig(nonInteractive, portOverride);

  // Step 7: API key
  const { apiKey, generated: apiKeyGenerated } = await promptApiKey(nonInteractive);

  // Step 8: Start services
  const cfg: WizardConfig = { port, dataDir, databaseUrl, apiKey, processManager };
  await startServices(cfg);

  // Step 9: Health check (only for PM2 path)
  if (processManager === 'pm2') {
    await checkHealth(port);
  }

  // Step 10: Write config
  writeConfigFile(port, apiKey);

  // Step 11: Done banner
  await printDoneBanner(port, apiKey, nonInteractive, apiKeyGenerated);

  process.exit(0);
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

export function createInstallCommand(): Command {
  return new Command('install')
    .description('Interactive setup wizard — bootstraps Omni server from zero')
    .option('--non-interactive', 'Use all defaults, skip prompts (for CI/scripted installs)')
    .option('--systemd', 'Write systemd unit instead of using PM2 (requires sudo)')
    .option('--port <port>', `API port to use (default: ${DEFAULT_API_PORT})`)
    .action(runInstall);
}
