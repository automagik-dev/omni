/**
 * Regression test for #546 — automation engine NATS subscription becomes
 * stale after a disable→enable cycle (or NATS server reset), leaving the
 * automation marked enabled in the API but silently not consuming events.
 *
 * Verifies that the engine:
 *  - Re-subscribes after a disable→enable toggle (reload path).
 *  - Re-subscribes when the underlying iterator dies (reconciler path).
 *  - Does not leak duplicate subscriptions on no-op reconciles.
 *  - Cleans up subscriptions when the last automation for a trigger is
 *    disabled.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus, GenericEventHandler, SubscribeOptions, Subscription } from '../../events/bus';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

function makeAutomation(triggerEventType: string, id = 'auto-1', enabled = true): Automation {
  return {
    id,
    name: `Auto ${id}`,
    enabled,
    priority: 0,
    triggerEventType,
    triggerConditions: [],
    conditionLogic: 'and',
    actions: [],
    debounce: { mode: 'none' },
  } as unknown as Automation;
}

interface FakeSubscription extends Subscription {
  alive: boolean;
}

interface BusHarness {
  bus: EventBus;
  subscribeCalls: Array<{ pattern: string; options: SubscribeOptions }>;
  liveSubs: FakeSubscription[];
}

function makeBus(): BusHarness {
  const subscribeCalls: Array<{ pattern: string; options: SubscribeOptions }> = [];
  const liveSubs: FakeSubscription[] = [];

  const bus = {
    connect: mock(async () => {}),
    publish: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    publishGeneric: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    subscribe: mock(async () => ({ id: 'x', pattern: '*', unsubscribe: async () => {} }) as Subscription),
    subscribePattern: mock(async (pattern: string, _handler: GenericEventHandler, options?: SubscribeOptions) => {
      subscribeCalls.push({ pattern, options: options ?? {} });
      const sub: FakeSubscription = {
        id: `sub-${subscribeCalls.length}`,
        pattern,
        alive: true,
        isAlive() {
          return this.alive;
        },
        async unsubscribe() {
          this.alive = false;
        },
      };
      liveSubs.push(sub);
      return sub;
    }),
    subscribeMany: mock(async () => ({ id: 'x', pattern: '*', unsubscribe: async () => {} }) as Subscription),
    subscribeAll: mock(async () => ({ id: 'x', pattern: '*', unsubscribe: async () => {} }) as Subscription),
    close: mock(async () => {}),
    isConnected: mock(() => true),
  } as unknown as EventBus;

  return { bus, subscribeCalls, liveSubs };
}

describe('AutomationEngine — reconcile + toggle (#546)', () => {
  let engine: ReturnType<typeof createAutomationEngine>;
  let harness: BusHarness;

  beforeEach(() => {
    // reconcileIntervalMs=0 disables the periodic timer so tests drive
    // reconcile() explicitly.
    engine = createAutomationEngine({ defaultConcurrency: 1, reconcileIntervalMs: 0 });
    harness = makeBus();
  });

  afterEach(async () => {
    await engine.stop();
  });

  test('disable→enable toggle re-subscribes the durable consumer', async () => {
    const auto = makeAutomation('chat.idle_timeout', 'a1', true);

    await engine.start(harness.bus, [auto]);
    expect(harness.subscribeCalls).toHaveLength(1);
    expect(harness.subscribeCalls[0]?.options.durable).toBe('automation-engine-chat-idle_timeout');

    // Simulate PATCH enabled=false: reload with empty enabled set.
    await engine.reload([{ ...auto, enabled: false } as Automation]);

    // The previous subscription must be unsubscribed so we don't leak
    // handlers.
    expect(harness.liveSubs[0]?.alive).toBe(false);

    // Simulate PATCH enabled=true: reload with the automation re-enabled.
    await engine.reload([auto]);

    // A fresh subscription must have been created — this is the bug from
    // #546: previously the engine could end up with no live subscription,
    // and the only recovery was `pm2 restart omni-api`.
    expect(harness.subscribeCalls).toHaveLength(2);
    expect(harness.subscribeCalls[1]?.options.durable).toBe('automation-engine-chat-idle_timeout');
    expect(harness.liveSubs[1]?.alive).toBe(true);
  });

  test('reconcile re-subscribes when the underlying iterator dies', async () => {
    const auto = makeAutomation('chat.idle_timeout', 'a1', true);
    await engine.start(harness.bus, [auto]);
    expect(harness.subscribeCalls).toHaveLength(1);

    // Simulate the iterator dying (NATS server reset, consumer GC'd) —
    // before #546, this dead subscription was never replaced and events
    // silently stopped flowing.
    const sub = harness.liveSubs[0];
    if (!sub) throw new Error('expected a live sub');
    sub.alive = false;

    await engine.reconcile();

    expect(harness.subscribeCalls).toHaveLength(2);
    expect(harness.liveSubs[1]?.alive).toBe(true);
  });

  test('reconcile is idempotent when subscriptions are healthy', async () => {
    const auto = makeAutomation('chat.idle_timeout', 'a1', true);
    await engine.start(harness.bus, [auto]);
    expect(harness.subscribeCalls).toHaveLength(1);

    await engine.reconcile();
    await engine.reconcile();
    await engine.reconcile();

    // Still only one subscribePattern call — no leaks from healthy reconciles.
    expect(harness.subscribeCalls).toHaveLength(1);
  });

  test('reload drops subscriptions for triggers with no enabled automations', async () => {
    const idleAuto = makeAutomation('chat.idle_timeout', 'a1', true);
    const archivedAuto = makeAutomation('chat.archived', 'a2', true);

    await engine.start(harness.bus, [idleAuto, archivedAuto]);
    expect(harness.subscribeCalls).toHaveLength(2);

    // Disable the chat.archived automation — its subscription should be
    // unsubscribed.
    await engine.reload([idleAuto, { ...archivedAuto, enabled: false } as Automation]);

    const idleSub = harness.liveSubs.find((s) => s.pattern === 'chat.idle_timeout.>');
    const archivedSub = harness.liveSubs.find((s) => s.pattern === 'chat.archived.>');
    expect(idleSub?.alive).toBe(true);
    expect(archivedSub?.alive).toBe(false);
  });

  test('reload preserves a healthy subscription instead of churning it', async () => {
    const auto = makeAutomation('chat.idle_timeout', 'a1', true);
    await engine.start(harness.bus, [auto]);
    expect(harness.subscribeCalls).toHaveLength(1);
    const originalSub = harness.liveSubs[0];

    // Reload with the same automation — no toggle, no change. The existing
    // healthy subscription must be reused; no extra subscribePattern call.
    await engine.reload([auto]);

    expect(harness.subscribeCalls).toHaveLength(1);
    expect(originalSub?.alive).toBe(true);
  });

  test('reload from never-started engine seeds automations without subscribing', async () => {
    // Some startup paths may call reload before start; this should not
    // throw nor create subscriptions until start() runs.
    const auto = makeAutomation('chat.idle_timeout', 'a1', true);
    await engine.reload([auto]);
    expect(harness.subscribeCalls).toHaveLength(0);
  });
});
