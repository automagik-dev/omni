/**
 * Download Size Guard
 *
 * Prevents memory exhaustion by capping HTTP response body size
 * before the full body is read into memory.
 *
 * Usage:
 *   const guard = createDownloadGuard({ maxSizeBytes: 50 * 1024 * 1024 });
 *   const response = await fetch(url);
 *   guard.checkResponse(response, logger, { instanceId, url });
 *   // If response is too large, throws DownloadTooLargeError
 */

import type { Logger } from '@omni/core';

const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export class DownloadTooLargeError extends Error {
  constructor(
    public readonly contentLength: number,
    public readonly maxSize: number,
  ) {
    super(`Download size ${contentLength} exceeds limit ${maxSize}`);
    this.name = 'DownloadTooLargeError';
  }
}

export interface DownloadGuardConfig {
  maxSizeBytes?: number;
}

export interface DownloadGuardContext {
  instanceId?: string;
  url?: string;
  channel?: string;
}

export interface DownloadGuard {
  /**
   * Check a fetch Response's Content-Length header before reading the body.
   * Throws DownloadTooLargeError if the declared size exceeds the limit.
   */
  checkResponse(response: Response, logger: Logger, ctx?: DownloadGuardContext): void;

  /**
   * Check an explicit size value (e.g., from a platform API's file_size field).
   * Throws DownloadTooLargeError if size exceeds the limit.
   */
  checkSize(sizeBytes: number, logger: Logger, ctx?: DownloadGuardContext): void;

  /** The configured max size in bytes. */
  readonly maxSizeBytes: number;
}

/**
 * Create a download guard with the given configuration.
 */
export function createDownloadGuard(config?: DownloadGuardConfig): DownloadGuard {
  const maxSizeBytes = config?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

  function checkSize(sizeBytes: number, logger: Logger, ctx?: DownloadGuardContext): void {
    if (sizeBytes > maxSizeBytes) {
      logger.warn('download_too_large', {
        event: 'download_too_large',
        instanceId: ctx?.instanceId,
        url: ctx?.url,
        channel: ctx?.channel,
        contentLength: sizeBytes,
        maxSizeBytes,
      });
      throw new DownloadTooLargeError(sizeBytes, maxSizeBytes);
    }
  }

  function checkResponse(response: Response, logger: Logger, ctx?: DownloadGuardContext): void {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);
      if (!Number.isNaN(size)) {
        checkSize(size, logger, ctx);
      }
    } else {
      // Content-Length header is absent: size cannot be verified before the body is read.
      // Log a warning so operators are aware the guard cannot protect this download.
      logger.warn('download_size_unknown', {
        event: 'download_size_unknown',
        instanceId: ctx?.instanceId,
        url: ctx?.url,
        channel: ctx?.channel,
        message: 'Content-Length header missing; download size cannot be verified before streaming',
      });
    }
  }

  return {
    checkResponse,
    checkSize,
    maxSizeBytes,
  };
}
