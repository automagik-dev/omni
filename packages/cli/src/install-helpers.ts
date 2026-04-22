/**
 * Install Helpers
 *
 * Extracted from commands/install.ts to keep the main command a thin wiring
 * layer. Each helper is independently testable.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getConfigPath, loadConfig } from './config.js';
import { NATS_BINARY_PATH } from './nats-install.js';
import * as output from './output.js';
import { PM2_PROCESSES, capturePm2, runPm2 } from './pm2.js';

const DEFAULT_DATA_DIR = join(homedir(), '.omni', 'data');

// ----------------------------------------------------------------------------
// Reinstall detection
// ----------------------------------------------------------------------------

export interface ReinstallSignals {
  isReinstall: boolean;
  hasConfig: boolean;
  hasPm2Process: boolean;
  hasDataDir: boolean;
}

/**
 * Any single signal flags reinstall mode. We err toward reinstall because
 * reinstall mode is strictly safer (preserves data, skips prompts).
 */
export async function detectReinstall(dataDirOverride?: string): Promise<ReinstallSignals> {
  const hasConfig = detectHasConfig();
  const hasPm2Process = await detectHasPm2Process();
  const hasDataDir = detectHasDataDir(dataDirOverride);
  return {
    isReinstall: hasConfig || hasPm2Process || hasDataDir,
    hasConfig,
    hasPm2Process,
    hasDataDir,
  };
}

function detectHasConfig(): boolean {
  if (!existsSync(getConfigPath())) return false;
  try {
    const parsed = loadConfig();
    return parsed.apiKey !== undefined || parsed.server !== undefined;
  } catch {
    return false;
  }
}

async function detectHasPm2Process(): Promise<boolean> {
  try {
    const { code, stdout } = await capturePm2('jlist');
    if (code !== 0 || !stdout.trim()) return false;
    const processes = JSON.parse(stdout) as Array<{ name?: string }>;
    return processes.some((p) => p.name === PM2_PROCESSES.api || p.name === PM2_PROCESSES.nats);
  } catch {
    return false;
  }
}

function detectHasDataDir(dataDirOverride?: string): boolean {
  const dataDir = dataDirOverride ?? DEFAULT_DATA_DIR;
  if (!existsSync(dataDir)) return false;
  try {
    return readdirSync(dataDir).filter((e) => e !== '.DS_Store').length > 0;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// pm2-logrotate installation
// ----------------------------------------------------------------------------

/** pm2-logrotate settings we enforce. */
export const PM2_LOGROTATE_SETTINGS = {
  max_size: '10M',
  retain: '5',
  compress: 'true',
  rotateInterval: '0 0 * * *',
} as const;

/**
 * Install and configure pm2-logrotate. Best-effort: WARN on failure but never
 * throw. Idempotent — skips re-install if the module is already configured.
 */
export async function installPm2Logrotate(): Promise<void> {
  try {
    const current = await capturePm2('conf');
    if (current.code === 0 && logrotateAlreadyConfigured(current.stdout)) return;

    if ((await runPm2(['install', 'pm2-logrotate'])) !== 0) {
      output.warn('pm2-logrotate install failed — logs will not auto-rotate');
      return;
    }

    for (const [key, value] of Object.entries(PM2_LOGROTATE_SETTINGS)) {
      const code = await runPm2(['set', `pm2-logrotate:${key}`, value]);
      if (code !== 0) output.warn(`pm2-logrotate:${key} set failed — logs may not rotate as configured`);
    }
  } catch (err) {
    output.warn(`pm2-logrotate configuration skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function logrotateAlreadyConfigured(confOutput: string): boolean {
  if (!confOutput.includes('pm2-logrotate')) return false;
  for (const [key, value] of Object.entries(PM2_LOGROTATE_SETTINGS)) {
    const pattern = new RegExp(`${key}\\s+${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (!pattern.test(confOutput)) return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// systemd unit writer (retained, no longer prompted for)
// ----------------------------------------------------------------------------

/** Write systemd unit files for omni-api and omni-nats under `/etc/systemd/system/`. */
export function writeSystemdUnit(dataDir: string): void {
  const apiUnit = `[Unit]
Description=Omni API Server
After=network.target omni-nats.service
Wants=omni-nats.service

[Service]
Type=forking
ExecStart=/usr/bin/env omni start
ExecStop=/usr/bin/env omni stop
ExecReload=/usr/bin/env omni restart
Restart=on-failure
PIDFile=${homedir()}/.pm2/pm2.pid

[Install]
WantedBy=multi-user.target
`;
  const natsUnit = `[Unit]
Description=Omni NATS Server
After=network.target

[Service]
Type=simple
ExecStart="${NATS_BINARY_PATH}" -js -sd "${join(dataDir, 'nats')}"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  try {
    writeFileSync('/etc/systemd/system/omni-nats.service', natsUnit, { mode: 0o644 });
    writeFileSync('/etc/systemd/system/omni-api.service', apiUnit, { mode: 0o644 });
    output.success('Systemd units written to /etc/systemd/system/');
    output.raw('\n  Enable with: sudo systemctl enable --now omni-nats omni-api\n');
  } catch {
    output.warn('Could not write systemd units — run with sudo or write them manually');
  }
}
