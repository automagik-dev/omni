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

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { MediaStorageService } from '../../services/media-storage';
import { __test__ } from '../agent-dispatcher';

const { extractMediaFiles } = __test__;

const BUCKET = 'omni-media-e2e-test';
const ACCESS_KEY = 'minioadmin';
const SECRET_KEY = 'minioadmin';
const REGION = 'us-east-1';

function dockerAvailable(): boolean {
  try {
    return Bun.spawnSync(['docker', 'info']).exitCode === 0;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();
const skipReason = hasDocker ? '' : 'Docker unavailable — skipping MinIO remote-media e2e round-trip';

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
  // A distinctive payload so the GET assertion is unambiguous (not the tiny
  // magic-byte fixtures the sibling tests reuse).
  const imageBytes = Buffer.from('OMNI-REMOTE-MEDIA-E2E-\x89PNG\r\n-payload', 'binary');

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
    // The DB is only touched by updateMessageLocalPath, which this flow does not
    // call — storeFromBuffer + presign never read it.
    remoteService = new MediaStorageService({} as unknown as Database, undefined, remoteBackend);
  }, 60_000);

  afterAll(() => {
    if (containerId) Bun.spawnSync(['docker', 'stop', containerId]);
  });

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
    const download = await fetch(providerUrl!);
    expect(download.status).toBe(200);
    const downloaded = new Uint8Array(await download.arrayBuffer());
    expect(Array.from(downloaded)).toEqual(Array.from(imageBytes));
  });
});

describe.skipIf(hasDocker)('remote media e2e (MinIO) (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
