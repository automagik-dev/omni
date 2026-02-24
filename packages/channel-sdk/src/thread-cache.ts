/**
 * Thread-Starter Cache
 *
 * Generic TTL cache with promise coalescing for concurrent in-flight requests.
 * Designed for caching thread-starter data (e.g., conversations.replies results)
 * keyed by `channelId:threadTs`.
 *
 * Inspired by OpenClaw's thread-resolution.ts pattern.
 *
 * Defaults:
 *   - TTL: 6 hours (thread roots rarely change)
 *   - Max entries: 2000
 */

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_MAX_SIZE = 2000;

export interface ThreadStarterCacheConfig {
  ttlMs?: number;
  maxSize?: number;
}

export interface ThreadStarterCache<T> {
  /**
   * Get a cached value or an in-flight Promise for the given key.
   * Returns:
   * - `Promise<T>` wrapping the cached value if the key is in cache
   * - An in-flight `Promise<T>` if a fetch is currently pending for this key (coalescing)
   * - `undefined` if neither is present
   */
  get(key: string): Promise<T> | undefined;

  /** Store a resolved value for a key, clearing any in-flight entry */
  set(key: string, value: T): void;

  /** Whether a resolved value exists for this key (does not check in-flight) */
  has(key: string): boolean;

  /**
   * Get from cache or run fetcher — deduplicates concurrent requests for the same key.
   *
   * If a cached value exists, returns it immediately.
   * If a fetch is already in-flight for this key, returns the same Promise (coalescing).
   * Otherwise, calls fetcher(), stores the in-flight Promise, awaits the result, caches it,
   * then returns it.
   */
  getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T>;

  /** Dispose all timers and clear the cache and in-flight map */
  dispose(): void;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Create a thread-starter cache with optional TTL and max-size config.
 */
export function createThreadStarterCache<T>(config?: ThreadStarterCacheConfig): ThreadStarterCache<T> {
  const ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
  const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE;

  const valueCache = new Map<string, CacheEntry<T>>();
  const inflightCache = new Map<string, Promise<T>>();

  // Cleanup timer: evict expired entries periodically
  const cleanupIntervalMs = Math.min(ttlMs / 2, 5 * 60 * 1000); // at most every 5 min
  const cleanupTimer = setInterval(() => {
    evictExpired();
  }, cleanupIntervalMs);
  if (typeof (cleanupTimer as unknown as { unref?: () => void }).unref === 'function') {
    (cleanupTimer as unknown as { unref: () => void }).unref();
  }

  function evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of valueCache) {
      if (entry.expiresAt <= now) {
        valueCache.delete(key);
      }
    }
  }

  function ensureCapacity(): void {
    if (valueCache.size < maxSize) return;
    evictExpired();
    if (valueCache.size < maxSize) return;
    // Evict oldest (first in insertion order)
    const firstKey = valueCache.keys().next().value;
    if (firstKey !== undefined) valueCache.delete(firstKey);
  }

  function get(key: string): Promise<T> | undefined {
    // Check value cache first
    const entry = valueCache.get(key);
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        // Refresh LRU position
        valueCache.delete(key);
        valueCache.set(key, entry);
        return Promise.resolve(entry.value);
      }
      valueCache.delete(key);
    }

    // Check in-flight
    const inflight = inflightCache.get(key);
    if (inflight) {
      return inflight;
    }

    return undefined;
  }

  function set(key: string, value: T): void {
    // Remove from inflight when value is resolved
    inflightCache.delete(key);

    ensureCapacity();
    // Refresh LRU position
    valueCache.delete(key);
    valueCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function has(key: string): boolean {
    const entry = valueCache.get(key);
    if (entry && entry.expiresAt > Date.now()) return true;
    if (entry) valueCache.delete(key);
    return false;
  }

  function getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Return cached or in-flight if available
    const existing = get(key);
    if (existing) return existing;

    // Start a new fetch and register in-flight
    const promise = fetcher().then(
      (value) => {
        set(key, value);
        return value;
      },
      (err) => {
        // On error, clear inflight so subsequent calls retry
        inflightCache.delete(key);
        throw err;
      },
    );

    inflightCache.set(key, promise);
    return promise;
  }

  function dispose(): void {
    clearInterval(cleanupTimer);
    valueCache.clear();
    inflightCache.clear();
  }

  return { get, set, has, getOrFetch, dispose };
}
