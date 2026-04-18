import { describe, expect, mock, test } from 'bun:test';
import { createInboundDedupeCache, validateCacheKey } from '../dedupe';

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  };
}

describe('validateCacheKey', () => {
  test('returns key for valid instanceId and externalId', () => {
    expect(validateCacheKey('inst-123', 'msg_abc')).toBe('inst-123:msg_abc');
  });

  test('returns null for empty instanceId', () => {
    expect(validateCacheKey('', 'msg_abc')).toBeNull();
  });

  test('returns null for empty externalId', () => {
    expect(validateCacheKey('inst-123', '')).toBeNull();
  });

  test('returns null for instanceId with invalid chars', () => {
    expect(validateCacheKey('inst@123', 'msg')).toBeNull();
  });

  test('returns null for instanceId exceeding 64 chars', () => {
    expect(validateCacheKey('a'.repeat(65), 'msg')).toBeNull();
  });

  test('returns null for externalId exceeding 512 chars', () => {
    expect(validateCacheKey('inst', 'a'.repeat(513))).toBeNull();
  });

  test('accepts externalId with dots, @, colons, slashes', () => {
    expect(validateCacheKey('inst', 'user@domain.com:123/abc')).toBe('inst:user@domain.com:123/abc');
  });
});

describe('createInboundDedupeCache', () => {
  test('returns false (not duplicate) for first occurrence', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();
    expect(cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger)).toBe(false);
  });

  test('returns true (duplicate) for second occurrence', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger);
    expect(cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger)).toBe(true);
  });

  test('different message IDs are not duplicates', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger);
    expect(cache.isDuplicate('inst-1', 'msg-2', 'whatsapp', logger)).toBe(false);
  });

  test('same externalId but different instanceId are not duplicates', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger);
    expect(cache.isDuplicate('inst-2', 'msg-1', 'whatsapp', logger)).toBe(false);
  });

  test('logs duplicate_dropped at info level', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger);
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger);
    expect(logger.info).toHaveBeenCalledWith(
      'duplicate_dropped',
      expect.objectContaining({
        event: 'duplicate_dropped',
        messageId: 'msg-1',
        instanceId: 'inst-1',
        channel: 'whatsapp',
        duplicateCount: 1,
      }),
    );
  });

  test('tracks duplicate count correctly', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger);
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger); // dup 1
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger); // dup 2
    cache.isDuplicate('inst-1', 'msg-1', 'whatsapp', logger); // dup 3

    // 3rd duplicate call
    const calls = (logger.info as ReturnType<typeof mock>).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[1]?.duplicateCount).toBe(3);
  });

  test('respects maxSize with LRU eviction', () => {
    const cache = createInboundDedupeCache({ maxSize: 3 });
    const logger = createMockLogger();

    cache.isDuplicate('inst', 'msg-1', 'wa', logger);
    cache.isDuplicate('inst', 'msg-2', 'wa', logger);
    cache.isDuplicate('inst', 'msg-3', 'wa', logger);
    // Cache is full (3 entries). Adding a 4th should evict msg-1
    cache.isDuplicate('inst', 'msg-4', 'wa', logger);

    expect(cache.size).toBeLessThanOrEqual(3);
    // msg-1 should have been evicted
    expect(cache.isDuplicate('inst', 'msg-1', 'wa', logger)).toBe(false);
    // msg-4 should still be cached
    expect(cache.isDuplicate('inst', 'msg-4', 'wa', logger)).toBe(true);
  });

  test('evicts expired entries scattered after LRU reordering', async () => {
    // Insert msg-1, then access it (causing LRU reorder: msg-1 moves to end).
    // msg-2 is inserted after, so the Map order is [msg-2, msg-1].
    // msg-2 expires first (short TTL), msg-1 has a long TTL.
    // evictExpired must scan the full Map and not stop at msg-1 (non-expired) before reaching msg-2.
    const logger = createMockLogger();
    const cache = createInboundDedupeCache({ ttlMs: 200 });

    // Insert and immediately hit msg-1 to move it to end of Map
    cache.isDuplicate('inst', 'msg-1', 'wa', logger);
    cache.isDuplicate('inst', 'msg-1', 'wa', logger); // hit → moves to end

    // Insert msg-2 after msg-1 was hit, but with a near-expiry (we'll let the cache TTL be short)
    const shortCache = createInboundDedupeCache({ ttlMs: 50 });
    shortCache.isDuplicate('inst', 'msg-old', 'wa', logger);
    shortCache.isDuplicate('inst', 'msg-new', 'wa', logger);

    // Access msg-old to move it after msg-new in Map order [msg-new, msg-old]
    shortCache.isDuplicate('inst', 'msg-old', 'wa', logger);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Both should be expired — evictExpired must not stop early
    expect(shortCache.isDuplicate('inst', 'msg-old', 'wa', logger)).toBe(false);
    expect(shortCache.isDuplicate('inst', 'msg-new', 'wa', logger)).toBe(false);
    shortCache.dispose();
    cache.dispose();
  });

  test('TTL expiry removes old entries', async () => {
    const cache = createInboundDedupeCache({ ttlMs: 50 });
    const logger = createMockLogger();

    cache.isDuplicate('inst', 'msg-1', 'wa', logger);
    expect(cache.isDuplicate('inst', 'msg-1', 'wa', logger)).toBe(true);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // After TTL, should not be duplicate
    expect(cache.isDuplicate('inst', 'msg-1', 'wa', logger)).toBe(false);
  });

  test('invalid cache key logs WARN and allows message through', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();

    // Invalid instanceId
    const result = cache.isDuplicate('', 'msg-1', 'wa', logger);
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'cache_key_invalid',
      expect.objectContaining({
        event: 'cache_key_invalid',
        reason: 'empty_field',
      }),
    );
  });

  test('stats() returns correct values', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();

    // Initial stats
    let s = cache.stats();
    expect(s.hitCount).toBe(0);
    expect(s.missCount).toBe(0);
    expect(s.cacheSize).toBe(0);

    // Miss
    cache.isDuplicate('inst', 'msg-1', 'wa', logger);
    s = cache.stats();
    expect(s.missCount).toBe(1);
    expect(s.cacheSize).toBe(1);

    // Hit
    cache.isDuplicate('inst', 'msg-1', 'wa', logger);
    s = cache.stats();
    expect(s.hitCount).toBe(1);
    expect(s.missCount).toBe(1);
    expect(s.avgHitLatencyMs).toBeGreaterThanOrEqual(0);
  });

  test('clear() resets cache and stats', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();

    cache.isDuplicate('inst', 'msg-1', 'wa', logger);
    cache.isDuplicate('inst', 'msg-1', 'wa', logger);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.stats().hitCount).toBe(0);
    expect(cache.stats().missCount).toBe(0);
  });

  test('cache hit latency under 1ms p99', () => {
    const cache = createInboundDedupeCache();
    const logger = createMockLogger();

    // Prime the cache
    cache.isDuplicate('inst', 'perf-msg', 'wa', logger);

    const latencies: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      const start = performance.now();
      cache.isDuplicate('inst', 'perf-msg', 'wa', logger);
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    expect(p99).toBeLessThan(1);
  });

  test('concurrent inserts do not corrupt cache', () => {
    const cache = createInboundDedupeCache({ maxSize: 100 });
    const logger = createMockLogger();

    // Simulate rapid concurrent inserts
    for (let i = 0; i < 200; i++) {
      cache.isDuplicate('inst', `msg-${i}`, 'wa', logger);
    }

    expect(cache.size).toBeLessThanOrEqual(100);
    expect(cache.stats().missCount).toBe(200);
  });
});
