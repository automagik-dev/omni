/**
 * Telegram — journal idempotency keys (#1149)
 *
 * message.received, message.sent and reaction.received claim a key derived
 * from instance + chat + message_id; a redelivery claims the same key and is
 * not republished.
 */

import { describe, expect, it } from 'bun:test';
import { TelegramPlugin } from '../plugin';

function setup() {
  const plugin = new TelegramPlugin();
  const claimed = new Set<string>();
  const keys: string[] = [];
  const published: string[] = [];
  const ingressClaim = {
    claim: async ({ idempotencyKey }: { idempotencyKey: string }) => {
      keys.push(idempotencyKey);
      if (claimed.has(idempotencyKey)) return null;
      claimed.add(idempotencyKey);
      return crypto.randomUUID();
    },
    release: async () => {},
  };
  const logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger };
  Object.assign(plugin, {
    ingressClaim,
    logger,
    eventBus: { publish: async (type: string) => published.push(type) },
    instances: { recordActivity() {} },
  });
  const emit = plugin as unknown as {
    emitMessageSent(p: Record<string, unknown>): Promise<void>;
  };
  return { plugin, emit, keys, published };
}

describe('TelegramPlugin idempotency keys', () => {
  it('message.received key is stable across redelivery and scoped per chat', async () => {
    const { plugin, keys, published } = setup();
    const deliver = (chatId: string) =>
      plugin.handleMessageReceived('tg-1', '42', chatId, 'u1', { type: 'text', text: 'hi' }, undefined, {});
    await deliver('-100');
    await deliver('-100');
    await deliver('-200');
    expect(keys).toEqual(['telegram:tg-1:-100:42:text', 'telegram:tg-1:-100:42:text', 'telegram:tg-1:-200:42:text']);
    expect(published.filter((t) => t === 'message.received').length).toBe(2);
  });

  it('message.sent key is stable across re-emission', async () => {
    const { emit, keys, published } = setup();
    const sent = { instanceId: 'tg-1', externalId: '7', chatId: '-100', to: '-100', content: { type: 'text' } };
    await emit.emitMessageSent(sent);
    await emit.emitMessageSent(sent);
    expect(keys).toEqual(['telegram:tg-1:-100:7:message.sent', 'telegram:tg-1:-100:7:message.sent']);
    expect(published.filter((t) => t === 'message.sent').length).toBe(1);
  });

  it('reaction.received key is stable across redelivery', async () => {
    const { plugin, keys, published } = setup();
    await plugin.handleReactionAdd('tg-1', '42', '-100', 'u1', '👍', false);
    await plugin.handleReactionAdd('tg-1', '42', '-100', 'u1', '👍', false);
    expect(keys[0]).toBe('telegram:tg-1:-100:42:u1:reaction.received:👍');
    expect(keys[1]).toBe(keys[0]);
    expect(published.filter((t) => t === 'reaction.received').length).toBe(1);
  });
});
