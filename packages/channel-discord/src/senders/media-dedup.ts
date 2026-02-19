import { createHash } from 'node:crypto';
import { createLogger } from '@omni/core';

const log = createLogger('discord:media-dedup');

interface DedupEntry {
  hash: string;
  timestamp: number;
}

/**
 * LRU-based media deduplication layer for outbound messages.
 * Tracks recently sent media by content hash (SHA-256 of first 4KB + file size)
 * to prevent duplicate processing in rapid succession.
 */
export class MediaDedup {
  private cache: Map<string, DedupEntry> = new Map();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options: { maxEntries?: number; ttlMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Compute a content hash from media data, scoped to a send context.
   * Uses SHA-256 of first 4KB + file size + scope string.
   *
   * The scope should be `${instanceId}:${channelId}` so that identical media
   * sent to different instances or channels is NOT collapsed as a duplicate.
   */
  computeHash(data: Buffer, scope = ''): string {
    const prefix = data.subarray(0, 4096);
    const hash = createHash('sha256');
    hash.update(prefix);
    hash.update(Buffer.from(String(data.length)));
    if (scope) hash.update(Buffer.from(scope));
    return hash.digest('hex');
  }

  /**
   * Check if media has been recently sent to this scope (instance + channel).
   * Returns true if this is a duplicate (should be skipped).
   */
  isDuplicate(data: Buffer, scope = ''): boolean {
    this.evictExpired();
    const hash = this.computeHash(data, scope);
    const entry = this.cache.get(hash);

    if (entry && Date.now() - entry.timestamp < this.ttlMs) {
      log.debug('Media dedup: duplicate detected', { hash: hash.slice(0, 12), scope });
      return true;
    }

    return false;
  }

  /**
   * Mark media as sent for this scope (add to dedup cache).
   */
  markSent(data: Buffer, scope = ''): void {
    const hash = this.computeHash(data, scope);
    this.cache.set(hash, { hash, timestamp: Date.now() });
    this.enforceMaxEntries();
  }

  /**
   * Check and mark in one operation. Returns true if duplicate.
   */
  checkAndMark(data: Buffer, scope = ''): boolean {
    if (this.isDuplicate(data, scope)) {
      return true;
    }
    this.markSent(data, scope);
    return false;
  }

  /** Evict expired entries */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp >= this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /** Enforce max entries (LRU eviction) */
  private enforceMaxEntries(): void {
    while (this.cache.size > this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }

  /** Clear the cache (for testing) */
  clear(): void {
    this.cache.clear();
  }

  /** Get current cache size */
  get size(): number {
    return this.cache.size;
  }
}

/** Singleton instance for the Discord channel */
export const mediaDedup = new MediaDedup();
