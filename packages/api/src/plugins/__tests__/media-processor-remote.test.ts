/**
 * Remote-mode media processing against a real MinIO container.
 *
 * The media processor (`processMessageMedia`) hands a *local filesystem path* to
 * the processing service, which reads whole files off disk. In remote mode the
 * message's stored reference (`mediaLocalPath`) is an S3 KEY, not a local path,
 * so the processor must fetch the bytes from the storage backend into a temp
 * file before transcription/vision. This suite asserts, end-to-end against
 * `minio/minio`:
 *   - remote mode fetches the object from S3 and feeds a readable temp file to
 *     `mediaService.process()` (the exact bytes stored in S3, never a local-disk
 *     read of the S3 key), then emits `media.processed`;
 *   - the temp file is removed after processing — on success AND on error;
 *   - local mode still resolves `{basePath}/{key}` on disk and does NOT delete it.
 *
 * If Docker is unavailable the whole suite skips with a clear reason (mirrors
 * the Group-1 s3-backend round-trip test).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalMediaBackend, type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
import type { EventBus, MessageReceivedPayload } from '@omni/core';
import type { Database } from '@omni/db';
import type { MediaProcessingService } from '@omni/media-processing';
import { createBucket, dockerAvailable, getSharedMinio, uniqueBucket } from '../../__tests__/minio-harness';
import type { Services } from '../../services';
import { MediaStorageService } from '../../services/media-storage';
import { type MediaProcessorContext, __test__ } from '../media-processor';

const { processMessageMedia } = __test__;

const BUCKET = uniqueBucket('omni-media-processor-test');
const REGION = 'us-east-1';
const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

const hasDocker = dockerAvailable();
const skipReason = hasDocker ? '' : 'Docker unavailable — skipping MinIO media-processor round-trip';

/** Records the path + bytes the processing service was handed. */
interface ProcessCapture {
  path?: string;
  bytes?: Buffer;
}

/**
 * A fake MediaProcessingService that reads the file at the path it is given —
 * proving the processor materialized readable bytes — and returns a synthetic
 * success (real transcription/vision would need external API keys). Set
 * `throwAfterRead` to exercise the cleanup-on-error path.
 */
function makeFakeMediaService(capture: ProcessCapture, throwAfterRead = false): MediaProcessingService {
  return {
    canProcess: () => true,
    process: async (path: string) => {
      capture.path = path;
      capture.bytes = await readFile(path);
      if (throwAfterRead) throw new Error('synthetic processing failure');
      return {
        success: true,
        content: 'transcribed: hello world',
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

function makeMockServices(mediaLocalPath: string): Services {
  return {
    chats: { findByExternalIdSmart: async () => ({ id: 'chat-uuid' }) },
    messages: { getByExternalId: async () => ({ id: 'msg-uuid', mediaLocalPath, platformTimestamp: null }) },
  } as unknown as Services;
}

function makeContext(opts: {
  mediaStorage: MediaStorageService;
  mediaService: MediaProcessingService;
  mediaLocalPath: string;
  published: Array<{ type: string; payload: Record<string, unknown> }>;
}): MediaProcessorContext {
  const eventBus = {
    publish: async (type: string, payload: Record<string, unknown>) => {
      opts.published.push({ type, payload });
    },
  } as unknown as EventBus;

  return {
    db: makeMockDb(),
    eventBus,
    services: makeMockServices(opts.mediaLocalPath),
    mediaService: opts.mediaService,
    mediaStorage: opts.mediaStorage,
    defaultLanguage: 'pt',
    promptOverrides: {},
  };
}

const audioPayload: MessageReceivedPayload = {
  externalId: 'ext-audio-1',
  chatId: 'chat-1',
  content: { type: 'audio', mimeType: 'audio/ogg' },
} as unknown as MessageReceivedPayload;

describe.skipIf(!hasDocker)('media-processor remote read (MinIO)', () => {
  let remoteService: MediaStorageService;
  const audioKey = 'inst-1/2026-07/aud-1.ogg';
  // Distinctive bytes so a disk-read of the key (which does not exist locally)
  // could never accidentally match the S3 object.
  const audioBytes = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x11, 0x22, 0x33, 0x44]);

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
    // Seed the audio object the processor will fetch from S3.
    await backend.store({ key: audioKey, buffer: audioBytes, mimeType: 'audio/ogg' });
  }, 60_000);

  it('fetches bytes from S3 into a temp file, processes them, and emits media.processed', async () => {
    const capture: ProcessCapture = {};
    const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ctx = makeContext({
      mediaStorage: remoteService,
      mediaService: makeFakeMediaService(capture),
      mediaLocalPath: audioKey,
      published,
    });

    await processMessageMedia(ctx, audioPayload, { instanceId: 'inst-1', channelType: 'whatsapp-baileys' });

    // The processor received a real, readable temp path — not the S3 key and not
    // a path under the local media base dir.
    expect(capture.path).toBeDefined();
    expect(capture.path).not.toBe(audioKey);
    expect(capture.path).not.toContain(audioKey);
    expect(capture.path).toContain('omni-media-');
    expect(capture.path?.endsWith('.ogg')).toBe(true);

    // The bytes handed to processing are exactly what was stored in S3.
    expect(capture.bytes).toBeDefined();
    expect(Array.from(capture.bytes!)).toEqual(Array.from(audioBytes));

    // media.processed carries the synthetic transcription content.
    const processed = published.find((e) => e.type === 'media.processed');
    expect(processed).toBeDefined();
    expect(processed?.payload.content).toBe('transcribed: hello world');

    // The temp file is cleaned up after a successful process.
    expect(existsSync(capture.path!)).toBe(false);
  });

  it('removes the temp file even when processing throws', async () => {
    const capture: ProcessCapture = {};
    const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ctx = makeContext({
      mediaStorage: remoteService,
      mediaService: makeFakeMediaService(capture, /* throwAfterRead */ true),
      mediaLocalPath: audioKey,
      published,
    });

    await expect(
      processMessageMedia(ctx, audioPayload, { instanceId: 'inst-1', channelType: 'whatsapp-baileys' }),
    ).rejects.toThrow('synthetic processing failure');

    // The temp file existed (bytes were read) but was removed by the finally block.
    expect(capture.path).toBeDefined();
    expect(existsSync(capture.path!)).toBe(false);
  });
});

describe('media-processor local read (no MinIO)', () => {
  const localKey = 'inst-local/2026-07/aud-local.ogg';
  const localBytes = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60]);
  const localFullPath = join(MEDIA_BASE_PATH, localKey);
  let localService: MediaStorageService;

  beforeAll(async () => {
    localService = new MediaStorageService(
      {} as unknown as Database,
      MEDIA_BASE_PATH,
      new LocalMediaBackend(MEDIA_BASE_PATH),
    );
    await mkdir(join(MEDIA_BASE_PATH, 'inst-local', '2026-07'), { recursive: true });
    await writeFile(localFullPath, localBytes);
  });

  afterEach(async () => {
    // Recreate the on-disk fixture in case a test asserted its persistence.
    if (!existsSync(localFullPath)) await writeFile(localFullPath, localBytes);
  });

  afterAll(async () => {
    await rm(localFullPath, { force: true });
  });

  it('reads the on-disk path (no temp file) and leaves the file in place', async () => {
    const capture: ProcessCapture = {};
    const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ctx = makeContext({
      mediaStorage: localService,
      mediaService: makeFakeMediaService(capture),
      mediaLocalPath: localKey,
      published,
    });

    await processMessageMedia(ctx, audioPayload, { instanceId: 'inst-local', channelType: 'whatsapp-baileys' });

    // Local mode hands the processor the canonical on-disk path (byte-for-byte
    // the pre-remote behavior), never a temp file.
    expect(capture.path).toBe(localFullPath);
    expect(capture.path).not.toContain('omni-media-');
    expect(Array.from(capture.bytes!)).toEqual(Array.from(localBytes));

    // The on-disk file is NOT deleted by the processor in local mode.
    expect(existsSync(localFullPath)).toBe(true);

    const processed = published.find((e) => e.type === 'media.processed');
    expect(processed?.payload.content).toBe('transcribed: hello world');
  });
});

describe.skipIf(hasDocker)('media-processor remote read (MinIO) (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
