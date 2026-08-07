/** PM2/systemd service materialization for `omni install`. */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ora from 'ora';
import { type Config, DEFAULT_SERVER_CONFIG, type ServerConfig } from './config.js';
import { waitForHealth } from './health.js';
import { installPm2Logrotate, writeSystemdUnit } from './install-helpers.js';
import { NATS_BINARY_PATH } from './nats-install.js';
import * as output from './output.js';
import { PM2_PROCESSES, buildPm2StartArgs, getPm2LogDir, isPm2Available, runPm2 } from './pm2.js';
import { type RuntimeEnv, buildRuntimeEnv } from './runtime-env.js';
import { getServerBundlePath, getServerLauncherPath } from './server-bundle.js';
import {
  databaseTargetFromRuntimeEnv,
  formatLifecycleFailure,
  runServiceStartSequence,
  tcpTargetFromUrl,
  waitForDatabaseReady,
  waitForTcpReady,
} from './service-lifecycle.js';

export interface InstallServiceConfig {
  port: number;
  dataDir: string;
  databaseUrl: string;
  apiKey: string;
}

function buildInstallRuntimeEnv(
  cfg: InstallServiceConfig,
  forceCleanup: boolean,
  useCanonicalPgserve: boolean,
): RuntimeEnv & Record<string, string> {
  const serverConfig: ServerConfig = {
    ...DEFAULT_SERVER_CONFIG,
    port: cfg.port,
    databaseUrl: cfg.databaseUrl,
    dataDir: cfg.dataDir,
    useCanonicalPgserve,
  };
  const env: RuntimeEnv & Record<string, string> = {
    ...buildRuntimeEnv(serverConfig, { apiKey: cfg.apiKey } as Config),
  };
  if (forceCleanup) env.OMNI_PGSERVE_FORCE_CLEANUP = 'true';
  return env;
}

export async function startInstallServices(
  cfg: InstallServiceConfig,
  forceCleanup: boolean,
  forceSystemd: boolean,
  useCanonicalPgserve: boolean,
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
  const natsTarget = tcpTargetFromUrl(runtimeEnv.NATS_URL);
  if (!natsTarget) return false;

  const natsDataDir = join(cfg.dataDir, 'nats');
  const natsArgs = buildPm2StartArgs({
    kind: 'nats',
    script: NATS_BINARY_PATH,
    name: PM2_PROCESSES.nats,
    scriptArgs: ['-js', '-sd', natsDataDir],
  });
  const apiArgs = buildPm2StartArgs({
    kind: 'api',
    script: getServerLauncherPath(),
    name: PM2_PROCESSES.api,
    interpreter: 'bash',
  });

  const result = await runServiceStartSequence({
    checkDatabase: () => waitForDatabaseReady(databaseTargetFromRuntimeEnv(runtimeEnv)),
    startNats: async () => {
      if (!existsSync(NATS_BINARY_PATH)) return false;
      await runPm2(['delete', PM2_PROCESSES.api]);
      await runPm2(['delete', PM2_PROCESSES.nats]);
      mkdirSync(natsDataDir, { recursive: true });
      const spinner = ora(`Starting ${PM2_PROCESSES.nats}...`).start();
      const code = await runPm2(natsArgs);
      if (code === 0) spinner.succeed(`${PM2_PROCESSES.nats} started`);
      else spinner.fail(`Failed to start ${PM2_PROCESSES.nats} (pm2 exit code ${code})`);
      return code === 0;
    },
    checkNats: () => waitForTcpReady(natsTarget.host, natsTarget.port),
    startApi: async () => {
      const spinner = ora(`Starting ${PM2_PROCESSES.api} on port ${cfg.port}...`).start();
      const code = await runPm2(apiArgs, runtimeEnv);
      if (code === 0) spinner.succeed(`${PM2_PROCESSES.api} started`);
      else spinner.fail(`Failed to start ${PM2_PROCESSES.api} (pm2 exit code ${code})`);
      return code === 0;
    },
    checkApi: async () => {
      const spinner = ora(`Checking health at http://localhost:${cfg.port}/api/v2/health...`).start();
      const healthy = await waitForHealth(cfg.port);
      if (healthy) spinner.succeed('Server is healthy');
      else spinner.fail('Server health check failed');
      return healthy;
    },
  });

  if (!result.ok) output.warn(formatLifecycleFailure(result));
  return result.ok;
}
