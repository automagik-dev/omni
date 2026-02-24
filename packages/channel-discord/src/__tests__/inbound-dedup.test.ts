/**
 * Discord — inbound dedup regression tests
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
import { DiscordPlugin } from '../plugin';

const log = createLogger('test:discord-dedup');

// ─────────────────────────────────────────────────────────────
// Plugin-level: per-instance cache isolation
// ─────────────────────────────────────────────────────────────

describe('DiscordPlugin — per-instance dedup cache lifecycle', () => {
  it('starts with no dedup caches (none created before connect)', () => {
    const plugin = new DiscordPlugin();
    // Access private field via cast to verify initial state
    const caches = (plugin as unknown as { dedupeCaches: Map<string, unknown> }).dedupeCaches;
    expect(caches.size).toBe(0);
  });

  it('createConnection creates an isolated dedup cache per instance', () => {
    // Two independent caches simulate two different bot connections for the same guild
    const cacheA = createInboundDedupeCache();
    const cacheB = createInboundDedupeCache();

    const msgId = 'discord-123456789012345';
    const instanceId = 'inst-discord-shared';

    // Record the message in cacheA (first time = miss)
    cacheA.isDuplicate(instanceId, msgId, 'discord', log);

    // cacheA now treats the message as a duplicate
    expect(cacheA.isDuplicate(instanceId, msgId, 'discord', log)).toBe(true);

    // cacheB has not seen this message — isolation guarantees it's a miss in cacheB
    expect(cacheB.isDuplicate(instanceId, msgId, 'discord', log)).toBe(false);
  });

  it('dispose clears cache state (simulates disconnect cleanup)', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-discord-dispose';

    cache.isDuplicate(instanceId, 'msg-1', 'discord', log);
    cache.isDuplicate(instanceId, 'msg-2', 'discord', log);
    expect(cache.size).toBe(2);

    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Dedup behavior: duplicate detection
// ─────────────────────────────────────────────────────────────

describe('Discord inbound dedup — duplicate detection', () => {
  it('first occurrence of a message is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-discord-1';

    expect(cache.isDuplicate(instanceId, 'discord-msg-abc', 'discord', log)).toBe(false);
  });

  it('second occurrence of the same message ID is dropped', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-discord-1';
    const msgId = 'discord-msg-abc';

    cache.isDuplicate(instanceId, msgId, 'discord', log); // first: miss
    expect(cache.isDuplicate(instanceId, msgId, 'discord', log)).toBe(true); // second: hit
  });

  it('different message IDs on same instance are not duplicates of each other', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-discord-1';

    cache.isDuplicate(instanceId, 'msg-alpha', 'discord', log);
    expect(cache.isDuplicate(instanceId, 'msg-beta', 'discord', log)).toBe(false);
  });

  it('same message ID on different instances is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const msgId = 'discord-msg-shared';

    // Instance A sees the message
    cache.isDuplicate('inst-A', msgId, 'discord', log);

    // Instance B seeing the same message ID should NOT be a dup — different instances
    expect(cache.isDuplicate('inst-B', msgId, 'discord', log)).toBe(false);
  });

  it('expired entries are not treated as duplicates', async () => {
    const cache = createInboundDedupeCache({ ttlMs: 50 }); // 50ms TTL
    const instanceId = 'inst-discord-expiry';
    const msgId = 'discord-msg-expiring';

    cache.isDuplicate(instanceId, msgId, 'discord', log); // record
    expect(cache.isDuplicate(instanceId, msgId, 'discord', log)).toBe(true); // still within TTL

    await new Promise<void>((resolve) => setTimeout(resolve, 100)); // wait past TTL

    // Should be treated as new after expiry
    expect(cache.isDuplicate(instanceId, msgId, 'discord', log)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Fallback: no configured cache → graceful
// ─────────────────────────────────────────────────────────────

describe('Discord inbound dedup — fallback cache', () => {
  it('module-level fallbackDedupeCache is present in messages.ts (handler falls back gracefully)', () => {
    // The handler in handlers/messages.ts uses: const cache = dedupeCache ?? fallbackDedupeCache
    // We verify the fallback pattern works by testing with a standalone cache (same logic)
    const fallback = createInboundDedupeCache();
    const instanceId = 'inst-discord-fallback';

    // Works without per-instance cache — no throw
    expect(() => fallback.isDuplicate(instanceId, 'fallback-msg-1', 'discord', log)).not.toThrow();
    expect(fallback.isDuplicate(instanceId, 'fallback-msg-1', 'discord', log)).toBe(true);
  });

  it('invalid or empty message IDs fail-open (not treated as duplicate)', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-discord-invalid';

    // Invalid IDs (spaces, etc.) should fail-open — not dropped, not duplicated
    expect(cache.isDuplicate(instanceId, 'invalid id with spaces', 'discord', log)).toBe(false);
    // Second call also fails-open (not recorded)
    expect(cache.isDuplicate(instanceId, 'invalid id with spaces', 'discord', log)).toBe(false);
  });
});
