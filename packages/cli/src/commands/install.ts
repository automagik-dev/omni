/**
 * Install Command
 *
 * omni install [--port <port>] [--database-url <url>] [--api-key <key>]
 *              [--systemd] [--force-cleanup] [--non-interactive]
 *
 * Non-interactive, reinstall-safe bootstrapper. Rewritten from an interactive
 * wizard in 2026-04 (WISH: omni-install-resilience). Flow:
 *
 *   1. Detect reinstall (config, pm2 process, or non-empty data dir).
 *   2. Preserve ALL user data on reinstall — never regenerate keys or config.
 *   3. Install pm2-logrotate (best-effort, idempotent).
 *   4. Start services via pm2 with hardened flags (max-restarts, log rotation).
 *   5. Health check.
 *   6. Print an agent handoff block addressed TO the AI agent running this.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import {
  type Config,
  DEFAULT_SERVER_CONFIG,
  type ServerConfig,
  getConfigPath,
  loadConfig,
  loadServerConfig,
  saveConfig,
  saveServerConfig,
} from '../config.js';
import { DEFAULT_API_PORT, HEALTH_TIMEOUT_MS, waitForHealth } from '../health.js';
import { detectReinstall, installPm2Logrotate, writeSystemdUnit } from '../install-helpers.js';
import { maybeSwitchToCanonicalPgserve } from '../lib/canonical-pgserve.js';
import { NATS_BINARY_PATH, ensureNats } from '../nats-install.js';
import * as output from '../output.js';
import { PM2_PROCESSES, buildPm2StartArgs, getPm2LogDir, isPm2Available, runPm2 } from '../pm2.js';
import { buildEmbeddedDatabaseUrl, buildRuntimeEnv } from '../runtime-env.js';
import { getServerBundlePath, getServerLauncherPath } from '../server-bundle.js';
import { generateApiKey, maskApiKey } from '../utils/keys.js';
import { VERSION } from '../version.js';

const DEFAULT_DATA_DIR = join(homedir(), '.omni', 'data');

/**
 * Compute the default database URL. Embedded-mode derives from the pgserve
 * port — NEVER from the calling shell. Exported so install-env-leak tests
 * can assert hermeticity.
 */
export function computeDefaultDatabaseUrl(): string {
  return buildEmbeddedDatabaseUrl();
}

/** Resolve the effective databaseUrl, honoring an explicit flag over the embedded default. */
export function resolveInstallDatabaseUrl(options: { databaseUrlFlag?: string }): string {
  const flag = options.databaseUrlFlag?.trim();
  if (flag && flag.length > 0) return flag;
  return computeDefaultDatabaseUrl();
}

interface InstallOptions {
  /** @deprecated — silent no-op. Install is always non-interactive. */
  nonInteractive?: boolean;
  systemd?: boolean;
  port?: string;
  databaseUrl?: string;
  apiKey?: string;
  forceCleanup?: boolean;
  /** Wave 3 of canonical-pgserve-pm2 (pgserve#55) — see lib/canonical-pgserve.ts. */
  canonicalPgserve?: boolean;
}

interface ResolvedConfig {
  port: number;
  dataDir: string;
  databaseUrl: string;
  apiKey: string;
}

// ----------------------------------------------------------------------------
// System checks
// ----------------------------------------------------------------------------

async function isBunAvailable(): Promise<boolean> {
  try {
    return (await Bun.spawn({ cmd: ['bun', '--version'], stdout: 'pipe', stderr: 'pipe' }).exited) === 0;
  } catch {
    return false;
  }
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } });
    server.stop();
    return true;
  } catch {
    return false;
  }
}

async function runSystemChecks(port: number): Promise<void> {
  output.raw('  System checks:');
  const bunOk = await isBunAvailable();
  output.raw(`    ${bunOk ? '✓' : '✗'} bun available`);
  if (!bunOk) output.warn('bun is not available — some features may not work correctly');
  const portOk = await isPortFree(port);
  output.raw(`    ${portOk ? '✓' : '⚠'} port ${port} is free`);
  if (!portOk) output.warn(`Port ${port} appears to be in use — continuing (reinstall or foreign process)`);
  output.raw('');
}

// ----------------------------------------------------------------------------
// Config resolution
// ----------------------------------------------------------------------------

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Resolve config for a FRESH install: defaults + optional flag overrides. */
function resolveFreshConfig(options: InstallOptions): ResolvedConfig {
  return {
    port: parsePort(options.port, DEFAULT_API_PORT),
    dataDir: DEFAULT_DATA_DIR,
    databaseUrl: resolveInstallDatabaseUrl({ databaseUrlFlag: options.databaseUrl }),
    apiKey: options.apiKey?.trim() || generateApiKey(),
  };
}

/**
 * Resolve config for a REINSTALL: reuse stored config verbatim. Only explicit
 * flag overrides (`--port`, `--database-url`, `--api-key`) change values.
 */
function resolveReinstallConfig(options: InstallOptions): ResolvedConfig {
  const cliConfig = loadConfig();
  const serverConfig = loadServerConfig();

  let databaseUrl = serverConfig.databaseUrl;
  if (options.databaseUrl && options.databaseUrl.trim().length > 0) {
    databaseUrl = options.databaseUrl.trim();
  } else if (!databaseUrl || databaseUrl === DEFAULT_SERVER_CONFIG.databaseUrl) {
    databaseUrl = computeDefaultDatabaseUrl();
  }

  let apiKey = cliConfig.apiKey ?? '';
  if (options.apiKey && options.apiKey.trim().length > 0) {
    apiKey = options.apiKey.trim();
  } else if (!apiKey) {
    apiKey = generateApiKey();
  }

  return {
    port: parsePort(options.port, serverConfig.port),
    dataDir: serverConfig.dataDir || DEFAULT_DATA_DIR,
    databaseUrl,
    apiKey,
  };
}

function buildInstallRuntimeEnv(
  cfg: ResolvedConfig,
  forceCleanup: boolean,
  useCanonicalPgserve = false,
): Record<string, string> {
  const serverConfig: ServerConfig = {
    ...DEFAULT_SERVER_CONFIG,
    port: cfg.port,
    databaseUrl: cfg.databaseUrl,
    dataDir: cfg.dataDir,
  };
  const env = buildRuntimeEnv(serverConfig, { apiKey: cfg.apiKey } as Config, {
    useCanonicalPgserve,
  }) as Record<string, string>;
  if (forceCleanup) env.OMNI_PGSERVE_FORCE_CLEANUP = 'true';
  return env;
}

// ----------------------------------------------------------------------------
// Service start
// ----------------------------------------------------------------------------

async function startServices(
  cfg: ResolvedConfig,
  forceCleanup: boolean,
  forceSystemd: boolean,
  useCanonicalPgserve = false,
): Promise<boolean> {
  if (forceSystemd) {
    writeSystemdUnit(cfg.dataDir);
    return false;
  }

  if (!(await isPm2Available())) {
    output.warn('PM2 not found in PATH.\n  Install it with: bun add -g pm2\n  Then run: omni start');
    return false;
  }

  const bundlePath = getServerBundlePath();
  if (!existsSync(bundlePath)) {
    output.warn(
      `Server bundle not found at: ${bundlePath}\n  Install @automagik/omni from npm: bun add -g @automagik/omni\n  Or build locally: make cli-build-full`,
    );
    return false;
  }

  mkdirSync(getPm2LogDir(), { recursive: true });
  await installPm2Logrotate();

  const runtimeEnv = buildInstallRuntimeEnv(cfg, forceCleanup, useCanonicalPgserve);

  // Delete existing processes so the new hardened flags take effect (reinstall path).
  await runPm2(['delete', PM2_PROCESSES.api]);
  await runPm2(['delete', PM2_PROCESSES.nats]);

  const apiSpinner = ora(`Starting ${PM2_PROCESSES.api} on port ${cfg.port}...`).start();
  const apiArgs = buildPm2StartArgs({
    kind: 'api',
    script: getServerLauncherPath(),
    name: PM2_PROCESSES.api,
    interpreter: 'bash',
  });
  const apiCode = await runPm2(apiArgs, runtimeEnv);
  if (apiCode !== 0) {
    apiSpinner.fail(`Failed to start ${PM2_PROCESSES.api} (pm2 exit code ${apiCode})`);
    return false;
  }
  apiSpinner.succeed(`${PM2_PROCESSES.api} started`);

  if (existsSync(NATS_BINARY_PATH)) {
    const natsSpinner = ora(`Starting ${PM2_PROCESSES.nats}...`).start();
    const natsDataDir = join(cfg.dataDir, 'nats');
    mkdirSync(natsDataDir, { recursive: true });
    const natsArgs = buildPm2StartArgs({
      kind: 'nats',
      script: NATS_BINARY_PATH,
      name: PM2_PROCESSES.nats,
      scriptArgs: ['-js', '-sd', natsDataDir],
    });
    const natsCode = await runPm2(natsArgs);
    if (natsCode !== 0) natsSpinner.warn(`${PM2_PROCESSES.nats} failed to start — check NATS binary`);
    else natsSpinner.succeed(`${PM2_PROCESSES.nats} started`);
  } else {
    output.warn(`NATS binary not found at ${NATS_BINARY_PATH} — skipping`);
  }
  return true;
}

// ----------------------------------------------------------------------------
// Persistence, health, handoff
// ----------------------------------------------------------------------------

function writeConfigFile(cfg: ResolvedConfig, useCanonicalPgserve = false): void {
  const existing = loadConfig();
  saveConfig({
    ...existing,
    apiUrl: `http://localhost:${cfg.port}`,
    apiKey: cfg.apiKey,
    format: existing.format ?? 'human',
  });
  saveServerConfig({
    port: cfg.port,
    databaseUrl: cfg.databaseUrl,
    dataDir: cfg.dataDir,
    // Persist canonical-pgserve choice so subsequent omni restart / doctor
    // commands honor it without operator passing the flag again.
    useCanonicalPgserve,
  });
}

async function checkHealth(port: number): Promise<boolean> {
  const spinner = ora(`Checking health at http://localhost:${port}/api/v2/health...`).start();
  const healthy = await waitForHealth(port);
  if (healthy) spinner.succeed('Server is healthy');
  else spinner.warn(`Health check failed after ${HEALTH_TIMEOUT_MS / 1000}s — check: omni logs --process api`);
  return healthy;
}

/**
 * Agent handoff banner. Plain text, no ANSI, no ASCII art, no interactive
 * prompts. An agent reading stdout can act on this block directly.
 * Exported for tests that assert the block's structure.
 */
export function buildAgentHandoffBlock(cfg: ResolvedConfig, apiKeyDisplay: string): string {
  const sep = '═══════════════════════════════════════════════════════════';
  return `
${sep}
For the agent running this install
${sep}

Omni v${VERSION} is installed. API: http://localhost:${cfg.port}

Your next actions, in order:

  1. Verify pm2 health:
       pm2 describe omni-api
       pm2 describe omni-nats
     Both must show status: online. If either shows stopped or errored, run:
       omni logs --process api --lines 50
     and diagnose before continuing.

  2. Load the /omni skill (if not already loaded). This gives you the
     full omni playbook: instances, channels, bot setup, troubleshooting.

  3. Assist the user with setting omni up. Ask them which channel they
     want first (WhatsApp, Telegram, Discord, Slack, ...) and walk them
     through:
       omni instances create --help
       omni instances create <name> --channel <channel>

Config:
  ~/.omni/config.json   CLI auth
  ${cfg.dataDir}   all data — preserved across reinstalls
  ~/.omni/logs/         pm2 logs, rotated

API key: ${apiKeyDisplay}
${sep}
`;
}

function printBanner(): void {
  output.raw(`
   ___  __  __ _  _ ___
  / _ \\|  \\/  | \\| |_ _|
 | (_) | |\\/| | .\` || |
  \\___/|_|  |_|_|\\_|___|

  Universal Event-Driven Omnichannel Platform
  v${VERSION}
`);
}

// ----------------------------------------------------------------------------
// Main action
// ----------------------------------------------------------------------------

async function runInstall(options: InstallOptions): Promise<void> {
  printBanner();

  const forceSystemd = options.systemd === true;
  const forceCleanup = options.forceCleanup === true;

  const signals = await detectReinstall();

  let cfg: ResolvedConfig;
  let apiKeyFreshlyGenerated = false;

  if (signals.isReinstall) {
    cfg = resolveReinstallConfig(options);
    output.raw(`Reinstalling Omni v${VERSION}`);
    output.raw(`Your data is at ${cfg.dataDir} and will be preserved — don't worry.`);
    const reasons: string[] = [];
    if (signals.hasConfig) reasons.push('~/.omni/config.json');
    if (signals.hasPm2Process) reasons.push('pm2 process');
    if (signals.hasDataDir) reasons.push('data directory');
    output.raw(`  Detected: ${reasons.join(', ')}`);
    output.raw('');
  } else {
    cfg = resolveFreshConfig(options);
    apiKeyFreshlyGenerated = options.apiKey === undefined || options.apiKey.trim().length === 0;
    output.raw(`Installing Omni v${VERSION}`);
    output.raw('');
  }

  await runSystemChecks(cfg.port);
  // Wave 3 (pgserve#55): opt-in canonical pgserve. Best-effort — falls
  // back to embedded with a warn when pgserve isn't installed globally.
  const useCanonicalPgserve = await maybeSwitchToCanonicalPgserve(options, cfg);
  await ensureNats();
  const servicesStarted = await startServices(cfg, forceCleanup, forceSystemd, useCanonicalPgserve);

  writeConfigFile(cfg, useCanonicalPgserve);
  output.success(`Config written to ${getConfigPath()}`);

  if (servicesStarted) await checkHealth(cfg.port);

  const apiKeyDisplay = apiKeyFreshlyGenerated ? cfg.apiKey : maskApiKey(cfg.apiKey);
  output.raw(buildAgentHandoffBlock(cfg, apiKeyDisplay));
}

export function createInstallCommand(): Command {
  return new Command('install')
    .description('Bootstrap Omni server (non-interactive, reinstall-safe, agent-first)')
    .option('--port <port>', `API port to use (default: ${DEFAULT_API_PORT})`)
    .option('--database-url <url>', 'External PostgreSQL URL (opt-in; defaults to embedded pgserve)')
    .option('--api-key <key>', 'Explicit API key (default: generate a new one)')
    .option('--systemd', 'Write systemd units instead of using pm2 (requires sudo)')
    .option('--force-cleanup', 'Allow pgserve startup to kill orphan postgres processes on the internal port')
    .option(
      '--canonical-pgserve',
      'Register pgserve under pm2 separately (canonical-pgserve-pm2 wave 3) and connect omni-api to it instead of spawning an embedded pgserve. Idempotent.',
    )
    .option('--non-interactive', '[deprecated] silent no-op — install is always non-interactive')
    .action(runInstall);
}
