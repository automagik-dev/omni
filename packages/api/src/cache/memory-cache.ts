/**
 * In-Memory Cache Implementation
 *
 * A fast, in-memory cache with TTL support and LRU eviction.
 * Designed for single-instance deployments.
 * For multi-instance deployments, swap this for RedisCache.
 */

import type { CacheConfig, CacheEntry, CacheProvider, CacheStats } from '@omni/core';
import { DEFAULT_CACHE_CONFIG } from '@omni/core';

export class MemoryCache implements CacheProvider {
  private store = new Map<string, CacheEntry>();
  private cleanupInterval: Timer | null = null;
  private config: CacheConfig;

  // Stats tracking
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };

    // Start periodic cleanup if configured
    if (this.config.cleanupIntervalMs) {
      this.cleanupInterval = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
      // Prevent interval from keeping the process alive
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this._misses++;
      this.config.onEvict?.(key, 'expired');
      return null;
    }

    this._hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    // Check size limit before adding
    if (this.config.maxSize && this.store.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const now = Date.now();
    const expiresAt = now + (ttlMs ?? this.config.defaultTtlMs);

    this.store.set(key, {
      value,
      expiresAt,
      createdAt: now,
    });
  }

  async delete(key: string): Promise<void> {
    const existed = this.store.delete(key);
    if (existed) {
      this.config.onEvict?.(key, 'manual');
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.config.onEvict?.(key, 'expired');
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  async stats(): Promise<CacheStats> {
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.store.size,
      evictions: this._evictions,
    };
  }

  async dispose(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }

  /**
   * Remove expired entries (called periodically).
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this._evictions++;
        this.config.onEvict?.(key, 'expired');
      }
    }
  }

  /**
   * Evict the oldest entry (LRU policy based on createdAt).
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.store) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
      this._evictions++;
      this.config.onEvict?.(oldestKey, 'lru');
    }
  }

  /**
   * Get the hit rate (for monitoring).
   */
  getHitRate(): number {
    const total = this._hits + this._misses;
    return total > 0 ? this._hits / total : 0;
  }
}

// Singleton instance for app-wide caching
let globalCache: MemoryCache | null = null;

/**
 * Get the global cache instance.
 */
export function getCache(): MemoryCache {
  if (!globalCache) {
    globalCache = new MemoryCache();
  }
  return globalCache;
}

/**
 * Reset the global cache (mainly for testing).
 */
export function resetCache(): void {
  if (globalCache) {
    globalCache.dispose();
    globalCache = null;
  }
}
