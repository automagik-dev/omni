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
   * Compute a content hash from media data.
   * Uses SHA-256 of first 4KB + file size for fast comparison.
   */
  computeHash(data: Buffer): string {
    const prefix = data.subarray(0, 4096);
    const hash = createHash('sha256');
    hash.update(prefix);
    hash.update(Buffer.from(String(data.length)));
    return hash.digest('hex');
  }

  /**
   * Check if media has been recently sent.
   * Returns true if this is a duplicate (should be skipped).
   */
  isDuplicate(data: Buffer): boolean {
    this.evictExpired();
    const hash = this.computeHash(data);
    const entry = this.cache.get(hash);

    if (entry && Date.now() - entry.timestamp < this.ttlMs) {
      log.debug('Media dedup: duplicate detected', { hash: hash.slice(0, 12) });
      return true;
    }

    return false;
  }

  /**
   * Mark media as sent (add to dedup cache).
   */
  markSent(data: Buffer): void {
    const hash = this.computeHash(data);
    this.cache.set(hash, { hash, timestamp: Date.now() });
    this.enforceMaxEntries();
  }

  /**
   * Check and mark in one operation. Returns true if duplicate.
   */
  checkAndMark(data: Buffer): boolean {
    if (this.isDuplicate(data)) {
      return true;
    }
    this.markSent(data);
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
