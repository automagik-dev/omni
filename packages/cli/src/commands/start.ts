/**
 * Start Command
 *
 * omni start — Start API and NATS via PM2 using ~/.omni/config.json
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { loadLocalRuntimeConfig, loadServerConfig } from '../config.js';
import { getHealthCheckUrl, waitForHealth } from '../health.js';
import { EMBEDDED_PGSERVE_DATA_DIR, readDataDirMajor } from '../lib/embedded-canonical-migration.js';
import * as output from '../output.js';
import { PM2_PROCESSES, buildPm2StartArgs, getPm2LogDir, isPm2Available, pm2NotFoundError, runPm2 } from '../pm2.js';
import { buildRuntimeEnv } from '../runtime-env.js';
import { bundleNotFoundError, getServerBundlePath, getServerLauncherPath } from '../server-bundle.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Start command uses a shorter health-check timeout than install */
const START_HEALTH_TIMEOUT_MS = 10_000;

// ============================================================================
// ACTION
// ============================================================================

/**
 * A legacy embedded-pgserve install (created before the canonical cutover)
 * cannot be served by this build — omni-api never spawns the embedded
 * postmaster, so it crash-loops on "Database not ready". Legacy installs
 * predate the `useCanonicalPgserve` flag, so they don't trip the API's
 * PGSERVE_EMBEDDED=true guard. The signal: not committed to canonical AND an
 * embedded data dir is present on disk.
 */
export function legacyEmbeddedNeedsMigration(
  useCanonicalPgserve: boolean | undefined,
  embeddedDataPresent: boolean = existsSync(join(EMBEDDED_PGSERVE_DATA_DIR, 'PG_VERSION')),
): boolean {
  return useCanonicalPgserve !== true && embeddedDataPresent;
}

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

  // Preflight: a legacy embedded-pgserve install (created before the canonical
  // cutover) cannot be served by this build — omni-api never spawns the
  // embedded postmaster, so it would crash-loop on "Database not ready after
  // 30 attempts". Legacy installs predate the `useCanonicalPgserve` flag, so
  // they DON'T trip the API's PGSERVE_EMBEDDED=true guard. Detect the shape
  // (no canonical flag + embedded data dir present) and fail fast with the
  // migration hint instead of an opaque crash loop.
  if (legacyEmbeddedNeedsMigration(serverConfig.useCanonicalPgserve)) {
    const major = readDataDirMajor(EMBEDDED_PGSERVE_DATA_DIR);
    output.error(
      `Legacy embedded pgserve detected — this omni build does not run an embedded Postgres.\n  Embedded data dir: ${EMBEDDED_PGSERVE_DATA_DIR}${major ? ` (PostgreSQL ${major})` : ''}\n  Your data is intact. Migrate to canonical pgserve first:\n      omni doctor --fix\n  (idempotent — preserves data; do not \`omni start\` until it completes).`,
      undefined,
      1,
    );
  }

  // Ensure hardened log directory exists before pm2 spawns.
  mkdirSync(getPm2LogDir(), { recursive: true });

  // 3. Start omni-api via PM2 with complete env from config and hardened flags
  output.info(`Starting ${PM2_PROCESSES.api} (port ${apiPort})...`);
  // LOCAL entry, never the active server — see runtime-env.ts rule 5.
  const cliConfig = loadLocalRuntimeConfig();
  const env = buildRuntimeEnv(serverConfig, cliConfig);
  const launcherPath = getServerLauncherPath();
  const apiArgs = buildPm2StartArgs({
    kind: 'api',
    script: launcherPath,
    name: PM2_PROCESSES.api,
    interpreter: 'bash',
  });
  const apiCode = await runPm2(apiArgs, env);
  if (apiCode !== 0) {
    output.error(`Failed to start ${PM2_PROCESSES.api} (pm2 exit code ${apiCode})`, undefined, 1);
    return;
  }

  // 4. Start omni-nats if binary exists
  const natsPath = join(homedir(), '.omni', 'nats-server');
  if (existsSync(natsPath)) {
    output.info(`Starting ${PM2_PROCESSES.nats}...`);
    const natsDataDir = join(serverConfig.dataDir, 'nats');
    mkdirSync(natsDataDir, { recursive: true });
    const natsArgs = buildPm2StartArgs({
      kind: 'nats',
      script: natsPath,
      name: PM2_PROCESSES.nats,
      scriptArgs: ['-js', '-sd', natsDataDir],
    });
    const natsCode = await runPm2(natsArgs);
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
