/**
 * Cache module for Omni API
 *
 * Provides pluggable caching with an in-memory default implementation.
 * For multi-instance deployments, swap MemoryCache for RedisCache.
 */

export { CacheKeys, CacheTTL, apiKeyCache, type CachedApiKey } from './cache-keys';
