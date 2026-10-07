/**
 * Install Helpers
 *
 * Extracted from commands/install.ts to keep the main command a thin wiring
 * layer. Each helper is independently testable.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ServerConfig, getConfigPath, loadConfig } from './config.js';
import { NATS_BINARY_PATH } from './nats-install.js';
import { buildNatsServerArgs, resolveNatsHost } from './nats-server-args.js';
import * as output from './output.js';
import { PM2_PROCESSES, buildPm2StartArgs, capturePm2, runPm2 } from './pm2.js';

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
// Managed NATS bind address
// ----------------------------------------------------------------------------

/**
 * Bind address for the managed nats-server, exiting with an actionable CLI
 * error when the stored `server.natsHost` is invalid. Shared by `omni start`
 * and `omni install` so both fail the same way before launching anything.
 */
export function resolveManagedNatsHost(serverConfig: Pick<ServerConfig, 'natsHost'>): string {
  try {
    return resolveNatsHost(serverConfig);
  } catch (err) {
    return output.error(err instanceof Error ? err.message : String(err));
  }
}

/** pm2 runners: `runPm2` streams output to the terminal, `quietPm2` captures it. */
export type ManagedNatsPm2 = {
  runPm2: (args: string[]) => Promise<number>;
  quietPm2: (args: string[]) => Promise<number>;
};

async function quietPm2(args: string[]): Promise<number> {
  return (await capturePm2(...args)).code;
}

/**
 * (Re)create the PM2 `omni-nats` process so it runs with the current bind
 * address. `pm2 start` on an existing name, and `pm2 restart`, reuse the
 * arguments recorded when the process was created — so an install made before
 * `server.natsHost` existed would keep its old listener. Deleting first makes
 * every caller (start, install, update) apply `-a <host>`. Returns pm2's exit
 * code for the start.
 */
export async function startManagedNats(
  opts: { dataDir: string; host: string; binaryPath?: string },
  deps: ManagedNatsPm2 = { runPm2, quietPm2 },
): Promise<number> {
  const natsDataDir = join(opts.dataDir, 'nats');
  mkdirSync(natsDataDir, { recursive: true });
  // Quiet: on a fresh host there is nothing to delete and pm2 prints an error.
  await deps.quietPm2(['delete', PM2_PROCESSES.nats]);
  return deps.runPm2(
    buildPm2StartArgs({
      kind: 'nats',
      script: opts.binaryPath ?? NATS_BINARY_PATH,
      name: PM2_PROCESSES.nats,
      scriptArgs: buildNatsServerArgs({ natsDataDir, host: opts.host }),
    }),
  );
}

/**
 * `omni update` path: recreate omni-nats with the current bind address instead
 * of `pm2 restart`, which would keep the arguments of an older install. Returns
 * null when it cannot recreate (no managed binary, or an invalid stored
 * `server.natsHost`) so the caller falls back to a plain restart.
 */
export async function recreateManagedNatsForUpdate(
  serverConfig: Pick<ServerConfig, 'dataDir' | 'natsHost'>,
  deps: ManagedNatsPm2 & { binaryExists: () => boolean } = {
    // Quiet like the pm2 restart it replaces — output would break update's spinner.
    runPm2: quietPm2,
    quietPm2,
    binaryExists: () => existsSync(NATS_BINARY_PATH),
  },
): Promise<number | null> {
  if (!deps.binaryExists()) return null;
  let host: string;
  try {
    host = resolveNatsHost(serverConfig);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    output.warn(`${reason}\n  Restarting ${PM2_PROCESSES.nats} with its previous arguments.`);
    return null;
  }
  return startManagedNats({ dataDir: serverConfig.dataDir, host }, deps);
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

/**
 * Quote one `ExecStart=` argument for systemd: wrap in double quotes, escape
 * `\\` and `"`, and double `%` (unit specifiers) and `$` (environment
 * expansion) so the value reaches the process verbatim.
 */
function quoteSystemdArg(arg: string): string {
  if (/[\r\n]/.test(arg))
    throw new Error(`systemd ExecStart argument must not contain a newline: ${JSON.stringify(arg)}`);
  const escaped = arg
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/%/g, '%%')
    .replace(/\$/g, () => '$$');
  return `"${escaped}"`;
}

/**
 * Content of the `omni-nats.service` unit: the managed nats-server with the
 * same arguments as the PM2 paths (`-js -sd <dataDir>/nats -a <natsHost>`),
 * every argument quoted.
 */
export function buildSystemdNatsUnit(dataDir: string, natsHost: string): string {
  const execStart = [NATS_BINARY_PATH, ...buildNatsServerArgs({ natsDataDir: join(dataDir, 'nats'), host: natsHost })]
    .map(quoteSystemdArg)
    .join(' ');
  return `[Unit]
Description=Omni NATS Server
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

/** Write systemd unit files for omni-api and omni-nats under `/etc/systemd/system/`. */
export function writeSystemdUnit(dataDir: string, natsHost: string): void {
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
  const natsUnit = buildSystemdNatsUnit(dataDir, natsHost);
  try {
    writeFileSync('/etc/systemd/system/omni-nats.service', natsUnit, { mode: 0o644 });
    writeFileSync('/etc/systemd/system/omni-api.service', apiUnit, { mode: 0o644 });
    output.success('Systemd units written to /etc/systemd/system/');
    output.raw('\n  Enable with: sudo systemctl enable --now omni-nats omni-api\n');
  } catch {
    output.warn('Could not write systemd units — run with sudo or write them manually');
  }
}
