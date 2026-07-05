/**
 * GET /media/:instanceId/* serving contract (PR #770 LOW-1 + LOW-2).
 *
 * LOW-1 — the route must distinguish "object gone" (404) from "backend down
 * right now" (503) so clients retry transient S3/disk failures instead of
 * caching a lying 404.
 *
 * LOW-2 — bytes are served WITHOUT full-object buffering: Range requests
 * fetch exactly the requested bytes (positional read / S3 ranged GET) and
 * full GETs stream. Status/header semantics (200/206, Content-Range,
 * Accept-Ranges, Content-Type, Content-Length) must hold in local AND remote
 * mode.
 *
 * Local mode runs everywhere; the remote (MinIO container) suite follows the
 * shared harness opt-in rules. Both live in ONE file because they inject the
 * media route's module-level storage singleton — test files may run
 * concurrently in one Bun process, but tests within a file are sequential.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MediaStorageBackend, type S3BackendConfig, S3MediaBackend } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { createBucket, getSharedMinio, minioIntegrationEnabled, uniqueBucket } from '../../../__tests__/minio-harness';
import { MediaStorageService } from '../../../services/media-storage';
import type { AppVariables } from '../../../types';
import { __test__, mediaRoutes } from '../media';

const fakeDb = {} as unknown as Database;
const INSTANCE_ID = '11111111-2222-4333-8444-555555555555';

function buildApp(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route('/api/v2/media', mediaRoutes);
  return app;
}

/** A patterned payload where every byte is position-derived (range proofs). */
function patternedBuffer(size: number): Buffer {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buffer[i] = (i * 7 + (i >> 8)) & 0xff;
  return buffer;
}

afterEach(() => {
  __test__.setMediaStorage(null);
});

describe('GET /media/:instanceId/* — local mode', () => {
  let tmpDir: string;
  let service: MediaStorageService;
  let storedKey: string;
  const payload = patternedBuffer(64 * 1024);
  const app = buildApp();

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'media-route-local-'));
    service = new MediaStorageService(fakeDb, tmpDir);
    const stored = await service.storeFromBuffer(
      INSTANCE_ID,
      'msg-local-1',
      payload,
      'video/mp4',
      new Date('2026-07-01T00:00:00Z'),
    );
    storedKey = stored.localPath;
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function url(): string {
    return `http://local.test/api/v2/media/${storedKey}`;
  }

  it('serves a full GET with 200, exact bytes and streaming-compatible headers', async () => {
    __test__.setMediaStorage(service);
    const res = await app.request(url());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Length')).toBe(String(payload.length));
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Cache-Control')).toContain('max-age=31536000');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(payload)).toBe(true);
  });

  it('serves a bounded Range request with 206 and exactly the requested bytes', async () => {
    __test__.setMediaStorage(service);
    const res = await app.request(url(), { headers: { Range: 'bytes=1000-2999' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 1000-2999/${payload.length}`);
    expect(res.headers.get('Content-Length')).toBe('2000');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(payload.subarray(1000, 3000))).toBe(true);
  });

  it('serves an open-ended Range request to the end of the object', async () => {
    __test__.setMediaStorage(service);
    const start = payload.length - 512;
    const res = await app.request(url(), { headers: { Range: `bytes=${start}-` } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes ${start}-${payload.length - 1}/${payload.length}`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(payload.subarray(start))).toBe(true);
  });

  it('clamps a Range whose end exceeds the object size', async () => {
    __test__.setMediaStorage(service);
    const res = await app.request(url(), { headers: { Range: `bytes=0-${payload.length + 5000}` } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-${payload.length - 1}/${payload.length}`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(payload.length);
  });

  it('answers 416 for a Range starting beyond the object', async () => {
    __test__.setMediaStorage(service);
    const res = await app.request(url(), { headers: { Range: `bytes=${payload.length}-` } });
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${payload.length}`);
  });

  it('returns 404 for a missing object', async () => {
    __test__.setMediaStorage(service);
    const res = await app.request(`http://local.test/api/v2/media/${INSTANCE_ID}/2026-07/nope.mp4`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for an invalid instance id (regression)', async () => {
    __test__.setMediaStorage(service);
    const res = await app.request('http://local.test/api/v2/media/not-a-uuid/2026-07/x.mp4');
    expect(res.status).toBe(400);
  });

  it('returns 503 (not 404) when the backend fails transiently', async () => {
    const transient = new Error('connect ECONNREFUSED') as Error & { code: string };
    transient.code = 'ConnectionRefused';
    const failingBackend: MediaStorageBackend = {
      mode: 'remote',
      store: async ({ key, buffer, mimeType }) => ({ reference: key, size: buffer.length, mimeType }),
      storeStream: async ({ key, mimeType }) => ({ reference: key, size: 0, mimeType }),
      read: async () => {
        throw transient;
      },
      stat: async () => {
        throw transient;
      },
      readRange: async () => {
        throw transient;
      },
      readStream: async () => {
        throw transient;
      },
      presignedUrl: async (key) => `https://s3.example/${key}`,
    };
    __test__.setMediaStorage(new MediaStorageService(fakeDb, undefined, failingBackend));

    const res = await app.request(url());
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('MEDIA_BACKEND_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Remote mode against a real MinIO container
// ---------------------------------------------------------------------------

const hasMinio = minioIntegrationEnabled();
const skipReason = hasMinio
  ? ''
  : 'MinIO integration disabled (CI opt-in / no Docker) — skipping remote media route suite';

describe.skipIf(!hasMinio)('GET /media/:instanceId/* — remote mode (MinIO)', () => {
  const BUCKET = uniqueBucket('omni-media-route-test');
  const app = buildApp();
  let remoteService: MediaStorageService;
  let minioEndpoint: string;
  let minioAccessKey: string;
  let minioSecretKey: string;
  let storedKey: string;
  // Multi-MB object so range serving is meaningfully exercised (4 MiB spans
  // multiple S3 ranged-GET chunks and would be an obvious heap hit if buffered
  // per seek).
  const payload = patternedBuffer(4 * 1024 * 1024);

  beforeAll(async () => {
    const minio = await getSharedMinio();
    minioEndpoint = minio.endpoint;
    minioAccessKey = minio.accessKey;
    minioSecretKey = minio.secretKey;
    await createBucket(minio.endpoint, BUCKET);

    const s3Config: S3BackendConfig = {
      endpoint: minio.endpoint,
      bucket: BUCKET,
      region: minio.region,
      accessKeyId: minio.accessKey,
      secretKey: minio.secretKey,
      forcePathStyle: true,
      presignTtlSeconds: 3600,
    };
    remoteService = new MediaStorageService(fakeDb, undefined, new S3MediaBackend(s3Config));

    const stored = await remoteService.storeFromBuffer(
      INSTANCE_ID,
      'msg-remote-1',
      payload,
      'video/mp4',
      new Date('2026-07-01T00:00:00Z'),
    );
    storedKey = stored.localPath;
  }, 180_000);

  function url(): string {
    return `http://local.test/api/v2/media/${storedKey}`;
  }

  it('serves a Range request via a ranged S3 GET: 206 with exactly the requested bytes', async () => {
    __test__.setMediaStorage(remoteService);
    const start = 1024 * 1024;
    const end = 2 * 1024 * 1024 - 1; // exactly 1 MiB
    const res = await app.request(url(), { headers: { Range: `bytes=${start}-${end}` } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes ${start}-${end}/${payload.length}`);
    expect(res.headers.get('Content-Length')).toBe(String(end - start + 1));
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(end - start + 1);
    expect(body.equals(payload.subarray(start, end + 1))).toBe(true);
  });

  it('serves a full GET as a 200 stream with the exact object bytes and length', async () => {
    __test__.setMediaStorage(remoteService);
    const res = await app.request(url());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe(String(payload.length));
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');

    // Consume incrementally (as a video element would) and verify the bytes.
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader!.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    expect(received).toBe(payload.length);
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  });

  it('returns 404 for a missing S3 key (NoSuchKey) — LOW-1 not-found path', async () => {
    __test__.setMediaStorage(remoteService);
    const res = await app.request(`http://local.test/api/v2/media/${INSTANCE_ID}/2026-07/does-not-exist.mp4`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 503 when the S3 endpoint is unreachable — LOW-1 transient path', async () => {
    const unreachable: S3BackendConfig = {
      endpoint: 'http://127.0.0.1:9', // discard port — nothing listens
      bucket: BUCKET,
      region: 'us-east-1',
      accessKeyId: minioAccessKey,
      secretKey: minioSecretKey,
      forcePathStyle: true,
      presignTtlSeconds: 3600,
    };
    __test__.setMediaStorage(new MediaStorageService(fakeDb, undefined, new S3MediaBackend(unreachable)));

    const res = await app.request(url());
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('MEDIA_BACKEND_UNAVAILABLE');
  });

  it('returns 503 when credentials are rejected — LOW-1 config-failure path', async () => {
    const badCreds: S3BackendConfig = {
      endpoint: minioEndpoint,
      bucket: BUCKET,
      region: 'us-east-1',
      accessKeyId: 'wrong-access-key',
      secretKey: 'wrong-secret-key',
      forcePathStyle: true,
      presignTtlSeconds: 3600,
    };
    __test__.setMediaStorage(new MediaStorageService(fakeDb, undefined, new S3MediaBackend(badCreds)));

    const res = await app.request(url());
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('MEDIA_BACKEND_UNAVAILABLE');
  });
});

describe.skipIf(hasMinio)('GET /media route remote mode (MinIO) (skipped)', () => {
  it.skip(skipReason || 'skipped', () => {});
});
