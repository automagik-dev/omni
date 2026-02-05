/**
 * Cache Key Definitions and Domain-Specific Caches
 *
 * Provides typed cache key generation and domain-specific cache instances.
 */

import { MemoryCache } from './memory-cache';

/**
 * Cache key namespace definitions.
 * All keys should be prefixed with their namespace.
 */
export const CacheKeys = {
  /**
   * API key cache (validated key info).
   * TTL: 60 seconds
   */
  apiKey: (keyHash: string) => `api-key:${keyHash}`,

  /**
   * Health endpoint response cache.
   * TTL: 5 seconds
   */
  healthResponse: () => 'response:health',

  /**
   * Info endpoint response cache.
   * TTL: 30 seconds
   */
  infoResponse: () => 'response:info',

  /**
   * Settings cache.
   * TTL: 60 seconds
   */
  settings: (key: string) => `settings:${key}`,

  /**
   * Instance info cache.
   * TTL: 30 seconds
   */
  instance: (instanceId: string) => `instance:${instanceId}`,
} as const;

/**
 * Cache TTLs in milliseconds.
 */
export const CacheTTL = {
  API_KEY: 60_000, // 1 minute
  HEALTH: 5_000, // 5 seconds
  INFO: 30_000, // 30 seconds
  SETTINGS: 60_000, // 1 minute
  INSTANCE: 30_000, // 30 seconds
} as const;

/**
 * Cached API key data structure.
 * Only cache what's needed for validation; fresh checks for rate limits.
 */
export interface CachedApiKey {
  id: string;
  name: string;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date | null;
  scopes: string[];
  instanceIds: string[] | null;
}

/**
 * API key cache instance.
 * Short TTL to balance performance with security (key revocation).
 */
export const apiKeyCache = new MemoryCache({
  defaultTtlMs: CacheTTL.API_KEY,
  maxSize: 10_000,
  cleanupIntervalMs: 30_000,
});

/**
 * Response cache for read-only, rarely-changing endpoints.
 */
export const responseCache = new MemoryCache({
  defaultTtlMs: CacheTTL.INFO,
  maxSize: 1_000,
  cleanupIntervalMs: 60_000,
});
