/**
 * Retry with Exponential Backoff
 *
 * Generic retry wrapper for async operations with exponential backoff,
 * jitter, per-attempt timeout, and transient error detection.
 */

import { createLogger } from '@omni/core';

const log = createLogger('media-processing:retry');

/**
 * Options for the retry wrapper
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default 3) */
  maxRetries: number;
  /** Base delay in ms before first retry (default 1000) */
  baseDelayMs: number;
  /** Maximum delay in ms between retries (default 10000) */
  maxDelayMs: number;
  /** Per-attempt timeout in ms (0 = no timeout) */
  timeoutMs: number;
  /** Optional callback invoked before each retry */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Default retry options
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  timeoutMs: 0,
};

/**
 * Patterns that indicate a transient error (case-insensitive matching against error message).
 */
const TRANSIENT_MESSAGE_PATTERNS = [
  // Rate limits
  '429',
  'rate limit',
  'too many requests',
  'resource exhausted',
  'resource_exhausted',
  // Timeouts
  'timeout',
  'timed out',
  'aborted',
  // Network errors
  'econnreset',
  'econnrefused',
  'epipe',
  'enotfound',
  'etimedout',
  'network',
  'fetch failed',
  'socket hang up',
  // Server errors (5xx)
  '500',
  '502',
  '503',
  '504',
  'internal server error',
  'service unavailable',
  'bad gateway',
];

/**
 * Error names that indicate a transient error.
 */
const TRANSIENT_ERROR_NAMES = ['aborterror', 'timeouterror'];

/**
 * Check if an error message matches any transient pattern.
 */
function matchesTransientPattern(msg: string): boolean {
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => msg.includes(pattern));
}

/**
 * Check if an error is transient and should be retried.
 *
 * Detects: rate limits (429), timeouts, network errors, server errors (5xx).
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const msg = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  if (TRANSIENT_ERROR_NAMES.includes(name)) {
    return true;
  }

  return matchesTransientPattern(msg);
}

/**
 * Calculate delay with exponential backoff and jitter.
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay) + random jitter (0-25% of delay)
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  // Add jitter: 0-25% of the delay
  const jitter = Math.random() * exponentialDelay * 0.25;
  return Math.round(exponentialDelay + jitter);
}

/**
 * Wrap a promise with a timeout.
 *
 * Returns a promise that rejects with a timeout error if the original
 * promise does not resolve within the given time.
 */
function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return fn();
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    fn()
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
  });
}

/**
 * Normalize an error to an Error instance.
 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Determine whether a failed attempt should be retried.
 */
function shouldRetry(error: Error, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) {
    return false;
  }
  return isTransientError(error);
}

/**
 * Execute an async function with retry logic, exponential backoff, and per-attempt timeout.
 *
 * Only retries on transient errors (rate limits, timeouts, network errors, 5xx).
 * Non-transient errors (auth, validation, 4xx) are thrown immediately.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration (uses defaults for missing fields)
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: Partial<RetryOptions>): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await withTimeout(fn, opts.timeoutMs);
    } catch (error) {
      lastError = toError(error);

      if (!shouldRetry(lastError, attempt, opts.maxRetries)) {
        break;
      }

      const delay = calculateBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);

      log.debug('Retrying after transient error', {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries,
        delayMs: delay,
        error: lastError.message,
      });

      opts.onRetry?.(attempt + 1, lastError);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error('withRetry failed with no error captured');
}
