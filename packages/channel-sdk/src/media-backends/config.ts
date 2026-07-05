/**
 * Media backend configuration parsing.
 *
 * Parses the `OMNI_MEDIA_*` env vars through a Zod schema (repo rule: no
 * unvalidated external inputs). `OMNI_MEDIA_MODE` selects the backend and
 * defaults to `local` when unset; ONLY `local` and `remote` are accepted — any
 * other value throws loudly, so a typo (`s3`, `minio`, ...) cannot silently
 * fall back to local disk. `remote` additionally requires S3 credentials and
 * fails loudly when they are missing.
 */

import { z } from 'zod';

export interface S3BackendConfig {
  /** Custom endpoint (e.g. MinIO `http://minio:9000`); omit for real AWS S3. */
  endpoint?: string;
  /**
   * Optional externally-reachable endpoint used ONLY for `presign()` URL
   * generation. Uploads/reads keep using `endpoint`. Set this when the agent
   * runtime cannot resolve the in-cluster endpoint (e.g. `http://minio:9000`).
   */
  publicEndpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretKey: string;
  /** MinIO and most self-hosted S3 need path-style addressing. Default true. */
  forcePathStyle: boolean;
  /** Default TTL applied when a caller does not pass an explicit one. */
  presignTtlSeconds: number;
}

export type MediaBackendConfig = { mode: 'local' } | { mode: 'remote'; s3: S3BackendConfig };

const DEFAULT_PRESIGN_TTL_SECONDS = 3600;
const DEFAULT_REGION = 'us-east-1';

/** Trimmed optional string; empty/whitespace-only collapses to undefined. */
const optionalTrimmedString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

/** Bool accepting 1/true/yes/on and 0/false/no/off; anything else → default. */
function boolFromEnv(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return defaultValue;
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      return defaultValue;
    });
}

/** Positive-integer TTL; non-positive or unparseable values → default. */
function ttlFromEnv(defaultValue: number) {
  return z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return defaultValue;
      const parsed = Number.parseInt(value.trim(), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
    });
}

/**
 * Schema over the `OMNI_MEDIA_*` env surface. Unknown keys on the env object
 * are ignored (process.env carries the whole environment).
 */
const MediaEnvSchema = z.object({
  OMNI_MEDIA_MODE: z
    .string()
    .optional()
    .transform((value) => (value ?? 'local').trim().toLowerCase())
    .pipe(
      z.enum(['local', 'remote'], {
        errorMap: (_issue, ctx) => ({
          message: `Invalid OMNI_MEDIA_MODE="${String(ctx.data)}" — expected "local" or "remote" (unset defaults to local). Refusing to silently fall back to local disk.`,
        }),
      }),
    ),
  OMNI_MEDIA_S3_ENDPOINT: optionalTrimmedString,
  OMNI_MEDIA_S3_PUBLIC_ENDPOINT: optionalTrimmedString,
  OMNI_MEDIA_S3_BUCKET: optionalTrimmedString,
  OMNI_MEDIA_S3_REGION: optionalTrimmedString,
  OMNI_MEDIA_S3_ACCESS_KEY: optionalTrimmedString,
  OMNI_MEDIA_S3_SECRET_KEY: optionalTrimmedString,
  OMNI_MEDIA_S3_FORCE_PATH_STYLE: boolFromEnv(true),
  OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS: ttlFromEnv(DEFAULT_PRESIGN_TTL_SECONDS),
});

/**
 * Resolve the media backend configuration from the environment.
 * @throws when `OMNI_MEDIA_MODE` is neither `local` nor `remote` (unset → local),
 *   or when `OMNI_MEDIA_MODE=remote` but required S3 credentials are missing.
 */
export function resolveMediaBackendConfig(env: NodeJS.ProcessEnv = process.env): MediaBackendConfig {
  const parsed = MediaEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  const vars = parsed.data;
  if (vars.OMNI_MEDIA_MODE !== 'remote') {
    return { mode: 'local' };
  }

  const bucket = vars.OMNI_MEDIA_S3_BUCKET;
  const accessKeyId = vars.OMNI_MEDIA_S3_ACCESS_KEY;
  const secretKey = vars.OMNI_MEDIA_S3_SECRET_KEY;

  if (!bucket || !accessKeyId || !secretKey) {
    const missing = (
      [
        ['OMNI_MEDIA_S3_BUCKET', bucket],
        ['OMNI_MEDIA_S3_ACCESS_KEY', accessKeyId],
        ['OMNI_MEDIA_S3_SECRET_KEY', secretKey],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    throw new Error(`OMNI_MEDIA_MODE=remote requires these env vars: ${missing.join(', ')}`);
  }

  return {
    mode: 'remote',
    s3: {
      endpoint: vars.OMNI_MEDIA_S3_ENDPOINT,
      publicEndpoint: vars.OMNI_MEDIA_S3_PUBLIC_ENDPOINT,
      bucket,
      region: vars.OMNI_MEDIA_S3_REGION ?? DEFAULT_REGION,
      accessKeyId,
      secretKey,
      forcePathStyle: vars.OMNI_MEDIA_S3_FORCE_PATH_STYLE,
      presignTtlSeconds: vars.OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS,
    },
  };
}
