/**
 * Restart Command
 *
 * omni restart — Restart omni PM2 processes and wait for health check
 *
 * IMPORTANT: This command does NOT ask pm2 to re-read the shell environment
 * on restart. Doing so would re-introduce env-pollution bugs (e.g. stray
 * `DATABASE_URL` from a parent tmux session leaking into omni-api). Instead,
 * we rely on the env that was captured at original `pm2 start` time (built
 * by `buildRuntimeEnv` from config). If the stored env is stale, use
 * `omni doctor --fix` to rebuild it deterministically.
 */

import { Command } from 'commander';
import { loadConfig, loadServerConfig } from '../config.js';
import { getHealthCheckUrl, waitForHealth } from '../health.js';
import * as output from '../output.js';
import { PM2_PROCESSES, isPm2Available, pm2NotFoundError, runPm2 } from '../pm2.js';
import { buildRuntimeEnv } from '../runtime-env.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Restart command uses a shorter health-check timeout than install */
const RESTART_HEALTH_TIMEOUT_MS = 10_000;

// ============================================================================
// ACTION
// ============================================================================

async function runRestart(): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  const serverConfig = loadServerConfig();
  const cliConfig = loadConfig();
  const apiPort = serverConfig.port;

  output.info('Restarting omni services...');
  // Build a hermetic env from config. We pass this so the pm2 CLI itself
  // runs in a sanitized environment (no leakage from the parent shell's
  // DATABASE_URL / OMNI_API_KEY).
  const env = buildRuntimeEnv(serverConfig, cliConfig);
  const code = await runPm2(['restart', PM2_PROCESSES.api, PM2_PROCESSES.nats], env);
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
