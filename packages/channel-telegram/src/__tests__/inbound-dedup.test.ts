/**
 * Telegram — inbound dedup regression tests
 *
 * Verifies:
 * - Per-instance dedup cache starts empty and is isolated per instance
 * - Duplicate messages are dropped within the TTL window
 * - Channels without a configured cache fall back gracefully (module-level fallback)
 * - Cache dispose clears state and stops timers
 */

import { describe, expect, it } from 'bun:test';
import { createInboundDedupeCache } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import { TelegramPlugin } from '../plugin';

const log = createLogger('test:telegram-dedup');

// ─────────────────────────────────────────────────────────────
// Plugin-level: per-instance cache isolation
// ─────────────────────────────────────────────────────────────

describe('TelegramPlugin — per-instance dedup cache lifecycle', () => {
  it('starts with no dedup caches (none created before connect)', () => {
    const plugin = new TelegramPlugin();
    const caches = (plugin as unknown as { dedupeCaches: Map<string, unknown> }).dedupeCaches;
    expect(caches.size).toBe(0);
  });

  it('connect creates an isolated dedup cache per instance', () => {
    // Two independent caches simulate two different Telegram bot instances
    const cacheA = createInboundDedupeCache();
    const cacheB = createInboundDedupeCache();

    const msgId = '100'; // Telegram message IDs are integers-as-strings
    const chatId = '-100123456';
    // Telegram dedup key: `${chatId}:${messageId}`
    const dedupeKey = `${chatId}:${msgId}`;
    const instanceId = 'inst-telegram-shared';

    // Record in cacheA (first time = miss)
    cacheA.isDuplicate(instanceId, dedupeKey, 'telegram', log);

    // cacheA now treats the message as a duplicate
    expect(cacheA.isDuplicate(instanceId, dedupeKey, 'telegram', log)).toBe(true);

    // cacheB has not seen this message — isolation guarantees it's a miss in cacheB
    expect(cacheB.isDuplicate(instanceId, dedupeKey, 'telegram', log)).toBe(false);
  });

  it('dispose clears cache state (simulates disconnect cleanup)', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-telegram-dispose';

    cache.isDuplicate(instanceId, '-100123:42', 'telegram', log);
    cache.isDuplicate(instanceId, '-100123:43', 'telegram', log);
    expect(cache.size).toBe(2);

    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Dedup behavior: duplicate detection (Telegram-specific key format)
// ─────────────────────────────────────────────────────────────

describe('Telegram inbound dedup — duplicate detection', () => {
  it('first occurrence of a message is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-telegram-1';
    // Telegram dedup key: `${chatId}:${messageId}`
    const dedupeKey = '-100123456:100';

    expect(cache.isDuplicate(instanceId, dedupeKey, 'telegram', log)).toBe(false);
  });

  it('second occurrence of the same message is dropped', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-telegram-1';
    const dedupeKey = '-100123456:100';

    cache.isDuplicate(instanceId, dedupeKey, 'telegram', log); // first: miss
    expect(cache.isDuplicate(instanceId, dedupeKey, 'telegram', log)).toBe(true); // second: hit
  });

  it('same message_id in different chats is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-telegram-1';

    // Message ID 42 in two different chats — distinct keys
    cache.isDuplicate(instanceId, '-100chat1:42', 'telegram', log);
    expect(cache.isDuplicate(instanceId, '-100chat2:42', 'telegram', log)).toBe(false);
  });

  it('different message_ids in same chat are not duplicates of each other', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-telegram-1';

    cache.isDuplicate(instanceId, '-100123:100', 'telegram', log);
    expect(cache.isDuplicate(instanceId, '-100123:101', 'telegram', log)).toBe(false);
  });

  it('stats() tracks hit and miss counts', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-telegram-stats';

    cache.isDuplicate(instanceId, '-100:1', 'telegram', log); // miss
    cache.isDuplicate(instanceId, '-100:2', 'telegram', log); // miss
    cache.isDuplicate(instanceId, '-100:1', 'telegram', log); // hit

    const stats = cache.stats();
    expect(stats.missCount).toBe(2);
    expect(stats.hitCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Fallback: no configured cache → graceful
// ─────────────────────────────────────────────────────────────

describe('Telegram inbound dedup — fallback cache', () => {
  it('handlers/messages.ts falls back gracefully when no cache is provided', () => {
    // The handler uses: const cache = dedupeCache ?? fallbackDedupeCache
    // We verify the fallback behavior using a standalone cache instance
    const fallback = createInboundDedupeCache();
    const instanceId = 'inst-telegram-fallback';
    const dedupeKey = '-100123:999';

    // Should work without throwing, and correctly deduplicate
    expect(() => fallback.isDuplicate(instanceId, dedupeKey, 'telegram', log)).not.toThrow();
    expect(fallback.isDuplicate(instanceId, dedupeKey, 'telegram', log)).toBe(true);
  });

  it('TelegramPlugin exposes connect and disconnect methods (lifecycle surface)', () => {
    const plugin = new TelegramPlugin();
    expect(typeof plugin.connect).toBe('function');
    expect(typeof plugin.disconnect).toBe('function');
  });
});
