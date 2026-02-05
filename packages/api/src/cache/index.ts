/**
 * Cache module for Omni API
 *
 * Provides pluggable caching with an in-memory default implementation.
 * For multi-instance deployments, swap MemoryCache for RedisCache.
 */

export { MemoryCache, getCache, resetCache } from './memory-cache';
export { CacheKeys, CacheTTL, apiKeyCache, responseCache, type CachedApiKey } from './cache-keys';
