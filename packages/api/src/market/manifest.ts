/**
 * The bundled market's manifest (the Automagik marketplace).
 *
 * scripts/pack-market.ts packs every apps/*-dsh plugin of a release with `npm pack` into the
 * CLI's dist/market: one <file>.tgz per plugin and this manifest, market.json, next to them.
 * The packer writes it through MarketManifestSchema and the server reads it back through the
 * same schema, so the two cannot drift. Zod only: the packer imports this file too.
 */

import { z } from 'zod';

export const MARKET_MANIFEST_FILE = 'market.json';

/** npm's package name grammar, as DSH's market index parser checks it. */
export const PackageNameSchema = z
  .string()
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/);

/** A tarball's own file name: no directory part, so a request can only name a file the manifest lists. */
export const TarballFileSchema = z
  .string()
  .max(255)
  .regex(/^[a-z0-9][a-z0-9._-]*\.tgz$/);

const NUMERIC = '(?:0|[1-9]\\d*)';
const PRERELEASE = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
/** One exact SemVer 2.0.0 version. */
export const ExactVersionSchema = z
  .string()
  .regex(
    new RegExp(
      `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE}(?:\\.${PRERELEASE})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
    ),
  );

const RangesSchema = z.record(z.string());

export const MarketPackageSchema = z.object({
  name: PackageNameSchema,
  version: ExactVersionSchema,
  file: TarballFileSchema,
  /** Subresource integrity of the tarball, as npm and pnpm verify it. */
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  /** sha1 of the tarball, hex: the legacy `dist.shasum`. */
  shasum: z.string().regex(/^[0-9a-f]{40}$/),
  size: z.number().int().positive(),
  // The package.json fields a registry packument carries for this version.
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  repository: z.object({ type: z.string().optional(), url: z.string(), directory: z.string().optional() }).optional(),
  dependencies: RangesSchema.optional(),
  peerDependencies: RangesSchema.optional(),
  peerDependenciesMeta: z.record(z.object({ optional: z.boolean().optional() })).optional(),
  engines: RangesSchema.optional(),
  dsh: z.record(z.unknown()).optional(),
});
export type MarketPackage = z.infer<typeof MarketPackageSchema>;

export const MarketManifestSchema = z.object({
  format: z.literal(1),
  /**
   * The Omni release the plugins were packed from. Each of Omni's own plugins carries the Omni
   * release of its last change, at most this one; Automagik's carry Automagik's.
   */
  omniVersion: ExactVersionSchema,
  /** When the plugins were packed, in Unix seconds: the market's publish time. */
  packedAt: z.number().int().nonnegative(),
  packages: z.array(MarketPackageSchema),
});
export type MarketManifest = z.infer<typeof MarketManifestSchema>;
