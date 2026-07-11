/**
 * Media backend configuration parsing.
 *
 * Parses the `OMNI_MEDIA_*` env vars through a Zod schema (repo rule: no
 * unvalidated external inputs). `OMNI_MEDIA_MODE` selects the backend and
 * defaults to `local` when unset; ONLY `local` and `remote` are accepted — any
 * other value throws loudly, so a typo (`s3`, `minio`, ...) cannot silently
 * fall back to local disk. `remote` additionally requires a bucket plus ONE
 * complete credential set — static keys (`OMNI_MEDIA_S3_ACCESS_KEY` +
 * `OMNI_MEDIA_S3_SECRET_KEY`) or IRSA web-identity
 * (`AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN`) — and fails loudly listing
 * both options when neither is complete. When BOTH sets are present,
 * web-identity is primary and the static pair is retained as a fallback.
 */

import { z } from 'zod';

/** How the S3 backend sources its credentials. */
export type S3CredentialSource = 'static' | 'web-identity';

/**
 * IRSA / web-identity parameters. On EKS the pod identity webhook injects the
 * source env vars automatically when the ServiceAccount carries the
 * `eks.amazonaws.com/role-arn` annotation.
 */
export interface S3WebIdentityParams {
  /** Path to the projected ServiceAccount token (`AWS_WEB_IDENTITY_TOKEN_FILE`). */
  tokenFile: string;
  /** IAM role to assume (`AWS_ROLE_ARN`). */
  roleArn: string;
  /** Region for the STS endpoint (`AWS_REGION`, falling back to the S3 region). */
  stsRegion: string;
}

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
  /**
   * Static key pair (`OMNI_MEDIA_S3_ACCESS_KEY` / `_SECRET_KEY`). Optional
   * because web-identity mode can run without static keys; when BOTH
   * credential sets are configured, web-identity is primary and this pair is
   * kept as an STS-outage fallback.
   */
  accessKeyId?: string;
  secretKey?: string;
  /**
   * Credential sourcing mode. Absent (or 'static') → the static key pair
   * above, byte-compatible with the pre-IRSA config shape. 'web-identity' →
   * STS AssumeRoleWithWebIdentity using `webIdentity`.
   */
  credentialSource?: S3CredentialSource;
  /** Present when `credentialSource` is 'web-identity'. */
  webIdentity?: S3WebIdentityParams;
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
  // IRSA / web-identity surface — injected by the EKS pod identity webhook
  // when the ServiceAccount carries the eks.amazonaws.com/role-arn annotation.
  AWS_WEB_IDENTITY_TOKEN_FILE: optionalTrimmedString,
  AWS_ROLE_ARN: optionalTrimmedString,
  AWS_REGION: optionalTrimmedString,
});

/**
 * Resolve the media backend configuration from the environment.
 * @throws when `OMNI_MEDIA_MODE` is neither `local` nor `remote` (unset → local),
 *   or when `OMNI_MEDIA_MODE=remote` but the bucket is missing or NEITHER
 *   credential set (static keys / IRSA web-identity) is complete.
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
  const tokenFile = vars.AWS_WEB_IDENTITY_TOKEN_FILE;
  const roleArn = vars.AWS_ROLE_ARN;

  const staticComplete = accessKeyId !== undefined && secretKey !== undefined;
  const webIdentityComplete = tokenFile !== undefined && roleArn !== undefined;

  if (!bucket || (!staticComplete && !webIdentityComplete)) {
    const missing: string[] = [];
    if (!bucket) missing.push('OMNI_MEDIA_S3_BUCKET');
    if (!staticComplete && !webIdentityComplete) {
      missing.push(
        'credentials — either static keys (OMNI_MEDIA_S3_ACCESS_KEY + OMNI_MEDIA_S3_SECRET_KEY) or IRSA web-identity (AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN)',
      );
    }
    throw new Error(`OMNI_MEDIA_MODE=remote requires: ${missing.join(', ')}`);
  }

  const region = vars.OMNI_MEDIA_S3_REGION ?? DEFAULT_REGION;
  return {
    mode: 'remote',
    s3: {
      endpoint: vars.OMNI_MEDIA_S3_ENDPOINT,
      publicEndpoint: vars.OMNI_MEDIA_S3_PUBLIC_ENDPOINT,
      bucket,
      region,
      accessKeyId,
      secretKey,
      forcePathStyle: vars.OMNI_MEDIA_S3_FORCE_PATH_STYLE,
      presignTtlSeconds: vars.OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS,
      // Web-identity (when complete) is PRIMARY; static keys above — when also
      // present — stay available as the backend's STS-outage fallback. In the
      // static-only path these keys are omitted entirely, keeping the resolved
      // shape byte-compatible with the pre-IRSA config.
      ...(tokenFile !== undefined && roleArn !== undefined
        ? {
            credentialSource: 'web-identity' as const,
            webIdentity: { tokenFile, roleArn, stsRegion: vars.AWS_REGION ?? region },
          }
        : {}),
    },
  };
}
