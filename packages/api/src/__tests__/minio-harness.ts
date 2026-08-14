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

import { createHash, createHmac, randomUUID } from 'node:crypto';

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

function dockerAvailable(): boolean {
  try {
    return Bun.spawnSync(['docker', 'info']).exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Whether the MinIO container-integration suites should actually run.
 *
 * They need a real `minio/minio` container. Locally (pre-push) that is fine, but
 * on a shared/loaded CI runner the container's readiness probe intermittently
 * blows the 120s deadline (~50% flake observed), which would red the whole
 * Quality Gate for entirely unrelated PRs. So in CI these suites are OPT-IN:
 * set `MINIO_INTEGRATION=1` (e.g. a dedicated integration job) to run them;
 * otherwise they skip deterministically. Docker is still required either way,
 * and local runs (no `CI` env) always run when Docker is present.
 */
export function minioIntegrationEnabled(): boolean {
  // Explicit opt-out, honoured anywhere. A dev box whose Docker cannot publish
  // ports (no bridge networking) starts the container fine and then waits out
  // the full 120s readiness budget — once per suite. Six suites is ~12min of
  // pre-push spent proving the same thing.
  if (process.env.MINIO_INTEGRATION === '0') return false;
  if (!dockerAvailable()) return false;
  if (process.env.CI === 'true' && process.env.MINIO_INTEGRATION !== '1') return false;
  return true;
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

type HarnessSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

interface SyncCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ProcessHooks {
  readonly pid: number;
  once(event: 'exit' | HarnessSignal, listener: () => void): void;
  removeListener(event: HarnessSignal, listener: () => void): void;
  kill(pid: number, signal: HarnessSignal): boolean;
}

export interface SharedMinioHarnessDependencies {
  runSync(command: string[]): SyncCommandResult;
  process: ProcessHooks;
  readyFetch(url: string, options: { signal: AbortSignal }): Promise<{ ok: boolean }>;
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  sessionId: string;
  readinessTimeoutMs: number;
  readyRequestTimeoutMs: number;
  reportCleanupFailure(message: string): void;
}

function runSync(command: string[]): SyncCommandResult {
  const result = Bun.spawnSync(command);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

const processHooks: ProcessHooks = {
  get pid() {
    return process.pid;
  },
  once(event, listener) {
    process.once(event, listener);
  },
  removeListener(event, listener) {
    process.removeListener(event, listener);
  },
  kill(pid, signal) {
    return process.kill(pid, signal);
  },
};

async function fetchReadyWithTimeout(
  url: string,
  timeoutMs: number,
  dependencies: SharedMinioHarnessDependencies,
): Promise<{ ok: boolean }> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      dependencies.readyFetch(url, { signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`MinIO readiness request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    controller.abort();
  }
}

async function waitForReady(port: number, dependencies: SharedMinioHarnessDependencies): Promise<void> {
  // Single wait for the shared container. Generous deadline: on a loaded CI
  // runner (Blacksmith 4vcpu, full suite hammering the box) MinIO has been
  // observed to need well over 45s to serve its readiness probe.
  const deadline = dependencies.now() + dependencies.readinessTimeoutMs;
  while (dependencies.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - dependencies.now());
      const requestTimeoutMs = Math.min(dependencies.readyRequestTimeoutMs, remainingMs);
      const res = await fetchReadyWithTimeout(
        `http://127.0.0.1:${port}/minio/health/ready`,
        requestTimeoutMs,
        dependencies,
      );
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await dependencies.sleep(500);
  }
  throw new Error(`MinIO did not become ready within ${dependencies.readinessTimeoutMs / 1000}s`);
}

/** Container state + log tail for actionable CI failure messages. */
function describeContainerFailure(containerId: string, run: SharedMinioHarnessDependencies['runSync']): string {
  const state = run(['docker', 'inspect', '-f', '{{.State.Status}} exit={{.State.ExitCode}}', containerId]);
  const logs = run(['docker', 'logs', '--tail', '15', containerId]);
  const stateText = state.exitCode === 0 ? state.stdout.trim() : 'container gone (--rm removed it)';
  const logText = logs.exitCode === 0 ? `${logs.stdout}${logs.stderr}`.trim() : '(no logs)';
  return `container state: ${stateText}\ncontainer logs:\n${logText}`;
}

export class MinioContainerLifecycle {
  private readonly liveContainerIds = new Set<string>();
  private handlersRegistered = false;
  private launchInProgress = false;
  private pendingSignal: HarnessSignal | undefined;
  private signalReraised = false;
  private readonly signalHandlers = new Map<HarnessSignal, () => void>();

  constructor(private readonly dependencies: SharedMinioHarnessDependencies) {}

  prepareForLaunch(): void {
    this.registerHandlers();
    if (this.pendingSignal) throw new Error(`Refusing to launch MinIO after ${this.pendingSignal}`);
    if (this.launchInProgress) throw new Error('Refusing to launch MinIO while another launch is pending');

    // A previous readiness failure may have left an exact ID tracked when its
    // synchronous stop failed. Retry that cleanup, but never start another
    // container until every previous ID has been successfully stopped.
    this.cleanup();
    if (this.liveContainerIds.size > 0) {
      throw new Error(
        `Refusing to launch MinIO while ${this.liveContainerIds.size} tracked container(s) still require cleanup`,
      );
    }
  }

  beginLaunch(): void {
    if (this.pendingSignal) throw new Error(`Refusing to launch MinIO after ${this.pendingSignal}`);
    this.launchInProgress = true;
  }

  track(containerId: string): void {
    this.launchInProgress = false;
    if (!containerId) {
      this.reraisePendingSignal();
      throw new Error('docker run returned an empty container ID');
    }
    this.liveContainerIds.add(containerId);

    // Signal callbacks normally run after spawnSync returns. This also closes
    // the narrower runtime race where a callback fires while the launch is in
    // progress: defer re-raise until the returned ID is tracked and stopped.
    if (this.pendingSignal) {
      try {
        this.cleanup();
      } finally {
        this.reraisePendingSignal();
      }
      throw new Error(`MinIO launch interrupted by ${this.pendingSignal}`);
    }
  }

  abortLaunch(): void {
    this.launchInProgress = false;
    this.reraisePendingSignal();
  }

  stop(containerId: string): boolean {
    if (!this.liveContainerIds.has(containerId)) return true;

    // Synchronous stop is intentional: exit and signal handlers cannot await,
    // and `--rm` removes exactly this tracked container after it stops.
    let result: SyncCommandResult;
    try {
      result = this.dependencies.runSync(['docker', 'stop', '--time', '10', containerId]);
    } catch (error) {
      this.reportCleanupFailure(
        `Failed to stop tracked MinIO test container ${containerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
    if (result.exitCode === 0) {
      this.liveContainerIds.delete(containerId);
      return true;
    }

    this.reportCleanupFailure(
      `Failed to stop tracked MinIO test container ${containerId}: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
    );
    return false;
  }

  private cleanup = (): void => {
    for (const containerId of [...this.liveContainerIds]) {
      try {
        this.stop(containerId);
      } catch (error) {
        // Cleanup is best-effort per exact ID. A faulty command adapter or
        // reporter must not prevent later IDs from being attempted.
        this.reportCleanupFailure(
          `Unexpected cleanup failure for tracked MinIO test container ${containerId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  };

  private reportCleanupFailure(message: string): void {
    try {
      this.dependencies.reportCleanupFailure(message);
    } catch {
      // Never let diagnostics suppress cleanup or native signal semantics.
    }
  }

  private reraisePendingSignal(): void {
    if (!this.pendingSignal || this.signalReraised) return;
    this.signalReraised = true;
    const signal = this.pendingSignal;
    const handler = this.signalHandlers.get(signal);
    if (handler) this.dependencies.process.removeListener(signal, handler);
    this.dependencies.process.kill(this.dependencies.process.pid, signal);
  }

  private registerHandlers(): void {
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;
    this.dependencies.process.once('exit', this.cleanup);

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      const handler = () => {
        this.pendingSignal = signal;
        try {
          this.cleanup();
        } finally {
          // When docker run is still blocking, wait for its exact returned ID
          // so `track` can stop it before preserving native signal semantics.
          if (!this.launchInProgress) this.reraisePendingSignal();
        }
      };
      this.signalHandlers.set(signal, handler);
      this.dependencies.process.once(signal, handler);
    }
  }
}

export function createSharedMinioHarness(dependencies: SharedMinioHarnessDependencies): {
  getSharedMinio(): Promise<SharedMinio>;
} {
  const lifecycle = new MinioContainerLifecycle(dependencies);
  let sharedMinioPromise: Promise<SharedMinio> | undefined;

  async function startSharedMinio(): Promise<SharedMinio> {
    // Register signal/exit cleanup before any blocking Docker operation and
    // fail closed if an earlier container has not been successfully stopped.
    lifecycle.prepareForLaunch();

    // Pre-pull explicitly so a cold image cache (fresh CI runner) cannot eat
    // into the readiness budget or fail the run with an opaque timeout.
    const pull = dependencies.runSync(['docker', 'pull', 'minio/minio']);
    if (pull.exitCode !== 0) {
      throw new Error(`docker pull minio/minio failed: ${pull.stderr}`);
    }

    // Random high port avoids collisions with a locally running MinIO.
    const port = 20000 + Math.floor(dependencies.random() * 20000);
    lifecycle.beginLaunch();
    let proc: SyncCommandResult;
    try {
      proc = dependencies.runSync([
        'docker',
        'run',
        '--rm',
        '-d',
        '--label',
        'com.automagik.omni.test-harness=minio',
        '--label',
        `com.automagik.omni.test-session=${dependencies.sessionId}`,
        '--cpus',
        '1',
        '--memory',
        '512m',
        '--pids-limit',
        '256',
        '--tmpfs',
        '/data:rw,noexec,nosuid,size=256m',
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
    } catch (error) {
      lifecycle.abortLaunch();
      throw error;
    }
    if (proc.exitCode !== 0) {
      lifecycle.abortLaunch();
      throw new Error(`docker run failed: ${proc.stderr}`);
    }
    const containerId = proc.stdout.trim();
    lifecycle.track(containerId);
    try {
      await waitForReady(port, dependencies);
    } catch (error) {
      // Capture diagnostics before `--rm` deletes the failed container, then
      // synchronously stop it before another suite is allowed to retry.
      let failure: string;
      try {
        failure = describeContainerFailure(containerId, dependencies.runSync);
      } catch (diagnosticError) {
        failure = `container diagnostics unavailable: ${
          diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
        }`;
      } finally {
        lifecycle.stop(containerId);
      }
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${failure}`);
    }
    return { endpoint: `http://127.0.0.1:${port}`, accessKey: ACCESS_KEY, secretKey: SECRET_KEY, region: REGION };
  }

  return {
    getSharedMinio() {
      sharedMinioPromise ??= startSharedMinio().catch((error) => {
        sharedMinioPromise = undefined;
        throw error;
      });
      return sharedMinioPromise;
    },
  };
}

const sharedMinioHarness = createSharedMinioHarness({
  runSync,
  process: processHooks,
  readyFetch: (url, options) => harnessFetch(url, options),
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  sessionId: `${process.pid}-${randomUUID()}`,
  readinessTimeoutMs: 120_000,
  readyRequestTimeoutMs: 5_000,
  reportCleanupFailure: (message) => console.error(message),
});

/**
 * Lazily start ONE shared `minio/minio` container for this test process and
 * return its connection info. Every importing file gets the same container.
 *
 * A FAILED start is not cached: the next suite retries with a fresh container
 * (and a fresh random port). Without this, one transient startup failure
 * cascades into instant failures for every other MinIO suite in the process.
 */
export function getSharedMinio(): Promise<SharedMinio> {
  return sharedMinioHarness.getSharedMinio();
}
