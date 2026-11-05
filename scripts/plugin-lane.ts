#!/usr/bin/env bun
/**
 * Omni's plugin lane: Omni's channels and canvases reach the Automagik desktop app without a new
 * app, the way Automagik's own plugins do (automagik-dev/automagik plugin-lane/README.md, the
 * schemaVersion 1 lane). Every stable Omni release updates one signed manifest:
 *
 *   https://github.com/automagik-dev/omni/releases/download/plugin-lane/lane.json
 *   https://github.com/automagik-dev/omni/releases/download/plugin-lane/lane.json.sig
 *
 * The rolling `plugin-lane` release also keeps every plugin tarball the lane ever named, one file
 * per plugin version, never replaced: the release's own assets are its signed binaries alone
 * (release-publish.yml), and a version's bytes must not change once a lane named them. So a
 * plugin at a version the lane already carries is listed with the kept tarball, not a new pack.
 * The signature is ed25519 over the exact bytes of lane.json, detached, base64; the public keys
 * are plugin-lane/keys.json.
 *
 *   bun scripts/plugin-lane.ts pack <dir>                        pack Omni's plugins into dir, with market.json
 *   bun scripts/plugin-lane.ts manifest <dir> <issuedAt> [kept]  print lane.json; kept holds tarballs already on the lane
 *   bun scripts/plugin-lane.ts sign <lane.json>                  print its signature (the key in PLUGIN_LANE_KEY, PEM)
 *   bun scripts/plugin-lane.ts verify <lane.json> <lane.json.sig>  check it against plugin-lane/keys.json
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MARKET_MANIFEST_FILE, MarketManifestSchema } from '../packages/api/src/market/manifest';
import { REPO_URL } from './marketplace';
import { packMarket, tarballPackage } from './pack-market';

const repoRoot = join(import.meta.dir, '..');
export const LANE_RELEASE = 'plugin-lane';
export const KEY_ID = 'omni-2026-10';
const SCHEMA_VERSION = 1;
const DOWNLOADS = `${REPO_URL}/releases/download/${LANE_RELEASE}/`;
/**
 * The oldest Automagik app Omni's plugins run on. Like Genie's, it is no app release line: an
 * app takes Omni's lane on any version at or past it, and each plugin's engines.dsh decides.
 */
export const LANE_BASE = '3.0.0';

export interface LanePlugin {
  name: string;
  version: string;
  url: string;
  integrity: string;
  sha256: string;
  size: number;
  engines: { dsh: string };
}
export interface Lane {
  schemaVersion: number;
  publisher: 'omni';
  keyId: string;
  /** Monotonic across releases: a consumer refuses a lane older than the last it took. */
  sequence: number;
  issuedAt: string;
  repository: string;
  version: string;
  commit: string;
  base: string;
  plugins: LanePlugin[];
}

/** A release's place in the lane's order: 2.YYMMDD.N as YYMMDD·10000 + N. */
export function sequenceOf(version: string): number {
  const match = /^2\.(\d{6})\.(\d+)$/.exec(version);
  if (!match || Number(match[2]) >= 10_000) throw new Error(`not an Omni release version: ${version}`);
  return Number(match[1]) * 10_000 + Number(match[2]);
}

/**
 * lane.json for the plugins packed in `dir` (its market.json). A tarball `kept` already holds (the
 * lane named that version before) replaces the new pack in `dir`, so its bytes never change.
 */
export function manifest(
  dir: string,
  { version, commit, issuedAt, kept }: { version: string; commit: string; issuedAt: string; kept?: string },
): Lane {
  const market = MarketManifestSchema.parse(JSON.parse(readFileSync(join(dir, MARKET_MANIFEST_FILE), 'utf8')));
  const plugins = market.packages.map((pkg) => {
    const earlier = kept ? join(kept, pkg.file) : null;
    if (earlier && existsSync(earlier)) {
      const was = tarballPackage(earlier);
      if (was.name !== pkg.name || was.version !== pkg.version)
        throw new Error(`${pkg.file} on the lane holds ${was.name}@${was.version}, not ${pkg.name}@${pkg.version}`);
      copyFileSync(earlier, join(dir, pkg.file));
    }
    const bytes = readFileSync(join(dir, pkg.file));
    const dsh = pkg.engines?.dsh;
    if (!dsh) throw new Error(`${pkg.name} declares no engines.dsh`);
    return {
      name: pkg.name,
      version: pkg.version,
      url: `${DOWNLOADS}${pkg.file}`,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      engines: { dsh },
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    publisher: 'omni',
    keyId: KEY_ID,
    sequence: sequenceOf(version),
    issuedAt,
    repository: REPO_URL,
    version,
    commit,
    base: LANE_BASE,
    plugins,
  };
}

export const signLane = (bytes: Buffer, privatePem: string) =>
  signBytes(null, bytes, createPrivateKey(privatePem)).toString('base64');

const KeysSchema = z.object({ keys: z.array(z.object({ keyId: z.string(), publicKey: z.string() })).min(1) });

/** The lane in `bytes` when `signature` is one of `keys`' over exactly them. */
export function verifyLane(bytes: Buffer, signature: string, keys: z.infer<typeof KeysSchema>['keys']): Lane {
  const lane = JSON.parse(bytes.toString('utf8')) as Lane;
  const key = keys.find((entry) => entry.keyId === lane.keyId);
  if (!key) throw new Error(`lane: no key ${lane.keyId}`);
  if (!verifyBytes(null, bytes, createPublicKey(key.publicKey), Buffer.from(signature.trim(), 'base64')))
    throw new Error('lane: the signature does not match');
  if (lane.schemaVersion !== SCHEMA_VERSION) throw new Error(`lane: schema ${lane.schemaVersion}`);
  if (lane.publisher !== 'omni') throw new Error(`lane: published by ${lane.publisher}`);
  return lane;
}

export const readKeys = (file = join(repoRoot, 'plugin-lane', 'keys.json')) =>
  KeysSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).keys;

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const version = z
    .object({ version: z.string() })
    .parse(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))).version;
  if (command === 'pack' && args.length === 1) {
    const packed = await packMarket({
      appsDir: join(repoRoot, 'apps'),
      outDir: args[0],
      omniVersion: version,
      automagik: false,
    });
    for (const pkg of packed.packages) console.log(`lane: ${pkg.name}@${pkg.version} ${pkg.file}`);
  } else if (command === 'manifest' && (args.length === 2 || args.length === 3)) {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    console.log(JSON.stringify(manifest(args[0], { version, commit, issuedAt: args[1], kept: args[2] }), null, 2));
  } else if (command === 'sign' && args.length === 1) {
    const key = process.env.PLUGIN_LANE_KEY;
    if (!key) throw new Error('PLUGIN_LANE_KEY is not set');
    console.log(signLane(readFileSync(args[0]), key));
  } else if (command === 'verify' && args.length === 2) {
    const lane = verifyLane(readFileSync(args[0]), readFileSync(args[1], 'utf8'), readKeys());
    console.log(`lane ${lane.version} (sequence ${lane.sequence}) is signed by ${lane.keyId}`);
  } else {
    console.error(
      'usage: bun scripts/plugin-lane.ts pack <dir> | manifest <dir> <issuedAt> [kept] | sign <lane.json> | verify <lane.json> <sig>',
    );
    process.exit(2);
  }
}
