/**
 * Inbound Message Deduplication
 *
 * Provides a factory for creating per-instance deduplication caches
 * using CacheProvider. Drops duplicate messages (same externalId)
 * within a configurable TTL window.
 *
 * Cache key format: `${instanceId}:${externalId}`
 *
 * DEC-4: Defaults: 5000 entries, 20-min TTL
 * DEC-5: Key validation with fail-open policy
 * DEC-7: Drops logged at AUDIT (info) level
 * DEC-8: Per-instance only (not distributed)
 * DEC-9: stats() required
 */

import type { Logger } from '@omni/core';

// Validation patterns from wish spec
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const EXTERNAL_ID_RE = /^[a-zA-Z0-9_.@:/-]{1,256}$/;

export interface DedupeConfig {
  maxSize?: number;
  ttlMs?: number;
}

export interface DedupeStats {
  hitCount: number;
  missCount: number;
  avgHitLatencyMs: number;
  cacheSize: number;
}

export interface DedupeCacheEntry {
  firstSeenAt: string;
  duplicateCount: number;
}

export interface DedupeCache {
  /**
   * Check if a message is a duplicate.
   * Returns true if the message has been seen before (should be dropped).
   * Returns false if it's new (should be processed).
   */
  isDuplicate(instanceId: string, externalId: string, channel: string, logger: Logger): boolean;

  /** Get cache statistics */
  stats(): DedupeStats;

  /** Clear all entries */
  clear(): void;

  /** Current number of entries */
  readonly size: number;
}

/**
 * Validate cache key components.
 * Returns the cache key string or null if invalid.
 */
export function validateCacheKey(instanceId: string, externalId: string): string | null {
  if (!instanceId || !externalId) return null;
  if (!INSTANCE_ID_RE.test(instanceId)) return null;
  if (!EXTERNAL_ID_RE.test(externalId)) return null;
  return `${instanceId}:${externalId}`;
}

interface CacheItem {
  firstSeenAt: string;
  duplicateCount: number;
  expiresAt: number;
}

/**
 * Create an inbound deduplication cache.
 *
 * Uses a synchronous in-memory LRU+TTL cache for <1ms latency.
 * When the cache is full, the oldest entry is evicted (LRU).
 */
export function createInboundDedupeCache(config?: DedupeConfig): DedupeCache {
  const maxSize = config?.maxSize ?? 5000;
  const ttlMs = config?.ttlMs ?? 20 * 60 * 1000; // 20 minutes

  // Use a Map for LRU ordering (Map preserves insertion order)
  const cache = new Map<string, CacheItem>();

  let hitCount = 0;
  let missCount = 0;
  let totalHitLatencyMs = 0;

  function evictExpired(): void {
    const now = Date.now();
    for (const [key, item] of cache) {
      if (item.expiresAt <= now) {
        cache.delete(key);
      } else {
        break;
      }
    }
  }

  function ensureCapacity(): void {
    if (cache.size < maxSize) return;
    evictExpired();
    if (cache.size < maxSize) return;
    // Still full — evict oldest (first entry in Map)
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }

  function recordHit(
    existing: CacheItem,
    cacheKey: string,
    externalId: string,
    instanceId: string,
    channel: string,
    elapsed: number,
    logger: Logger,
  ): true {
    hitCount++;
    totalHitLatencyMs += elapsed;
    existing.duplicateCount++;

    // Move to end for LRU (delete + re-insert)
    cache.delete(cacheKey);
    cache.set(cacheKey, existing);

    logger.info('duplicate_dropped', {
      event: 'duplicate_dropped',
      messageId: externalId,
      instanceId,
      channel,
      cacheHitMs: Math.round(elapsed * 100) / 100,
      duplicateCount: existing.duplicateCount,
      firstSeenAt: existing.firstSeenAt,
    });

    return true;
  }

  function recordMiss(cacheKey: string): false {
    missCount++;
    ensureCapacity();
    cache.set(cacheKey, {
      firstSeenAt: new Date().toISOString(),
      duplicateCount: 0,
      expiresAt: Date.now() + ttlMs,
    });
    return false;
  }

  function isDuplicate(instanceId: string, externalId: string, channel: string, logger: Logger): boolean {
    const startTime = performance.now();

    const cacheKey = validateCacheKey(instanceId, externalId);
    if (cacheKey === null) {
      logger.warn('cache_key_invalid', {
        event: 'cache_key_invalid',
        instanceId,
        externalId,
        reason: !instanceId || !externalId ? 'empty_field' : 'format_mismatch',
      });
      return false; // Fail-open
    }

    const existing = cache.get(cacheKey);
    const elapsed = performance.now() - startTime;

    if (existing && existing.expiresAt > Date.now()) {
      return recordHit(existing, cacheKey, externalId, instanceId, channel, elapsed, logger);
    }

    return recordMiss(cacheKey);
  }

  function stats(): DedupeStats {
    return {
      hitCount,
      missCount,
      avgHitLatencyMs: hitCount > 0 ? totalHitLatencyMs / hitCount : 0,
      cacheSize: cache.size,
    };
  }

  function clear(): void {
    cache.clear();
    hitCount = 0;
    missCount = 0;
    totalHitLatencyMs = 0;
  }

  return {
    isDuplicate,
    stats,
    clear,
    get size() {
      return cache.size;
    },
  };
}
