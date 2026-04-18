/**
 * Regression test for #445 — automation engine subscriptions silently die
 * because ephemeral NATS consumers get GC'd after 5s idle.
 *
 * Verifies that the engine passes a `durable` name (plus queue/startFrom/
 * retry config) to the event bus when subscribing to trigger event types,
 * so the resulting consumer is not ephemeral and cannot be GC'd.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus, SubscribeOptions, Subscription } from '../../events/bus';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

function makeAutomation(triggerEventType: string, id = 'auto-1'): Automation {
  return {
    id,
    name: `Auto ${id}`,
    enabled: true,
    priority: 0,
    triggerEventType,
    triggerConditions: [],
    conditionLogic: 'and',
    actions: [],
    debounce: { mode: 'none' },
  } as unknown as Automation;
}

function makeMockBus(): {
  bus: EventBus;
  calls: Array<{ pattern: string; options: SubscribeOptions }>;
} {
  const calls: Array<{ pattern: string; options: SubscribeOptions }> = [];
  const fakeSubscription: Subscription = {
    id: 'sub-test',
    pattern: '*',
    unsubscribe: async () => {},
  };
  const bus = {
    connect: mock(async () => {}),
    publish: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    publishGeneric: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    subscribe: mock(async () => fakeSubscription),
    subscribePattern: mock(async (pattern: string, _handler: unknown, options?: SubscribeOptions) => {
      calls.push({ pattern, options: options ?? {} });
      return fakeSubscription;
    }),
    subscribeMany: mock(async () => fakeSubscription),
    subscribeAll: mock(async () => fakeSubscription),
    close: mock(async () => {}),
    isConnected: mock(() => true),
  } as unknown as EventBus;

  return { bus, calls };
}

describe('AutomationEngine — durable NATS consumers (#445)', () => {
  let engine: ReturnType<typeof createAutomationEngine>;

  beforeEach(() => {
    engine = createAutomationEngine({ defaultConcurrency: 1 });
  });

  test('passes a durable name for each unique trigger event type', async () => {
    const { bus, calls } = makeMockBus();

    await engine.start(bus, [
      makeAutomation('chat.idle_timeout', 'a1'),
      makeAutomation('chat.archived', 'a2'),
      makeAutomation('chat.handoff_activated', 'a3'),
    ]);

    expect(calls).toHaveLength(3);

    const durables = calls.map((c) => c.options.durable).sort();
    expect(durables).toEqual([
      'automation-engine-chat-archived',
      'automation-engine-chat-handoff_activated',
      'automation-engine-chat-idle_timeout',
    ]);

    // Every subscription must have a durable set — no ephemerals allowed.
    for (const { options } of calls) {
      expect(options.durable).toBeDefined();
      expect(options.durable).toMatch(/^automation-engine-/);
    }
  });

  test('deduplicates subscriptions by triggerEventType', async () => {
    const { bus, calls } = makeMockBus();

    await engine.start(bus, [
      makeAutomation('chat.idle_timeout', 'a1'),
      makeAutomation('chat.idle_timeout', 'a2'),
      makeAutomation('chat.idle_timeout', 'a3'),
    ]);

    // One durable consumer shared across all automations for the same
    // trigger — engine dispatches internally after the handler fires.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.durable).toBe('automation-engine-chat-idle_timeout');
  });

  test('sets queue group and startFrom=new on subscription options', async () => {
    const { bus, calls } = makeMockBus();

    await engine.start(bus, [makeAutomation('message.received')]);

    expect(calls).toHaveLength(1);
    const options = calls[0]?.options;
    expect(options?.queue).toBe('automation-engine');
    expect(options?.startFrom).toBe('new');
    expect(options?.maxRetries).toBeGreaterThanOrEqual(1);
  });

  test('subscribes using the pattern `<eventType>.>`', async () => {
    const { bus, calls } = makeMockBus();

    await engine.start(bus, [makeAutomation('chat.idle_timeout')]);

    expect(calls[0]?.pattern).toBe('chat.idle_timeout.>');
  });
});
