/**
 * Status Command
 *
 * omni status - Show API health and connection info
 */

import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getOptionalClient } from '../client.js';
import { getConfigDir, hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';
import { capturePm2, isPm2Available } from '../pm2.js';
import { CLI_VERSION_HEADER, SERVER_VERSION_HEADER, VERSION, formatStatusVersionHint } from '../version.js';

// ============================================================================
// PM2 PROCESS TYPES & HELPERS
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

interface ProcessRow {
  service: string;
  pid: string;
  status: string;
  uptime: string;
  cpu: string;
  memory: string;
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

/** Query PM2 for omni-* processes. Returns null if PM2 is not available. */
async function getProcessStatus(): Promise<ProcessRow[] | null> {
  if (!(await isPm2Available())) {
    return null;
  }

  const { code, stdout } = await capturePm2('jlist');
  if (code !== 0) {
    return null;
  }

  let processes: Pm2ProcessInfo[] = [];
  try {
    processes = JSON.parse(stdout) as Pm2ProcessInfo[];
  } catch {
    return null;
  }

  const omniProcesses = processes.filter((p) => typeof p.name === 'string' && p.name.startsWith('omni-'));

  return omniProcesses.map((p) => ({
    service: p.name ?? '-',
    pid: p.pid !== undefined ? String(p.pid) : '-',
    status: p.pm2_env?.status ?? '-',
    uptime: formatUptime(p.pm2_env?.pm_uptime),
    cpu: p.monit?.cpu !== undefined ? `${p.monit.cpu}%` : '-',
    memory: formatMemory(p.monit?.memory),
  }));
}

// ============================================================================
// HEALTH & AUTH HELPERS
// ============================================================================

/** Check API health and add to status info */
async function checkApiHealth(statusInfo: Record<string, unknown>, apiUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/v2/health`, {
      headers: {
        'Accept-Encoding': 'identity',
        [CLI_VERSION_HEADER]: VERSION,
      },
    });

    const health = (await response.json()) as {
      status?: string;
      version?: string;
      checks?: Record<string, unknown>;
    };

    statusInfo.apiStatus = health.status ?? 'unknown';
    statusInfo.apiVersion = health.version;
    if (health.checks) {
      statusInfo.checks = health.checks;
    }

    return response.headers.get(SERVER_VERSION_HEADER);
  } catch (err) {
    statusInfo.apiStatus = 'unreachable';
    statusInfo.apiError = err instanceof Error ? err.message : 'Unknown error';
    return null;
  }
}

/** Validate auth key and add to status info */
async function validateAuthKey(statusInfo: Record<string, unknown>, client: OmniClient): Promise<void> {
  try {
    const auth = await client.auth.validate();
    statusInfo.keyValid = auth.valid;
    statusInfo.keyName = auth.keyName;
    statusInfo.keyPrefix = auth.keyPrefix;
    statusInfo.scopes = auth.scopes;
  } catch {
    statusInfo.keyValid = false;
  }
}

/** Collect all status info: config, health, auth, processes */
async function collectStatusInfo(): Promise<{
  statusInfo: Record<string, unknown>;
  serverVersion: string | null;
  processes: ProcessRow[] | null;
}> {
  const config = loadConfig();
  const isAuthenticated = hasAuth();
  const apiUrl = config.apiUrl ?? 'http://localhost:8882';

  const statusInfo: Record<string, unknown> = {
    configDir: getConfigDir(),
    apiUrl,
    authenticated: isAuthenticated,
    defaultInstance: config.defaultInstance ?? '-',
    format: config.format ?? 'auto (TTY detection)',
  };

  const serverVersion = await checkApiHealth(statusInfo, apiUrl);

  if (isAuthenticated) {
    const client = getOptionalClient();
    if (client) {
      await validateAuthKey(statusInfo, client);
    }
  }

  const processes = await getProcessStatus();
  if (processes !== null) {
    statusInfo.processes = processes;
  }

  return { statusInfo, serverVersion, processes };
}

/** Render human-mode extras (version hint, process table) */
function renderHumanExtras(serverVersion: string | null, processes: ProcessRow[] | null): void {
  if (serverVersion) {
    output.raw(formatStatusVersionHint(VERSION, serverVersion));
  }
  if (processes !== null && processes.length > 0) {
    output.header('Services');
    output.list(processes);
  } else if (processes !== null) {
    output.header('Services');
    output.dim('No omni services running. Start with: omni start');
  }
}

export function createStatusCommand(): Command {
  const status = new Command('status').description('Show API health and connection info').action(async () => {
    const { statusInfo, serverVersion, processes } = await collectStatusInfo();
    output.data(statusInfo);
    if (output.getCurrentFormat() === 'human') {
      renderHumanExtras(serverVersion, processes);
    }
  });

  return status;
}
