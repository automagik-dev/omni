/**
 * ASC Brazil API error mapping.
 *
 * `AscApiError` extends `ChannelError` from `@omni/core` (SDK compliance:
 * every channel error participates in the core hierarchy), mirroring the
 * `HermesApiError` surface:
 *   - `.code` carries the ASC wire code (`ASC_*`).
 *   - `.channelCode` duplicates it (SDK compliance property).
 *   - `.retryable` derives from the code — rate limit / upstream 5xx only;
 *     auth failures are NOT retryable.
 *
 * ASC documents no error-code taxonomy (most endpoints only declare a 200) —
 * mapping is purely HTTP-status based (`mapHttpStatusToAscError`) and the
 * response body is preserved in the message for diagnosis.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/** Keys of the ASC error taxonomy. */
type AscErrorCodeName =
  | 'AUTH_FAILED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_CONNECTED'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN';

/**
 * ASC wire codes. Values are channel-specific (`ASC_*`) and intentionally
 * NOT part of the core `ErrorCode` union — members are typed `string` so
 * comparisons against the inherited `code: ErrorCode` property stay valid
 * for TypeScript while runtime values are preserved.
 */
export const AscErrorCode: Record<AscErrorCodeName, string> = {
  /** `asc-token` / `originador` rejected (401/403). */
  AUTH_FAILED: 'ASC_AUTH_FAILED',
  /** Malformed request / unknown resource (4xx). */
  INVALID_REQUEST: 'ASC_INVALID_REQUEST',
  /** Rate limit (429) — retryable. ASC documents no limits; mapped defensively. */
  RATE_LIMITED: 'ASC_RATE_LIMITED',
  /** Local guard — the instance is not connected (no HTTP call made). */
  NOT_CONNECTED: 'ASC_NOT_CONNECTED',
  /** 5xx upstream — retryable. */
  UPSTREAM_ERROR: 'ASC_UPSTREAM_ERROR',
  /** Anything we couldn't classify. */
  UNKNOWN: 'ASC_UNKNOWN',
} as const;

export type AscErrorCodeType = (typeof AscErrorCode)[AscErrorCodeName];

const RETRYABLE_CODES = new Set<AscErrorCodeType>([AscErrorCode.RATE_LIMITED, AscErrorCode.UPSTREAM_ERROR]);

/** ASC code → core ErrorCode handed to the ChannelError constructor. */
const CORE_CODE_MAP: Record<string, CoreErrorCode> = {
  [AscErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [AscErrorCode.INVALID_REQUEST]: ERROR_CODES.VALIDATION,
  [AscErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [AscErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [AscErrorCode.UPSTREAM_ERROR]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [AscErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

export interface AscApiErrorContext {
  httpStatus?: number;
  operation?: string;
  raw?: string;
}

/** ASC channel error — extends core ChannelError. */
export class AscApiError extends ChannelError {
  readonly channelCode: string;
  readonly httpStatus?: number;
  readonly operation?: string;

  constructor(code: AscErrorCodeType, message: string, context: AscApiErrorContext = {}) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'asc', undefined, {
      recoverable: RETRYABLE_CODES.has(code),
      context: { ...context, channelCode: code },
    });
    this.name = 'AscApiError';
    this.channelCode = code;
    this.httpStatus = context.httpStatus;
    this.operation = context.operation;
  }

  /** True when the error is eligible for retry with backoff. */
  get retryable(): boolean {
    return this.recoverable;
  }
}

/**
 * Map an HTTP status to an ASC error code.
 *
 * Retryable: 429 (rate limit), 5xx (upstream).
 * Non-retryable: 401/403 (auth), remaining 4xx (invalid request).
 */
export function mapHttpStatusToAscError(status: number): AscErrorCodeType {
  if (status === 401 || status === 403) return AscErrorCode.AUTH_FAILED;
  if (status === 429) return AscErrorCode.RATE_LIMITED;
  if (status >= 400 && status < 500) return AscErrorCode.INVALID_REQUEST;
  if (status >= 500) return AscErrorCode.UPSTREAM_ERROR;
  return AscErrorCode.UNKNOWN;
}

/** Check if an error is retryable (eligible for exponential backoff). */
export function isRetryable(error: unknown): boolean {
  return error instanceof AscApiError && error.retryable;
}
