/**
 * Error handling utilities for Gupshup channel plugin
 *
 * GupshupError extends core ChannelError for standardized error handling.
 * Errors are classified as retryable (exponential backoff) or non-retryable (fail immediately).
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/**
 * Error codes for Gupshup plugin errors
 */
export const GupshupErrorCode = {
  NOT_CONNECTED: 'GUPSHUP_NOT_CONNECTED',
  SEND_FAILED: 'GUPSHUP_SEND_FAILED',
  AUTH_FAILED: 'GUPSHUP_AUTH_FAILED',
  RATE_LIMITED: 'GUPSHUP_RATE_LIMITED',
  BAD_REQUEST: 'GUPSHUP_BAD_REQUEST',
  NOT_FOUND: 'GUPSHUP_NOT_FOUND',
  WEBHOOK_FAILED: 'GUPSHUP_WEBHOOK_FAILED',
  UNKNOWN: 'GUPSHUP_UNKNOWN_ERROR',
} as const;

export type GupshupErrorCodeType = (typeof GupshupErrorCode)[keyof typeof GupshupErrorCode];

/**
 * Map Gupshup-specific error codes to core ErrorCode
 */
const CORE_CODE_MAP: Record<GupshupErrorCodeType, CoreErrorCode> = {
  [GupshupErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [GupshupErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [GupshupErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [GupshupErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [GupshupErrorCode.BAD_REQUEST]: ERROR_CODES.VALIDATION,
  [GupshupErrorCode.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [GupshupErrorCode.WEBHOOK_FAILED]: ERROR_CODES.CHANNEL_CONNECTION_FAILED,
  [GupshupErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

/**
 * Gupshup plugin error — extends core ChannelError
 */
export class GupshupError extends ChannelError {
  readonly channelCode: GupshupErrorCodeType;

  constructor(code: GupshupErrorCodeType, message: string, recoverable = false, context?: Record<string, unknown>) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'gupshup', undefined, { recoverable, context: { ...context, channelCode: code } });
    this.name = 'GupshupError';
    this.channelCode = code;
  }
}

/**
 * Map HTTP status codes and network errors to GupshupError
 *
 * Retryable (exponential backoff):
 *   - HTTP 429 (rate limit)
 *   - HTTP 500/502/503 (server errors)
 *   - ETIMEDOUT, ECONNRESET (network timeouts)
 *
 * Non-retryable (fail immediately):
 *   - HTTP 401/403 (auth)
 *   - HTTP 400 (bad request / invalid number)
 *   - HTTP 404 (unknown endpoint)
 */
export function mapGupshupError(error: unknown, httpStatus?: number): GupshupError {
  if (error instanceof GupshupError) return error;

  if (httpStatus !== undefined) {
    return fromHttpStatus(httpStatus, error instanceof Error ? error.message : String(error));
  }

  if (error instanceof Error) {
    return fromErrorMessage(error.message);
  }

  return new GupshupError(GupshupErrorCode.UNKNOWN, String(error), false);
}

function fromHttpStatus(status: number, message: string): GupshupError {
  if (status === 429) return new GupshupError(GupshupErrorCode.RATE_LIMITED, message, true);
  if (status === 401 || status === 403) return new GupshupError(GupshupErrorCode.AUTH_FAILED, message, false);
  if (status === 400) return new GupshupError(GupshupErrorCode.BAD_REQUEST, message, false);
  if (status === 404) return new GupshupError(GupshupErrorCode.NOT_FOUND, message, false);
  if (status >= 500 && status <= 503) return new GupshupError(GupshupErrorCode.SEND_FAILED, message, true);
  return new GupshupError(GupshupErrorCode.UNKNOWN, message, false);
}

function fromErrorMessage(message: string): GupshupError {
  const lower = message.toLowerCase();
  if (lower.includes('etimedout') || lower.includes('econnreset') || lower.includes('timeout')) {
    return new GupshupError(GupshupErrorCode.SEND_FAILED, message, true);
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return new GupshupError(GupshupErrorCode.RATE_LIMITED, message, true);
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return new GupshupError(GupshupErrorCode.AUTH_FAILED, message, false);
  }
  if (lower.includes('400') || lower.includes('bad request')) {
    return new GupshupError(GupshupErrorCode.BAD_REQUEST, message, false);
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return new GupshupError(GupshupErrorCode.NOT_FOUND, message, false);
  }
  return new GupshupError(GupshupErrorCode.UNKNOWN, message, false);
}

/**
 * Check if an error is retryable (eligible for exponential backoff)
 *
 * Retryable: HTTP 429, 500/502/503, ETIMEDOUT, ECONNRESET
 * Non-retryable: HTTP 401/403, 400, 404
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof GupshupError) return error.recoverable;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
    if (msg.includes('etimedout') || msg.includes('econnreset') || msg.includes('timeout')) return true;
  }

  return false;
}
