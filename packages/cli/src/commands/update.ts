/**
 * Update Command
 *
 * omni update [--dev] [--force]
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import * as output from '../output.js';

interface UpdateOptions {
  dev?: boolean;
  force?: boolean;
}

const INSTALL_DIR = join(process.env.HOME ?? '', '.omni');
const BIN_PATH = join(INSTALL_DIR, 'bin', 'omni');
const BACKUP_PATH = join(INSTALL_DIR, 'bin', 'omni.bak');

/** Read installed omni binary version from ~/.omni/bin/omni */
async function getInstalledVersion(): Promise<string | null> {
  if (!existsSync(BIN_PATH)) {
    return null;
  }

  const proc = Bun.spawn({
    cmd: [BIN_PATH, '--version'],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const version = stdout.trim();
  return version.length > 0 ? version : null;
}

/** Backup current binary before running installer */
function backupCurrentBinary(): boolean {
  if (!existsSync(BIN_PATH)) {
    return false;
  }

  mkdirSync(dirname(BACKUP_PATH), { recursive: true });
  copyFileSync(BIN_PATH, BACKUP_PATH);
  return true;
}

/** Download installer script from GitHub raw */
async function fetchInstallerScript(branch: 'main' | 'dev'): Promise<string> {
  const url = `https://raw.githubusercontent.com/automagik-dev/omni/${branch}/install-client.sh`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch installer script (${response.status})`);
  }

  const script = await response.text();
  if (!script.includes('Omni v2') || !script.includes('install-client.sh')) {
    throw new Error('Fetched installer script looks invalid');
  }

  return script;
}

/** Execute installer via bash */
async function runInstaller(scriptContent: string, args: string[]): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'omni-update-'));
  const scriptPath = join(tempDir, 'install-client.sh');

  try {
    writeFileSync(scriptPath, scriptContent, 'utf-8');
    chmodSync(scriptPath, 0o700);

    const proc = Bun.spawn({
      cmd: ['bash', scriptPath, ...args],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: process.env,
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Installer failed with exit code ${exitCode}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runUpdate(options: UpdateOptions): Promise<void> {
  const { loadConfig, saveConfig } = await import('../config.js');
  const config = loadConfig();
  const branch: 'main' | 'dev' = options.dev ? 'dev' : (config.updateChannel ?? 'main');
  const installerArgs: string[] = [];
  if (branch === 'dev') installerArgs.push('--dev');
  if (options.force) installerArgs.push('--force');

  // Persist chosen track
  if (config.updateChannel !== branch) {
    saveConfig({ ...config, updateChannel: branch });
  }

  const currentVersion = await getInstalledVersion();
  output.info(`Current version: ${currentVersion ?? 'not installed'}`);

  const backupCreated = backupCurrentBinary();
  output.info(backupCreated ? `Backup created: ${BACKUP_PATH}` : 'No existing binary to back up');

  output.info(`Updating from ${branch}...`);

  try {
    const script = await fetchInstallerScript(branch);
    await runInstaller(script, installerArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Update failed: ${message}`, {
      recovery: backupCreated ? `cp ${BACKUP_PATH} ${BIN_PATH}` : null,
    });
    return;
  }

  const newVersion = await getInstalledVersion();
  output.success('Update complete', { previousVersion: currentVersion, newVersion, branch });
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update Omni CLI using the official installer')
    .option('--dev', 'Update from dev branch')
    .option('--force', 'Force overwrite existing installation')
    .action(runUpdate);
}
