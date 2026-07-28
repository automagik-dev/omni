/**
 * Cache module for Omni API
 *
 * Exports cache keys, TTL values, and API-key cache helpers.
 * For multi-instance deployments, use a Redis-backed cache implementation.
 */

export {
  CacheKeys,
  CacheTTL,
  apiKeyCache,
  authCacheTtlMs,
  type CachedApiKey,
} from './cache-keys';
