/**
 * Cache Key Definitions and Domain-Specific Caches
 *
 * Provides typed cache key generation and domain-specific cache instances.
 */

import { isMultitenancyEnabled } from '../tenancy/feature-flag';
import { MemoryCache } from './memory-cache';

/**
 * Auth-cache invalidation ceiling (wish: omni-full-multitenancy, Group G5,
 * deliverable (c); RELEASE_SLOS
 * `revocation.auth_cache_invalidation_seconds_max: 15`).
 *
 * Any cached AUTHORIZATION fact (a validated API key, an allow/deny access
 * decision) must die within this window, so an out-of-band revocation — one
 * that did not pass through the in-process invalidation hooks — still stops
 * authenticating within the release ceiling. Dual-world: the clamp binds only
 * when multitenancy is enabled; flag-off keeps the legacy TTLs byte-identical.
 */
export const AUTH_CACHE_INVALIDATION_CEILING_SECONDS = 15;

/**
 * The TTL an AUTH cache write must use: the legacy TTL, clamped to the
 * revocation ceiling when multitenancy is enabled. A legacy TTL already under
 * the ceiling is honoured, not raised.
 */
export function authCacheTtlMs(legacyTtlMs: number): number {
  if (!isMultitenancyEnabled()) return legacyTtlMs;
  return Math.min(legacyTtlMs, AUTH_CACHE_INVALIDATION_CEILING_SECONDS * 1000);
}

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

  /**
   * Access check result cache.
   * TTL: 5 minutes
   */
  accessCheck: (instanceId: string, userId: string) => `access:${instanceId}:${userId}`,
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
  ACCESS_CHECK: 300_000, // 5 minutes
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
  profile?: string | null;
  chatAllowlist?: string[];
  instanceAllowlist?: string[];
  outboundRecipientAllowlist?: string[];
  profileOverrides?: Record<string, unknown> | null;
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
 * Access check cache - caches allow/deny decisions per user per instance.
 */
export const accessCache = new MemoryCache({
  defaultTtlMs: CacheTTL.ACCESS_CHECK,
  maxSize: 50_000,
  cleanupIntervalMs: 60_000,
});
