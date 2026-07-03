/**
 * Backend selection + config parsing.
 *
 * Locks the acceptance criteria: `OMNI_MEDIA_MODE` unset → local; `=remote` →
 * s3 with required credentials, and a loud failure when they are missing.
 */

import { describe, expect, it } from 'bun:test';
import { resolveMediaBackendConfig } from '../config';

const REMOTE_ENV = {
  OMNI_MEDIA_MODE: 'remote',
  OMNI_MEDIA_S3_BUCKET: 'omni-media',
  OMNI_MEDIA_S3_ACCESS_KEY: 'minioadmin',
  OMNI_MEDIA_S3_SECRET_KEY: 'minioadmin',
} satisfies NodeJS.ProcessEnv;

describe('resolveMediaBackendConfig', () => {
  it('defaults to local when OMNI_MEDIA_MODE is unset', () => {
    expect(resolveMediaBackendConfig({})).toEqual({ mode: 'local' });
  });

  it('treats any non-remote value as local', () => {
    expect(resolveMediaBackendConfig({ OMNI_MEDIA_MODE: 'local' })).toEqual({ mode: 'local' });
    expect(resolveMediaBackendConfig({ OMNI_MEDIA_MODE: 'nonsense' })).toEqual({ mode: 'local' });
  });

  it('is case-insensitive for the mode value', () => {
    expect(resolveMediaBackendConfig({ ...REMOTE_ENV, OMNI_MEDIA_MODE: 'REMOTE' }).mode).toBe('remote');
  });

  it('parses remote config with sensible defaults', () => {
    const config = resolveMediaBackendConfig({ ...REMOTE_ENV, OMNI_MEDIA_S3_ENDPOINT: 'http://minio:9000' });
    expect(config).toEqual({
      mode: 'remote',
      s3: {
        endpoint: 'http://minio:9000',
        bucket: 'omni-media',
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretKey: 'minioadmin',
        forcePathStyle: true,
        presignTtlSeconds: 3600,
      },
    });
  });

  it('honors explicit region, path-style and TTL overrides', () => {
    const config = resolveMediaBackendConfig({
      ...REMOTE_ENV,
      OMNI_MEDIA_S3_REGION: 'eu-central-1',
      OMNI_MEDIA_S3_FORCE_PATH_STYLE: 'false',
      OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS: '600',
    });
    expect(config.mode).toBe('remote');
    if (config.mode !== 'remote') throw new Error('unreachable');
    expect(config.s3.region).toBe('eu-central-1');
    expect(config.s3.forcePathStyle).toBe(false);
    expect(config.s3.presignTtlSeconds).toBe(600);
    expect(config.s3.endpoint).toBeUndefined();
  });

  it('falls back to defaults for an unparseable TTL', () => {
    const config = resolveMediaBackendConfig({ ...REMOTE_ENV, OMNI_MEDIA_S3_PRESIGN_TTL_SECONDS: 'abc' });
    if (config.mode !== 'remote') throw new Error('unreachable');
    expect(config.s3.presignTtlSeconds).toBe(3600);
  });

  it('throws with the missing var names when remote credentials are incomplete', () => {
    expect(() => resolveMediaBackendConfig({ OMNI_MEDIA_MODE: 'remote' })).toThrow(
      /OMNI_MEDIA_S3_BUCKET.*OMNI_MEDIA_S3_ACCESS_KEY.*OMNI_MEDIA_S3_SECRET_KEY/,
    );
  });
});
