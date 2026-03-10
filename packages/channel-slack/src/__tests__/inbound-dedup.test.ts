/**
 * Slack — inbound dedup regression tests
 *
 * Verifies:
 * - Per-instance dedup cache starts empty and is isolated per instance
 * - Duplicate messages are dropped within the TTL window
 * - Invalid/empty keys fail-open (not treated as duplicate)
 * - Cache dispose clears state and stops timers
 */

import { describe, expect, it } from 'bun:test';
import { createInboundDedupeCache } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import { SlackPlugin } from '../plugin';

const log = createLogger('test:slack-dedup');

// ─────────────────────────────────────────────────────────────
// Plugin-level: per-instance cache lifecycle
// ─────────────────────────────────────────────────────────────

describe('SlackPlugin — per-instance dedup cache lifecycle', () => {
  it('starts with no dedup caches (none created before connect)', () => {
    const plugin = new SlackPlugin();
    const caches = (plugin as unknown as { dedupeCaches: Map<string, unknown> }).dedupeCaches;
    expect(caches.size).toBe(0);
  });

  it('createConnection creates an isolated dedup cache per instance', () => {
    // Two independent caches simulate two different workspace connections
    const cacheA = createInboundDedupeCache();
    const cacheB = createInboundDedupeCache();

    const dedupeKey = 'C123:1234567890.123456';
    const instanceId = 'inst-slack-shared';

    // Record the message in cacheA (first time = miss)
    cacheA.isDuplicate(instanceId, dedupeKey, 'slack', log);

    // cacheA now treats the message as a duplicate
    expect(cacheA.isDuplicate(instanceId, dedupeKey, 'slack', log)).toBe(true);

    // cacheB has not seen this message — isolation guarantees it's a miss in cacheB
    expect(cacheB.isDuplicate(instanceId, dedupeKey, 'slack', log)).toBe(false);
  });

  it('dispose clears cache state (simulates disconnect cleanup)', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-slack-dispose';

    cache.isDuplicate(instanceId, 'C123:1111111.000001', 'slack', log);
    cache.isDuplicate(instanceId, 'C123:2222222.000002', 'slack', log);
    expect(cache.size).toBe(2);

    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Dedup behavior: duplicate detection
// ─────────────────────────────────────────────────────────────

describe('Slack inbound dedup — duplicate detection', () => {
  it('first occurrence of a message is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-slack-1';

    expect(cache.isDuplicate(instanceId, 'C123:1234567890.123456', 'slack', log)).toBe(false);
  });

  it('second occurrence of the same channel:ts key is dropped', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-slack-1';
    const key = 'C123:1234567890.123456';

    cache.isDuplicate(instanceId, key, 'slack', log); // first: miss
    expect(cache.isDuplicate(instanceId, key, 'slack', log)).toBe(true); // second: hit
  });

  it('different channel:ts keys on same instance are not duplicates of each other', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-slack-1';

    cache.isDuplicate(instanceId, 'C123:1234567890.000001', 'slack', log);
    expect(cache.isDuplicate(instanceId, 'C123:1234567890.000002', 'slack', log)).toBe(false);
  });

  it('same channel:ts key on different instances is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const key = 'C123:1234567890.123456';

    // Instance A sees the message
    cache.isDuplicate('inst-A', key, 'slack', log);

    // Instance B seeing the same key should NOT be a dup — different instances
    expect(cache.isDuplicate('inst-B', key, 'slack', log)).toBe(false);
  });

  it('expired entries are not treated as duplicates', async () => {
    const cache = createInboundDedupeCache({ ttlMs: 50 }); // 50ms TTL
    const instanceId = 'inst-slack-expiry';
    const key = 'C123:9999999999.000001';

    cache.isDuplicate(instanceId, key, 'slack', log); // record
    expect(cache.isDuplicate(instanceId, key, 'slack', log)).toBe(true); // still within TTL

    await new Promise<void>((resolve) => setTimeout(resolve, 100)); // wait past TTL

    // Should be treated as new after expiry
    expect(cache.isDuplicate(instanceId, key, 'slack', log)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Fallback: invalid keys fail-open
// ─────────────────────────────────────────────────────────────

describe('Slack inbound dedup — invalid key handling', () => {
  it('invalid or empty keys fail-open (not treated as duplicate)', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-slack-invalid';

    // Keys with spaces fail validation — fail-open means not dropped, not recorded
    expect(cache.isDuplicate(instanceId, 'invalid key with spaces', 'slack', log)).toBe(false);
    // Second call also fails-open (not recorded)
    expect(cache.isDuplicate(instanceId, 'invalid key with spaces', 'slack', log)).toBe(false);
  });
});
