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
export const RATE_LIMITS = {
  messages: { windowMs: 60 * 1000, maxRequests: 60 }, // 60 per minute
  events: { windowMs: 60 * 1000, maxRequests: 100 }, // 100 per minute
  instances: { windowMs: 60 * 1000, maxRequests: 30 }, // 30 per minute
  general: { windowMs: 60 * 1000, maxRequests: 1000 }, // 1000 per minute
} as const;

/**
 * Create rate limiting middleware
 */
export function createRateLimiter(config: RateLimitConfig = RATE_LIMITS.general) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    // Use API key ID as identifier, fall back to IP
    const apiKey = c.get('apiKey');
    const identifier = apiKey?.id ?? c.req.header('x-forwarded-for') ?? 'anonymous';

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

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - entry.count);
    c.res.headers.set('X-RateLimit-Limit', config.maxRequests.toString());
    c.res.headers.set('X-RateLimit-Remaining', remaining.toString());
    c.res.headers.set('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString());

    if (entry.count > config.maxRequests) {
      return c.json(
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
    }

    await next();
  });
}

/**
 * Default rate limiter for general endpoints
 */
export const rateLimitMiddleware = createRateLimiter(RATE_LIMITS.general);
