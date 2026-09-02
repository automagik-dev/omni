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
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Every minute
cleanupTimer.unref();

/**
 * Default rate limits by endpoint category
 */
const RATE_LIMITS = {
  messages: { windowMs: 60 * 1000, maxRequests: 60 }, // 60 per minute
  events: { windowMs: 60 * 1000, maxRequests: 100 }, // 100 per minute
  instances: { windowMs: 60 * 1000, maxRequests: 30 }, // 30 per minute
  general: { windowMs: 60 * 1000, maxRequests: 1000 }, // 1000 per minute
} as const;

/**
 * Pick the client IP for the per-IP bucket.
 *
 * `TRUSTED_PROXY_HEADER` names a header the deployment's OWN reverse proxy
 * sets (e.g. `X-Forwarded-For`, `CF-Connecting-IP`, `X-Real-IP`). For
 * overwrite-style headers the value is a single address. For append-style
 * headers (`X-Forwarded-For`) every hop appends its peer, so the LEFTMOST
 * entry is whatever the client chose to send and the RIGHTMOST is the one
 * written by the trusted proxy in front of this process. Taking the first hop
 * would let any client pick its own bucket (or evict a victim's) by sending
 * a forged `X-Forwarded-For`; the rightmost hop is the only one the trusted
 * proxy vouches for. This assumes exactly one trusted proxy — deployments
 * with a longer trusted chain must have the edge proxy collapse the header.
 *
 * Without the env var the header is ignored entirely and the socket peer
 * address is used, so a forged header can never influence the bucket.
 */
export function resolveClientIp(
  trustedProxyHeaderValue: string | undefined,
  remoteAddr: string | undefined,
): string | undefined {
  const raw = trustedProxyHeaderValue ?? remoteAddr;
  if (!raw) return undefined;
  const hops = raw
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1);
}

/**
 * Create rate limiting middleware.
 *
 * `keyPrefix` isolates a limiter's counters from the default bucket so a
 * surface with its own budget (e.g. the public webhook ingress) doesn't share
 * windows with the general limiter for the same identifier.
 */
function createRateLimiter(config: RateLimitConfig = RATE_LIMITS.general, keyPrefix = 'ratelimit') {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    // Use API key ID as identifier, then only trusted infra-provided address data.
    // Do not trust client-supplied IP headers unless explicitly configured
    // (TRUSTED_PROXY_HEADER) — and even then only the hop the trusted proxy
    // wrote, see resolveClientIp.
    const apiKey = c.get('apiKey');
    const trustedProxyHeader = process.env.TRUSTED_PROXY_HEADER?.toLowerCase();
    const trustedProxyIp = trustedProxyHeader ? c.req.header(trustedProxyHeader) : undefined;
    // Under Bun.serve, Hono's env is the Bun Server, which exposes the peer
    // address via requestIP() — there is no `remoteAddr` field. Without this,
    // unauthenticated surfaces (the public webhook ingress) would all share
    // one 'anon' bucket instead of being limited per IP.
    const server = c.env as
      | { remoteAddr?: string; requestIP?: (req: Request) => { address?: string } | null }
      | undefined;
    const remoteAddr = server?.remoteAddr ?? server?.requestIP?.(c.req.raw)?.address;
    const normalizedIp = resolveClientIp(trustedProxyIp, remoteAddr);
    const identifier = apiKey?.id ? `api:${apiKey.id}` : normalizedIp ? `ip:${normalizedIp}` : 'anon';

    const key = `${keyPrefix}:${identifier}`;
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

/**
 * Rate limiter for the auth-exempt generic webhook ingress (issue #928).
 * Keyed by IP (no API key on that surface), same budget as channel events.
 */
export const webhookIngressRateLimitMiddleware = createRateLimiter(RATE_LIMITS.events, 'ratelimit:webhook-ingress');
