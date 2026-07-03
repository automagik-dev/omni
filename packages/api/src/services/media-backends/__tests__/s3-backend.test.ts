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

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import type { Database } from '@omni/db';
import { MediaStorageService } from '../../media-storage';
import type { S3BackendConfig } from '../config';
import { S3MediaBackend } from '../s3-backend';

const BUCKET = 'omni-media-test';
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
const skipReason = hasDocker ? '' : 'Docker unavailable — skipping MinIO S3 round-trip';

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

describe.skipIf(!hasDocker)('S3MediaBackend against MinIO', () => {
  // Random high port avoids collisions with a locally running MinIO.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const endpoint = `http://127.0.0.1:${port}`;
  let containerId = '';

  const config: S3BackendConfig = {
    endpoint,
    bucket: BUCKET,
    region: REGION,
    accessKeyId: ACCESS_KEY,
    secretKey: SECRET_KEY,
    forcePathStyle: true,
    presignTtlSeconds: 3600,
  };

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
  }, 60_000);

  afterAll(() => {
    if (containerId) {
      Bun.spawnSync(['docker', 'stop', containerId]);
    }
  });

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

    const download = await fetch(url);
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
    const download = await fetch(url);
    expect(download.status).toBe(200);
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual([1, 2, 3]);
  });
});

describe.skipIf(hasDocker)('S3MediaBackend against MinIO (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
