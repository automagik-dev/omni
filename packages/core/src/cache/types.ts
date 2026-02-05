/**
 * Cache Provider Interface
 *
 * Pluggable caching interface designed for easy swapping between implementations.
 * Currently supports in-memory caching; future implementations can add Redis, etc.
 */

/**
 * Cache provider interface for pluggable caching implementations.
 * All operations are async to support both in-memory and distributed caches.
 */
export interface CacheProvider {
  /**
   * Get a value from the cache.
   * @param key Cache key
   * @returns The cached value or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in the cache with optional TTL.
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Time-to-live in milliseconds (uses default if not specified)
   */
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;

  /**
   * Delete a value from the cache.
   * @param key Cache key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists in the cache (and is not expired).
   * @param key Cache key
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all entries from the cache.
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics (optional - for debugging/monitoring).
   */
  stats?(): Promise<CacheStats>;

  /**
   * Dispose of the cache provider (cleanup intervals, connections, etc).
   */
  dispose?(): Promise<void>;
}

/**
 * Cache statistics for monitoring.
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Current number of entries */
  size: number;
  /** Total number of evictions */
  evictions: number;
}

/**
 * Configuration for cache providers.
 */
export interface CacheConfig {
  /** Default TTL in milliseconds for entries without explicit TTL */
  defaultTtlMs: number;
  /** Maximum number of entries (LRU eviction when exceeded) */
  maxSize?: number;
  /** Cleanup interval in milliseconds (for removing expired entries) */
  cleanupIntervalMs?: number;
  /** Callback when an entry is evicted */
  onEvict?: (key: string, reason: 'expired' | 'lru' | 'manual') => void;
}

/**
 * Cache entry stored internally.
 */
export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

/**
 * Default cache configuration.
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  defaultTtlMs: 60_000, // 1 minute
  maxSize: 10_000,
  cleanupIntervalMs: 60_000, // Cleanup every minute
};
