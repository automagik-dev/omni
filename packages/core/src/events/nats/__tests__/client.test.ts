/**
 * NatsEventBus connection-resilience tests.
 *
 * Regression coverage for the 2026-07-06 prod incident: after a NATS server
 * restart, running pods kept a permanently dead connection (finite transport
 * reconnect budget exhausted, `closed()` resolved, nothing rebuilt it) and
 * every publish threw "Not connected to NATS. Call connect() first." while
 * /health kept reporting the bus as connected.
 *
 * Covers:
 *   - transport connects with infinite reconnect (maxReconnectAttempts: -1)
 *   - publish recovers after the underlying connection closes (lazy rebuild)
 *   - closed()-handler rebuilds the connection without waiting for a publish
 *   - isConnected() reflects the real state of the publisher connection
 *
 * The `nats` module is mocked (same approach as nats-genie-provider.test.ts)
 * so no live broker is required.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock the nats module before importing the client
// ---------------------------------------------------------------------------

class FakeNatsConnection {
  private closedFlag = false;
  private resolveClosed!: (err?: Error) => void;
  private readonly closedPromise = new Promise<Error | undefined>((resolve) => {
    this.resolveClosed = resolve;
  });

  readonly publish = mock(async (_subject: string, _data: Uint8Array, _opts?: unknown) => ({ seq: 1 }));

  isClosed(): boolean {
    return this.closedFlag;
  }

  closed(): Promise<Error | undefined> {
    return this.closedPromise;
  }

  status(): AsyncIterable<{ type: string }> {
    // Never yields — keeps the status loop pending like an idle connection
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<{ type: string }>>(() => {}),
      }),
    };
  }

  jetstream(): { publish: FakeNatsConnection['publish'] } {
    return { publish: this.publish };
  }

  jetstreamManager(): unknown {
    return {
      streams: {
        info: async () => {
          throw new Error('stream not found');
        },
        add: async () => ({}),
        update: async () => ({}),
      },
    };
  }

  async drain(): Promise<void> {
    this.markClosed();
  }

  /** Simulate the server closing the connection (reconnect budget exhausted) */
  simulateServerClose(err?: Error): void {
    this.markClosed(err);
  }

  private markClosed(err?: Error): void {
    this.closedFlag = true;
    this.resolveClosed(err);
  }
}

const connections: FakeNatsConnection[] = [];
const connectOptions: Array<Record<string, unknown>> = [];

const connectMock = mock(async (opts: Record<string, unknown>) => {
  connectOptions.push(opts);
  const conn = new FakeNatsConnection();
  connections.push(conn);
  return conn;
});

mock.module('nats', () => ({
  AckPolicy: { Explicit: 'explicit' },
  DeliverPolicy: { All: 'all', Last: 'last', New: 'new', StartTime: 'by_start_time' },
  RetentionPolicy: { Limits: 'limits' },
  StorageType: { File: 'file' },
  StringCodec: () => ({
    encode: (s: string) => new TextEncoder().encode(s),
    decode: (b: Uint8Array) => new TextDecoder().decode(b),
  }),
  headers: () => {
    const values = new Map<string, string>();
    return {
      set: (key: string, value: string) => values.set(key, value),
      get: (key: string) => values.get(key),
      values,
    };
  },
  connect: connectMock,
}));

// Import AFTER mocks are registered (dynamic import — static imports are
// hoisted above mock.module by the ESM transform).
const { NatsEventBus } = await import('../client');

const flushReconnect = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  connections.length = 0;
  connectOptions.length = 0;
  connectMock.mockClear();
});

describe('NatsEventBus connection resilience', () => {
  it('connects with infinite transport reconnect', async () => {
    const bus = new NatsEventBus();
    await bus.connect();

    expect(connectOptions[0]?.maxReconnectAttempts).toBe(-1);
    expect(connectOptions[0]?.reconnect).toBe(true);
    expect(bus.isConnected()).toBe(true);

    await bus.close();
  });

  it('recovers publishing after the underlying connection closes', async () => {
    const bus = new NatsEventBus();
    await bus.connect();

    const first = connections[0];
    expect(first).toBeDefined();

    // First publish goes through connection #1
    await bus.publishGeneric('custom.test.reconnect', { attempt: 1 });
    expect(first?.publish).toHaveBeenCalledTimes(1);

    // Server kills the connection (e.g. NATS statefulset restart)
    first?.simulateServerClose();
    expect(bus.isConnected()).toBe(false);

    // Publish must rebuild the connection instead of throwing forever
    const result = await bus.publishGeneric('custom.test.reconnect', { attempt: 2 });

    expect(result.sequence).toBe(1);
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(connections[1]?.publish).toHaveBeenCalledTimes(1);
    expect(bus.isConnected()).toBe(true);

    await bus.close();
  });

  it('rebuilds the connection via the closed() handler without a publish', async () => {
    const bus = new NatsEventBus();
    await bus.connect();

    connections[0]?.simulateServerClose(new Error('server gone'));
    await flushReconnect();

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(bus.isConnected()).toBe(true);

    await bus.close();
  });

  it('does not rebuild the connection on intentional close()', async () => {
    const bus = new NatsEventBus();
    await bus.connect();

    await bus.close();
    await flushReconnect();

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(bus.isConnected()).toBe(false);
  });

  it('isConnected() reflects the real publisher connection state', async () => {
    const bus = new NatsEventBus();
    expect(bus.isConnected()).toBe(false);

    await bus.connect();
    expect(bus.isConnected()).toBe(true);

    connections[0]?.simulateServerClose();
    expect(bus.isConnected()).toBe(false);

    // Let the background rebuild settle before cleanup
    await flushReconnect();
    await bus.close();
  });
});
