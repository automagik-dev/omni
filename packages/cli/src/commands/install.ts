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

import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  DEFAULT_SERVER_CONFIG,
  getConfigPath,
  loadLocalRuntimeConfig,
  loadServerConfig,
  saveLocalRuntimeConfig,
  saveServerConfig,
} from '../config.js';
import { DEFAULT_API_PORT } from '../health.js';
import { detectReinstall } from '../install-helpers.js';
import { startInstallServices } from '../install-services.js';
import { resolveCanonicalPgservePreference } from '../lib/canonical-pgserve.js';
import { ensureNats } from '../nats-install.js';
import * as output from '../output.js';
import { buildEmbeddedDatabaseUrl } from '../runtime-env.js';
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
  // `omni install` provisions the LOCAL server — read/write the `default`
  // entry, never whichever remote entry happens to be active.
  const cliConfig = loadLocalRuntimeConfig();
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

// ----------------------------------------------------------------------------
// Persistence, health, handoff
// ----------------------------------------------------------------------------

function writeConfigFile(cfg: ResolvedConfig, useCanonicalPgserve: boolean): void {
  const existing = loadLocalRuntimeConfig();
  saveLocalRuntimeConfig({
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
    // commands honor it without operator passing flags or env vars.
    useCanonicalPgserve,
  });
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

  // Canonical pgserve (pgserve@^2.1.0): fresh installs default to canonical;
  // reinstalls preserve the operator's existing choice. Doctor `--fix` is the
  // way to migrate an embedded install onto canonical later.
  const useCanonicalPgserve = await resolveCanonicalPgservePreference(signals.isReinstall, cfg);

  await ensureNats();
  const servicesStarted = await startInstallServices(cfg, forceCleanup, forceSystemd, useCanonicalPgserve);

  if (!forceSystemd && !servicesStarted) {
    output.error('Installation did not complete because the local services are not ready.', undefined, 1);
  }

  writeConfigFile(cfg, useCanonicalPgserve);
  output.success(`Config written to ${getConfigPath()}`);

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
    .option('--non-interactive', '[deprecated] silent no-op — install is always non-interactive')
    .action(runInstall);
}
