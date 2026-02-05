/**
 * Request Timeout Middleware
 *
 * Ensures requests don't hang indefinitely by enforcing a timeout.
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppVariables } from '../types';

/**
 * Default timeout in milliseconds (30 seconds)
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Timeout middleware configuration
 */
export interface TimeoutConfig {
  /** Timeout in milliseconds. Default: 30000 (30 seconds) */
  timeoutMs?: number;
  /** Custom message for timeout error */
  message?: string;
}

/**
 * Create a request timeout middleware.
 *
 * If the request takes longer than the configured timeout, it will be aborted
 * and a 408 Request Timeout response will be returned.
 */
export function timeoutMiddleware(config: TimeoutConfig = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, message = 'Request timeout' } = config;

  return createMiddleware<{ Variables: AppVariables }>(async (_c, next) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Store the abort signal for downstream handlers to check
    // Note: This doesn't actually abort the handler, but provides a signal
    // that handlers can check for cooperative cancellation

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new HTTPException(408, { message }));
        });
      });

      // Race between the handler and the timeout
      await Promise.race([next(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Pre-configured 30-second timeout middleware
 */
export const defaultTimeoutMiddleware = timeoutMiddleware();

/**
 * Pre-configured 60-second timeout for long operations
 */
export const longTimeoutMiddleware = timeoutMiddleware({ timeoutMs: 60_000 });

/**
 * Pre-configured 5-second timeout for quick operations
 */
export const shortTimeoutMiddleware = timeoutMiddleware({ timeoutMs: 5_000 });
