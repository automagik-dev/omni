/**
 * Zenvia API error mapping.
 *
 * `ZenviaApiError` extends `ChannelError` from `@omni/core` (SDK compliance:
 * every channel error participates in the core hierarchy), mirroring the
 * `AscApiError` surface:
 *   - `.channelCode` carries the Zenvia wire code (`ZENVIA_*`).
 *   - `.retryable` derives from the code — rate limit / upstream 5xx only;
 *     auth failures are NOT retryable.
 *
 * Zenvia answers errors with `{ code, message, details[] }` (`error.base` in
 * the spec). Classification is by HTTP status; the vendor `code` and message
 * are preserved for diagnosis.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/** Keys of the Zenvia error taxonomy. */
type ZenviaErrorCodeName =
  | 'AUTH_FAILED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_CONNECTED'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN';

/**
 * Zenvia wire codes. Values are channel-specific (`ZENVIA_*`) and intentionally
 * NOT part of the core `ErrorCode` union — members are typed `string` so
 * comparisons against the inherited `code: ErrorCode` property stay valid
 * for TypeScript while runtime values are preserved.
 */
export const ZenviaErrorCode: Record<ZenviaErrorCodeName, string> = {
  /** `X-API-TOKEN` rejected (401/403). */
  AUTH_FAILED: 'ZENVIA_AUTH_FAILED',
  /** Validation error / unknown resource (4xx). */
  INVALID_REQUEST: 'ZENVIA_INVALID_REQUEST',
  /** Rate limit (429) — retryable. */
  RATE_LIMITED: 'ZENVIA_RATE_LIMITED',
  /** Local guard — the instance is not connected (no HTTP call made). */
  NOT_CONNECTED: 'ZENVIA_NOT_CONNECTED',
  /** 5xx upstream — retryable. */
  UPSTREAM_ERROR: 'ZENVIA_UPSTREAM_ERROR',
  /** Anything we couldn't classify. */
  UNKNOWN: 'ZENVIA_UNKNOWN',
} as const;

export type ZenviaErrorCodeType = (typeof ZenviaErrorCode)[ZenviaErrorCodeName];

const RETRYABLE_CODES = new Set<ZenviaErrorCodeType>([ZenviaErrorCode.RATE_LIMITED, ZenviaErrorCode.UPSTREAM_ERROR]);

/** Zenvia code → core ErrorCode handed to the ChannelError constructor. */
const CORE_CODE_MAP: Record<string, CoreErrorCode> = {
  [ZenviaErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [ZenviaErrorCode.INVALID_REQUEST]: ERROR_CODES.VALIDATION,
  [ZenviaErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [ZenviaErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [ZenviaErrorCode.UPSTREAM_ERROR]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [ZenviaErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

export interface ZenviaApiErrorContext {
  httpStatus?: number;
  operation?: string;
  /** The `code` field of Zenvia's error body (e.g. VALIDATION_ERROR). */
  vendorCode?: string;
  raw?: string;
}

/** Zenvia channel error — extends core ChannelError. */
export class ZenviaApiError extends ChannelError {
  readonly channelCode: string;
  readonly httpStatus?: number;
  readonly operation?: string;
  readonly vendorCode?: string;

  constructor(code: ZenviaErrorCodeType, message: string, context: ZenviaApiErrorContext = {}) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'zenvia', undefined, {
      recoverable: RETRYABLE_CODES.has(code),
      context: { ...context, channelCode: code },
    });
    this.name = 'ZenviaApiError';
    this.channelCode = code;
    this.httpStatus = context.httpStatus;
    this.operation = context.operation;
    this.vendorCode = context.vendorCode;
  }

  /** True when the error is eligible for retry with backoff. */
  get retryable(): boolean {
    return this.recoverable;
  }
}

/**
 * Map an HTTP status to a Zenvia error code.
 *
 * Retryable: 429 (rate limit), 5xx (upstream).
 * Non-retryable: 401/403 (auth), remaining 4xx (invalid request).
 */
export function mapHttpStatusToZenviaError(status: number): ZenviaErrorCodeType {
  if (status === 401 || status === 403) return ZenviaErrorCode.AUTH_FAILED;
  if (status === 429) return ZenviaErrorCode.RATE_LIMITED;
  if (status >= 400 && status < 500) return ZenviaErrorCode.INVALID_REQUEST;
  if (status >= 500) return ZenviaErrorCode.UPSTREAM_ERROR;
  return ZenviaErrorCode.UNKNOWN;
}

/** Check if an error is retryable (eligible for exponential backoff). */
export function isRetryable(error: unknown): boolean {
  return error instanceof ZenviaApiError && error.retryable;
}
