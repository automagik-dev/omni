/**
 * Request Body Size Limit Middleware
 *
 * Prevents memory exhaustion from overly large request bodies.
 */

import { bodyLimit } from 'hono/body-limit';

/**
 * Default max body size (10MB)
 */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Body limit middleware configuration
 */
export interface BodyLimitConfig {
  /** Maximum body size in bytes. Default: 10MB */
  maxSize?: number;
  /** Custom error message */
  message?: string;
}

/**
 * Create a body size limit middleware.
 *
 * Rejects requests with bodies larger than the configured limit
 * with a 413 Payload Too Large response.
 */
export function bodyLimitMiddleware(config: BodyLimitConfig = {}) {
  const { maxSize = DEFAULT_MAX_SIZE, message = 'Payload too large' } = config;

  return bodyLimit({
    maxSize,
    onError: (c) => {
      return c.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message,
            maxSize,
          },
        },
        413,
      );
    },
  });
}

/**
 * Pre-configured 10MB body limit middleware
 */
export const defaultBodyLimitMiddleware = bodyLimitMiddleware();

/**
 * Pre-configured 1MB body limit for smaller payloads
 */
export const smallBodyLimitMiddleware = bodyLimitMiddleware({ maxSize: 1024 * 1024 });

/**
 * Pre-configured 50MB body limit for file uploads
 */
export const largeBodyLimitMiddleware = bodyLimitMiddleware({ maxSize: 50 * 1024 * 1024 });
