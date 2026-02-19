/**
 * Telegram fetch-history + per_thread integration tests
 *
 * Tests:
 * - is_topic_message field present in TelegramMessageLike
 * - threadId logic: only set in rawPayload when is_topic_message === true
 * - TelegramPlugin.fetchHistory returns empty (Bot API limitation)
 * - TelegramPlugin exposes react, unreact methods
 */

import { describe, expect, it } from 'bun:test';
import type { TelegramMessageLike } from '../grammy-shim';
import { TelegramPlugin } from '../plugin';

describe('TelegramMessageLike — is_topic_message field', () => {
  it('accepts is_topic_message: true', () => {
    const msg: TelegramMessageLike = {
      message_id: 100,
      date: 1700000000,
      chat: { id: -100123, type: 'supergroup' },
      text: 'Hello topic',
      message_thread_id: 42,
      is_topic_message: true,
    };
    expect(msg.is_topic_message).toBe(true);
    expect(msg.message_thread_id).toBe(42);
  });

  it('accepts is_topic_message: false for regular supergroup replies', () => {
    const msg: TelegramMessageLike = {
      message_id: 101,
      date: 1700000000,
      chat: { id: -100123, type: 'supergroup' },
      text: 'Regular reply',
      message_thread_id: 55,
      is_topic_message: false,
    };
    expect(msg.is_topic_message).toBe(false);
  });

  it('is_topic_message is optional (can be undefined)', () => {
    const msg: TelegramMessageLike = {
      message_id: 102,
      date: 1700000000,
      chat: { id: 12345, type: 'private' },
      text: 'DM message',
    };
    expect(msg.is_topic_message).toBeUndefined();
  });
});

describe('Telegram threadId rawPayload logic', () => {
  /**
   * Mirrors the logic in processInboundMessage:
   * threadId: msg.is_topic_message === true ? String(msg.message_thread_id) : undefined
   */
  function resolveThreadId(msg: TelegramMessageLike): string | undefined {
    return msg.is_topic_message === true ? String(msg.message_thread_id) : undefined;
  }

  it('sets threadId for is_topic_message messages', () => {
    const msg: TelegramMessageLike = {
      message_id: 100,
      date: 1700000000,
      chat: { id: -100123, type: 'supergroup' },
      message_thread_id: 42,
      is_topic_message: true,
    };
    expect(resolveThreadId(msg)).toBe('42');
  });

  it('does not set threadId for regular supergroup replies (not topic)', () => {
    const msg: TelegramMessageLike = {
      message_id: 101,
      date: 1700000000,
      chat: { id: -100123, type: 'supergroup' },
      message_thread_id: 55,
      is_topic_message: false,
    };
    expect(resolveThreadId(msg)).toBeUndefined();
  });

  it('does not set threadId for messages without is_topic_message', () => {
    const msg: TelegramMessageLike = {
      message_id: 102,
      date: 1700000000,
      chat: { id: 12345, type: 'private' },
      message_thread_id: 1,
    };
    expect(resolveThreadId(msg)).toBeUndefined();
  });

  it('does not set threadId for DM messages', () => {
    const msg: TelegramMessageLike = {
      message_id: 103,
      date: 1700000000,
      chat: { id: 12345, type: 'private' },
    };
    expect(resolveThreadId(msg)).toBeUndefined();
  });
});

describe('TelegramPlugin — fetchHistory Bot API limitation', () => {
  it('exposes fetchHistory method', () => {
    const plugin = new TelegramPlugin();
    expect(typeof plugin.fetchHistory).toBe('function');
  });

  it('fetchHistory returns empty result (Telegram Bot API has no history endpoint)', async () => {
    const plugin = new TelegramPlugin();
    const result = await plugin.fetchHistory('inst-1', {
      channelId: '-100123',
      threadId: '42',
      limit: 200,
    });
    expect(result.totalFetched).toBe(0);
    expect(result.messages).toEqual([]);
  });
});

describe('TelegramPlugin — react/unreact surface', () => {
  it('exposes react method', () => {
    const plugin = new TelegramPlugin();
    expect(typeof plugin.react).toBe('function');
  });

  it('exposes unreact method', () => {
    const plugin = new TelegramPlugin();
    expect(typeof plugin.unreact).toBe('function');
  });

  it('react is graceful when bot is not connected (returns without throwing)', async () => {
    const plugin = new TelegramPlugin();
    // No bot connected — should not throw
    await expect(plugin.react('not-connected', 'chat-1', '42', '👀')).resolves.toBeUndefined();
  });

  it('unreact is graceful when bot is not connected (returns without throwing)', async () => {
    const plugin = new TelegramPlugin();
    await expect(plugin.unreact('not-connected', 'chat-1', '42', '✅')).resolves.toBeUndefined();
  });
});
