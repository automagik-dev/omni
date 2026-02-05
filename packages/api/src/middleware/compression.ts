/**
 * HTTP Response Compression Middleware
 *
 * Compresses responses using gzip or deflate based on Accept-Encoding header.
 * Only compresses responses larger than the minimum size threshold.
 */

import { compress } from 'hono/compress';
import { createMiddleware } from 'hono/factory';
import type { AppVariables } from '../types';

/**
 * Default minimum size for compression (1KB).
 * Responses smaller than this won't be compressed (overhead not worth it).
 */
const DEFAULT_MIN_SIZE = 1024;

/**
 * Compression middleware configuration
 */
export interface CompressionConfig {
  /** Compression encoding (gzip, deflate). Default: gzip */
  encoding?: 'gzip' | 'deflate';
  /** Minimum response size to compress (bytes). Default: 1024 */
  threshold?: number;
}

/**
 * Create compression middleware that respects Accept-Encoding.
 *
 * Uses Hono's built-in compression middleware which:
 * - Respects Accept-Encoding header
 * - Only compresses compressible content types (JSON, text, etc.)
 * - Skips already-compressed content
 */
export function compressionMiddleware(config: CompressionConfig = {}) {
  const { encoding = 'gzip', threshold = DEFAULT_MIN_SIZE } = config;

  // Create the base compress middleware
  const compressMiddleware = compress({
    encoding,
    threshold,
  });

  // Wrap to check Accept-Encoding first
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const acceptEncoding = c.req.header('Accept-Encoding') || '';

    // If client explicitly requests no compression, skip
    if (acceptEncoding === 'identity' || acceptEncoding === '*;q=0') {
      return next();
    }

    // If client doesn't accept our encoding, skip
    if (encoding === 'gzip' && !acceptEncoding.includes('gzip')) {
      return next();
    }
    if (encoding === 'deflate' && !acceptEncoding.includes('deflate')) {
      return next();
    }

    // Apply compression
    return compressMiddleware(c, next);
  });
}

/**
 * Pre-configured gzip compression middleware
 */
export const gzipMiddleware = compressionMiddleware({ encoding: 'gzip' });

/**
 * Pre-configured deflate compression middleware
 */
export const deflateMiddleware = compressionMiddleware({ encoding: 'deflate' });
