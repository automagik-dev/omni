/**
 * Automagik's plugin lane (automagik-dev/automagik plugin-lane/README.md): the newest Bot team and
 * welcome, published apart from Omni releases. This Omni's market (./service.ts) serves a lane's
 * plugins over the ones its release bundled, so they reach DSH without a new Omni.
 *
 * A lane is taken only when all of it checks out:
 *   - lane.json is signed (ed25519 over its exact bytes, lane.json.sig) by a key pinned here,
 *     and is Automagik's (publisher, repository);
 *   - its sequence is higher than the last lane taken's, so an old one cannot be replayed;
 *   - only `@automagik/*` plugins count, each at least the version Omni's floor names
 *     (apps/automagik.json), with its tarball on one of Automagik's releases;
 *   - every tarball has the size, sha256 and sha512 the lane says, and holds a package.json of
 *     that name and version.
 * Anything else keeps what this Omni serves now. The last lane taken is kept on disk (the signed
 * bytes, their signature and the tarballs, swapped in whole) and checked again on start, with no
 * request. A tarball this Omni served before stays served. OMNI_PLUGIN_LANE=off makes no request.
 * `engines.dsh` is listed for DSH to read: this Omni cannot know which DSH installs a plugin.
 */

import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { type EventBus, createLogger } from '@omni/core';
import { z } from 'zod';
import {
  ExactVersionSchema,
  type MarketPackage,
  MarketPackageSchema,
  PackageNameSchema,
  TarballFileSchema,
} from './manifest';

const log = createLogger('api:market:lane');

export const LANE_URL = 'https://github.com/automagik-dev/automagik/releases/download/plugin-lane/lane.json';
const REPOSITORY = 'https://github.com/automagik-dev/automagik';
const RELEASES_PATH = '/automagik-dev/automagik/releases/download/';
const KEPT_FILE = 'kept.json';
const PUBLISHER = 'automagik';
const SCOPE = '@automagik/';
/** Automagik's lane keys (plugin-lane/keys.json there), pinned: a lane signed by any other is refused. */
export const LANE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'automagik-2026-10':
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxqwLF+rCCfBNkvXWTsTs/Pj9E56w4iBF5V46rxprXJk=\n-----END PUBLIC KEY-----\n',
});

const MAX_LANE_BYTES = 256 * 1024;
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
// As the desktop app looks: a minute after start, then hourly.
const FIRST_LOOK_MS = 60_000;
const EVERY_MS = 60 * 60_000;

const LanePluginSchema = z.object({
  name: PackageNameSchema,
  version: ExactVersionSchema,
  url: z.string().url(),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(MAX_TARBALL_BYTES),
  engines: z.object({ dsh: z.string().optional() }).optional(),
});
export const LaneSchema = z.object({
  schemaVersion: z.literal(1),
  publisher: z.string(),
  keyId: z.string(),
  sequence: z.number().int().nonnegative(),
  issuedAt: z.string().datetime({ offset: true }),
  repository: z.string().url(),
  version: ExactVersionSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  base: ExactVersionSchema,
  plugins: z.array(LanePluginSchema).max(50),
});
export type Lane = z.infer<typeof LaneSchema>;

/** A lane this Omni took: its plugins as the market serves them, and their tarballs' bytes. */
export interface TakenLane {
  sequence: number;
  version: string;
  /** issuedAt, in Unix seconds: the plugins' publish time. */
  publishedAt: number;
  packages: MarketPackage[];
  tarballs: Map<string, Uint8Array<ArrayBuffer>>;
}

export interface PluginLane {
  /** The lane taken, or null while none is. */
  current(): TakenLane | null;
  /** A tarball of the lane taken, or of one taken before it in this run; null for any other file. */
  tarball(file: string): Uint8Array<ArrayBuffer> | null;
  /** Settles once the lane kept on disk, if any, is checked and served. */
  readonly loaded: Promise<void>;
  /** Looks at the lane now (one look at a time); resolves to whether a newer one was taken. */
  refresh(): Promise<boolean>;
  /** Looks a minute from now, then hourly; returns the stop. */
  start(): () => void;
}

export interface PluginLaneOptions {
  url?: string;
  keys?: Readonly<Record<string, string>>;
  /** The oldest version this Omni takes of each plugin: apps/automagik.json's. */
  floor: Readonly<Record<string, string>>;
  /** Where the last lane taken is kept; null keeps it in memory only. */
  dir: string | null;
  fetchImpl?: typeof fetch;
  eventBus?: Pick<EventBus, 'publishGeneric'> | null;
  timers?: {
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
    clearTimeout: typeof clearTimeout;
    clearInterval: typeof clearInterval;
  };
}

/** OMNI_PLUGIN_LANE: unset reads Automagik's lane, `off` reads none, a URL reads that one (a mirror). */
export function readPluginLaneUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.OMNI_PLUGIN_LANE?.trim();
  if (value === 'off') return null;
  if (!value) return LANE_URL;
  const url = z.string().url().safeParse(value);
  if (!url.success) {
    log.warn('OMNI_PLUGIN_LANE is neither "off" nor a URL; reading no lane', { value });
    return null;
  }
  return url.data;
}

/** OMNI_PLUGIN_LANE_DIR, else plugin-lane next to the update state (OMNI_UPDATE_STATE_DIR or ./data). */
export function readPluginLaneDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OMNI_PLUGIN_LANE_DIR?.trim() || join(env.OMNI_UPDATE_STATE_DIR?.trim() || './data', 'plugin-lane');
}

const sha = (algorithm: 'sha1' | 'sha256' | 'sha512', bytes: Uint8Array, encoding: 'hex' | 'base64') =>
  createHash(algorithm).update(bytes).digest(encoding);

/** The lane in `bytes`, when `signature` (base64) is a pinned key's over exactly them; else why not. */
export function verifyLane(
  bytes: Uint8Array,
  signature: string,
  keys: Readonly<Record<string, string>> = LANE_KEYS,
): { lane: Lane } | { refused: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { refused: 'lane.json is not JSON' };
  }
  const keyId = z.object({ keyId: z.string() }).safeParse(raw);
  const pem = keyId.success && Object.hasOwn(keys, keyId.data.keyId) ? keys[keyId.data.keyId] : undefined;
  if (!pem)
    return { refused: `lane.json names a key this Omni does not pin (${keyId.success ? keyId.data.keyId : 'none'})` };
  let signed = false;
  try {
    signed = verify(null, bytes, createPublicKey(pem), Buffer.from(signature.trim(), 'base64'));
  } catch {
    signed = false;
  }
  if (!signed) return { refused: 'lane.json.sig is not a valid signature of lane.json' };
  const lane = LaneSchema.safeParse(raw);
  if (!lane.success)
    return { refused: `lane.json is not a schemaVersion 1 lane (${lane.error.issues[0]?.path.join('.')})` };
  if (lane.data.publisher !== PUBLISHER || lane.data.repository.replace(/\/+$/, '') !== REPOSITORY)
    return { refused: `lane.json is ${lane.data.publisher}'s, from ${lane.data.repository}` };
  return { lane: lane.data };
}

/**
 * `package/package.json` from an npm tarball (gzip'd ustar), or null when it has none. The last
 * one wins, as npm extracts it. Only signed bytes reach here (their hashes are checked first).
 */
export function packageJsonOf(tarball: Uint8Array): unknown {
  const tar = gunzipSync(tarball, { maxOutputLength: 4 * MAX_TARBALL_BYTES });
  const field = (header: Uint8Array, start: number, length: number) =>
    new TextDecoder().decode(header.subarray(start, start + length)).replace(/\0.*$/s, '');
  let found: Uint8Array | null = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156] ?? 48);
    const body = at + 512;
    if (!Number.isFinite(size) || size < 0 || body + size > tar.length) return null;
    if (type === '0' && (prefix ? `${prefix}/${name}` : name) === 'package/package.json')
      found = tar.subarray(body, body + size);
    at = body + Math.ceil(size / 512) * 512;
  }
  return found ? JSON.parse(new TextDecoder().decode(found)) : null;
}

// The package.json fields a registry packument carries, as scripts/pack-market.ts reads them.
const RangesSchema = z.record(z.string());
const TarballPackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  repository: z
    .union([z.string(), z.object({ type: z.string().optional(), url: z.string(), directory: z.string().optional() })])
    .optional(),
  dependencies: RangesSchema.optional(),
  peerDependencies: RangesSchema.optional(),
  peerDependenciesMeta: z.record(z.object({ optional: z.boolean().optional() })).optional(),
  engines: RangesSchema.optional(),
  dsh: z.record(z.unknown()).optional(),
});

/** A lane plugin's tarball file name: the last part of its URL. */
const fileOf = (plugin: Lane['plugins'][number]) =>
  TarballFileSchema.parse(plugin.url.slice(plugin.url.lastIndexOf('/') + 1));

/** Whether `bytes` are the tarball the lane describes. */
const isTarballOf = (plugin: Lane['plugins'][number], bytes: Uint8Array) =>
  bytes.byteLength === plugin.size &&
  sha('sha256', bytes, 'hex') === plugin.sha256 &&
  `sha512-${sha('sha512', bytes, 'base64')}` === plugin.integrity;

/** A lane plugin's market entry from its tarball; throws why it is not one. */
function marketPackageOf(plugin: Lane['plugins'][number], bytes: Uint8Array<ArrayBuffer>): MarketPackage {
  if (!isTarballOf(plugin, bytes))
    throw new Error(`${plugin.name}@${plugin.version}: the tarball is not the one the lane describes`);
  const pkg = TarballPackageSchema.parse(packageJsonOf(bytes));
  if (pkg.name !== plugin.name || pkg.version !== plugin.version)
    throw new Error(`${plugin.name}@${plugin.version}: its package.json is ${pkg.name}@${pkg.version}`);
  const repository = typeof pkg.repository === 'string' ? { type: 'git', url: pkg.repository } : pkg.repository;
  return MarketPackageSchema.parse({
    ...pkg,
    repository,
    file: fileOf(plugin),
    integrity: plugin.integrity,
    shasum: sha('sha1', bytes, 'hex'),
    size: plugin.size,
  });
}

/** Whether `raw` is a file on one of Automagik's releases, exactly as written (no `..`, query or fragment). */
function onAutomagikReleases(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.href === raw &&
      url.origin === 'https://github.com' &&
      url.pathname.startsWith(RELEASES_PATH) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Bytes from `url`, at most `max`, counted as they arrive; throws on any other answer. */
async function download(fetchImpl: typeof fetch, url: string, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > max) throw new Error(`${url}: more than ${max} bytes`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
    total += part.value.byteLength;
    if (total > max) {
      await reader?.cancel();
      throw new Error(`${url}: more than ${max} bytes`);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** Writes `path` whole: a fresh temp file renamed over it, so a crash or a link there never leaves half of it. */
function writeWhole(path: string, data: Uint8Array | string): void {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, data, { flag: 'wx' });
  renameSync(temp, path);
}

/** A kept file's bytes, when it is a plain file no bigger than `max`; else null. */
function readKept(path: string, max: number): Uint8Array<ArrayBuffer> | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  return stat.isFile() && stat.size <= max ? new Uint8Array(readFileSync(path)) : null;
}

const KeptSchema = z.object({ lane: z.string(), signature: z.string() });

export function createPluginLane(options: PluginLaneOptions): PluginLane {
  const url = options.url ?? LANE_URL;
  const keys = options.keys ?? LANE_KEYS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timers = options.timers ?? { setTimeout, setInterval, clearTimeout, clearInterval };
  const { dir, floor } = options;
  let taken: TakenLane | null = null;
  let takenBytes: Uint8Array | null = null;
  // Tarballs of lanes taken earlier in this run: a lockfile written then still installs.
  const earlier = new Map<string, Uint8Array<ArrayBuffer>>();

  // The plugins of a lane this Omni serves: Automagik's own, on Automagik's releases, at or past the floor.
  const servedPlugins = (lane: Lane) =>
    lane.plugins.filter((plugin) => {
      if (!plugin.name.startsWith(SCOPE) || !onAutomagikReleases(plugin.url)) return false;
      const oldest = floor[plugin.name];
      return !oldest || Bun.semver.order(plugin.version, oldest) >= 0;
    });

  /**
   * The whole lane checked: each tarball from `cached` when its bytes are the lane's, else
   * downloaded, unless `offline` (a start, which asks nothing of the network).
   */
  async function take(
    lane: Lane,
    cached: (file: string) => Uint8Array<ArrayBuffer> | null,
    offline = false,
  ): Promise<TakenLane> {
    const packages: MarketPackage[] = [];
    const tarballs = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const plugin of servedPlugins(lane)) {
      const file = fileOf(plugin);
      const have = cached(file);
      if (!(have && isTarballOf(plugin, have)) && offline) throw new Error(`${plugin.name}: its tarball is not kept`);
      const bytes = have && isTarballOf(plugin, have) ? have : await download(fetchImpl, plugin.url, plugin.size);
      packages.push(marketPackageOf(plugin, bytes));
      tarballs.set(file, bytes);
    }
    const publishedAt = Math.floor(Date.parse(lane.issuedAt) / 1000);
    return { sequence: lane.sequence, version: lane.version, publishedAt, packages, tarballs };
  }

  // What was kept on disk is trusted no more than the network: the same checks, again.
  async function load(): Promise<void> {
    const keptPath = dir ? join(dir, KEPT_FILE) : null;
    if (!dir || !keptPath || !existsSync(keptPath)) return;
    try {
      const raw = readKept(keptPath, 2 * MAX_LANE_BYTES);
      if (!raw) throw new Error(`${KEPT_FILE} is not a plain file of a lane's size`);
      const kept = KeptSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
      const bytes = new Uint8Array(Buffer.from(kept.lane, 'base64'));
      const checked = verifyLane(bytes, kept.signature, keys);
      if ('refused' in checked) throw new Error(checked.refused);
      const fromDisk = (file: string) => readKept(join(dir, TarballFileSchema.parse(file)), MAX_TARBALL_BYTES);
      const lane = await take(checked.lane, fromDisk, true);
      if (taken && taken.sequence >= lane.sequence) return;
      taken = lane;
      takenBytes = bytes;
      log.info('Serving the kept plugin lane', { sequence: lane.sequence, version: lane.version });
    } catch (error) {
      log.warn('The kept plugin lane does not check out; serving the release', { error: String(error) });
    }
  }

  // The tarballs first, then the lane and its signature in one file swapped in whole: a crash
  // leaves the previous lane, whose tarballs are never removed, as it was.
  function keep(next: TakenLane, bytes: Uint8Array, signature: string): void {
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      for (const [file, tarball] of next.tarballs) writeWhole(join(dir, file), tarball);
      writeWhole(join(dir, KEPT_FILE), JSON.stringify({ lane: Buffer.from(bytes).toString('base64'), signature }));
    } catch (error) {
      log.warn('Could not keep the plugin lane on disk; serving it from memory', { dir, error: String(error) });
    }
  }

  // One look at a time: a slow look and the next tick must not finish out of order.
  let looking: Promise<boolean> | null = null;
  function refresh(): Promise<boolean> {
    looking ??= look().finally(() => {
      looking = null;
    });
    return looking;
  }

  async function look(): Promise<boolean> {
    let bytes: Uint8Array;
    let signature: string;
    try {
      bytes = await download(fetchImpl, url, MAX_LANE_BYTES);
      signature = new TextDecoder().decode(await download(fetchImpl, `${url}.sig`, 4096));
    } catch (error) {
      log.info('Plugin lane unreachable; serving what this Omni has', { error: String(error) });
      return false;
    }
    if (takenBytes && Buffer.from(bytes).equals(Buffer.from(takenBytes))) return false;
    const checked = verifyLane(bytes, signature, keys);
    if ('refused' in checked) {
      log.warn('Plugin lane refused', { reason: checked.refused });
      return false;
    }
    const lane = checked.lane;
    if (taken && lane.sequence <= taken.sequence) {
      log.warn('Plugin lane refused: not newer than the one served', {
        sequence: lane.sequence,
        served: taken.sequence,
      });
      return false;
    }
    let next: TakenLane;
    try {
      next = await take(lane, (file) => taken?.tarballs.get(file) ?? null);
    } catch (error) {
      log.warn('Plugin lane refused: a tarball does not check out', { sequence: lane.sequence, error: String(error) });
      return false;
    }
    // The kept lane may have been served while the tarballs downloaded.
    if (taken && taken.sequence >= next.sequence) return false;
    for (const [file, tarball] of taken?.tarballs ?? []) earlier.set(file, tarball);
    taken = next;
    takenBytes = bytes;
    keep(next, bytes, signature);
    log.info('Plugin lane taken', { sequence: next.sequence, version: next.version, plugins: next.packages.length });
    await options.eventBus
      ?.publishGeneric('system.plugin_lane.taken', {
        sequence: next.sequence,
        version: next.version,
        plugins: next.packages.map((pkg) => ({ name: pkg.name, version: pkg.version })),
      })
      .catch((error) => log.warn('Could not publish the plugin lane', { error: String(error) }));
    return true;
  }

  function start(): () => void {
    let interval: ReturnType<typeof setInterval> | undefined;
    const look = () => void refresh().catch((error) => log.warn('Plugin lane look failed', { error: String(error) }));
    const first = timers.setTimeout(() => {
      look();
      interval = timers.setInterval(look, EVERY_MS);
    }, FIRST_LOOK_MS);
    return () => {
      timers.clearTimeout(first);
      if (interval) timers.clearInterval(interval);
    };
  }

  const loaded = load();
  const tarball = (file: string) => taken?.tarballs.get(file) ?? earlier.get(file) ?? null;
  return { current: () => taken, tarball, loaded, refresh, start };
}
