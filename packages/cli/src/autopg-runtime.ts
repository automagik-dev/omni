/**
 * autopg runtime of a sandbox, from autopg's signed GitHub release
 *
 * autopg 3.x is not on npm: it ships per-platform release tarballs, signed by its release
 * workflow (cosign keyless). Omni pins one release by the sha256 of each tarball
 * (autopg-pin.json); CI checks every pinned tarball's signature against autopg's exact
 * identity whenever the pin changes (scripts/ci/verify-autopg-pin.sh). An install checks the
 * sha256 and refuses anything else: on a pinned platform there is no fallback to npm.
 *
 * The tarball carries Postgres as well. It is seeded into autopg's binary cache
 * (`<AUTOPG_CONFIG_DIR>/bin/<platformKey>` with its `.version`), which autopg reads first:
 * without it, autopg downloads Postgres from the npm registry on its first start, unverified.
 *
 * Platforms the release has no build for get no target, and keep npm pgserve.
 */

import { createHash } from 'node:crypto';
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import pin from './autopg-pin.json';

type AutopgPlatform = 'darwin-arm64' | 'linux-arm64' | 'linux-x64-glibc';

export interface AutopgPin {
  version: string;
  /** autopg's PINNED_PG_VERSION at that release: the `.version` it expects in its binary cache. */
  pgRuntime: string;
  platforms: Partial<Record<AutopgPlatform, { sha256: string; size: number }>>;
}

/** The release this Omni runs its sandbox's Postgres from. */
export const AUTOPG_PIN: AutopgPin = pin;

/** autopg's binary-cache key for each release platform (getPlatformKey in its src/postgres.js). */
const CACHE_KEYS: Record<AutopgPlatform, string> = {
  'darwin-arm64': 'darwin-arm64',
  'linux-arm64': 'linux-arm64',
  'linux-x64-glibc': 'linux-x64',
};

const RELEASES = 'https://github.com/automagik-dev/autopg/releases/download';
const SHA256_MARKER = '.sha256';
const DOWNLOAD_TIMEOUT_MS = 300_000;

export interface AutopgHost {
  platform: string;
  arch: string;
  libc: 'glibc' | 'musl' | null;
}

export interface AutopgTarget {
  version: string;
  pgRuntime: string;
  platform: AutopgPlatform;
  cacheKey: string;
  sha256: string;
  size: number;
  url: string;
}

function releasePlatform(host: AutopgHost): AutopgPlatform | null {
  if (host.platform === 'darwin') return host.arch === 'arm64' ? 'darwin-arm64' : null;
  // autopg builds Linux against glibc only.
  if (host.platform !== 'linux' || host.libc !== 'glibc') return null;
  if (host.arch === 'arm64') return 'linux-arm64';
  return host.arch === 'x64' ? 'linux-x64-glibc' : null;
}

/**
 * The pinned tarball for this host, or null where autopg ships no build (npm pgserve then). A
 * platform autopg ships but the pin leaves out is refused: it never falls back to npm pgserve.
 */
export function autopgTarget(pinned: AutopgPin, host: AutopgHost): AutopgTarget | null {
  const platform = releasePlatform(host);
  if (!platform) return null;
  const asset = pinned.platforms[platform];
  if (!asset) throw new Error(`The autopg ${pinned.version} pin has no ${platform} entry; refusing to run without it`);
  return {
    version: pinned.version,
    pgRuntime: pinned.pgRuntime,
    platform,
    cacheKey: CACHE_KEYS[platform],
    sha256: asset.sha256,
    size: asset.size,
    url: `${RELEASES}/v${pinned.version}/autopg-${pinned.version}-${platform}.tar.gz`,
  };
}

/** The C library of a Linux host: musl where its loader is, else glibc. Null off Linux. */
export function detectLibc(
  platform: string = process.platform,
  arch: string = process.arch,
  exists: (path: string) => boolean = existsSync,
): 'glibc' | 'musl' | null {
  if (platform !== 'linux') return null;
  return exists(`/lib/ld-musl-${arch === 'arm64' ? 'aarch64' : 'x86_64'}.so.1`) ? 'musl' : 'glibc';
}

/** Where a sandbox keeps the autopg runtime: its releases, and autopg's config dir. */
export interface AutopgPaths {
  /** `<home>/autopg`: one unpacked release per version. */
  dir: string;
  /** AUTOPG_CONFIG_DIR of the sandbox's processes, which holds autopg's binary cache. */
  configDir: string;
}

export const autopgBinary = (dir: string, version: string): string => join(dir, version, 'autopg');

const seedDir = (paths: AutopgPaths, target: AutopgTarget): string => join(paths.configDir, 'bin', target.cacheKey);

function readTrimmed(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return null;
  }
}

/** True when the pinned release is unpacked and autopg's binary cache holds its Postgres. */
export function autopgRuntimeReady(paths: AutopgPaths, target: AutopgTarget): boolean {
  const release = join(paths.dir, target.version);
  const seed = seedDir(paths, target);
  return (
    readTrimmed(join(release, SHA256_MARKER)) === target.sha256 &&
    existsSync(autopgBinary(paths.dir, target.version)) &&
    readTrimmed(join(seed, '.version')) === target.pgRuntime &&
    existsSync(join(seed, 'bin', 'initdb')) &&
    existsSync(join(seed, 'bin', 'postgres'))
  );
}

export async function downloadRelease(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Download of ${url} failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function extract(tarball: string, into: string): Promise<void> {
  const tar = Bun.spawn({ cmd: ['tar', '-xzf', tarball, '-C', into], stdout: 'ignore', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()]);
  if (code !== 0) throw new Error(`Could not unpack ${tarball}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
}

/** Moves the release's Postgres into autopg's binary cache, with the `.version` autopg checks. */
function seedBinaryCache(unpacked: string, paths: AutopgPaths, target: AutopgTarget): void {
  const seed = seedDir(paths, target);
  rmSync(seed, { recursive: true, force: true });
  mkdirSync(seed, { recursive: true, mode: 0o700 });
  for (const part of ['bin', 'lib', 'share']) {
    const from = join(unpacked, 'postgres', part);
    if (existsSync(from)) renameSync(from, join(seed, part));
  }
  writeFileSync(join(seed, '.version'), `${target.pgRuntime}\n`);
}

/**
 * Installs the pinned release (from `tarball` when given, else downloaded) unless it is in place,
 * and returns autopg's binary. A tarball whose sha256 is not the pin is refused before anything is
 * written.
 */
export async function installAutopgRuntime(
  paths: AutopgPaths,
  target: AutopgTarget,
  source: { tarball?: string; download(url: string): Promise<Uint8Array> },
): Promise<string> {
  const binary = autopgBinary(paths.dir, target.version);
  if (autopgRuntimeReady(paths, target)) return binary;
  const bytes = source.tarball ? new Uint8Array(readFileSync(source.tarball)) : await source.download(target.url);
  if (bytes.length !== target.size) {
    throw new Error(
      `autopg ${target.version} for ${target.platform}: size ${bytes.length} is not the pinned ${target.size}; refusing it`,
    );
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== target.sha256) {
    throw new Error(
      `autopg ${target.version} for ${target.platform}: sha256 ${actual} is not the pinned ${target.sha256}; refusing it`,
    );
  }
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(paths.dir, '.staging-'));
  try {
    const tarball = join(staging, 'autopg.tar.gz');
    writeFileSync(tarball, bytes, { mode: 0o600 });
    await extract(tarball, staging);
    const unpacked = join(staging, 'autopg');
    for (const file of ['autopg', 'postgres/bin/postgres', 'postgres/bin/initdb']) {
      if (!existsSync(join(unpacked, file))) throw new Error(`autopg ${target.version} tarball has no ${file}`);
    }
    seedBinaryCache(unpacked, paths, target);
    const release = join(paths.dir, target.version);
    rmSync(release, { recursive: true, force: true });
    renameSync(unpacked, release);
    writeFileSync(join(release, SHA256_MARKER), `${target.sha256}\n`, { mode: 0o600 });
    // Releases of an earlier pin; nothing runs them once the sandbox restarts on this one.
    for (const entry of readdirSync(paths.dir)) {
      if (entry !== target.version && !entry.startsWith('.')) rmSync(join(paths.dir, entry), { recursive: true });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return binary;
}

/** The first line autopg writes to pg_hba.conf at every start of a password-file cluster. */
const PASSWORD_FILE_HBA_HEADER = '# Written by pgserve at every start (--password-file).';

/**
 * True when autopg has started the cluster in `dataDir` with a password file: its pg_hba.conf
 * starts with the line autopg writes then. A cluster made without one cannot take one later.
 */
export function clusterRanWithPasswordFile(dataDir: string): boolean {
  return readTrimmed(join(dataDir, 'pg_hba.conf'))?.startsWith(`${PASSWORD_FILE_HBA_HEADER}\n`) === true;
}

/** An embedding app writes 32 random bytes as URL-safe text; anything this short is a mistake. */
const MIN_PASSWORD_LENGTH = 16;

/**
 * The superuser password of a password-file cluster, read the way autopg reads `--password-file`
 * (its src/lib/postmaster-password.js), so Omni never logs in with a password autopg would refuse.
 * Errors name the file and the reason, never its content.
 */
export function readPgPasswordFile(path: string, uid: number | undefined = process.getuid?.()): string {
  const refuse = (reason: string) => new Error(`password file ${path}: ${reason}`);
  if (!isAbsolute(path)) throw refuse('the path must be absolute');
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw refuse(code === 'ELOOP' ? 'it is a symlink' : `cannot read it (${code ?? String(error)})`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw refuse('it is not a regular file');
    if (uid !== undefined && stat.uid !== uid) throw refuse('it is not owned by this user');
    if ((stat.mode & 0o077) !== 0) {
      throw refuse(`its mode is ${(stat.mode & 0o777).toString(8).padStart(4, '0')}; it must be 0600 or stricter`);
    }
    const password = readFileSync(fd, 'utf-8').replace(/\r?\n$/, '');
    if (/[\r\n]/.test(password)) throw refuse('it must hold one line');
    if (password.length < MIN_PASSWORD_LENGTH) throw refuse(`it must hold at least ${MIN_PASSWORD_LENGTH} characters`);
    return password;
  } finally {
    closeSync(fd);
  }
}
