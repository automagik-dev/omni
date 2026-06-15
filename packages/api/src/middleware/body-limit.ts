/**
 * Request Body Size Limit Middleware
 *
 * Prevents memory exhaustion from overly large request bodies.
 */

import { bodyLimit } from 'hono/body-limit';

/**
 * Default max body size (150MB).
 *
 * Sized to NOT be the bottleneck below the channels' own declared media limits.
 * The largest real file any channel accepts is a 100MB WhatsApp document
 * (channel-whatsapp capabilities: maxFileSize 100MB). Media travels as base64
 * in the JSON body (~37% larger than the raw file), so a 100MB file is ~137MB
 * on the wire — 150MB leaves headroom for the JSON envelope/other fields.
 *
 * Reference downstream limits: WhatsApp img/audio 16MB, video 64MB, doc 100MB;
 * Telegram img 10MB, audio/video/doc 50MB.
 *
 * Override via OMNI_API_BODY_LIMIT_MB (megabytes) — lower it if memory-bound.
 */
const DEFAULT_MAX_SIZE = (Number(process.env.OMNI_API_BODY_LIMIT_MB) || 150) * 1024 * 1024;

/**
 * Body limit middleware configuration
 */
interface BodyLimitConfig {
  /** Maximum body size in bytes. Default: DEFAULT_MAX_SIZE (150MB). */
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
function bodyLimitMiddleware(config: BodyLimitConfig = {}) {
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
 * Pre-configured body limit middleware (DEFAULT_MAX_SIZE, 150MB by default).
 */
export const defaultBodyLimitMiddleware = bodyLimitMiddleware();
