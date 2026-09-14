/**
 * Discord — journal idempotency keys (#1149)
 *
 * message.received, message.sent and reaction.received claim a key derived
 * from instance + message snowflake; a redelivery claims the same key and is
 * not republished.
 */

import { describe, expect, it } from 'bun:test';
import { DiscordPlugin } from '../plugin';

function setup() {
  const plugin = new DiscordPlugin();
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

describe('DiscordPlugin idempotency keys', () => {
  it('message.received key is stable across redelivery', async () => {
    const { plugin, keys, published } = setup();
    const deliver = () =>
      plugin.handleMessageReceived(
        'dc-1',
        '1200000000000000001',
        'ch-1',
        'u1',
        { type: 'text', text: 'hi' },
        undefined,
        {},
      );
    await deliver();
    await deliver();
    expect(keys).toEqual(['discord:dc-1:1200000000000000001:text', 'discord:dc-1:1200000000000000001:text']);
    expect(published.filter((t) => t === 'message.received').length).toBe(1);
  });

  it('message.sent key is stable across re-emission', async () => {
    const { emit, keys, published } = setup();
    const sent = {
      instanceId: 'dc-1',
      externalId: '1200000000000000002',
      chatId: 'ch-1',
      to: 'ch-1',
      content: { type: 'text' },
    };
    await emit.emitMessageSent(sent);
    await emit.emitMessageSent(sent);
    expect(keys).toEqual([
      'discord:dc-1:1200000000000000002:message.sent',
      'discord:dc-1:1200000000000000002:message.sent',
    ]);
    expect(published.filter((t) => t === 'message.sent').length).toBe(1);
  });

  it('reaction.received key is stable across redelivery', async () => {
    const { plugin, keys, published } = setup();
    await plugin.handleReactionReceived('dc-1', '1200000000000000001', 'ch-1', 'u1', '👍', 'add');
    await plugin.handleReactionReceived('dc-1', '1200000000000000001', 'ch-1', 'u1', '👍', 'add');
    expect(keys[0]).toBe('discord:dc-1:1200000000000000001:u1:reaction.received:👍');
    expect(keys[1]).toBe(keys[0]);
    expect(published.filter((t) => t === 'reaction.received').length).toBe(1);
  });
});
