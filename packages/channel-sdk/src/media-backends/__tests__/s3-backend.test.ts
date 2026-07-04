/**
 * S3 backend endpoint wiring (offline — presigning is pure local SigV4 math).
 *
 * MED-1 contract: `OMNI_MEDIA_S3_PUBLIC_ENDPOINT` (config `publicEndpoint`) is
 * used ONLY for `presignedUrl()`; uploads/reads keep using the internal
 * `endpoint`. Verified by trapping the `Bun.S3Client` constructor (the same
 * device backend.test.ts uses) and asserting which endpoint each constructed
 * client carries, plus asserting the host baked into the presigned URL.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { S3MediaBackend } from '../s3-backend';

const INTERNAL_ENDPOINT = 'http://minio.internal:9000';
const PUBLIC_ENDPOINT = 'https://media.example.com';

const BASE_CONFIG = {
  endpoint: INTERNAL_ENDPOINT,
  bucket: 'omni-media',
  region: 'us-east-1',
  accessKeyId: 'test-access',
  secretKey: 'test-secret',
  forcePathStyle: true,
  presignTtlSeconds: 3600,
};

describe('S3MediaBackend public presign endpoint', () => {
  const OriginalS3Client = Bun.S3Client;
  let constructedEndpoints: Array<string | undefined>;

  beforeEach(() => {
    constructedEndpoints = [];
    // Trap the native S3 client constructor to observe the endpoint each
    // internal client is wired with. Cast through unknown: we replace a native class.
    (Bun as unknown as { S3Client: unknown }).S3Client = class extends OriginalS3Client {
      constructor(...args: ConstructorParameters<typeof OriginalS3Client>) {
        constructedEndpoints.push(args[0]?.endpoint);
        super(...args);
      }
    };
  });

  afterEach(() => {
    (Bun as unknown as { S3Client: typeof OriginalS3Client }).S3Client = OriginalS3Client;
  });

  it('builds one client on the internal endpoint and presigns against it when no public endpoint is set', async () => {
    const backend = new S3MediaBackend(BASE_CONFIG);

    // Storage and presigning share the single internal-endpoint client.
    expect(constructedEndpoints).toEqual([INTERNAL_ENDPOINT]);

    const url = await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    expect(url.startsWith(`${INTERNAL_ENDPOINT}/`)).toBe(true);
    expect(url).toContain('X-Amz-Signature=');
  });

  it('presigns against the public endpoint while storage keeps the internal client', async () => {
    const backend = new S3MediaBackend({ ...BASE_CONFIG, publicEndpoint: PUBLIC_ENDPOINT });

    // Exactly two clients: the storage client first (internal endpoint — the
    // one store/storeStream/read use), then the presign-only public client.
    expect(constructedEndpoints).toEqual([INTERNAL_ENDPOINT, PUBLIC_ENDPOINT]);

    // Presigned URLs carry the externally-reachable host, not the internal one.
    const url = await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    expect(url.startsWith(`${PUBLIC_ENDPOINT}/`)).toBe(true);
    expect(url).not.toContain('minio.internal');
    expect(url).toContain('X-Amz-Signature=');
  });
});
