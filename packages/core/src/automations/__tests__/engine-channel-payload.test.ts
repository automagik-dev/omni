/**
 * Channel events (#1115) and dry-run parity (#1116).
 *
 * A WhatsApp `message.received` reaches the engine with its platform fields
 * (`rawChatId`, `key.fromMe`, `message.conversation`) nested under
 * `payload.rawPayload`. Conditions and templates must resolve them live, and
 * `testAutomation` must reach the same verdict from the same event.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, Subscription } from '../../events/bus';
import type { OmniEvent } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

const automation = {
  id: 'auto-1',
  name: 'Group reply',
  enabled: true,
  priority: 0,
  triggerEventType: 'message.received',
  triggerConditions: [
    { field: 'rawChatId', operator: 'eq', value: '120363@g.us' },
    { field: 'key.fromMe', operator: 'eq', value: false },
    { field: 'instanceId', operator: 'eq', value: 'inst-1' },
  ],
  conditionLogic: 'and',
  actions: [
    {
      type: 'send_message',
      config: { instanceId: 'inst-1', to: '{{payload.rawChatId}}', contentTemplate: 'echo {{message.conversation}}' },
    },
  ],
  debounce: { mode: 'none' },
} as unknown as Automation;

const event = {
  id: 'evt-1',
  type: 'message.received',
  payload: {
    externalId: 'wa-1',
    chatId: '120363@g.us',
    from: { id: 'p1' },
    content: { type: 'text', text: 'testante' },
    rawPayload: { rawChatId: '120363@g.us', key: { fromMe: false }, message: { conversation: 'testante' } },
  },
  metadata: { correlationId: 'corr-1', instanceId: 'inst-1' },
  timestamp: Date.now(),
} as unknown as OmniEvent;

describe('AutomationEngine — channel event payload (#1115, #1116)', () => {
  test('live match renders rawPayload fields, and the dry run agrees', async () => {
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
    if (!handler) throw new Error('engine never subscribed');
    await (handler as (e: OmniEvent) => Promise<void>)(event);
    await engine.stop();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendMessage.mock.calls[0])).toContain('echo testante');
    expect(JSON.stringify(sendMessage.mock.calls[0])).toContain('120363@g.us');

    const dry = await engine.testAutomation(automation, {
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      metadata: event.metadata as unknown as Record<string, unknown>,
    });
    expect(dry.matched).toBe(true);
    expect(dry.conditions.every((c) => c.matched)).toBe(true);
  });
});
