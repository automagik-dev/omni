/**
 * End-to-end proof of the remote media path against a real MinIO container.
 *
 * Unlike the sibling remote tests, this one starts at the PUBLIC ingest API
 * (`MediaStorageService.storeFromBuffer`) and follows the bytes all the way to
 * an agent-consumable link:
 *
 *   1. In remote mode, store a media item via `MediaStorageService` (the same
 *      call the ingest path uses) → yields a stable S3 KEY, never a URL.
 *   2. Drive the dispatch path (`extractMediaFiles`) over a buffered message
 *      carrying that key → produces a `ProviderFile.url` presigned GET link.
 *   3. `fetch()` that presigned URL → asserts HTTP 200 and the EXACT stored
 *      bytes come back from MinIO.
 *
 * This closes the loop the wish cares about: stored media → presigned
 * `ProviderFile.url` → GET returns the stored object bytes.
 *
 * If Docker is unavailable the whole suite skips with a clear reason (mirrors
 * the Group-1 s3-backend round-trip test).
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
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

const { extractMediaFiles } = __test__;

const BUCKET = uniqueBucket('omni-media-e2e-test');
const REGION = 'us-east-1';

const hasDocker = minioIntegrationEnabled();
const skipReason = hasDocker
  ? ''
  : 'MinIO integration disabled (CI opt-in / no Docker) — skipping MinIO remote-media e2e round-trip';

// Build a buffered message shaped like agent-dispatcher's BufferedMessage.
type BufferedLike = Parameters<typeof extractMediaFiles>[0][number];
function bufferedMessage(opts: { type: string; mimeType?: string; mediaLocalPath: string }): BufferedLike {
  return {
    payload: {
      externalId: 'ext-1',
      chatId: 'chat-1',
      from: 'user-1',
      content: { type: opts.type, mimeType: opts.mimeType },
      rawPayload: { mediaLocalPath: opts.mediaLocalPath },
    },
    metadata: { instanceId: 'inst-1', traceId: 'trace-1' },
    timestamp: Date.now(),
  } as unknown as BufferedLike;
}

describe.skipIf(!hasDocker)('remote media e2e: stored media → presigned ProviderFile.url → GET bytes (MinIO)', () => {
  let remoteService: MediaStorageService;
  // A distinctive payload so the GET assertion is unambiguous (not the tiny
  // magic-byte fixtures the sibling tests reuse).
  const imageBytes = Buffer.from('OMNI-REMOTE-MEDIA-E2E-\x89PNG\r\n-payload', 'binary');

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
    // The DB is only touched by updateMessageLocalPath, which this flow does not
    // call — storeFromBuffer + presign never read it.
    remoteService = new MediaStorageService({} as unknown as Database, undefined, remoteBackend);
  }, 180_000);

  it('stores via MediaStorageService, presigns through dispatch, and the GET returns the exact bytes', async () => {
    // 1. Ingest: store through the public service API. Remote mode records the
    //    stable S3 key (never a URL) as the reference.
    expect(remoteService.getStorageMode()).toBe('remote');
    const stored = await remoteService.storeFromBuffer(
      'inst-1',
      'msg-e2e-1',
      imageBytes,
      'image/png',
      new Date('2026-07-03T00:00:00Z'),
    );
    expect(stored.localPath).not.toContain('http');
    expect(stored.localPath).not.toContain('X-Amz-Signature');

    // 2. Dispatch: drive extractMediaFiles over a message carrying that key.
    //    Remote mode presigns the key into ProviderFile.url (no path).
    const files = await extractMediaFiles(
      [bufferedMessage({ type: 'image', mimeType: 'image/png', mediaLocalPath: stored.localPath })],
      true,
      remoteService,
    );
    expect(files).toHaveLength(1);
    const providerUrl = files[0]?.url;
    expect(providerUrl).toBeDefined();
    expect(providerUrl).toContain(`/${BUCKET}/${stored.localPath}`);
    expect(providerUrl).toContain('X-Amz-Signature=');
    expect(files[0]?.path).toBeUndefined();

    // 3. Retrieval: the presigned URL GET returns HTTP 200 and the exact bytes.
    const download = await harnessFetch(providerUrl!);
    expect(download.status).toBe(200);
    const downloaded = new Uint8Array(await download.arrayBuffer());
    expect(Array.from(downloaded)).toEqual(Array.from(imageBytes));
  });

  it('serves remote-stored media through the backend-aware route read (GET /media path)', async () => {
    // The persisted mediaUrl points at GET /api/v2/media/<key>, which serves via
    // readMediaViaBackend — in remote mode that must S3-GET the key, not 404 on
    // a local-disk lookup (PR #761 review finding).
    const stored = await remoteService.storeFromBuffer(
      'inst-1',
      'msg-e2e-route',
      imageBytes,
      'image/png',
      new Date('2026-07-03T00:00:00Z'),
    );

    const served = await remoteService.readMediaViaBackend(stored.localPath);
    expect(served).not.toBeNull();
    expect(served?.size).toBe(imageBytes.length);
    expect(Array.from(new Uint8Array(served!.buffer))).toEqual(Array.from(imageBytes));

    // Missing keys still resolve to null (the route's 404 path).
    expect(await remoteService.readMediaViaBackend('inst-1/2026-07/does-not-exist.png')).toBeNull();
  });
});

describe.skipIf(hasDocker)('remote media e2e (MinIO) (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
