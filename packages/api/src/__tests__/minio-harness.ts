/**
 * Shared MinIO test harness.
 *
 * The remote-media integration tests each need a real `minio/minio` server. Run
 * per-file they can afford one container apiece, but the `pre-push` gate runs the
 * whole suite in ONE `bun test` process, so four `beforeAll`s racing to start
 * four containers concurrently starve Docker and blow the readiness deadline.
 *
 * This module starts exactly ONE container per test process (a cached Promise
 * shared across every importing file) and hands each file its own bucket via
 * `uniqueBucket`, so they never clobber each other. The container is stopped
 * exactly once on process exit — no per-file teardown races.
 */

import { createHash, createHmac } from 'node:crypto';

/**
 * Real `fetch`, captured at module-load time — before any test body runs.
 *
 * Bun executes test FILES concurrently in ONE process, and `globalThis.fetch`
 * is process-global. A sibling file that monkeypatches it inside a test (e.g.
 * `tts.test.ts` swapping fetch for an ElevenLabs stub) would otherwise poison
 * the MinIO round-trips racing alongside it. Every HTTP call this harness — and
 * the MinIO suites — make goes through this captured reference so it stays the
 * genuine implementation regardless of that race. Object IO itself uses
 * `Bun.S3Client`, which is already immune; only bucket-create / health-poll /
 * presigned-GET assertions touch `fetch`.
 */
export const harnessFetch: typeof fetch = globalThis.fetch.bind(globalThis);

export interface SharedMinio {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

const ACCESS_KEY = 'minioadmin';
const SECRET_KEY = 'minioadmin';
const REGION = 'us-east-1';

export function dockerAvailable(): boolean {
  try {
    return Bun.spawnSync(['docker', 'info']).exitCode === 0;
  } catch {
    return false;
  }
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Create a bucket with a signed empty-payload PUT (SigV4, path-style). */
export async function createBucket(endpoint: string, bucket: string): Promise<void> {
  const url = new URL(`${endpoint}/${bucket}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex('');
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', `/${bucket}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, dateStamp), REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await harnessFetch(url, {
    method: 'PUT',
    headers: { Authorization: authorization, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to create bucket: ${response.status} ${await response.text()}`);
  }
}

/** A per-file bucket name so the four suites never share object namespaces. */
export function uniqueBucket(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`.toLowerCase();
}

async function waitForReady(port: number): Promise<void> {
  // Single wait for the shared container — a modestly bumped deadline covers a
  // cold `minio/minio` image pull without the per-file contention we removed.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await harnessFetch(`http://127.0.0.1:${port}/minio/health/ready`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('MinIO did not become ready within 45s');
}

let teardownRegistered = false;
function registerTeardown(containerId: string): void {
  if (teardownRegistered) return;
  teardownRegistered = true;
  let stopped = false;
  const stop = () => {
    if (stopped || !containerId) return;
    stopped = true;
    // Synchronous stop so it completes inside the process-exit handler; the
    // container ran with `--rm`, so this also removes it.
    Bun.spawnSync(['docker', 'stop', containerId]);
  };
  process.once('exit', stop);
}

let sharedMinioPromise: Promise<SharedMinio> | undefined;

async function startSharedMinio(): Promise<SharedMinio> {
  // Random high port avoids collisions with a locally running MinIO.
  const port = 20000 + Math.floor(Math.random() * 20000);
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
  const containerId = proc.stdout.toString().trim();
  registerTeardown(containerId);
  await waitForReady(port);
  return { endpoint: `http://127.0.0.1:${port}`, accessKey: ACCESS_KEY, secretKey: SECRET_KEY, region: REGION };
}

/**
 * Lazily start ONE shared `minio/minio` container for this test process and
 * return its connection info. Every importing file gets the same container.
 */
export function getSharedMinio(): Promise<SharedMinio> {
  sharedMinioPromise ??= startSharedMinio();
  return sharedMinioPromise;
}
