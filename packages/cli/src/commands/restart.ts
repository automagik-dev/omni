/**
 * Restart Command
 *
 * omni restart — Restart omni PM2 processes and wait for health check
 */

import { join } from 'node:path';
import { Command } from 'commander';
import { loadConfig, loadServerConfig } from '../config.js';
import { getHealthCheckUrl, waitForHealth } from '../health.js';
import * as output from '../output.js';
import { PM2_PROCESSES, isPm2Available, pm2NotFoundError, runPm2 } from '../pm2.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Restart command uses a shorter health-check timeout than install */
const RESTART_HEALTH_TIMEOUT_MS = 10_000;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build complete runtime environment for the API process from config.
 * Used with --update-env to ensure restarted processes pick up config changes.
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
    PGSERVE_DATA: join(serverConfig.dataDir, 'pgserve'),
    NATS_URL: 'nats://localhost:4222',
    NODE_ENV: serverConfig.nodeEnv,
    LOG_LEVEL: serverConfig.logLevel,
  };
}

// ============================================================================
// ACTION
// ============================================================================

async function runRestart(): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  const serverConfig = loadServerConfig();
  const apiPort = serverConfig.port;

  output.info('Restarting omni services...');
  const env = buildApiRuntimeEnv();
  const code = await runPm2(['restart', PM2_PROCESSES.api, PM2_PROCESSES.nats, '--update-env'], env);
  if (code !== 0) {
    output.warn('Some services may not have restarted cleanly — check pm2 status');
  }

  // Wait for health check
  const healthUrl = getHealthCheckUrl(apiPort);
  output.info(`Waiting for health check at ${healthUrl}...`);
  const healthy = await waitForHealth(apiPort, RESTART_HEALTH_TIMEOUT_MS);
  if (healthy) {
    output.success('Server is healthy after restart');
  } else {
    output.warn(`Health check did not pass within ${RESTART_HEALTH_TIMEOUT_MS / 1000}s`);
  }
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

export function createRestartCommand(): Command {
  return new Command('restart').description('Restart omni PM2 processes and wait for health check').action(runRestart);
}
