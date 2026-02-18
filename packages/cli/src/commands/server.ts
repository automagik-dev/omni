/**
 * Server Commands
 *
 * omni server start    - Start API, NATS via PM2
 * omni server stop     - Stop all omni PM2 processes
 * omni server restart  - Rolling restart with health check
 * omni server logs     - Stream PM2 logs for a service
 * omni server status   - Show PM2 process table for omni-* services
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import * as output from '../output.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const OMNI_API_PORT = 8882;
const HEALTH_CHECK_URL = `http://localhost:${OMNI_API_PORT}/api/v2/health`;
const HEALTH_TIMEOUT_MS = 10_000;
const HEALTH_POLL_INTERVAL_MS = 500;

/** PM2 process names managed by omni */
const PM2_PROCESSES = {
  api: 'omni-api',
  nats: 'omni-nats',
} as const;

/** Map CLI service arg to PM2 process name */
function resolveProcessName(service: string): string {
  if (service === 'api') return PM2_PROCESSES.api;
  if (service === 'nats') return PM2_PROCESSES.nats;
  return service;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Get path to the bundled server index.js relative to this binary */
function getServerBundlePath(): string {
  // When installed via npm, __filename resolves inside dist/
  // dist/server/index.js lives next to dist/index.js
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const distDir = dirname(thisFile);
    return join(distDir, 'server', 'index.js');
  } catch {
    // Fallback: relative to cwd (source installs / dev mode)
    return join(process.cwd(), 'dist', 'server', 'index.js');
  }
}

/** Check if PM2 is available in PATH */
async function isPm2Available(): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ['pm2', '--version'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/** Run a PM2 command and return exit code */
async function runPm2(...args: string[]): Promise<number> {
  const proc = Bun.spawn({
    cmd: ['pm2', ...args],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  return proc.exited;
}

/** Run a PM2 command and capture stdout */
async function capturePm2(...args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn({
    cmd: ['pm2', ...args],
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

/** Wait for the health endpoint to respond (up to HEALTH_TIMEOUT_MS) */
async function waitForHealth(): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(HEALTH_CHECK_URL, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) return true;
    } catch {
      // keep polling
    }
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}

/** Abort with a human-readable PM2 install message */
function pm2NotFoundError(): never {
  output.error(
    'PM2 not found in PATH.\n  Install it with: bun add -g pm2\n  Then retry: omni server start',
    undefined,
    1,
  );
}

/** Abort with a human-readable bundle-not-found message */
function bundleNotFoundError(bundlePath: string): never {
  output.error(
    `Server bundle not found at: ${bundlePath}\n  This command requires @automagik/omni installed from npm.\n  Install: bun add -g @automagik/omni\n  Or build locally: make cli-build-full`,
    undefined,
    1,
  );
}

// ============================================================================
// PM2 STATUS TYPES
// ============================================================================

interface Pm2ProcessInfo {
  name?: string;
  pid?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
  };
  monit?: {
    cpu?: number;
    memory?: number;
  };
}

/** Format uptime in ms to a human-readable string */
function formatUptime(ms: number | undefined): string {
  if (ms === undefined || ms === 0) return '-';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Format memory bytes to MB string */
function formatMemory(bytes: number | undefined): string {
  if (bytes === undefined || bytes === 0) return '-';
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

// ============================================================================
// SUBCOMMAND ACTIONS
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

  // 3. Start omni-api via PM2
  output.info(`Starting ${PM2_PROCESSES.api} (port ${OMNI_API_PORT})...`);
  const apiCode = await runPm2(
    'start',
    bundlePath,
    '--name',
    PM2_PROCESSES.api,
    '--interpreter',
    'node',
    '--env',
    `OMNI_API_PORT=${OMNI_API_PORT}`,
    '--update-env',
  );
  if (apiCode !== 0) {
    output.error(`Failed to start ${PM2_PROCESSES.api} (pm2 exit code ${apiCode})`);
  }

  // 4. Start omni-nats if binary exists
  const natsPath = join(homedir(), '.omni', 'nats-server');
  if (existsSync(natsPath)) {
    output.info(`Starting ${PM2_PROCESSES.nats}...`);
    const natsCode = await runPm2('start', natsPath, '--name', PM2_PROCESSES.nats);
    if (natsCode !== 0) {
      output.warn(`${PM2_PROCESSES.nats} failed to start — run 'omni install' to download NATS first`);
    }
  } else {
    output.warn(`NATS binary not found at ${natsPath} — skipping. Run 'omni install' to set it up.`);
  }

  // 5. Wait for health check
  output.info(`Waiting for health check at ${HEALTH_CHECK_URL}...`);
  const healthy = await waitForHealth();
  if (healthy) {
    output.success(`Server is healthy at ${HEALTH_CHECK_URL}`);
  } else {
    output.warn(`Health check did not pass within ${HEALTH_TIMEOUT_MS / 1000}s — server may still be starting`);
  }
}

async function runStop(): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  output.info('Stopping omni services...');

  // Delete each process; ignore errors for processes that aren't running
  for (const name of Object.values(PM2_PROCESSES)) {
    await runPm2('delete', name);
  }

  output.success('Omni services stopped');
}

async function runRestart(): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  output.info('Restarting omni services...');
  const code = await runPm2('restart', PM2_PROCESSES.api, PM2_PROCESSES.nats);
  if (code !== 0) {
    output.warn('Some services may not have restarted cleanly — check pm2 status');
  }

  // Wait for health
  output.info(`Waiting for health check at ${HEALTH_CHECK_URL}...`);
  const healthy = await waitForHealth();
  if (healthy) {
    output.success('Server is healthy after restart');
  } else {
    output.warn(`Health check did not pass within ${HEALTH_TIMEOUT_MS / 1000}s`);
  }
}

interface LogsOptions {
  lines: number;
  follow: boolean;
}

async function runLogs(service: string | undefined, options: LogsOptions): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  const svcName = service ?? 'api';
  const processName = resolveProcessName(svcName);
  const pm2Args = ['logs', processName, '--lines', String(options.lines)];
  if (!options.follow) {
    pm2Args.push('--nostream');
  }

  const proc = Bun.spawn({
    cmd: ['pm2', ...pm2Args],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  await proc.exited;
}

async function runStatus(): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  const { code, stdout } = await capturePm2('jlist');
  if (code !== 0) {
    output.error('Failed to get PM2 process list');
  }

  let processes: Pm2ProcessInfo[] = [];
  try {
    processes = JSON.parse(stdout) as Pm2ProcessInfo[];
  } catch {
    output.error('Failed to parse PM2 process list');
  }

  // Filter for omni-* processes
  const omniProcesses = processes.filter((p) => typeof p.name === 'string' && p.name.startsWith('omni-'));

  if (omniProcesses.length === 0) {
    output.info('No omni services are running. Start them with: omni server start');
    return;
  }

  const rows = omniProcesses.map((p) => ({
    service: p.name ?? '-',
    pid: p.pid !== undefined ? String(p.pid) : '-',
    status: p.pm2_env?.status ?? '-',
    uptime: formatUptime(p.pm2_env?.pm_uptime),
    cpu: p.monit?.cpu !== undefined ? `${p.monit.cpu}%` : '-',
    memory: formatMemory(p.monit?.memory),
  }));

  output.list(rows);
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

export function createServerCommand(): Command {
  const server = new Command('server').description('Manage Omni server processes via PM2');

  server.command('start').description('Start API and NATS via PM2').action(runStart);

  server.command('stop').description('Stop all omni PM2 processes').action(runStop);

  server.command('restart').description('Restart omni PM2 processes and wait for health check').action(runRestart);

  server
    .command('logs [service]')
    .description('Stream PM2 logs (service: api, nats — default: api)')
    .option('--lines <n>', 'Number of lines to show', (v) => Number.parseInt(v, 10), 50)
    .option('--follow', 'Stream live logs (default: false)', false)
    .action(runLogs);

  server.command('status').description('Show PM2 status table for omni-* services').action(runStatus);

  return server;
}
