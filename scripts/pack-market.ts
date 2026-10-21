#!/usr/bin/env bun
/**
 * Pack the Automagik marketplace a release carries: every DSH plugin in apps/*-dsh.
 *
 *   bun scripts/pack-market.ts [outDir]     default: packages/cli/dist/market
 *
 * Each plugin is packed with `bun pm pack` (the same files `npm pack` takes: the package's
 * `files`) into outDir, next to a market.json manifest the server reads (packages/api/src/market). The
 * directory is emptied first, so it holds exactly this release's plugins. A plugin whose
 * version is not Omni's fails the pack: the market serves each plugin at Omni's version.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
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

export interface PackMarketOptions {
  appsDir: string;
  outDir: string;
  omniVersion: string;
  /** Unix seconds; defaults to SOURCE_DATE_EPOCH, else now. */
  packedAt?: number;
}

/** Pack every plugin into outDir (emptied first) and write its market.json. */
export function packMarket(options: PackMarketOptions): MarketManifest {
  const outDir = resolve(options.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const packages = discoverPlugins(options.appsDir)
    .map((dir) => ({ dir, pkg: readPlugin(dir) }))
    .filter(({ pkg }) => pkg.private !== true)
    .map(({ dir, pkg }) => packOne(dir, pkg, outDir, options.omniVersion));
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
  const manifest = packMarket({ appsDir: join(repoRoot, 'apps'), outDir, omniVersion: version });
  for (const pkg of manifest.packages) console.log(`market: ${pkg.name}@${pkg.version} ${pkg.file} (${pkg.size} B)`);
  console.log(`market: ${manifest.packages.length} plugins packed into ${outDir}`);
}
