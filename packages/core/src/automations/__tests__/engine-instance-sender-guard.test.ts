/**
 * Loop guard (#1148). The two-instance group from the issue, as the engine
 * sees it: the bot's message is journaled fromMe:true on the bot instance and
 * fromMe:false on the personal instance, but both rows carry
 * `senderInstanceId: 'bot'`. An automation with `key.fromMe eq false` must
 * not answer the bot, while humans still get through.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, Subscription } from '../../events/bus';
import type { OmniEvent } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

const baseAutomation = {
  id: 'auto-1',
  name: 'Reply to humans',
  enabled: true,
  priority: 0,
  triggerEventType: 'message.received',
  triggerConditions: [{ field: 'key.fromMe', operator: 'eq', value: false }],
  conditionLogic: 'and',
  actions: [
    { type: 'send_message', config: { instanceId: 'bot', to: 'g@g.us', contentTemplate: 'by={{senderInstanceId}}' } },
  ],
  debounce: { mode: 'none' },
} as unknown as Automation;

const rows = [
  { observer: 'bot', fromMe: true, senderInstanceId: 'bot' },
  { observer: 'personal', fromMe: false, senderInstanceId: 'bot' },
  { observer: 'bot', fromMe: false, senderInstanceId: undefined },
  { observer: 'personal', fromMe: false, senderInstanceId: undefined },
];

async function run(automation: Automation) {
  let handler: ((e: OmniEvent) => Promise<void>) | null = null;
  const subscription: Subscription = { id: 'sub', pattern: '*', unsubscribe: async () => {} };
  const bus = {
    subscribePattern: mock(async (_p: string, h: (e: OmniEvent) => Promise<void>) => {
      handler = h;
      return subscription;
    }),
    subscribe: mock(async () => subscription),
  } as unknown as EventBus;
  const engine = createAutomationEngine({ defaultConcurrency: 5, reconcileIntervalMs: 0 });
  const sendMessage = mock(async (_cfg: unknown) => {});
  await engine.start(bus, [automation], { sendMessage: sendMessage as never });
  for (const [i, row] of rows.entries()) {
    await (handler as unknown as (e: OmniEvent) => Promise<void>)({
      id: `evt-${i}`,
      type: 'message.received',
      payload: {
        externalId: `wa-${i}`,
        chatId: 'g@g.us',
        from: 'x',
        content: { type: 'text', text: 'hi' },
        ...(row.senderInstanceId ? { senderInstanceId: row.senderInstanceId } : {}),
        rawPayload: { key: { fromMe: row.fromMe } },
      },
      metadata: { correlationId: `c-${i}`, instanceId: row.observer },
      timestamp: Date.now(),
    } as unknown as OmniEvent);
  }
  await engine.stop();
  return sendMessage.mock.calls.map((c) => JSON.stringify(c));
}

describe('AutomationEngine — same-tenant instance sender guard (#1148)', () => {
  test('key.fromMe eq false answers only the humans, not the bot seen from the personal instance', async () => {
    const calls = await run(baseAutomation);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => !c.includes('by=bot'))).toBe(true);
  });

  test('allowInstanceSenders opts back in, and templates see senderInstanceId', async () => {
    const calls = await run({ ...baseAutomation, allowInstanceSenders: true });
    // fromMe:false rows: the bot via personal + the two humans.
    expect(calls).toHaveLength(3);
    expect(calls.filter((c) => c.includes('by=bot'))).toHaveLength(1);
  });
});
