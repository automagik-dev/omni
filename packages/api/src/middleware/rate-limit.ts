/**
 * Rate limiting middleware
 *
 * Simple in-memory rate limiter. For production, use Redis-based solution.
 */

import { createMiddleware } from 'hono/factory';
import type { AppVariables } from '../types';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store (replace with Redis for production)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Every minute

/**
 * Default rate limits by endpoint category
 */
const RATE_LIMITS = {
  general: { windowMs: 60 * 1000, maxRequests: 1000 }, // 1000 per minute
} as const;

/**
 * Create rate limiting middleware
 */
function createRateLimiter(config: RateLimitConfig = RATE_LIMITS.general) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    // Use API key ID as identifier, then only trusted infra-provided address data.
    // Do not trust client-supplied IP headers unless explicitly configured.
    const apiKey = c.get('apiKey');
    const trustedProxyHeader = process.env.TRUSTED_PROXY_HEADER?.toLowerCase();
    const trustedProxyIp = trustedProxyHeader ? c.req.header(trustedProxyHeader) : undefined;
    const remoteAddr = (c.env as { remoteAddr?: string } | undefined)?.remoteAddr;
    const rawIp = remoteAddr ?? trustedProxyIp;
    const normalizedIp = rawIp?.split(',')[0]?.trim() || rawIp?.trim();
    const identifier = apiKey?.id ? `api:${apiKey.id}` : normalizedIp ? `ip:${normalizedIp}` : 'anon';

    const key = `ratelimit:${identifier}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      // Start new window
      entry = {
        count: 1,
        resetAt: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
    } else {
      entry.count++;
    }

    // Helper: set rate-limit headers on any response path
    const setRateLimitHeaders = () => {
      const remaining = Math.max(0, config.maxRequests - entry.count);
      c.res.headers.set('X-RateLimit-Limit', config.maxRequests.toString());
      c.res.headers.set('X-RateLimit-Remaining', remaining.toString());
      c.res.headers.set('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString());
    };

    if (entry.count > config.maxRequests) {
      const res = c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please slow down.',
            details: {
              retryAfterMs: entry.resetAt - now,
              limit: config.maxRequests,
              windowMs: config.windowMs,
            },
          },
        },
        429,
      );
      // Set headers on the 429 response so clients can determine retry timing
      setRateLimitHeaders();
      return res;
    }

    await next();

    // Set after next() so headers survive response replacement
    setRateLimitHeaders();
  });
}

/**
 * Default rate limiter for general endpoints
 */
export const rateLimitMiddleware = createRateLimiter(RATE_LIMITS.general);
