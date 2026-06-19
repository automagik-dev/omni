/**
 * Agent heartbeat consumer tests.
 *
 * Contract: incoming `omni.agent.heartbeat.*` events convert into exactly one
 * `turnService.recordActivity(turnId)` call per valid event. Malformed events
 * never crash the consumer, never call recordActivity, and emit a warning.
 * Unknown turn IDs (rejection from recordActivity) are swallowed.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AgentHeartbeatConsumer } from '../agent-heartbeat';
import type { AgentHeartbeatEvent } from '../turn-events';

type Msg = { subject: string; data: Uint8Array };

interface FakeNats {
  isClosed(): boolean;
  subscribe(subject: string): FakeSubscription;
  __push(msg: Msg): void;
  __end(): void;
  __subscribedTo: string | null;
  __unsubscribed: boolean;
}

interface FakeSubscription {
  unsubscribe(): void;
  [Symbol.asyncIterator](): AsyncIterator<Msg>;
}

function createFakeNats(): FakeNats {
  const queue: Msg[] = [];
  const waiters: Array<(value: IteratorResult<Msg>) => void> = [];
  let ended = false;
  let closed = false;
  let subscribedTo: string | null = null;
  let unsubscribed = false;

  const drainOne = () => {
    while (waiters.length > 0 && queue.length > 0) {
      const w = waiters.shift()!;
      w({ value: queue.shift()!, done: false });
    }
    if (ended) {
      while (waiters.length > 0) {
        const w = waiters.shift()!;
        w({ value: undefined as never, done: true });
      }
    }
  };

  const subscription: FakeSubscription = {
    unsubscribe() {
      unsubscribed = true;
      ended = true;
      drainOne();
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Msg>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          return new Promise<IteratorResult<Msg>>((resolve) => waiters.push(resolve));
        },
        return(): Promise<IteratorResult<Msg>> {
          ended = true;
          drainOne();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };

  return {
    isClosed: () => closed,
    subscribe(subject: string) {
      subscribedTo = subject;
      return subscription;
    },
    __push(msg: Msg) {
      queue.push(msg);
      drainOne();
    },
    __end() {
      ended = true;
      drainOne();
      closed = true;
    },
    get __subscribedTo() {
      return subscribedTo;
    },
    get __unsubscribed() {
      return unsubscribed;
    },
  };
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

function makeEvent(overrides: Partial<AgentHeartbeatEvent> = {}): AgentHeartbeatEvent {
  return {
    turnId: 'turn-abc',
    instanceId: 'inst-1',
    chatId: 'chat-1',
    timestamp: '2026-04-30T12:00:00.000Z',
    ...overrides,
  };
}

// Wait for the consumer's async loop to process all queued messages.
async function flush() {
  // Two ticks: one for the Promise.resolve queued by the iterator, one for
  // the synchronous mock call inside the consumer.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('AgentHeartbeatConsumer', () => {
  let consumer: AgentHeartbeatConsumer;
  let nats: FakeNats;

  beforeEach(() => {
    consumer = new AgentHeartbeatConsumer();
    nats = createFakeNats();
  });

  afterEach(async () => {
    nats.__end();
    await consumer.stop();
  });

  test('subscribes to omni.agent.heartbeat.> on start', () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });
    expect(nats.__subscribedTo).toBe('omni.agent.heartbeat.>');
  });

  test('valid heartbeat → recordActivity called once with turnId', async () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    const event = makeEvent({ turnId: 'turn-xyz' });
    nats.__push({
      subject: 'omni.agent.heartbeat.inst-1.chat-1',
      data: encode(event),
    });

    await flush();

    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith('turn-xyz');
  });

  test('malformed JSON → recordActivity NOT called, no crash', async () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    nats.__push({
      subject: 'omni.agent.heartbeat.inst-1.chat-1',
      data: encode('not-json{'),
    });

    await flush();

    expect(recordActivity).not.toHaveBeenCalled();
  });

  test('missing turnId → recordActivity NOT called', async () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    nats.__push({
      subject: 'omni.agent.heartbeat.inst-1.chat-1',
      data: encode({ instanceId: 'inst-1', chatId: 'chat-1', timestamp: 'now' }),
    });

    await flush();

    expect(recordActivity).not.toHaveBeenCalled();
  });

  test('non-object payload → recordActivity NOT called', async () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    nats.__push({
      subject: 'omni.agent.heartbeat.inst-1.chat-1',
      data: encode(42),
    });

    await flush();

    expect(recordActivity).not.toHaveBeenCalled();
  });

  test('unknown turnId (recordActivity rejects) is swallowed, consumer keeps processing', async () => {
    const calls: string[] = [];
    const recordActivity = mock(async (turnId: string) => {
      calls.push(turnId);
      if (turnId === 'turn-missing') {
        throw new Error('turn not found');
      }
    });

    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    nats.__push({
      subject: 'omni.agent.heartbeat.inst-1.chat-1',
      data: encode(makeEvent({ turnId: 'turn-missing' })),
    });
    nats.__push({
      subject: 'omni.agent.heartbeat.inst-1.chat-1',
      data: encode(makeEvent({ turnId: 'turn-good' })),
    });

    await flush();

    expect(calls).toEqual(['turn-missing', 'turn-good']);
  });

  test('multiple heartbeats in sequence → recordActivity called once per event', async () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    for (let i = 0; i < 5; i++) {
      nats.__push({
        subject: `omni.agent.heartbeat.inst-1.chat-${i}`,
        data: encode(makeEvent({ turnId: `turn-${i}`, chatId: `chat-${i}` })),
      });
    }

    await flush();

    expect(recordActivity).toHaveBeenCalledTimes(5);
  });

  test('start is idempotent — second start while running is a no-op', () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });
    const firstSub = nats.__subscribedTo;

    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    expect(nats.__subscribedTo).toBe(firstSub);
  });

  test('stop unsubscribes and cleans up', async () => {
    const recordActivity = mock(async () => {});
    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    await consumer.stop();
    expect(nats.__unsubscribed).toBe(true);
  });

  test('stop is safe when consumer was never started', async () => {
    await expect(consumer.stop()).resolves.toBeUndefined();
  });

  test('start no-ops when NATS connection is already closed', () => {
    nats.__end();
    const recordActivity = mock(async () => {});

    consumer.start({
      natsConnection: nats as never,
      turnService: { recordActivity } as never,
    });

    expect(nats.__subscribedTo).toBeNull();
  });
});
