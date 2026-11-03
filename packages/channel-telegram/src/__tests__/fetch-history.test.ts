/**
 * Tests for Telegram fetch-history limits and disconnected reactions.
 */

import { describe, expect, it } from 'bun:test';
import { TelegramPlugin } from '../plugin';

describe('TelegramPlugin — fetchHistory Bot API limitation', () => {
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
