/**
 * Redelivery dedup for automation execution (#1031).
 *
 * A NATS redelivery of an event whose long-running action outlived the ack
 * window must NOT re-run the actions: the engine claims the
 * (eventId, automationId) slot before any side effect and skips when the
 * claim is already taken.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SubscribeOptions, Subscription } from '../../events/bus';
import type { OmniEvent } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

function makeAutomation(): Automation {
  return {
    id: 'auto-1',
    name: 'Announce PR',
    enabled: true,
    priority: 0,
    triggerEventType: 'custom.github.pull_request',
    triggerConditions: [],
    conditionLogic: 'and',
    actions: [{ type: 'send_message', config: { instanceId: 'inst-1', to: 'chat-1', contentTemplate: 'hi' } }],
    debounce: { mode: 'none' },
  } as unknown as Automation;
}

function prEvent(): OmniEvent {
  return {
    id: 'evt-1',
    type: 'custom.github.pull_request',
    payload: { action: 'closed' },
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

describe('AutomationEngine — execution claim (#1031)', () => {
  test('redelivered event runs actions once; second delivery is logged as skipped', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5 });
    const { bus, deliver } = makeBus();
    const claimed = new Set<string>();
    const sendMessage = mock(async () => {});
    const logs: Array<{ status: string; error?: string }> = [];
    engine.setLogger(async (log) => {
      logs.push({ status: log.status, error: log.error });
    });

    await engine.start(bus, [makeAutomation()], {
      sendMessage,
      claimExecution: async (eventId, automationId) => {
        const key = `${eventId}:${automationId}`;
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    });

    await deliver(prEvent());
    await deliver(prEvent());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(logs.map((l) => l.status)).toEqual(['success', 'skipped']);
    expect(logs[1]?.error).toContain('duplicate delivery');
    await engine.stop();
  });

  test('subscribes with an ack window long enough for multi-minute actions', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5 });
    const { bus } = makeBus();
    await engine.start(bus, [makeAutomation()], {});
    const opts = (bus.subscribePattern as ReturnType<typeof mock>).mock.calls[0]?.[2] as SubscribeOptions;
    expect(opts.ackWaitMs).toBeGreaterThanOrEqual(3 * 60 * 1000);
    await engine.stop();
  });
});
