/**
 * Media backend configuration parsing.
 *
 * Reads `OMNI_MEDIA_*` env vars directly (mirroring how MediaStorageService
 * already reads `MEDIA_STORAGE_PATH`). `OMNI_MEDIA_MODE` selects the backend and
 * defaults to `local`; `remote` requires S3 credentials and fails loudly when
 * they are missing so a misconfigured deployment cannot silently fall back to
 * local disk.
 */

export interface S3BackendConfig {
  /** Custom endpoint (e.g. MinIO `http://minio:9000`); omit for real AWS S3. */
  endpoint?: string;
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

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseTtl(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/**
 * Resolve the media backend configuration from the environment.
 * @throws when `OMNI_MEDIA_MODE=remote` but required S3 credentials are missing.
 */
export function resolveMediaBackendConfig(env: NodeJS.ProcessEnv = process.env): MediaBackendConfig {
  const mode = (env.OMNI_MEDIA_MODE ?? 'local').trim().toLowerCase();
  if (mode !== 'remote') {
    return { mode: 'local' };
  }

  const bucket = env.OMNI_MEDIA_S3_BUCKET?.trim();
  const accessKeyId = env.OMNI_MEDIA_S3_ACCESS_KEY?.trim();
  const secretKey = env.OMNI_MEDIA_S3_SECRET_KEY?.trim();

  const missing = (
    [
      ['OMNI_MEDIA_S3_BUCKET', bucket],
      ['OMNI_MEDIA_S3_ACCESS_KEY', accessKeyId],
      ['OMNI_MEDIA_S3_SECRET_KEY', secretKey],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`OMNI_MEDIA_MODE=remote requires these env vars: ${missing.join(', ')}`);
  }

  return {
    mode: 'remote',
    s3: {
      endpoint: env.OMNI_MEDIA_S3_ENDPOINT?.trim() || undefined,
      // biome-ignore lint/style/noNonNullAssertion: presence enforced by the missing[] guard above
      bucket: bucket!,
      region: env.OMNI_MEDIA_S3_REGION?.trim() || DEFAULT_REGION,
      // biome-ignore lint/style/noNonNullAssertion: presence enforced by the missing[] guard above
      accessKeyId: accessKeyId!,
      // biome-ignore lint/style/noNonNullAssertion: presence enforced by the missing[] guard above
      secretKey: secretKey!,
      forcePathStyle: parseBool(env.OMNI_MEDIA_S3_FORCE_PATH_STYLE, true),
      presignTtlSeconds: parseTtl(env.OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS, DEFAULT_PRESIGN_TTL_SECONDS),
    },
  };
}
