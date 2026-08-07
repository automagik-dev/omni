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
import { loadLocalRuntimeConfig, loadServerConfig } from '../config.js';
import { getHealthCheckUrl, waitForHealth } from '../health.js';
import * as output from '../output.js';
import { PM2_PROCESSES, isPm2Available, pm2NotFoundError, runPm2 } from '../pm2.js';
import { buildRuntimeEnv } from '../runtime-env.js';
import {
  databaseTargetFromRuntimeEnv,
  formatLifecycleFailure,
  runServiceStartSequence,
  tcpTargetFromUrl,
  waitForDatabaseReady,
  waitForTcpReady,
} from '../service-lifecycle.js';

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
  // LOCAL entry, never the active server — see runtime-env.ts rule 5.
  const cliConfig = loadLocalRuntimeConfig();
  const apiPort = serverConfig.port;

  // Build a hermetic env from config. We pass this so the pm2 CLI itself
  // runs in a sanitized environment (no leakage from the parent shell's
  // DATABASE_URL / OMNI_API_KEY).
  const env = buildRuntimeEnv(serverConfig, cliConfig);
  const natsTarget = tcpTargetFromUrl(env.NATS_URL);
  if (!natsTarget) {
    output.error(`Invalid NATS URL in runtime configuration: ${env.NATS_URL}`, undefined, 1);
  }

  const healthUrl = getHealthCheckUrl(apiPort);
  const result = await runServiceStartSequence({
    checkDatabase: async () => {
      output.info('Waiting for database readiness...');
      return waitForDatabaseReady(databaseTargetFromRuntimeEnv(env));
    },
    startNats: async () => {
      output.info(`Restarting ${PM2_PROCESSES.nats}...`);
      return (await runPm2(['restart', PM2_PROCESSES.nats], env)) === 0;
    },
    checkNats: async () => {
      output.info(`Waiting for NATS at ${natsTarget.host}:${natsTarget.port}...`);
      return waitForTcpReady(natsTarget.host, natsTarget.port);
    },
    startApi: async () => {
      output.info(`Restarting ${PM2_PROCESSES.api}...`);
      return (await runPm2(['restart', PM2_PROCESSES.api], env)) === 0;
    },
    checkApi: async () => {
      output.info(`Waiting for health check at ${healthUrl}...`);
      return waitForHealth(apiPort, RESTART_HEALTH_TIMEOUT_MS);
    },
  });

  if (!result.ok) {
    output.error(`${formatLifecycleFailure(result)}.`, undefined, 1);
  }

  output.success('Server is healthy after restart');
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

export function createRestartCommand(): Command {
  return new Command('restart').description('Restart omni PM2 processes and wait for health check').action(runRestart);
}
