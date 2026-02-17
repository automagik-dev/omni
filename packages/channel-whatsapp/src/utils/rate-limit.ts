/**
 * WhatsApp Rate Limit Handling
 *
 * Parses rate limit responses from Baileys/WhatsApp and manages backoff.
 * When Baileys returns a 429 or rate limit error, outbound messages are
 * queued and retried after the specified delay.
 *
 * Backoff strategies:
 * - Explicit: Uses `retry_after` value from error response
 * - Exponential: Starting at 1s, max 30s, with jitter
 */

import type { Logger } from '@omni/core';

export interface RateLimitState {
  backoffUntil: number;
  retryAfterMs: number;
  backoffStrategy: 'explicit' | 'exponential';
  consecutiveHits: number;
}

export interface RateLimitConfig {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  jitterFactor?: number;
}

const DEFAULT_INITIAL_BACKOFF = 1000;
const DEFAULT_MAX_BACKOFF = 30_000;
const DEFAULT_JITTER_FACTOR = 0.2;

function extractRetryField(err: Record<string, unknown>): number | null {
  if (typeof err.retryAfter === 'number' && err.retryAfter > 0) {
    return err.retryAfter * 1000;
  }
  if (typeof err.retry_after === 'number' && err.retry_after > 0) {
    return err.retry_after * 1000;
  }
  return null;
}

function extractFromStatusCode(err: Record<string, unknown>): number | null {
  // Check top-level status fields first
  const statusCode = err.statusCode ?? err.status ?? err.code;
  // Also check Boom error shape: { output: { statusCode: 429 } }
  const boomStatusCode = (err.output as Record<string, unknown> | undefined)?.statusCode;
  const is429 = statusCode === 429 || statusCode === '429' || boomStatusCode === 429;
  if (!is429) return null;

  const data = err.data as Record<string, unknown> | undefined;
  if (data && typeof data.retry_after === 'number') {
    return data.retry_after * 1000;
  }
  return null; // Is rate limit but no explicit retry_after
}

/**
 * Parse retry_after duration from a Baileys error response.
 * Returns the backoff duration in ms, or null if not a rate limit error.
 */
export function parseRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  const err = error as Record<string, unknown>;

  const fromField = extractRetryField(err);
  if (fromField !== null) return fromField;

  return extractFromStatusCode(err);
}

/**
 * Check if an error looks like a rate limit error.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;

  // Top-level status fields (plain errors, Baileys errors)
  const statusCode = err.statusCode ?? err.status ?? err.code;
  if (statusCode === 429 || statusCode === '429') return true;

  // Boom error shape: { output: { statusCode: 429, ... } }
  const boomStatusCode = (err.output as Record<string, unknown> | undefined)?.statusCode;
  if (boomStatusCode === 429) return true;

  if (typeof err.retryAfter === 'number' || typeof err.retry_after === 'number') return true;

  const msg = String(err.message ?? err.msg ?? '').toLowerCase();
  return msg.includes('rate') && (msg.includes('limit') || msg.includes('throttl'));
}

/**
 * Calculate exponential backoff with jitter.
 */
export function calculateExponentialBackoff(consecutiveHits: number, config?: RateLimitConfig): number {
  const initial = config?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF;
  const max = config?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF;
  const jitter = config?.jitterFactor ?? DEFAULT_JITTER_FACTOR;

  // Exponential: initial * 2^(attempts - 1)
  const base = Math.min(initial * 2 ** (consecutiveHits - 1), max);

  // Add jitter: +-jitterFactor of base
  const jitterRange = base * jitter;
  const jitterValue = Math.random() * jitterRange * 2 - jitterRange;

  return Math.max(0, Math.round(base + jitterValue));
}

export interface RateLimitManager {
  handleRateLimit(error: unknown, queueDepth: number): number;
  getRemainingBackoff(): number;
  reset(): void;
  readonly state: Readonly<RateLimitState>;
}

/**
 * Create a rate limit manager for a WhatsApp instance.
 */
export function createRateLimitManager(instanceId: string, logger: Logger, config?: RateLimitConfig): RateLimitManager {
  const state: RateLimitState = {
    backoffUntil: 0,
    retryAfterMs: 0,
    backoffStrategy: 'exponential',
    consecutiveHits: 0,
  };

  function handleRateLimit(error: unknown, queueDepth: number): number {
    state.consecutiveHits++;

    const explicitDelay = parseRetryAfter(error);
    let retryAfterMs: number;
    let strategy: 'explicit' | 'exponential';

    if (explicitDelay !== null && explicitDelay > 0) {
      retryAfterMs = explicitDelay;
      strategy = 'explicit';
    } else {
      retryAfterMs = calculateExponentialBackoff(state.consecutiveHits, config);
      strategy = 'exponential';
    }

    state.retryAfterMs = retryAfterMs;
    state.backoffStrategy = strategy;
    state.backoffUntil = Date.now() + retryAfterMs;

    logger.warn('rate_limit_hit', {
      event: 'rate_limit_hit',
      instanceId,
      retryAfterMs,
      queueDepth,
      backoffStrategy: strategy,
      consecutiveHits: state.consecutiveHits,
    });

    return retryAfterMs;
  }

  function getRemainingBackoff(): number {
    const remaining = state.backoffUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  function reset(): void {
    state.backoffUntil = 0;
    state.retryAfterMs = 0;
    state.consecutiveHits = 0;
  }

  return {
    handleRateLimit,
    getRemainingBackoff,
    reset,
    get state() {
      return { ...state };
    },
  };
}
