import { describe, expect, test } from 'bun:test';
import {
  MinioContainerLifecycle,
  type SharedMinioHarnessDependencies,
  createSharedMinioHarness,
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

class FakeDocker {
  readonly calls: string[][] = [];
  readonly events: string[];
  beforeCommand: ((command: string[]) => void) | undefined;
  private readonly containerIds: string[];
  private readonly stopFailures: Map<string, number>;
  private readonly stopThrows: Map<string, number>;

  constructor(
    containerIds: string[],
    options: { stopFailures?: Record<string, number>; stopThrows?: Record<string, number>; events?: string[] } = {},
  ) {
    this.containerIds = [...containerIds];
    this.stopFailures = new Map(Object.entries(options.stopFailures ?? {}));
    this.stopThrows = new Map(Object.entries(options.stopThrows ?? {}));
    this.events = options.events ?? [];
  }

  runSync = (command: string[]): { exitCode: number; stdout: string; stderr: string } => {
    this.calls.push([...command]);
    this.beforeCommand?.(command);
    const operation = command[1];
    if (operation === 'pull') return { exitCode: 0, stdout: '', stderr: '' };
    if (operation === 'run') {
      const containerId = this.containerIds.shift();
      return containerId
        ? { exitCode: 0, stdout: `${containerId}\n`, stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'no fake container ID available' };
    }
    if (operation === 'inspect') return { exitCode: 0, stdout: 'running exit=0\n', stderr: '' };
    if (operation === 'logs') return { exitCode: 0, stdout: 'fake MinIO log\n', stderr: '' };
    if (operation === 'stop') {
      const containerId = command.at(-1)!;
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
    throw new Error(`Unexpected fake Docker command: ${command.join(' ')}`);
  };

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
  let clock = 0;
  let ready = options.ready ?? true;
  const events: string[] = [];
  const docker = new FakeDocker(containerIds, {
    stopFailures: options.stopFailures,
    stopThrows: options.stopThrows,
    events,
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
    expect(fake.docker.calls.some((command) => command.includes('prune') || command[1] === 'ps')).toBe(false);
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
    expect(fake.docker.calls.some((command) => command.includes('prune') || command[1] === 'ps')).toBe(false);
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
});
