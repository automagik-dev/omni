import { describe, expect, test } from 'bun:test';
import {
  MinioContainerLifecycle,
  STALE_CONTAINER_MIN_AGE_MS,
  type SharedMinioHarnessDependencies,
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
