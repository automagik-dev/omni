/**
 * Start Command
 *
 * omni start — Start API and NATS via PM2 using ~/.omni/config.json
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { loadConfig, loadServerConfig } from '../config.js';
import { getHealthCheckUrl, waitForHealth } from '../health.js';
import * as output from '../output.js';
import { PM2_PROCESSES, isPm2Available, pm2NotFoundError, runPm2 } from '../pm2.js';
import { bundleNotFoundError, getServerBundlePath } from '../server-bundle.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Start command uses a shorter health-check timeout than install */
const START_HEALTH_TIMEOUT_MS = 10_000;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build complete runtime environment for the API process from config.
 * All values come from loadServerConfig() / loadConfig() — never from process.env.
 */
function buildApiRuntimeEnv(): Record<string, string> {
  const serverConfig = loadServerConfig();
  const config = loadConfig();
  return {
    API_PORT: String(serverConfig.port),
    DATABASE_URL: serverConfig.databaseUrl,
    OMNI_API_KEY: config.apiKey ?? '',
    MEDIA_STORAGE_PATH: join(serverConfig.dataDir, 'media'),
    PGSERVE_EMBEDDED: 'true',
    PGSERVE_DATA: join(serverConfig.dataDir, 'pglite'),
    NATS_URL: 'nats://localhost:4222',
    NODE_ENV: serverConfig.nodeEnv,
    LOG_LEVEL: serverConfig.logLevel,
  };
}

// ============================================================================
// ACTION
// ============================================================================

async function runStart(): Promise<void> {
  // 1. Check PM2 availability
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  // 2. Check server bundle
  const bundlePath = getServerBundlePath();
  if (!existsSync(bundlePath)) {
    bundleNotFoundError(bundlePath);
  }

  const serverConfig = loadServerConfig();
  const apiPort = serverConfig.port;

  // 3. Start omni-api via PM2 with complete env from config
  output.info(`Starting ${PM2_PROCESSES.api} (port ${apiPort})...`);
  const env = buildApiRuntimeEnv();
  const apiCode = await runPm2(
    ['start', bundlePath, '--name', PM2_PROCESSES.api, '--interpreter', 'bun', '--update-env'],
    env,
  );
  if (apiCode !== 0) {
    output.error(`Failed to start ${PM2_PROCESSES.api} (pm2 exit code ${apiCode})`);
  }

  // 4. Start omni-nats if binary exists
  const natsPath = join(homedir(), '.omni', 'nats-server');
  if (existsSync(natsPath)) {
    output.info(`Starting ${PM2_PROCESSES.nats}...`);
    const natsCode = await runPm2(['start', natsPath, '--name', PM2_PROCESSES.nats]);
    if (natsCode !== 0) {
      output.warn(`${PM2_PROCESSES.nats} failed to start — run 'omni install' to download NATS first`);
    }
  } else {
    output.warn(`NATS binary not found at ${natsPath} — skipping. Run 'omni install' to set it up.`);
  }

  // 5. Wait for health check
  const healthUrl = getHealthCheckUrl(apiPort);
  output.info(`Waiting for health check at ${healthUrl}...`);
  const healthy = await waitForHealth(apiPort, START_HEALTH_TIMEOUT_MS);
  if (healthy) {
    output.success(`Server is healthy at ${healthUrl}`);
  } else {
    output.warn(`Health check did not pass within ${START_HEALTH_TIMEOUT_MS / 1000}s — server may still be starting`);
  }
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

export function createStartCommand(): Command {
  return new Command('start').description('Start API and NATS via PM2').action(runStart);
}
