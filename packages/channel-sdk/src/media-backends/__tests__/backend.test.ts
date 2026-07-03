/**
 * Factory behavior + local backend byte-for-byte contract.
 *
 * Two acceptance criteria live here:
 *  - `createMediaBackend` returns a LocalMediaBackend for local mode and an
 *    S3MediaBackend for remote mode.
 *  - NO S3 client is constructed in local mode (verified by trapping the
 *    `Bun.S3Client` constructor and asserting zero calls).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaBackend } from '../index';
import { LocalMediaBackend } from '../local-backend';
import { S3MediaBackend } from '../s3-backend';

describe('createMediaBackend', () => {
  const OriginalS3Client = Bun.S3Client;
  let s3ClientConstructions: number;
  let tmpDir: string;

  beforeEach(() => {
    s3ClientConstructions = 0;
    // Trap the native S3 client constructor so we can assert it is never built
    // in local mode. Cast through unknown because we replace a native class.
    (Bun as unknown as { S3Client: unknown }).S3Client = class extends OriginalS3Client {
      constructor(...args: ConstructorParameters<typeof OriginalS3Client>) {
        s3ClientConstructions++;
        super(...args);
      }
    };
    tmpDir = mkdtempSync(join(tmpdir(), 'media-backend-test-'));
  });

  afterEach(() => {
    (Bun as unknown as { S3Client: typeof OriginalS3Client }).S3Client = OriginalS3Client;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a LocalMediaBackend in local mode and builds no S3 client', () => {
    const backend = createMediaBackend(tmpDir, { mode: 'local' });
    expect(backend).toBeInstanceOf(LocalMediaBackend);
    expect(backend.mode).toBe('local');
    expect(s3ClientConstructions).toBe(0);
  });

  it('defaults to local (no S3 client) when the environment is empty', () => {
    // resolveMediaBackendConfig() reads process.env; the harness runs without
    // OMNI_MEDIA_MODE set, so this exercises the real default path.
    const backend = createMediaBackend(tmpDir);
    expect(backend.mode).toBe('local');
    expect(s3ClientConstructions).toBe(0);
  });

  it('returns an S3MediaBackend and builds exactly one S3 client in remote mode', () => {
    const backend = createMediaBackend(tmpDir, {
      mode: 'remote',
      s3: {
        endpoint: 'http://127.0.0.1:9000',
        bucket: 'omni-media',
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretKey: 'minioadmin',
        forcePathStyle: true,
        presignTtlSeconds: 3600,
      },
    });
    expect(backend).toBeInstanceOf(S3MediaBackend);
    expect(backend.mode).toBe('remote');
    expect(s3ClientConstructions).toBe(1);
  });
});

describe('LocalMediaBackend', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'media-backend-local-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes bytes under basePath/key and returns the key as reference', async () => {
    const backend = new LocalMediaBackend(tmpDir);
    const key = join('inst-1', '2026-07', 'msg-1.png');
    const buffer = Buffer.from([1, 2, 3, 4]);

    const result = await backend.store({ key, buffer, mimeType: 'image/png' });

    expect(result.reference).toBe(key);
    expect(result.size).toBe(4);
    expect(result.mimeType).toBe('image/png');

    const written = readFileSync(join(tmpDir, key));
    expect(Array.from(written)).toEqual([1, 2, 3, 4]);
    expect(existsSync(join(tmpDir, 'inst-1', '2026-07'))).toBe(true);
  });

  it('throws for presignedUrl (local mode has no presigning)', async () => {
    const backend = new LocalMediaBackend(tmpDir);
    await expect(backend.presignedUrl('inst-1/2026-07/msg-1.png')).rejects.toThrow(/remote mode/);
  });
});
