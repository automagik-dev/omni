/**
 * Remote-mode media dispatch against a real MinIO container.
 *
 * Asserts the Group-2 dispatch contract end-to-end:
 *   - `extractMediaFiles` in remote mode presigns the stored S3 key and emits
 *     `ProviderFile.url` (no `path`); in local mode it still emits `path` (no url).
 *   - Audio is excluded in remote mode (transcription path stays URL-less).
 *   - `resolveDispatchMediaPath` + `formatProcessedMedia` put the presigned URL
 *     (remote) / local path (local) into the in-text media line.
 *   - A presign minted with a short TTL is rejected by MinIO once it expires.
 *
 * If Docker is unavailable the whole suite skips with a clear reason (mirrors
 * the Group-1 s3-backend round-trip test).
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { LocalMediaBackend, type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import {
  createBucket,
  getSharedMinio,
  harnessFetch,
  minioIntegrationEnabled,
  uniqueBucket,
} from '../../__tests__/minio-harness';
import { MediaStorageService } from '../../services/media-storage';
import { __test__ } from '../agent-dispatcher';

const { extractMediaFiles, formatProcessedMedia, resolveDispatchMediaPath } = __test__;

const BUCKET = uniqueBucket('omni-media-dispatch-test');
const REGION = 'us-east-1';
const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

const hasDocker = minioIntegrationEnabled();
const skipReason = hasDocker
  ? ''
  : 'MinIO integration disabled (CI opt-in / no Docker) — skipping MinIO remote-dispatch round-trip';

// Build a buffered message shaped like agent-dispatcher's BufferedMessage.
type BufferedLike = Parameters<typeof extractMediaFiles>[0][number];
function bufferedMessage(opts: {
  type: string;
  mimeType?: string;
  mediaUrl?: string;
  mediaLocalPath?: string;
}): BufferedLike {
  return {
    payload: {
      externalId: 'ext-1',
      chatId: 'chat-1',
      from: 'user-1',
      content: { type: opts.type, mimeType: opts.mimeType, mediaUrl: opts.mediaUrl },
      rawPayload: opts.mediaLocalPath ? { mediaLocalPath: opts.mediaLocalPath } : undefined,
    },
    metadata: { instanceId: 'inst-1', traceId: 'trace-1' },
    timestamp: Date.now(),
  } as unknown as BufferedLike;
}

describe.skipIf(!hasDocker)('remote-mode media dispatch (MinIO)', () => {
  let remoteService: MediaStorageService;
  let localService: MediaStorageService;
  const imageKey = 'inst-1/2026-07/img-1.png';
  const audioKey = 'inst-1/2026-07/aud-1.ogg';
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

  beforeAll(async () => {
    const minio = await getSharedMinio();
    await createBucket(minio.endpoint, BUCKET);

    const s3Config: S3BackendConfig = {
      endpoint: minio.endpoint,
      bucket: BUCKET,
      region: REGION,
      accessKeyId: minio.accessKey,
      secretKey: minio.secretKey,
      forcePathStyle: true,
      presignTtlSeconds: 3600,
    };

    const remoteBackend = new S3MediaBackend(s3Config);
    remoteService = new MediaStorageService({} as unknown as Database, undefined, remoteBackend);
    localService = new MediaStorageService(
      {} as unknown as Database,
      MEDIA_BASE_PATH,
      new LocalMediaBackend(MEDIA_BASE_PATH),
    );

    // Seed the objects the dispatch code will presign.
    await remoteBackend.store({ key: imageKey, buffer: imageBytes, mimeType: 'image/png' });
    await remoteBackend.store({ key: audioKey, buffer: Buffer.from([1, 2, 3]), mimeType: 'audio/ogg' });
  }, 180_000);

  it('remote: extractMediaFiles presigns the S3 key into ProviderFile.url (no path)', async () => {
    const files = await extractMediaFiles(
      [bufferedMessage({ type: 'image', mimeType: 'image/png', mediaLocalPath: imageKey })],
      true,
      remoteService,
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.url).toContain(`/${BUCKET}/${imageKey}`);
    expect(files[0]?.url).toContain('X-Amz-Signature=');
    expect(files[0]?.path).toBeUndefined();
    expect(files[0]?.mimeType).toBe('image/png');

    // The presigned URL actually retrieves the stored bytes.
    const download = await harnessFetch(files[0]!.url!);
    expect(download.status).toBe(200);
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array.from(imageBytes));
  });

  it('remote: audio is excluded from presigned files (transcription path stays URL-less)', async () => {
    const files = await extractMediaFiles(
      [bufferedMessage({ type: 'audio', mimeType: 'audio/ogg', mediaLocalPath: audioKey })],
      true,
      remoteService,
    );
    expect(files).toHaveLength(0);
  });

  it('local: extractMediaFiles resolves a local path into ProviderFile.path (no url)', async () => {
    const files = await extractMediaFiles(
      [bufferedMessage({ type: 'image', mimeType: 'image/png', mediaUrl: '/api/v2/media/inst-1/2026-07/img-1.png' })],
      true,
      localService,
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(resolve(join(MEDIA_BASE_PATH, 'inst-1/2026-07/img-1.png')));
    expect(files[0]?.url).toBeUndefined();
  });

  it('remote: processed-media text carries the presigned URL', async () => {
    const ref = await resolveDispatchMediaPath(remoteService, imageKey);
    expect(ref).toContain(`/${BUCKET}/${imageKey}`);
    expect(ref).toContain('X-Amz-Signature=');

    const text = formatProcessedMedia('image', ref, 'a cat', true);
    expect(text).toContain(ref!);
    expect(text).toContain('a cat');
    expect(text).toContain('http');
  });

  it('local: processed-media text carries the local path', async () => {
    const ref = await resolveDispatchMediaPath(localService, 'inst-1/2026-07/img-1.png');
    expect(ref).toBe(resolve(join(MEDIA_BASE_PATH, 'inst-1/2026-07/img-1.png')));

    const text = formatProcessedMedia('image', ref, 'a cat', true);
    expect(text).toContain(ref!);
    expect(text).not.toContain('X-Amz-Signature');
  });

  it('rejects an expired presign (TTL honored by MinIO)', async () => {
    const url = await remoteService.presignedUrl(imageKey, 1);
    // Wait past the 1s TTL (plus MinIO clock-skew slack).
    await new Promise((r) => setTimeout(r, 2500));
    const res = await harnessFetch(url);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
  }, 15_000);
});

describe.skipIf(hasDocker)('remote-mode media dispatch (MinIO) (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
