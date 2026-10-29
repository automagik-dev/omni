/**
 * NATS Installer
 *
 * Downloads and installs the NATS server binary to `~/.omni/nats-server`.
 * Extracted from install.ts so the install command stays focused on wiring,
 * not platform-specific download logic.
 *
 * The release is pinned (nats-pin.json) by the size and sha256 of each
 * platform's archive. The archive is checked in memory and refused unless both
 * match, before anything is written or unpacked; a platform the pin has no
 * checksum for gets no download. nats publishes no signature, only SHA256SUMS
 * next to the archives, so the pin is the check.
 */

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import ora from 'ora';
import natsPin from './nats-pin.json';
import * as output from './output.js';

const OMNI_DIR = join(homedir(), '.omni');
export const NATS_BINARY_PATH = join(OMNI_DIR, 'nats-server');

/** A nats-server release and, per `<os>-<arch>`, its archive's size and sha256. */
interface NatsPin {
  version: string;
  platforms: Partial<Record<string, { sha256: string; size: number }>>;
}

const NATS_PIN: NatsPin = natsPin;

function platformInfo(): { os: string; arch: string } | null {
  const platform = process.platform;
  const arch = process.arch;
  const os = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : null;
  if (!os) return null;
  const natsArch = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!natsArch) return null;
  return { os, arch: natsArch };
}

/** Why `bytes` is not the pinned archive, or null when its size and sha256 both match. */
function archiveMismatch(bytes: Uint8Array, pinned: { sha256: string; size: number }): string | null {
  if (bytes.length !== pinned.size) return `size ${bytes.length} is not the pinned ${pinned.size}`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return sha256 === pinned.sha256 ? null : `sha256 ${sha256} is not the pinned ${pinned.sha256}`;
}

/** Download the NATS binary to `target` (default `~/.omni/nats-server`). Returns true on success. */
async function downloadNats(target: string = NATS_BINARY_PATH, pin: NatsPin = NATS_PIN): Promise<boolean> {
  const info = platformInfo();
  if (!info) {
    output.warn('Unsupported platform for automatic NATS download — install manually');
    return false;
  }
  const version = `v${pin.version}`;
  const platform = `${info.os}-${info.arch}`;
  const pinned = pin.platforms[platform];
  if (!pinned) {
    output.warn(`NATS ${version} has no pinned checksum for ${platform}, so it is not downloaded — install manually`);
    return false;
  }

  const fileName = `nats-server-${version}-${platform}.tar.gz`;
  const url = `https://github.com/nats-io/nats-server/releases/download/${version}/${fileName}`;
  const spinner = ora(`Downloading NATS ${version} for ${info.os}/${info.arch}...`).start();
  const workDir = dirname(target);
  const tarPath = join(workDir, fileName);
  const tmpDir = join(workDir, 'nats-tmp');

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) {
      spinner.fail(`NATS download failed: HTTP ${resp.status}`);
      return false;
    }

    // Checked before anything is written: other bytes never reach the disk.
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const mismatch = archiveMismatch(bytes, pinned);
    if (mismatch) {
      spinner.fail(`NATS ${version} for ${platform}: ${mismatch}; refusing it`);
      return false;
    }

    mkdirSync(workDir, { recursive: true, mode: 0o700 });
    writeFileSync(tarPath, bytes);

    spinner.text = 'Extracting NATS binary...';
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

    await Bun.spawn({ cmd: ['mv', binPath, target] }).exited;
    chmodSync(target, 0o755);

    spinner.succeed(`NATS ${version} installed to ${target}`);
    return true;
  } catch (err) {
    spinner.fail(`NATS download error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    rmSync(tarPath, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
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

/** Download nats-server to `target` (a sandbox's own bin dir). No-op if it is already there. */
export async function installNatsBinary(target: string, pin: NatsPin = NATS_PIN): Promise<boolean> {
  if (existsSync(target)) return true;
  return downloadNats(target, pin);
}
