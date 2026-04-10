/**
 * NATS Installer
 *
 * Downloads and installs the NATS server binary to `~/.omni/nats-server`.
 * Extracted from install.ts so the install command stays focused on wiring,
 * not platform-specific download logic.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import ora from 'ora';
import * as output from './output.js';

const OMNI_DIR = join(homedir(), '.omni');
export const NATS_BINARY_PATH = join(OMNI_DIR, 'nats-server');
const NATS_VERSION = 'v2.12.4';

function platformInfo(): { os: string; arch: string } | null {
  const platform = process.platform;
  const arch = process.arch;
  const os = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : null;
  if (!os) return null;
  const natsArch = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!natsArch) return null;
  return { os, arch: natsArch };
}

/** Download and install NATS binary. Returns true on success. */
async function downloadNats(): Promise<boolean> {
  const info = platformInfo();
  if (!info) {
    output.warn('Unsupported platform for automatic NATS download — install manually');
    return false;
  }

  const fileName = `nats-server-${NATS_VERSION}-${info.os}-${info.arch}.tar.gz`;
  const url = `https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/${fileName}`;
  const spinner = ora(`Downloading NATS ${NATS_VERSION} for ${info.os}/${info.arch}...`).start();

  try {
    mkdirSync(OMNI_DIR, { recursive: true, mode: 0o700 });

    const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) {
      spinner.fail(`NATS download failed: HTTP ${resp.status}`);
      return false;
    }

    const tarPath = join(OMNI_DIR, fileName);
    writeFileSync(tarPath, Buffer.from(await resp.arrayBuffer()));

    spinner.text = 'Extracting NATS binary...';
    const tmpDir = join(OMNI_DIR, 'nats-tmp');
    mkdirSync(tmpDir, { recursive: true });

    const tar = Bun.spawn({ cmd: ['tar', '-xzf', tarPath, '-C', tmpDir], stdout: 'pipe', stderr: 'pipe' });
    const [tarCode, tarErr] = await Promise.all([tar.exited, new Response(tar.stderr).text()]);
    if (tarCode !== 0) {
      spinner.fail(`Failed to extract NATS archive${tarErr.trim() ? `: ${tarErr.trim()}` : ''}`);
      return false;
    }

    const find = Bun.spawn({ cmd: ['find', tmpDir, '-name', 'nats-server', '-type', 'f'], stdout: 'pipe' });
    const binPath = (await new Response(find.stdout).text()).trim();
    await find.exited;
    if (!binPath) {
      spinner.fail('Could not find nats-server binary in archive');
      return false;
    }

    await Bun.spawn({ cmd: ['mv', binPath, NATS_BINARY_PATH] }).exited;
    chmodSync(NATS_BINARY_PATH, 0o755);
    await Bun.spawn({ cmd: ['rm', '-rf', tarPath, tmpDir] }).exited;

    spinner.succeed(`NATS ${NATS_VERSION} installed to ${NATS_BINARY_PATH}`);
    return true;
  } catch (err) {
    spinner.fail(`NATS download error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Ensure NATS is installed. No-op if the binary already exists. */
export async function ensureNats(): Promise<void> {
  if (existsSync(NATS_BINARY_PATH)) {
    output.raw(`  ✓ NATS binary found at ${NATS_BINARY_PATH}`);
    return;
  }
  output.raw('  NATS binary not found — downloading...');
  await downloadNats();
}
