/**
 * Remote-mode credential matrix: static-only / irsa-only / both / neither.
 *
 * Locks the IRSA acceptance criteria on resolveMediaBackendConfig:
 *  - static-only resolves to the EXACT pre-IRSA shape (no new defined keys);
 *  - web-identity (AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN) alone is a
 *    complete credential set — no static keys required;
 *  - when BOTH sets are complete, web-identity is primary and the static pair
 *    is retained (the backend's STS-outage fallback);
 *  - only when NEITHER set is complete does it throw, listing both options.
 */

import { describe, expect, it } from 'bun:test';
import { resolveMediaBackendConfig } from '../config';

const REMOTE_BASE = {
  OMNI_MEDIA_MODE: 'remote',
  OMNI_MEDIA_S3_BUCKET: 'omni-media',
} satisfies NodeJS.ProcessEnv;

const STATIC_KEYS = {
  OMNI_MEDIA_S3_ACCESS_KEY: 'static-access',
  OMNI_MEDIA_S3_SECRET_KEY: 'static-secret',
} satisfies NodeJS.ProcessEnv;

const WEB_IDENTITY = {
  AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/secrets/eks.amazonaws.com/serviceaccount/token',
  AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/omni-media-irsa',
} satisfies NodeJS.ProcessEnv;

describe('resolveMediaBackendConfig credential matrix', () => {
  it('static-only resolves byte-compatible with the pre-IRSA shape (no credential-mode keys)', () => {
    const config = resolveMediaBackendConfig({ ...REMOTE_BASE, ...STATIC_KEYS });
    expect(config).toEqual({
      mode: 'remote',
      s3: {
        bucket: 'omni-media',
        region: 'us-east-1',
        accessKeyId: 'static-access',
        secretKey: 'static-secret',
        forcePathStyle: true,
        presignTtlSeconds: 3600,
      },
    });
    if (config.mode !== 'remote') throw new Error('unreachable');
    // Assert key ABSENCE, not just undefined: toEqual ignores undefined props.
    expect('credentialSource' in config.s3).toBe(false);
    expect('webIdentity' in config.s3).toBe(false);
  });

  it('web-identity-only is a complete credential set — no static keys required', () => {
    const config = resolveMediaBackendConfig({ ...REMOTE_BASE, ...WEB_IDENTITY, AWS_REGION: 'sa-east-1' });
    if (config.mode !== 'remote') throw new Error('unreachable');
    expect(config.s3.credentialSource).toBe('web-identity');
    expect(config.s3.webIdentity).toEqual({
      tokenFile: WEB_IDENTITY.AWS_WEB_IDENTITY_TOKEN_FILE,
      roleArn: WEB_IDENTITY.AWS_ROLE_ARN,
      stsRegion: 'sa-east-1',
    });
    expect(config.s3.accessKeyId).toBeUndefined();
    expect(config.s3.secretKey).toBeUndefined();
    expect(config.s3.bucket).toBe('omni-media');
  });

  it('stsRegion falls back to the S3 region when AWS_REGION is unset', () => {
    const explicit = resolveMediaBackendConfig({ ...REMOTE_BASE, ...WEB_IDENTITY, OMNI_MEDIA_S3_REGION: 'eu-west-1' });
    if (explicit.mode !== 'remote') throw new Error('unreachable');
    expect(explicit.s3.webIdentity?.stsRegion).toBe('eu-west-1');

    const defaulted = resolveMediaBackendConfig({ ...REMOTE_BASE, ...WEB_IDENTITY });
    if (defaulted.mode !== 'remote') throw new Error('unreachable');
    expect(defaulted.s3.webIdentity?.stsRegion).toBe('us-east-1');
  });

  it('both sets complete: web-identity is primary, static keys retained as fallback', () => {
    const config = resolveMediaBackendConfig({ ...REMOTE_BASE, ...STATIC_KEYS, ...WEB_IDENTITY });
    if (config.mode !== 'remote') throw new Error('unreachable');
    expect(config.s3.credentialSource).toBe('web-identity');
    expect(config.s3.webIdentity?.roleArn).toBe(WEB_IDENTITY.AWS_ROLE_ARN);
    expect(config.s3.accessKeyId).toBe('static-access');
    expect(config.s3.secretKey).toBe('static-secret');
  });

  it('neither set complete: throws listing BOTH credential options', () => {
    const expectBothOptions = (env: NodeJS.ProcessEnv) => {
      expect(() => resolveMediaBackendConfig(env)).toThrow(
        /OMNI_MEDIA_S3_ACCESS_KEY \+ OMNI_MEDIA_S3_SECRET_KEY.*AWS_WEB_IDENTITY_TOKEN_FILE \+ AWS_ROLE_ARN/,
      );
    };
    expectBothOptions(REMOTE_BASE);
    // Half a static pair does not count as a complete set.
    expectBothOptions({ ...REMOTE_BASE, OMNI_MEDIA_S3_ACCESS_KEY: 'static-access' });
    // Half a web-identity pair does not count either.
    expectBothOptions({ ...REMOTE_BASE, AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/token' });
    expectBothOptions({ ...REMOTE_BASE, AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/x' });
  });

  it('bucket stays required regardless of the credential source', () => {
    expect(() => resolveMediaBackendConfig({ OMNI_MEDIA_MODE: 'remote', ...STATIC_KEYS })).toThrow(
      /OMNI_MEDIA_S3_BUCKET/,
    );
    expect(() => resolveMediaBackendConfig({ OMNI_MEDIA_MODE: 'remote', ...WEB_IDENTITY })).toThrow(
      /OMNI_MEDIA_S3_BUCKET/,
    );
  });
});
