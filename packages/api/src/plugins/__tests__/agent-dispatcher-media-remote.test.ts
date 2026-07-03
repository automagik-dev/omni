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

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { join, resolve } from 'node:path';
import { LocalMediaBackend, type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { MediaStorageService } from '../../services/media-storage';
import { __test__ } from '../agent-dispatcher';

const { extractMediaFiles, formatProcessedMedia, resolveDispatchMediaPath } = __test__;

const BUCKET = 'omni-media-dispatch-test';
const ACCESS_KEY = 'minioadmin';
const SECRET_KEY = 'minioadmin';
const REGION = 'us-east-1';
const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

function dockerAvailable(): boolean {
  try {
    return Bun.spawnSync(['docker', 'info']).exitCode === 0;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();
const skipReason = hasDocker ? '' : 'Docker unavailable — skipping MinIO remote-dispatch round-trip';

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Create a bucket with a signed empty-payload PUT (SigV4, path-style). */
async function createBucket(endpoint: string): Promise<void> {
  const url = new URL(`${endpoint}/${BUCKET}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex('');
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', `/${BUCKET}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, dateStamp), REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: authorization, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to create bucket: ${response.status} ${await response.text()}`);
  }
}

async function waitForReady(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/minio/health/ready`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('MinIO did not become ready within 30s');
}

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
  const port = 20000 + Math.floor(Math.random() * 20000);
  const endpoint = `http://127.0.0.1:${port}`;
  let containerId = '';

  const s3Config: S3BackendConfig = {
    endpoint,
    bucket: BUCKET,
    region: REGION,
    accessKeyId: ACCESS_KEY,
    secretKey: SECRET_KEY,
    forcePathStyle: true,
    presignTtlSeconds: 3600,
  };

  let remoteService: MediaStorageService;
  let localService: MediaStorageService;
  const imageKey = 'inst-1/2026-07/img-1.png';
  const audioKey = 'inst-1/2026-07/aud-1.ogg';
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

  beforeAll(async () => {
    const proc = Bun.spawnSync([
      'docker',
      'run',
      '--rm',
      '-d',
      '-p',
      `${port}:9000`,
      '-e',
      `MINIO_ROOT_USER=${ACCESS_KEY}`,
      '-e',
      `MINIO_ROOT_PASSWORD=${SECRET_KEY}`,
      'minio/minio',
      'server',
      '/data',
    ]);
    if (proc.exitCode !== 0) {
      throw new Error(`docker run failed: ${proc.stderr.toString()}`);
    }
    containerId = proc.stdout.toString().trim();
    await waitForReady(port);
    await createBucket(endpoint);

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
  }, 60_000);

  afterAll(() => {
    if (containerId) Bun.spawnSync(['docker', 'stop', containerId]);
  });

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
    const download = await fetch(files[0]!.url!);
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
    const res = await fetch(url);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
  }, 15_000);
});

describe.skipIf(hasDocker)('remote-mode media dispatch (MinIO) (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
