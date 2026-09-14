/**
 * #1147 — re-enabling an automation must not replay the backlog the shared
 * durable consumer accumulated while it was disabled. The engine drops trigger
 * events older than `enabledAt`; an explicit earlier `enabledAt` (enable
 * --replay-since) opts into acting on them.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SubscribeOptions, Subscription } from '../../events/bus';
import type { OmniEvent } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

const DISABLED_AT = Date.now() - 60 * 60 * 1000;
const N = 5;

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Greet',
    enabled: true,
    priority: 0,
    triggerEventType: 'custom.greet',
    triggerConditions: [],
    conditionLogic: 'and',
    actions: [{ type: 'send_message', config: { instanceId: 'inst-1', to: 'chat-1', contentTemplate: 'hi' } }],
    debounce: { mode: 'none' },
    ...overrides,
  } as unknown as Automation;
}

function makeBus() {
  let handler: ((event: OmniEvent) => Promise<void>) | null = null;
  const subscription: Subscription = { id: 'sub', pattern: '*', unsubscribe: async () => {} };
  const bus = {
    publish: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    publishGeneric: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    subscribePattern: mock(async (_p: string, h: (e: OmniEvent) => Promise<void>, _o?: SubscribeOptions) => {
      handler = h;
      return subscription;
    }),
    isConnected: mock(() => true),
  } as unknown as EventBus;
  return {
    bus,
    deliver: (event: OmniEvent) => {
      if (!handler) throw new Error('engine never subscribed');
      return handler(event);
    },
  };
}

/** N matching events journaled while the automation was disabled. */
function backlog(): OmniEvent[] {
  return Array.from({ length: N }, (_, i) => ({
    id: `evt-${i}`,
    type: 'custom.greet',
    payload: {},
    metadata: { correlationId: `corr-${i}`, instanceId: 'inst-1' },
    timestamp: DISABLED_AT + (i + 1) * 1000,
  })) as unknown as OmniEvent[];
}

async function runEnable(enabledAt: Date): Promise<number> {
  const engine = createAutomationEngine({ reconcileIntervalMs: 0 });
  const { bus, deliver } = makeBus();
  const sendMessage = mock(async () => {});
  await engine.start(bus, [makeAutomation({ enabled: false })], { sendMessage });
  await engine.reload([makeAutomation({ enabledAt })]);
  for (const event of backlog()) await deliver(event);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await engine.stop();
  return sendMessage.mock.calls.length;
}

describe('AutomationEngine — enable resumes from now (#1147)', () => {
  test('backlog journaled while disabled fires zero actions on enable', async () => {
    expect(await runEnable(new Date())).toBe(0);
  });

  test('replay opt-in (enabledAt before the backlog) fires every backlog action', async () => {
    expect(await runEnable(new Date(DISABLED_AT))).toBe(N);
  });
});
