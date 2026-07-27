/**
 * The idle-timeout delivery claim must be released when the delivery FAILS.
 *
 * `staleIdleTimeoutGate` records a claim for the event's identity *before* the
 * engine executes it. If handling then throws (queue full → the NATS subscriber
 * naks and redelivers, dispatcher error, …), the redelivery would meet that
 * claim, be classified `duplicate_delivery_event_N`, and the follow-up would be
 * lost permanently — the gate failing CLOSED, which its contract forbids
 * ("a redundant follow-up beats a silent drop").
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SubscribeOptions, Subscription } from '../../events/bus';
import type { OmniEvent } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

function makeAutomation(): Automation {
  return {
    id: 'auto-idle',
    name: 'Idle follow-up',
    enabled: true,
    priority: 0,
    triggerEventType: 'chat.idle_timeout',
    triggerConditions: [],
    conditionLogic: 'and',
    // No actions: the claim contract is decided by the queue/dispatch layer,
    // which is reached before any action runs.
    actions: [],
    debounce: { mode: 'none' },
  } as unknown as Automation;
}

function idleEvent(): OmniEvent {
  return {
    id: 'evt-1',
    type: 'chat.idle_timeout',
    payload: { chatId: 'chat-1', instanceId: 'inst-1', sequenceIndex: 0 },
    metadata: { correlationId: 'corr-1', instanceId: 'inst-1' },
    timestamp: Date.now(),
  } as unknown as OmniEvent;
}

function makeBus(): { bus: EventBus; deliver: (event: OmniEvent) => Promise<void> } {
  let handler: ((event: OmniEvent) => Promise<void>) | null = null;
  const subscription: Subscription = { id: 'sub', pattern: '*', unsubscribe: async () => {} };
  const bus = {
    connect: mock(async () => {}),
    publish: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    publishGeneric: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    subscribe: mock(async () => subscription),
    subscribePattern: mock(async (_p: string, h: (e: OmniEvent) => Promise<void>, _o?: SubscribeOptions) => {
      handler = h;
      return subscription;
    }),
    subscribeMany: mock(async () => subscription),
    subscribeAll: mock(async () => subscription),
    close: mock(async () => {}),
    isConnected: mock(() => true),
  } as unknown as EventBus;

  return {
    bus,
    deliver: async (event) => {
      if (!handler) throw new Error('engine never subscribed');
      await handler(event);
    },
  };
}

describe('AutomationEngine — idle-timeout claim release on failed delivery', () => {
  test('releases the claim (and rethrows) when handling throws — the nak path', async () => {
    // defaultConcurrency 0 + maxQueueDepth 0 ⇒ queueExecution throws
    // QueueFullError, the exact backpressure failure that naks the message.
    const engine = createAutomationEngine({ defaultConcurrency: 0, maxQueueDepth: 0 });
    const { bus, deliver } = makeBus();
    const released: string[] = [];

    await engine.start(bus, [makeAutomation()], {
      staleIdleTimeoutGate: async () => ({ skip: false, claimToken: 'inst-1:chat-1:1000:0' }),
      releaseIdleTimeoutClaim: (token) => {
        released.push(token);
      },
    });

    await expect(deliver(idleEvent())).rejects.toThrow(/queue/i);
    expect(released).toEqual(['inst-1:chat-1:1000:0']);

    await engine.stop();
  });

  test('keeps the claim when handling succeeds', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5, maxQueueDepth: 100 });
    const { bus, deliver } = makeBus();
    const released: string[] = [];

    await engine.start(bus, [makeAutomation()], {
      sendMessage: async () => {},
      staleIdleTimeoutGate: async () => ({ skip: false, claimToken: 'inst-1:chat-1:1000:0' }),
      releaseIdleTimeoutClaim: (token) => {
        released.push(token);
      },
    });

    await deliver(idleEvent());
    expect(released).toEqual([]);

    await engine.stop();
  });

  test('a skip verdict never releases anything', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 0, maxQueueDepth: 0 });
    const { bus, deliver } = makeBus();
    const release = mock(() => {});

    await engine.start(bus, [makeAutomation()], {
      staleIdleTimeoutGate: async () => ({ skip: true, reason: 'duplicate_delivery_event_0' }),
      releaseIdleTimeoutClaim: release,
    });

    await deliver(idleEvent());
    expect(release).not.toHaveBeenCalled();

    await engine.stop();
  });
});
