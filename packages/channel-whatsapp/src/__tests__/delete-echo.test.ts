/**
 * Own-device edit/delete echoes must carry rawPayload.isFromMe so the
 * persistence layer journals them as outbound, like regular echoes (#1034, #1062).
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { WhatsAppPlugin } from '../plugin';

function createMockEventBus() {
  const published: Array<{ type: string; payload: { rawPayload?: Record<string, unknown> } }> = [];
  return {
    published,
    publish: mock(async (type: string, payload: unknown) => {
      published.push({ type, payload: payload as { rawPayload?: Record<string, unknown> } });
      return 'mock-correlation-id';
    }),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
  };
}

function createPlugin(eventBus: ReturnType<typeof createMockEventBus>): WhatsAppPlugin {
  const plugin = new WhatsAppPlugin();
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop };
  plugin.initialize({
    eventBus: eventBus as never,
    logger: { ...logger, child: () => logger } as never,
    storage: {} as never,
    config: {} as never,
    db: {} as never,
  });
  return plugin;
}

describe('Own-device edit/delete echoes carry isFromMe (#1062)', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;
  let plugin: WhatsAppPlugin;

  beforeEach(() => {
    eventBus = createMockEventBus();
    plugin = createPlugin(eventBus);
  });

  it.each([true, false])('handleMessageDeleted(fromMe=%p) sets rawPayload.isFromMe', async (fromMe) => {
    await plugin.handleMessageDeleted('instance-1', 'ext-123', 'chat-456@s.whatsapp.net', fromMe);
    const [event] = eventBus.published;
    expect(event?.type).toBe('message.received');
    expect(event?.payload.rawPayload?.isFromMe).toBe(fromMe);
    expect(event?.payload.rawPayload?.deletedByMe).toBe(fromMe);
  });

  it.each([true, false])('handleMessageEdited(fromMe=%p) sets rawPayload.isFromMe', async (fromMe) => {
    await plugin.handleMessageEdited('instance-1', 'ext-123', 'chat-456@s.whatsapp.net', 'new text', fromMe);
    const [event] = eventBus.published;
    expect(event?.type).toBe('message.received');
    expect(event?.payload.rawPayload?.isFromMe).toBe(fromMe);
  });
});
