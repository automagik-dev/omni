/**
 * The Automagik marketplace an Omni serves for its own release (routes in ./routes.ts).
 *
 * Two sources, both fixed at build time and identical for every caller:
 *   - the bundled market: this release's apps/*-dsh plugins, packed into the CLI's dist/market
 *     with market.json (see ./manifest.ts). Served as npm packages from this Omni's own
 *     registry at /api/market/npm/, one version each: Omni's.
 *   - marketplace/automagik.json, imported into the bundle: its titles, categories and labels,
 *     and its vetted third-party npm add-ons, which install from the client's own registry.
 *
 * Without a bundled market (a server run from source) the index lists the third-party
 * add-ons only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@omni/core';
import { z } from 'zod';
import staticIndexJson from '../../../../marketplace/automagik.json';
import {
  ExactVersionSchema,
  MARKET_MANIFEST_FILE,
  type MarketManifest,
  MarketManifestSchema,
  type MarketPackage,
  PackageNameSchema,
} from './manifest';

const log = createLogger('api:market');

const TextSchema = z.union([z.string(), z.record(z.string())]);
const DeclarationsSchema = z.record(z.object({ title: TextSchema }));
const SourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('npm'), registry: z.string().url().optional() }),
  z.object({ type: z.literal('git'), url: z.string().url(), commit: z.string(), path: z.string().optional() }),
]);
const VersionSchema = z.object({
  version: ExactVersionSchema,
  publishTimestamp: z.number().int().nonnegative(),
  source: SourceSchema,
  engines: z.object({ dsh: z.string().optional() }).optional(),
});
const PluginSchema = z.object({
  name: PackageNameSchema,
  title: TextSchema.optional(),
  description: TextSchema.optional(),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
  repository: z.object({ url: z.string().url(), directory: z.string().optional() }).optional(),
  metadata: z
    .object({
      category: z.string().optional(),
      keywords: z.array(z.string()).optional(),
      labels: z.array(z.string()).optional(),
    })
    .optional(),
  versions: z.array(VersionSchema).min(1),
});
const IndexSchema = z.object({
  format: z.literal(1),
  title: TextSchema,
  description: TextSchema.optional(),
  metadata: z.object({ categories: DeclarationsSchema.optional(), labels: DeclarationsSchema.optional() }).optional(),
  plugins: z.array(PluginSchema),
});

type LocalizedText = z.infer<typeof TextSchema>;
type IndexPlugin = z.infer<typeof PluginSchema>;
/** A DSH plugin market index, format 1 (@deepseek-ai/dsh-plugin-market-index). */
export type MarketIndex = z.infer<typeof IndexSchema>;

/** The parts of a registry packument (npm's package document) pnpm and npm read to install. */
export interface Packument {
  _id: string;
  name: string;
  description?: string;
  'dist-tags': { latest: string };
  versions: Record<string, PackumentVersion>;
  time: Record<string, string>;
  license?: string;
  homepage?: string;
  keywords?: string[];
  repository?: MarketPackage['repository'];
}
type PackumentVersion = Omit<MarketPackage, 'file' | 'integrity' | 'shasum' | 'size'> & {
  _id: string;
  dist: { tarball: string; integrity: string; shasum: string };
};

export interface CatalogEntry {
  name: string;
  title: string;
  version: string;
  description: string;
  labels: string[];
  /** Installs from this Omni (true) or from the client's own npm registry. */
  bundled: boolean;
}
export interface Catalog {
  title: string;
  indexUrl: string;
  plugins: CatalogEntry[];
}

export interface Market {
  /** The market index; `origin` is the request's, used when no public URL is configured. */
  index(origin: string): MarketIndex;
  /** The packument of a plugin this Omni carries, or null for any other name. */
  packument(name: string, origin: string): Packument | null;
  /** A carried plugin's tarball bytes, or null unless `file` is that plugin's listed tarball. */
  tarball(name: string, file: string): Promise<Uint8Array<ArrayBuffer> | null>;
  catalog(origin: string): Catalog;
}

export interface MarketOptions {
  /** This Omni's public URL (https://omni.example.com); null falls back to the request's origin. */
  publicUrl?: string | null;
  /** Where the bundled market lives; defaults to OMNI_MARKET_DIR, else dist/market next to the server bundle. */
  dir?: string;
  /** The static index; defaults to marketplace/automagik.json. */
  staticIndex?: unknown;
}

/**
 * dist/market next to the server bundle (dist/server/index.js). From source this resolves to
 * this directory, which holds no market.json, so a source run has no bundled market.
 */
function defaultMarketDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OMNI_MARKET_DIR?.trim() || fileURLToPath(new URL('../market', import.meta.url));
}

/** OMNI_PUBLIC_URL without its trailing slashes, or null when unset or not a URL. */
export function readMarketPublicUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const parsed = z.string().url().safeParse(env.OMNI_PUBLIC_URL?.trim().replace(/\/+$/, ''));
  return parsed.success ? parsed.data : null;
}

/** The bundled market's manifest, keeping only packages whose tarball is there; null when absent or invalid. */
function loadBundledMarket(dir: string): MarketManifest | null {
  const path = join(dir, MARKET_MANIFEST_FILE);
  if (!existsSync(path)) return null;
  let parsed: z.SafeParseReturnType<unknown, MarketManifest>;
  try {
    parsed = MarketManifestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    log.warn('Bundled market manifest is not JSON; serving without it', { path, error: String(error) });
    return null;
  }
  if (!parsed.success) {
    log.warn('Bundled market manifest is invalid; serving without it', { path, issues: parsed.error.issues.length });
    return null;
  }
  const seen = new Set<string>();
  const packages = parsed.data.packages.filter((pkg) => {
    if (seen.has(pkg.name) || !existsSync(join(dir, pkg.file))) return false;
    seen.add(pkg.name);
    return true;
  });
  return { ...parsed.data, packages };
}

const text = (value: LocalizedText | undefined): string =>
  typeof value === 'string' ? value : (value?.en ?? Object.values(value ?? {})[0] ?? '');

/** `git+https://host/org/repo.git` → `https://host/org/repo`, the web page an index may show. */
function repositoryPage(pkg: MarketPackage): IndexPlugin['repository'] {
  if (!pkg.repository) return undefined;
  const url = z
    .string()
    .url()
    .safeParse(pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''));
  if (!url.success || !url.data.startsWith('https://')) return undefined;
  return { url: url.data, ...(pkg.repository.directory ? { directory: pkg.repository.directory } : {}) };
}

/**
 * A bundled plugin's index entry: the static index's presentation when it lists the plugin,
 * else what its package.json says. Absent fields stay undefined, which JSON drops.
 */
function bundledPlugin(pkg: MarketPackage, known: IndexPlugin | undefined, publishTimestamp: number, registry: string) {
  const dsh = pkg.engines?.dsh ?? known?.versions[0]?.engines?.dsh;
  const plugin: IndexPlugin = {
    name: pkg.name,
    title: known?.title ?? pkg.name,
    description: known?.description ?? pkg.description,
    author: known?.author ?? 'Automagik',
    homepage: known?.homepage ?? pkg.homepage,
    repository: known?.repository ?? repositoryPage(pkg),
    metadata: known?.metadata ?? { category: 'omni', keywords: pkg.keywords ?? [], labels: ['official'] },
    versions: [{ version: pkg.version, publishTimestamp, source: { type: 'npm', registry }, engines: { dsh } }],
  };
  return plugin;
}

/** npm's path form of a name: a scoped name's slash is encoded. */
const encodedName = (name: string) => name.replace('/', '%2f');

export function createMarket(options: MarketOptions = {}): Market {
  const staticIndex = IndexSchema.parse(options.staticIndex ?? staticIndexJson);
  const dir = options.dir ?? defaultMarketDir();
  const bundled = loadBundledMarket(dir);
  const publicUrl = options.publicUrl?.replace(/\/+$/, '') || null;
  const carried = new Map((bundled?.packages ?? []).map((pkg) => [pkg.name, pkg]));
  const listed = new Map(staticIndex.plugins.map((plugin) => [plugin.name, plugin]));
  const categories = staticIndex.metadata?.categories ?? {};
  const labels = staticIndex.metadata?.labels ?? {};

  const base = (origin: string) => publicUrl ?? origin.replace(/\/+$/, '');
  const registryOf = (origin: string) => `${base(origin)}/api/market/npm/`;

  // The vetted third-party add-ons: the static index's npm versions of plugins this Omni does not carry.
  const thirdParty: IndexPlugin[] = staticIndex.plugins
    .filter((plugin) => !carried.has(plugin.name))
    .map((plugin) => ({ ...plugin, versions: plugin.versions.filter((entry) => entry.source.type === 'npm') }))
    .filter((plugin) => plugin.versions.length > 0);

  function index(origin: string): MarketIndex {
    return {
      format: 1,
      title: { en: 'Automagik' },
      ...(staticIndex.description ? { description: staticIndex.description } : {}),
      metadata: { categories, labels },
      plugins: [
        ...[...carried.values()].map((pkg) =>
          bundledPlugin(pkg, listed.get(pkg.name), bundled?.packedAt ?? 0, registryOf(origin)),
        ),
        ...thirdParty,
      ],
    };
  }

  function packument(name: string, origin: string): Packument | null {
    const pkg = carried.get(name);
    if (!pkg || !bundled) return null;
    const { file, integrity, shasum, size: _size, ...fields } = pkg;
    const published = new Date(bundled.packedAt * 1000).toISOString();
    return {
      _id: pkg.name,
      name: pkg.name,
      description: pkg.description,
      'dist-tags': { latest: pkg.version },
      versions: {
        [pkg.version]: {
          ...fields,
          _id: `${pkg.name}@${pkg.version}`,
          dist: { tarball: `${registryOf(origin)}${pkg.name}/-/${file}`, integrity, shasum },
        },
      },
      time: { created: published, modified: published, [pkg.version]: published },
      license: pkg.license,
      homepage: pkg.homepage,
      keywords: pkg.keywords,
      repository: pkg.repository,
    };
  }

  async function tarball(name: string, file: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const pkg = carried.get(name);
    // Only the exact file the manifest lists: never a path built from the request.
    if (!pkg || pkg.file !== file) return null;
    return new Uint8Array(await readFile(join(dir, pkg.file)));
  }

  function catalog(origin: string): Catalog {
    const labelTitle = (id: string) => text(labels[id]?.title) || id;
    return {
      title: 'Automagik',
      indexUrl: `${base(origin)}/api/market/index.json`,
      plugins: index(origin).plugins.map((plugin) => ({
        name: plugin.name,
        title: text(plugin.title) || plugin.name,
        version: plugin.versions[0]?.version ?? '',
        description: text(plugin.description),
        labels: (plugin.metadata?.labels ?? []).map(labelTitle),
        bundled: carried.has(plugin.name),
      })),
    };
  }

  return { index, packument, tarball, catalog };
}

/** Where a name this Omni does not carry resolves: the public npm registry. */
export const upstreamPackumentUrl = (name: string) => `https://registry.npmjs.org/${encodedName(name)}`;
