/**
 * S3 backend round-trip against a real MinIO container.
 *
 * Spins an ephemeral `minio/minio` server, creates a bucket with a hand-rolled
 * SigV4 PUT (self-contained — no `mc` sidecar, no `host.docker.internal`), then
 * exercises the acceptance criteria end-to-end:
 *  - `store` uploads bytes to the bucket under a stable key.
 *  - `presignedUrl` returns a GET URL that retrieves the exact bytes + content-type.
 *  - MediaStorageService in remote mode records the S3 KEY (not a URL) as the
 *    reference destined for `messages.mediaLocalPath`.
 *
 * If Docker is unavailable the whole suite skips with a clear reason.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import {
  createBucket,
  dockerAvailable,
  getSharedMinio,
  harnessFetch,
  uniqueBucket,
} from '../../__tests__/minio-harness';
import { MediaStorageService } from '../media-storage';

const BUCKET = uniqueBucket('omni-media-test');
const REGION = 'us-east-1';

const hasDocker = dockerAvailable();
const skipReason = hasDocker ? '' : 'Docker unavailable — skipping MinIO S3 round-trip';

describe.skipIf(!hasDocker)('S3MediaBackend against MinIO', () => {
  let config: S3BackendConfig;

  beforeAll(async () => {
    const minio = await getSharedMinio();
    await createBucket(minio.endpoint, BUCKET);
    config = {
      endpoint: minio.endpoint,
      bucket: BUCKET,
      region: REGION,
      accessKeyId: minio.accessKey,
      secretKey: minio.secretKey,
      forcePathStyle: true,
      presignTtlSeconds: 3600,
    };
  }, 60_000);

  it('stores bytes and presigns a GET URL that returns the exact bytes + content-type', async () => {
    const backend = new S3MediaBackend(config);
    const key = 'inst-1/2026-07/msg-1.png';
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

    const result = await backend.store({ key, buffer: bytes, mimeType: 'image/png' });
    expect(result.reference).toBe(key);
    expect(result.size).toBe(bytes.length);

    const url = await backend.presignedUrl(key, 60);
    expect(url).toContain(`/${BUCKET}/${key}`);
    expect(url).toContain('X-Amz-Signature=');

    const download = await harnessFetch(url);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('image/png');
    const downloaded = new Uint8Array(await download.arrayBuffer());
    expect(Array.from(downloaded)).toEqual(Array.from(bytes));
  });

  it('records the S3 key (not a URL) as the reference in remote mode', async () => {
    const backend = new S3MediaBackend(config);
    // Inject the remote backend; the DB is only touched by updateMessageLocalPath,
    // which we do not call here — we assert the reference the service would persist.
    const service = new MediaStorageService({} as unknown as Database, undefined, backend);

    const stored = await service.storeFromBuffer(
      'inst-9',
      'msg-42',
      Buffer.from([1, 2, 3]),
      'audio/ogg',
      new Date('2026-07-01T00:00:00Z'),
    );

    // The recorded reference is the stable key, never a presigned/expiring URL.
    expect(stored.localPath).toBe('inst-9/2026-07/msg-42.ogg');
    expect(stored.localPath).not.toContain('http');
    expect(stored.localPath).not.toContain('X-Amz-Signature');
    expect(service.getStorageMode()).toBe('remote');

    // And that stable key is retrievable via a presigned URL.
    const url = await service.presignedUrl(stored.localPath, 60);
    const download = await harnessFetch(url);
    expect(download.status).toBe(200);
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual([1, 2, 3]);
  });
});

describe.skipIf(hasDocker)('S3MediaBackend against MinIO (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
