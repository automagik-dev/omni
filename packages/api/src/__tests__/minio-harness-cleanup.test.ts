import { describe, expect, test } from 'bun:test';
import {
  type DockerPublishProbeDependencies,
  MinioContainerLifecycle,
  STALE_CONTAINER_MIN_AGE_MS,
  type SharedMinioHarnessDependencies,
  createDockerPublishProbe,
  createSharedMinioHarness,
  reapStaleContainers,
} from './minio-harness';

type HarnessSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';
type HarnessEvent = 'exit' | HarnessSignal;

class FakeProcessHooks {
  readonly pid = 4242;
  readonly signals: Array<{ pid: number; signal: HarnessSignal; listenerCount: number; nativeExitCode: number }> = [];
  private readonly listeners = new Map<HarnessEvent, Set<() => void>>();

  constructor(private readonly events: string[]) {}

  once(event: HarnessEvent, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event: HarnessSignal, listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  kill(pid: number, signal: HarnessSignal): boolean {
    const nativeExitCode = 128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal];
    this.signals.push({ pid, signal, listenerCount: this.listeners.get(signal)?.size ?? 0, nativeExitCode });
    this.events.push(`kill:${signal}`);
    return true;
  }

  emit(event: HarnessEvent): void {
    const listeners = [...(this.listeners.get(event) ?? [])];
    this.listeners.delete(event);
    for (const listener of listeners) listener();
  }

  listenerCount(event: HarnessEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

interface FakePsRow {
  id: string;
  session: string;
  createdAt: string;
}

class FakeDocker {
  readonly calls: string[][] = [];
  readonly events: string[];
  beforeCommand: ((command: string[]) => void) | undefined;
  private readonly containerIds: string[];
  private readonly stopFailures: Map<string, number>;
  private readonly stopThrows: Map<string, number>;
  private readonly psRows: FakePsRow[];
  private readonly psFails: boolean;
  private readonly rmFailures: Map<string, number>;

  constructor(
    containerIds: string[],
    options: {
      stopFailures?: Record<string, number>;
      stopThrows?: Record<string, number>;
      events?: string[];
      psRows?: FakePsRow[];
      psFails?: boolean;
      rmFailures?: Record<string, number>;
    } = {},
  ) {
    this.containerIds = [...containerIds];
    this.stopFailures = new Map(Object.entries(options.stopFailures ?? {}));
    this.stopThrows = new Map(Object.entries(options.stopThrows ?? {}));
    this.events = options.events ?? [];
    this.psRows = options.psRows ?? [];
    this.psFails = options.psFails ?? false;
    this.rmFailures = new Map(Object.entries(options.rmFailures ?? {}));
  }

  runSync = (command: string[]): { exitCode: number; stdout: string; stderr: string } => {
    this.calls.push([...command]);
    this.beforeCommand?.(command);
    const operation = command[1];
    if (operation === 'pull') return { exitCode: 0, stdout: '', stderr: '' };
    if (operation === 'run') return this.handleRun();
    if (operation === 'inspect') return this.handleInspect(command);
    if (operation === 'ps') return this.handlePs();
    if (operation === 'rm') return this.handleRm(command.at(-1)!);
    if (operation === 'logs') return { exitCode: 0, stdout: 'fake MinIO log\n', stderr: '' };
    if (operation === 'stop') return this.handleStop(command.at(-1)!);
    throw new Error(`Unexpected fake Docker command: ${command.join(' ')}`);
  };

  private handleRun(): { exitCode: number; stdout: string; stderr: string } {
    const containerId = this.containerIds.shift();
    return containerId
      ? { exitCode: 0, stdout: `${containerId}\n`, stderr: '' }
      : { exitCode: 1, stdout: '', stderr: 'no fake container ID available' };
  }

  private handleInspect(command: string[]): { exitCode: number; stdout: string; stderr: string } {
    const format = command[3] ?? '';
    if (!format.includes('.Created')) return { exitCode: 0, stdout: 'running exit=0\n', stderr: '' };
    const containerId = command.at(-1)!;
    const row = this.psRows.find((candidate) => candidate.id === containerId);
    return row
      ? { exitCode: 0, stdout: `${row.createdAt}\n`, stderr: '' }
      : { exitCode: 1, stdout: '', stderr: 'no such container' };
  }

  private handlePs(): { exitCode: number; stdout: string; stderr: string } {
    if (this.psFails) return { exitCode: 1, stdout: '', stderr: 'fake docker ps failure' };
    const rows = this.psRows.map((row) => `${row.id}\t${row.session}`).join('\n');
    return { exitCode: 0, stdout: rows ? `${rows}\n` : '', stderr: '' };
  }

  private handleRm(containerId: string): { exitCode: number; stdout: string; stderr: string } {
    this.events.push(`rm:${containerId}`);
    const failuresRemaining = this.rmFailures.get(containerId) ?? 0;
    if (failuresRemaining > 0) {
      this.rmFailures.set(containerId, failuresRemaining - 1);
      return { exitCode: 1, stdout: '', stderr: 'fake rm failure' };
    }
    return { exitCode: 0, stdout: `${containerId}\n`, stderr: '' };
  }

  private handleStop(containerId: string): { exitCode: number; stdout: string; stderr: string } {
    this.events.push(`stop:${containerId}`);
    const throwsRemaining = this.stopThrows.get(containerId) ?? 0;
    if (throwsRemaining > 0) {
      this.stopThrows.set(containerId, throwsRemaining - 1);
      throw new Error('thrown fake stop failure');
    }
    const failuresRemaining = this.stopFailures.get(containerId) ?? 0;
    if (failuresRemaining > 0) {
      this.stopFailures.set(containerId, failuresRemaining - 1);
      return { exitCode: 1, stdout: '', stderr: 'temporary fake stop failure' };
    }
    return { exitCode: 0, stdout: `${containerId}\n`, stderr: '' };
  }

  operations(operation: string): string[][] {
    return this.calls.filter((command) => command[1] === operation);
  }
}

function setup(
  containerIds: string[],
  options: {
    ready?: boolean;
    stopFailures?: Record<string, number>;
    stopThrows?: Record<string, number>;
    psRows?: FakePsRow[];
    psFails?: boolean;
    rmFailures?: Record<string, number>;
    initialClockMs?: number;
  } = {},
): {
  docker: FakeDocker;
  process: FakeProcessHooks;
  dependencies: SharedMinioHarnessDependencies;
  cleanupFailures: string[];
  events: string[];
  setReady(ready: boolean): void;
  getSharedMinio: ReturnType<typeof createSharedMinioHarness>['getSharedMinio'];
} {
  let clock = options.initialClockMs ?? 0;
  let ready = options.ready ?? true;
  const events: string[] = [];
  const docker = new FakeDocker(containerIds, {
    stopFailures: options.stopFailures,
    stopThrows: options.stopThrows,
    events,
    psRows: options.psRows,
    psFails: options.psFails,
    rmFailures: options.rmFailures,
  });
  const fakeProcess = new FakeProcessHooks(events);
  const cleanupFailures: string[] = [];
  const dependencies: SharedMinioHarnessDependencies = {
    runSync: docker.runSync,
    process: fakeProcess,
    readyFetch: async () => {
      if (!ready) throw new Error('fake MinIO is not ready');
      return { ok: true };
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    random: () => 0.5,
    sessionId: 'session-123',
    readinessTimeoutMs: 1_000,
    readyRequestTimeoutMs: 100,
    connectionRefusedFastFailMs: 250,
    reportCleanupFailure: (message) => cleanupFailures.push(message),
  };
  const harness = createSharedMinioHarness(dependencies);
  return {
    docker,
    process: fakeProcess,
    dependencies,
    cleanupFailures,
    events,
    setReady(value) {
      ready = value;
    },
    getSharedMinio: harness.getSharedMinio,
  };
}

describe('shared MinIO harness cleanup', () => {
  test('labels and bounds the container, then synchronously stops its exact ID on normal exit', async () => {
    const fake = setup(['container-normal']);

    await fake.getSharedMinio();

    expect(fake.docker.operations('run')).toEqual([
      [
        'docker',
        'run',
        '--rm',
        '-d',
        '--label',
        'com.automagik.omni.test-harness=minio',
        '--label',
        'com.automagik.omni.test-session=session-123',
        '--cpus',
        '1',
        '--memory',
        '512m',
        '--pids-limit',
        '256',
        '--tmpfs',
        '/data:rw,noexec,nosuid,size=256m',
        '-p',
        '30000:9000',
        '-e',
        'MINIO_ROOT_USER=minioadmin',
        '-e',
        'MINIO_ROOT_PASSWORD=minioadmin',
        'minio/minio',
        'server',
        '/data',
      ],
    ]);

    fake.process.emit('exit');

    expect(fake.docker.operations('stop')).toEqual([['docker', 'stop', '--time', '10', 'container-normal']]);
    // Cleanup must stay surgical: no prunes ever, and any container listing is
    // scoped to this harness's own label (the stale-container reaper).
    expect(fake.docker.calls.some((command) => command.includes('prune'))).toBe(false);
    for (const ps of fake.docker.operations('ps')) {
      expect(ps).toContain('label=com.automagik.omni.test-harness=minio');
    }
    expect(fake.docker.operations('rm')).toHaveLength(0);
  });

  test('registers handlers before launch and closes a SIGTERM race around the blocking run command', async () => {
    const fake = setup(['container-launch-race']);
    let sigtermListenersAtLaunch = 0;
    fake.docker.beforeCommand = (command) => {
      if (command[1] !== 'run') return;
      sigtermListenersAtLaunch = fake.process.listenerCount('SIGTERM');
      fake.process.emit('SIGTERM');
    };

    await expect(fake.getSharedMinio()).rejects.toThrow('MinIO launch interrupted by SIGTERM');

    expect(sigtermListenersAtLaunch).toBe(1);
    expect(fake.events).toEqual(['stop:container-launch-race', 'kill:SIGTERM']);
    expect(fake.docker.operations('stop')).toEqual([['docker', 'stop', '--time', '10', 'container-launch-race']]);
    expect(fake.process.signals).toEqual([{ pid: 4242, signal: 'SIGTERM', listenerCount: 0, nativeExitCode: 143 }]);
  });

  test('stops a failed-readiness container before a fresh retry', async () => {
    const fake = setup(['container-failed', 'container-retry'], { ready: false });

    await expect(fake.getSharedMinio()).rejects.toThrow(
      'MinIO did not become ready within 1s\ncontainer state: running exit=0\ncontainer logs:\nfake MinIO log',
    );
    expect(fake.docker.operations('stop')).toEqual([['docker', 'stop', '--time', '10', 'container-failed']]);

    fake.setReady(true);
    await expect(fake.getSharedMinio()).resolves.toMatchObject({ endpoint: 'http://127.0.0.1:30000' });
    expect(fake.docker.operations('run')).toHaveLength(2);

    fake.process.emit('exit');
    expect(fake.docker.operations('stop')).toEqual([
      ['docker', 'stop', '--time', '10', 'container-failed'],
      ['docker', 'stop', '--time', '10', 'container-retry'],
    ]);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    test(`stops the exact container and re-raises ${signal}`, async () => {
      const fake = setup([`container-${signal.toLowerCase()}`]);
      await fake.getSharedMinio();

      fake.process.emit(signal);

      expect(fake.docker.operations('stop')).toEqual([
        ['docker', 'stop', '--time', '10', `container-${signal.toLowerCase()}`],
      ]);
      expect(fake.process.signals).toEqual([
        { pid: 4242, signal, listenerCount: 0, nativeExitCode: signal === 'SIGINT' ? 130 : 143 },
      ]);
    });
  }

  test('uses the same native signal cleanup semantics for SIGHUP', async () => {
    const fake = setup(['container-sighup']);
    await fake.getSharedMinio();

    fake.process.emit('SIGHUP');

    expect(fake.docker.operations('stop')).toEqual([['docker', 'stop', '--time', '10', 'container-sighup']]);
    expect(fake.process.signals).toEqual([{ pid: 4242, signal: 'SIGHUP', listenerCount: 0, nativeExitCode: 129 }]);
  });

  test('blocks retry launches until every previously tracked ID is successfully stopped', async () => {
    const fake = setup(['container-first', 'container-second'], {
      ready: false,
      stopFailures: { 'container-first': 2 },
    });

    await expect(fake.getSharedMinio()).rejects.toThrow('MinIO did not become ready within 1s');
    fake.setReady(true);

    await expect(fake.getSharedMinio()).rejects.toThrow(
      'Refusing to launch MinIO while 1 tracked container(s) still require cleanup',
    );
    expect(fake.docker.operations('run')).toHaveLength(1);

    await fake.getSharedMinio();
    expect(fake.docker.operations('run')).toHaveLength(2);

    fake.process.emit('exit');

    expect(fake.docker.operations('stop')).toEqual([
      ['docker', 'stop', '--time', '10', 'container-first'],
      ['docker', 'stop', '--time', '10', 'container-first'],
      ['docker', 'stop', '--time', '10', 'container-first'],
      ['docker', 'stop', '--time', '10', 'container-second'],
    ]);
    expect(fake.cleanupFailures).toEqual([
      'Failed to stop tracked MinIO test container container-first: temporary fake stop failure',
      'Failed to stop tracked MinIO test container container-first: temporary fake stop failure',
    ]);
    expect(fake.docker.calls.some((command) => command.includes('prune'))).toBe(false);
    for (const ps of fake.docker.operations('ps')) {
      expect(ps).toContain('label=com.automagik.omni.test-harness=minio');
    }
    expect(fake.docker.operations('rm')).toHaveLength(0);
  });

  test('attempts every tracked ID and preserves native 143 when one SIGTERM stop throws', () => {
    const fake = setup([], { stopThrows: { 'container-throws': 1 } });
    const lifecycle = new MinioContainerLifecycle(fake.dependencies);
    lifecycle.prepareForLaunch();
    lifecycle.track('container-throws');
    lifecycle.track('container-after-throw');

    fake.process.emit('SIGTERM');

    expect(fake.docker.operations('stop')).toEqual([
      ['docker', 'stop', '--time', '10', 'container-throws'],
      ['docker', 'stop', '--time', '10', 'container-after-throw'],
    ]);
    expect(fake.events).toEqual(['stop:container-throws', 'stop:container-after-throw', 'kill:SIGTERM']);
    expect(fake.cleanupFailures).toEqual([
      'Failed to stop tracked MinIO test container container-throws: thrown fake stop failure',
    ]);
    expect(fake.process.signals).toEqual([{ pid: 4242, signal: 'SIGTERM', listenerCount: 0, nativeExitCode: 143 }]);
  });

  test('stops the failed container even when collecting readiness diagnostics throws', async () => {
    const fake = setup(['container-diagnostics-throw'], { ready: false });
    fake.docker.beforeCommand = (command) => {
      if (command[1] === 'inspect') throw new Error('fake inspect failure');
    };

    await expect(fake.getSharedMinio()).rejects.toThrow('container diagnostics unavailable: fake inspect failure');

    expect(fake.docker.operations('stop')).toEqual([['docker', 'stop', '--time', '10', 'container-diagnostics-throw']]);
  });

  test('bounds and aborts a readiness request that never settles', async () => {
    const fake = setup(['container-hung-probe'], { ready: false });
    let observedSignal: AbortSignal | undefined;
    fake.dependencies.readyRequestTimeoutMs = 10;
    fake.dependencies.readyFetch = (_url, options) => {
      observedSignal = options?.signal;
      return new Promise(() => {});
    };

    await expect(fake.getSharedMinio()).rejects.toThrow('MinIO did not become ready within 1s');

    expect(observedSignal?.aborted).toBe(true);
    expect(fake.docker.operations('stop')).toEqual([['docker', 'stop', '--time', '10', 'container-hung-probe']]);
  }, 250);

  function connectionRefusedError(code: 'ECONNREFUSED' | 'ConnectionRefused'): Error {
    const error = new Error('Unable to connect. Is the computer able to access the url?');
    (error as Error & { code?: string }).code = code;
    return error;
  }

  for (const code of ['ECONNREFUSED', 'ConnectionRefused'] as const) {
    test(`aborts readiness early with a port-publishing diagnosis when every probe is ${code}`, async () => {
      const fake = setup(['container-unpublished']);
      fake.dependencies.readyFetch = async () => {
        throw connectionRefusedError(code);
      };

      await expect(fake.getSharedMinio()).rejects.toThrow(
        /refused every connection for 500ms.*Docker likely cannot publish ports/s,
      );

      // Fast-failed at 500ms of fake time, well inside the 1s readiness
      // deadline, and the container was still stopped synchronously.
      expect(fake.docker.operations('stop')).toEqual([['docker', 'stop', '--time', '10', 'container-unpublished']]);
    });
  }

  test('a brief startup connection-refused window does not trip the fast-fail', async () => {
    const fake = setup(['container-slow-bind']);
    let attempts = 0;
    fake.dependencies.readyFetch = async () => {
      attempts += 1;
      if (attempts === 1) throw connectionRefusedError('ConnectionRefused');
      return { ok: true };
    };

    await expect(fake.getSharedMinio()).resolves.toMatchObject({ endpoint: 'http://127.0.0.1:30000' });
    expect(attempts).toBe(2);
  });

  test('once the port has answered, later refusals get the full readiness deadline, not the fast-fail', async () => {
    const fake = setup(['container-answered-then-died']);
    let attempts = 0;
    fake.dependencies.readyFetch = async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false };
      throw connectionRefusedError('ECONNREFUSED');
    };

    await expect(fake.getSharedMinio()).rejects.toThrow('MinIO did not become ready within 1s');
    expect(fake.docker.operations('stop')).toEqual([
      ['docker', 'stop', '--time', '10', 'container-answered-then-died'],
    ]);
  });

  test('non-refused readiness failures still burn the full deadline (slow container, not a wiring problem)', async () => {
    // The default fake readyFetch throws a generic (non-refused) error, so the
    // pre-existing timeout path must be unchanged by the fast-fail logic.
    const fake = setup(['container-slow'], { ready: false });

    await expect(fake.getSharedMinio()).rejects.toThrow('MinIO did not become ready within 1s');
  });
});

describe('Docker port-publishability probe', () => {
  const FAKE_BUN = '/fake/bin/bun';

  function probeSetup(
    options: {
      /** Number of failed fetch attempts before one succeeds; omit for never-reachable. */
      reachableAfterAttempts?: number;
      runFails?: boolean;
      emptyRunStdout?: boolean;
    } = {},
  ): {
    probe: () => boolean;
    warns: string[];
    calls: string[][];
    operations(operation: string): string[][];
    fetchAttempts(): number;
  } {
    let clock = 0;
    let attempts = 0;
    const warns: string[] = [];
    const calls: string[][] = [];
    const handleProbeFetch = (): { exitCode: number; stdout: string; stderr: string } => {
      attempts += 1;
      const reachable = options.reachableAfterAttempts !== undefined && attempts > options.reachableAfterAttempts;
      return { exitCode: reachable ? 0 : 1, stdout: '', stderr: '' };
    };
    const handleDockerRun = (): { exitCode: number; stdout: string; stderr: string } => {
      if (options.runFails) return { exitCode: 125, stdout: '', stderr: 'fake docker run failure' };
      return { exitCode: 0, stdout: options.emptyRunStdout ? '' : 'probe-container\n', stderr: '' };
    };
    const dependencies: DockerPublishProbeDependencies = {
      runSync: (command) => {
        calls.push([...command]);
        if (command[0] === FAKE_BUN) return handleProbeFetch();
        if (command[1] === 'run') return handleDockerRun();
        if (command[1] === 'rm') return { exitCode: 0, stdout: 'probe-container\n', stderr: '' };
        throw new Error(`Unexpected fake probe command: ${command.join(' ')}`);
      },
      now: () => clock,
      sleepSync: (ms) => {
        clock += ms;
      },
      random: () => 0.5,
      execPath: FAKE_BUN,
      sessionId: 'session-123',
      probeTimeoutMs: 1_000,
      probePollIntervalMs: 250,
      warn: (message) => warns.push(message),
    };
    return {
      probe: createDockerPublishProbe(dependencies),
      warns,
      calls,
      operations: (operation) => calls.filter((command) => command[0] === 'docker' && command[1] === operation),
      fetchAttempts: () => attempts,
    };
  }

  test('a reachable published port passes: labeled bounded probe container, fetch via child bun, then removal', () => {
    const fake = probeSetup({ reachableAfterAttempts: 0 });

    expect(fake.probe()).toBe(true);
    expect(fake.warns).toEqual([]);

    // Same labeled, resource-bounded, port-publishing run shape as the real
    // harness container — the probe must test exactly what the suites need.
    expect(fake.operations('run')).toEqual([
      [
        'docker',
        'run',
        '--rm',
        '-d',
        '--label',
        'com.automagik.omni.test-harness=minio',
        '--label',
        'com.automagik.omni.test-session=session-123',
        '--cpus',
        '1',
        '--memory',
        '512m',
        '--pids-limit',
        '256',
        '--tmpfs',
        '/data:rw,noexec,nosuid,size=256m',
        '-p',
        '30000:9000',
        '-e',
        'MINIO_ROOT_USER=minioadmin',
        '-e',
        'MINIO_ROOT_PASSWORD=minioadmin',
        'minio/minio',
        'server',
        '/data',
      ],
    ]);
    const fetchCommand = fake.calls.find((command) => command[0] === FAKE_BUN);
    expect(fetchCommand?.[1]).toBe('--eval');
    expect(fetchCommand?.[2]).toContain('http://127.0.0.1:30000/minio/health/ready');
    expect(fake.operations('rm')).toEqual([['docker', 'rm', '-f', 'probe-container']]);
  });

  test('a slow-to-listen but reachable port still passes without a warning', () => {
    const fake = probeSetup({ reachableAfterAttempts: 2 });

    expect(fake.probe()).toBe(true);
    expect(fake.warns).toEqual([]);
    expect(fake.fetchAttempts()).toBe(3);
    expect(fake.operations('rm')).toEqual([['docker', 'rm', '-f', 'probe-container']]);
  });

  test('an unreachable published port fails loudly once and never leaks the probe container', () => {
    const fake = probeSetup();

    expect(fake.probe()).toBe(false);

    // 1s budget / 250ms poll interval => exactly 4 attempts before giving up.
    expect(fake.fetchAttempts()).toBe(4);
    expect(fake.warns).toHaveLength(1);
    expect(fake.warns[0]).toContain('Docker is running but cannot publish container ports');
    expect(fake.warns[0]).toContain('127.0.0.1:30000');
    expect(fake.warns[0]).toContain('MINIO_INTEGRATION=1');
    expect(fake.operations('rm')).toEqual([['docker', 'rm', '-f', 'probe-container']]);
  });

  test('the verdict and the warning are cached per process: one probe container for all six suites', () => {
    const fake = probeSetup();

    expect(fake.probe()).toBe(false);
    expect(fake.probe()).toBe(false);
    expect(fake.probe()).toBe(false);

    expect(fake.operations('run')).toHaveLength(1);
    expect(fake.warns).toHaveLength(1);
  });

  test('a positive verdict is cached too', () => {
    const fake = probeSetup({ reachableAfterAttempts: 0 });

    expect(fake.probe()).toBe(true);
    expect(fake.probe()).toBe(true);

    expect(fake.operations('run')).toHaveLength(1);
  });

  test('a failed docker run fails the probe loudly with the stderr and removes nothing', () => {
    const fake = probeSetup({ runFails: true });

    expect(fake.probe()).toBe(false);
    expect(fake.warns).toEqual([
      'MinIO integration suites SKIPPED: the Docker port-publishability probe could not start a container: fake docker run failure',
    ]);
    expect(fake.operations('rm')).toHaveLength(0);
  });

  test('an empty container ID from docker run fails the probe loudly', () => {
    const fake = probeSetup({ emptyRunStdout: true });

    expect(fake.probe()).toBe(false);
    expect(fake.warns).toEqual([
      'MinIO integration suites SKIPPED: the Docker port-publishability probe got no container ID from docker run',
    ]);
    expect(fake.operations('rm')).toHaveLength(0);
  });
});

describe('stale MinIO container reaper', () => {
  const EPOCH = '1970-01-01T00:00:00.000Z'; // Date.parse => 0 against the fake clock
  const THIRTY_MIN = '1970-01-01T00:30:00.000Z';
  const STALE_CLOCK = STALE_CONTAINER_MIN_AGE_MS + 60_000; // 31 minutes

  test('launch force-removes an abandoned foreign-session container and leaves fresh or own-session ones', async () => {
    const fake = setup(['container-normal'], {
      initialClockMs: STALE_CLOCK,
      psRows: [
        { id: 'leaked-old', session: 'session-dead', createdAt: EPOCH },
        { id: 'fresh-foreign', session: 'session-live', createdAt: THIRTY_MIN },
        { id: 'own-live', session: 'session-123', createdAt: EPOCH },
      ],
    });

    await fake.getSharedMinio();

    expect(fake.docker.operations('rm')).toEqual([['docker', 'rm', '-f', 'leaked-old']]);
    // Only the reap candidates from OTHER sessions are even inspected.
    const inspectedIds = fake.docker
      .operations('inspect')
      .filter((command) => command[3]?.includes('.Created'))
      .map((command) => command.at(-1));
    expect(inspectedIds).toEqual(['leaked-old', 'fresh-foreign']);
    expect(fake.cleanupFailures).toEqual([]);
  });

  test('a failed listing reaps nothing and never blocks the launch', async () => {
    const fake = setup(['container-normal'], { psFails: true, initialClockMs: STALE_CLOCK });

    await expect(fake.getSharedMinio()).resolves.toMatchObject({ accessKey: 'minioadmin' });

    expect(fake.docker.operations('rm')).toHaveLength(0);
  });

  test('a failed removal is reported and never blocks the launch', async () => {
    const fake = setup(['container-normal'], {
      initialClockMs: STALE_CLOCK,
      psRows: [{ id: 'leaked-stubborn', session: 'session-dead', createdAt: EPOCH }],
      rmFailures: { 'leaked-stubborn': 1 },
    });

    await expect(fake.getSharedMinio()).resolves.toMatchObject({ accessKey: 'minioadmin' });

    expect(fake.cleanupFailures).toEqual([
      'Failed to reap stale MinIO test container leaked-stubborn: fake rm failure',
    ]);
  });

  test('an unparseable creation time is left alone', () => {
    const fake = setup([], {
      initialClockMs: STALE_CLOCK,
      psRows: [{ id: 'weird-timestamp', session: 'session-dead', createdAt: 'not-a-date' }],
    });

    reapStaleContainers(fake.dependencies);

    expect(fake.docker.operations('rm')).toHaveLength(0);
  });

  test('a container that disappears between listing and inspection is skipped', () => {
    const fake = setup([], { initialClockMs: STALE_CLOCK });
    // Listed but not inspectable: FakeDocker answers ps from psRows, so fake a
    // vanished container by making ps report an id inspect will not find.
    const vanishing = new FakeDocker([], {
      psRows: [{ id: 'vanished', session: 'session-dead', createdAt: EPOCH }],
    });
    const psOnly = vanishing.runSync;
    fake.dependencies.runSync = (command) => {
      if (command[1] === 'ps') return psOnly(command);
      if (command[1] === 'inspect') return { exitCode: 1, stdout: '', stderr: 'no such container' };
      return fake.docker.runSync(command);
    };

    reapStaleContainers(fake.dependencies);

    expect(fake.docker.operations('rm')).toHaveLength(0);
  });
});
