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
 *
 * A verified install leaves `<target>.pin` (the version and the archive's
 * sha256) beside the binary. A binary already in place counts as installed only
 * when that marker is the pin; any other is replaced through the same checks.
 * The new binary is renamed over the old one, so a running nats-server keeps its
 * file, and a refused upgrade leaves the old binary and marker as they were.
 */

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** What installing nats-server at a target did. */
export type NatsInstall = 'installed' | 'kept' | 'failed';

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

/** The marker a verified install of `sha256` leaves at `<target>.pin`. */
const pinMarker = (pin: NatsPin, sha256: string) => `${pin.version} ${sha256}\n`;

/**
 * Whether the binary at `target` is the pinned release, by its marker. On a platform the pin has
 * no checksum for, nothing can be downloaded, so a binary installed by hand is kept.
 */
function natsBinaryPinned(target: string, pin: NatsPin): boolean {
  if (!existsSync(target)) return false;
  const info = platformInfo();
  const pinned = info ? pin.platforms[`${info.os}-${info.arch}`] : undefined;
  if (!pinned) return true;
  try {
    return readFileSync(`${target}.pin`, 'utf-8') === pinMarker(pin, pinned.sha256);
  } catch {
    return false;
  }
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

    // The binary first, then its marker: a crash in between leaves no pinned marker, so the next
    // run installs again.
    chmodSync(binPath, 0o755);
    renameSync(binPath, target);
    const marker = join(tmpDir, 'nats-server.pin');
    writeFileSync(marker, pinMarker(pin, pinned.sha256));
    renameSync(marker, `${target}.pin`);

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

/** Ensure the pinned NATS is installed at `~/.omni/nats-server`, replacing one that is not the pin. */
export async function ensureNats(): Promise<void> {
  if (natsBinaryPinned(NATS_BINARY_PATH, NATS_PIN)) {
    output.raw(`  ✓ NATS binary found at ${NATS_BINARY_PATH}`);
    return;
  }
  const found = existsSync(NATS_BINARY_PATH);
  output.raw(
    found
      ? `  NATS binary at ${NATS_BINARY_PATH} is not the pinned v${NATS_PIN.version} — replacing it...`
      : '  NATS binary not found — downloading...',
  );
  if (!(await downloadNats()) && found) output.warn(`Kept the NATS binary already at ${NATS_BINARY_PATH}`);
}

/** Install the pinned nats-server at `target` (a sandbox's own bin dir), unless it is already there. */
export async function installNatsBinary(target: string, pin: NatsPin = NATS_PIN): Promise<NatsInstall> {
  if (natsBinaryPinned(target, pin)) return 'kept';
  return (await downloadNats(target, pin)) ? 'installed' : 'failed';
}
