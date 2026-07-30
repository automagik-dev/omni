/**
 * Hermes (Mutant) API error mapping.
 *
 * `HermesApiError` extends `ChannelError` from `@omni/core` (SDK compliance:
 * every channel error participates in the core hierarchy) mirroring the
 * `MetaApiError` surface:
 *   - `.code` carries the Hermes wire code (`HERMES_*`).
 *   - `.channelCode` duplicates it (SDK compliance property).
 *   - `.retryable` derives from the code — rate limit / upstream 5xx only;
 *     auth failures are NOT retryable.
 *
 * Hermes has no documented error-code taxonomy of its own — mapping is purely
 * HTTP-status based (`mapHttpStatusToHermesError`).
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/** Keys of the Hermes error taxonomy. */
type HermesErrorCodeName =
  | 'AUTH_FAILED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_CONNECTED'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN';

/**
 * Hermes wire codes. Values are channel-specific (`HERMES_*`) and
 * intentionally NOT part of the core `ErrorCode` union — members are typed
 * `string` so comparisons against the inherited `code: ErrorCode` property
 * stay valid for TypeScript while runtime values are preserved.
 */
export const HermesErrorCode: Record<HermesErrorCodeName, string> = {
  /** JWT sign-in rejected, or Bearer token rejected twice in a row (401/403). */
  AUTH_FAILED: 'HERMES_AUTH_FAILED',
  /** Malformed request / unknown resource / oversized upload (4xx). */
  INVALID_REQUEST: 'HERMES_INVALID_REQUEST',
  /** Rate limit (429) — retryable. */
  RATE_LIMITED: 'HERMES_RATE_LIMITED',
  /** Local guard — the instance is not connected (no HTTP call made). */
  NOT_CONNECTED: 'HERMES_NOT_CONNECTED',
  /** 5xx upstream — retryable. */
  UPSTREAM_ERROR: 'HERMES_UPSTREAM_ERROR',
  /** Anything we couldn't classify. */
  UNKNOWN: 'HERMES_UNKNOWN',
} as const;

export type HermesErrorCodeType = (typeof HermesErrorCode)[HermesErrorCodeName];

const RETRYABLE_CODES = new Set<HermesErrorCodeType>([HermesErrorCode.RATE_LIMITED, HermesErrorCode.UPSTREAM_ERROR]);

/** Hermes code → core ErrorCode handed to the ChannelError constructor. */
const CORE_CODE_MAP: Record<string, CoreErrorCode> = {
  [HermesErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [HermesErrorCode.INVALID_REQUEST]: ERROR_CODES.VALIDATION,
  [HermesErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [HermesErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [HermesErrorCode.UPSTREAM_ERROR]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [HermesErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

/** Structured Hermes API failure context. */
export type HermesApiErrorContext = {
  httpStatus?: number;
  operation?: string;
  raw?: unknown;
};

export class HermesApiError extends ChannelError {
  /** Channel-specific code — same HERMES_* value as `.code` (SDK compliance surface). */
  readonly channelCode: HermesErrorCodeType;
  declare readonly context: HermesApiErrorContext;

  constructor(code: HermesErrorCodeType, message: string, context: HermesApiErrorContext = {}) {
    super(CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN, message, 'hermes', undefined, {
      recoverable: RETRYABLE_CODES.has(code),
      context: { ...context },
    });
    this.name = 'HermesApiError';
    this.channelCode = code;
    // `.code` keeps the Hermes wire code (`HERMES_*`) — the ChannelError
    // constructor received the mapped core ErrorCode; restore the channel
    // value on the instance (same pattern as MetaApiError).
    Object.defineProperty(this, 'code', { value: code, enumerable: true, writable: false, configurable: true });
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.channelCode);
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof HermesApiError && error.retryable;
}

/**
 * Map an HTTP status from the Hermes API to a normalized HermesErrorCode.
 *
 *   - 401 / 403 → AUTH_FAILED (not retryable — credentials are wrong)
 *   - 429       → RATE_LIMITED (retryable)
 *   - other 4xx → INVALID_REQUEST (payload problem — not retryable)
 *   - 5xx       → UPSTREAM_ERROR (retryable)
 */
export function mapHttpStatusToHermesError(status: number): HermesErrorCodeType {
  if (status === 401 || status === 403) return HermesErrorCode.AUTH_FAILED;
  if (status === 429) return HermesErrorCode.RATE_LIMITED;
  if (status >= 400 && status < 500) return HermesErrorCode.INVALID_REQUEST;
  if (status >= 500 && status < 600) return HermesErrorCode.UPSTREAM_ERROR;
  return HermesErrorCode.UNKNOWN;
}
