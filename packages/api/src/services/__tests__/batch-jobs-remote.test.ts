/**
 * Batch-job media processing in remote mode against a real MinIO container.
 *
 * `BatchJobService.processItem` hands a *local filesystem path* to the media
 * processing service, which reads whole files off disk. In remote mode the
 * message's stored reference (`mediaLocalPath`) is an S3 KEY, not a local path,
 * so the batch path must fetch the bytes from the storage backend into a temp
 * file before processing — exactly what the realtime processor already does via
 * `MediaStorageService.materializeForProcessing`. This suite asserts, end-to-end
 * against `minio/minio`:
 *   - a batch item whose `mediaLocalPath` is an S3 key SUCCEEDS in remote mode
 *     (before the fix, `processItem` joined the S3 key onto the local base path
 *     and every item failed with a file-not-found error);
 *   - the bytes handed to the processing service are exactly the stored S3
 *     object, via a temp file that is cleaned up afterwards — on success AND on
 *     processing error;
 *   - local mode still resolves `{basePath}/{key}` on disk, creates no temp
 *     file, and does NOT delete the stored file.
 *
 * If Docker is unavailable the whole suite skips with a clear reason (mirrors
 * the sibling media-processor-remote suite).
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalMediaBackend, type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
import type { Database, Message } from '@omni/db';
import type { MediaProcessingService, ProcessingResult } from '@omni/media-processing';
import { createBucket, getSharedMinio, minioIntegrationEnabled, uniqueBucket } from '../../__tests__/minio-harness';
import { BatchJobService } from '../batch-jobs';
import { MediaStorageService } from '../media-storage';

const BUCKET = uniqueBucket('omni-batch-jobs-test');
const REGION = 'us-east-1';
const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

const hasDocker = minioIntegrationEnabled();
const skipReason = hasDocker
  ? ''
  : 'MinIO integration disabled (CI opt-in / no Docker) — skipping MinIO batch-jobs round-trip';

/** Records the path + bytes the processing service was handed. */
interface ProcessCapture {
  path?: string;
  bytes?: Buffer;
}

/**
 * A fake MediaProcessingService that reads the file at the path it is given —
 * proving the batch path materialized readable bytes — and returns a synthetic
 * success (real transcription would need external API keys). Set
 * `throwAfterRead` to exercise the cleanup-on-error path.
 */
function makeFakeMediaService(capture: ProcessCapture, throwAfterRead = false): MediaProcessingService {
  return {
    canProcess: () => true,
    process: async (path: string) => {
      capture.path = path;
      capture.bytes = await readFile(path);
      if (throwAfterRead) throw new Error('synthetic batch processing failure');
      return {
        success: true,
        content: 'transcribed: batch hello',
        contentFormat: 'text',
        processingType: 'transcription',
        provider: 'fake',
        model: 'fake-model',
        processingTimeMs: 1,
        costCents: 0,
      };
    },
  } as unknown as MediaProcessingService;
}

/** Chainable no-op DB — persistProcessingResult only writes; we assert elsewhere. */
function makeMockDb(): Database {
  return {
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({ values: async () => {} }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  } as unknown as Database;
}

/**
 * The members under test are private on BatchJobService (TypeScript-only
 * visibility). This narrow view injects the remote/local storage + fake media
 * service and drives `processItem` directly, without touching `any`.
 */
interface BatchJobServiceInternals {
  mediaStorage: MediaStorageService;
  mediaServicePromise: Promise<MediaProcessingService> | null;
  processItem(instanceId: string, message: Message, batchJobId: string): Promise<ProcessingResult>;
}

function makeBatchInternals(storage: MediaStorageService, mediaService: MediaProcessingService) {
  const service = new BatchJobService(makeMockDb(), null);
  const internals = service as unknown as BatchJobServiceInternals;
  internals.mediaStorage = storage;
  internals.mediaServicePromise = Promise.resolve(mediaService);
  return internals;
}

function makeMessage(mediaLocalPath: string): Message {
  return {
    id: 'msg-batch-1',
    mediaMimeType: 'audio/ogg',
    mediaLocalPath,
    mediaUrl: null,
    textContent: null,
    platformTimestamp: null,
  } as unknown as Message;
}

describe.skipIf(!hasDocker)('batch-jobs remote mode (MinIO)', () => {
  let remoteService: MediaStorageService;
  const audioKey = 'inst-batch/2026-07/aud-batch.ogg';
  // Distinctive bytes so a disk-read of the key (which does not exist locally)
  // could never accidentally match the S3 object.
  const audioBytes = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0xaa, 0xbb, 0xcc, 0xdd]);

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

    const backend = new S3MediaBackend(s3Config);
    remoteService = new MediaStorageService({} as unknown as Database, undefined, backend);
    // Seed the audio object the batch item will fetch from S3.
    await backend.store({ key: audioKey, buffer: audioBytes, mimeType: 'audio/ogg' });
  }, 180_000);

  it('succeeds on an item whose mediaLocalPath is an S3 key, feeding the stored bytes via a temp file', async () => {
    const capture: ProcessCapture = {};
    const internals = makeBatchInternals(remoteService, makeFakeMediaService(capture));

    const result = await internals.processItem('inst-batch', makeMessage(audioKey), 'job-1');

    // The item succeeds — before the remote-mode fix this was a guaranteed
    // failure: processItem joined the S3 key onto the local base path and the
    // processing service found no file there.
    expect(result.success).toBe(true);
    expect(result.content).toBe('transcribed: batch hello');

    // The processing service received a real, readable temp path — not the S3
    // key and not a path under the local media base dir.
    expect(capture.path).toBeDefined();
    expect(capture.path).not.toBe(audioKey);
    expect(capture.path).not.toContain(audioKey);
    expect(capture.path).toContain('omni-media-');
    expect(capture.path?.endsWith('.ogg')).toBe(true);

    // The bytes handed to processing are exactly what was stored in S3.
    expect(capture.bytes).toBeDefined();
    expect(Array.from(capture.bytes ?? [])).toEqual(Array.from(audioBytes));

    // The temp file is cleaned up after a successful process.
    expect(capture.path).toBeDefined();
    expect(existsSync(capture.path ?? '')).toBe(false);
  });

  it('removes the temp file even when processing throws', async () => {
    const capture: ProcessCapture = {};
    const internals = makeBatchInternals(remoteService, makeFakeMediaService(capture, /* throwAfterRead */ true));

    await expect(internals.processItem('inst-batch', makeMessage(audioKey), 'job-2')).rejects.toThrow(
      'synthetic batch processing failure',
    );

    // The temp file existed (bytes were read) but was removed by the finally block.
    expect(capture.path).toBeDefined();
    expect(existsSync(capture.path ?? '')).toBe(false);
  });
});

describe('batch-jobs local mode (no MinIO)', () => {
  const localKey = 'inst-batch-local/2026-07/aud-batch-local.ogg';
  const localBytes = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55]);
  const localFullPath = join(MEDIA_BASE_PATH, localKey);
  let localService: MediaStorageService;

  beforeAll(async () => {
    localService = new MediaStorageService(
      {} as unknown as Database,
      MEDIA_BASE_PATH,
      new LocalMediaBackend(MEDIA_BASE_PATH),
    );
    await mkdir(join(MEDIA_BASE_PATH, 'inst-batch-local', '2026-07'), { recursive: true });
    await writeFile(localFullPath, localBytes);
  });

  it('reads the on-disk path (no temp file) and leaves the file in place', async () => {
    const capture: ProcessCapture = {};
    const internals = makeBatchInternals(localService, makeFakeMediaService(capture));

    const result = await internals.processItem('inst-batch-local', makeMessage(localKey), 'job-3');

    expect(result.success).toBe(true);

    // Local mode hands the processor the canonical on-disk path (byte-for-byte
    // the pre-remote behavior), never a temp file.
    expect(capture.path).toBe(localFullPath);
    expect(capture.path).not.toContain('omni-media-');
    expect(Array.from(capture.bytes ?? [])).toEqual(Array.from(localBytes));

    // The on-disk file is NOT deleted by batch processing in local mode.
    expect(existsSync(localFullPath)).toBe(true);

    await rm(localFullPath, { force: true });
  });
});

describe.skipIf(hasDocker)('batch-jobs remote mode (MinIO) (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
