#!/usr/bin/env bun
/**
 * Pack the Automagik marketplace a release carries: every DSH plugin in apps/*-dsh, and the
 * Automagik plugins Omni's own build on (the Bot team, the welcome) at the Automagik release
 * apps/automagik.json pins.
 *
 *   bun scripts/pack-market.ts [outDir]     default: packages/cli/dist/market
 *
 * Each plugin of this repository is packed with `bun pm pack` (the same files `npm pack`
 * takes: the package's `files`) into outDir, next to a market.json manifest the server reads
 * (packages/api/src/market). A plugin whose version is not Omni's fails the pack: the market
 * serves each of Omni's own plugins at Omni's version. The Automagik plugins come as the
 * pinned release's own tarballs (apps/automagik.mjs: downloaded, or taken from
 * AUTOMAGIK_TARBALLS, and refused unless their integrity is the pinned one), at their own
 * version. The directory is emptied first, so it holds exactly this release's plugins.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
// @ts-expect-error -- plain Node ESM without types (apps/automagik.mjs), shared with the admin UI image.
import { fetchTarballs, readPin } from '../apps/automagik.mjs';
import {
  MARKET_MANIFEST_FILE,
  type MarketManifest,
  MarketManifestSchema,
  type MarketPackage,
} from '../packages/api/src/market/manifest';

const repoRoot = join(import.meta.dir, '..');

const RangesSchema = z.record(z.string());
const PluginPackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  private: z.boolean().optional(),
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

/** The DSH plugin directories under appsDir (every `*-dsh` with a package.json), by name. */
export function discoverPlugins(appsDir: string): string[] {
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-dsh'))
    .map((entry) => join(appsDir, entry.name))
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .sort();
}

type PluginPackage = z.infer<typeof PluginPackageSchema>;
const readPlugin = (dir: string): PluginPackage =>
  PluginPackageSchema.parse(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')));

function packOne(dir: string, pkg: PluginPackage, outDir: string, omniVersion: string): MarketPackage {
  if (pkg.version !== omniVersion)
    throw new Error(`${pkg.name} is ${pkg.version}, not Omni's ${omniVersion}: run scripts/sync-versions.ts`);
  // npm's tarball name: the scope's @ dropped and its / made a dash.
  const filename = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
  execFileSync(process.execPath, ['pm', 'pack', '--ignore-scripts', '--quiet', '--destination', outDir], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!existsSync(join(outDir, filename))) throw new Error(`bun pm pack in ${dir} did not write ${filename}`);
  return describeTarball(outDir, filename, pkg);
}

/** A tarball's manifest entry: its checksums and the package.json fields a registry serves. */
function describeTarball(outDir: string, filename: string, pkg: PluginPackage): MarketPackage {
  const bytes = readFileSync(join(outDir, filename));
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const repository = typeof pkg.repository === 'string' ? { type: 'git', url: pkg.repository } : pkg.repository;
  return {
    name: pkg.name,
    version: pkg.version,
    file: filename,
    integrity,
    shasum: createHash('sha1').update(bytes).digest('hex'),
    size: bytes.byteLength,
    description: pkg.description,
    keywords: pkg.keywords,
    license: pkg.license,
    homepage: pkg.homepage,
    repository,
    dependencies: pkg.dependencies,
    peerDependencies: pkg.peerDependencies,
    peerDependenciesMeta: pkg.peerDependenciesMeta,
    engines: pkg.engines,
    dsh: pkg.dsh,
  };
}

/** The package.json a tarball carries (npm's layout: package/package.json). */
export function tarballPackage(path: string): PluginPackage {
  return PluginPackageSchema.parse(
    JSON.parse(execFileSync('tar', ['-xzOf', path, 'package/package.json'], { encoding: 'utf8' })),
  );
}

/** The pinned Automagik release's plugins in outDir, checked, as manifest entries. */
async function automagikPackages(
  outDir: string,
  options: { pinFile?: string; from?: string },
): Promise<MarketPackage[]> {
  const pin = readPin(options.pinFile);
  const tarballs: { name: string; version: string; path: string }[] = await fetchTarballs(outDir, {
    pin,
    ...(options.from ? { from: options.from } : {}),
  });
  return tarballs.map(({ name, version, path }) => {
    const pkg = tarballPackage(path);
    if (pkg.name !== name || pkg.version !== version)
      throw new Error(`${basename(path)} holds ${pkg.name}@${pkg.version}, not the pinned ${name}@${version}`);
    return describeTarball(outDir, basename(path), pkg);
  });
}

export interface PackMarketOptions {
  appsDir: string;
  outDir: string;
  omniVersion: string;
  /** Unix seconds; defaults to SOURCE_DATE_EPOCH, else now. */
  packedAt?: number;
  /**
   * The Automagik plugins: the pin to take (default apps/automagik.json) and a folder that
   * already holds its tarballs (default AUTOMAGIK_TARBALLS, else download). false leaves them out.
   */
  automagik?: { pinFile?: string; from?: string } | false;
}

/** Pack every plugin into outDir (emptied first) and write its market.json. */
export async function packMarket(options: PackMarketOptions): Promise<MarketManifest> {
  const outDir = resolve(options.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const own = discoverPlugins(options.appsDir)
    .map((dir) => ({ dir, pkg: readPlugin(dir) }))
    .filter(({ pkg }) => pkg.private !== true)
    .map(({ dir, pkg }) => packOne(dir, pkg, outDir, options.omniVersion));
  const automagik = options.automagik === false ? [] : await automagikPackages(outDir, options.automagik ?? {});
  const packages = [...automagik, ...own];
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const manifest = MarketManifestSchema.parse({
    format: 1,
    omniVersion: options.omniVersion,
    packedAt: options.packedAt ?? (Number.isInteger(epoch) && epoch > 0 ? epoch : Math.floor(Date.now() / 1000)),
    packages,
  });
  writeFileSync(join(outDir, MARKET_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? join(repoRoot, 'packages', 'cli', 'dist', 'market'));
  const { version } = z
    .object({ version: z.string() })
    .parse(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')));
  const manifest = await packMarket({ appsDir: join(repoRoot, 'apps'), outDir, omniVersion: version });
  for (const pkg of manifest.packages) console.log(`market: ${pkg.name}@${pkg.version} ${pkg.file} (${pkg.size} B)`);
  console.log(`market: ${manifest.packages.length} plugins packed into ${outDir}`);
}
