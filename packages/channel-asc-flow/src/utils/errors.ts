/**
 * ASC platform (/rest/v2) error mapping.
 *
 * `AscFlowApiError` extends `ChannelError` from `@omni/core` (SDK compliance:
 * every channel error participates in the core hierarchy):
 *   - `.code` carries the wire code (`ASC_FLOW_*`).
 *   - `.channelCode` duplicates it (SDK compliance property).
 *   - `.retryable` derives from the code — rate limit / upstream 5xx only;
 *     auth and business failures are NOT retryable.
 *
 * 🔴 The platform overloads HTTP 401. `/mensagem` answers 401 with a
 * `cod_error` body for BUSINESS failures ("Atendimento já finalizado!"), not
 * for an expired token. That distinction lives in `client.ts` (a business 401
 * must never trigger a re-auth + retry: the retry would deliver the message
 * twice on the beneficiary's handset). Here it only decides the taxonomy —
 * a 401 carrying `cod_error` maps to BUSINESS_ERROR, never AUTH_FAILED.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/** Keys of the ASC Flow error taxonomy. */
type AscFlowErrorCodeName =
  | 'AUTH_FAILED'
  | 'BUSINESS_ERROR'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_CONNECTED'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN';

/**
 * ASC Flow wire codes. Values are channel-specific (`ASC_FLOW_*`) and
 * intentionally NOT part of the core `ErrorCode` union — members are typed
 * `string` so comparisons against the inherited `code: ErrorCode` property
 * stay valid for TypeScript while runtime values are preserved.
 */
export const AscFlowErrorCode: Record<AscFlowErrorCodeName, string> = {
  /** `/authuser` rejected the login/chave pair, or a 401 with no `cod_error`. */
  AUTH_FAILED: 'ASC_FLOW_AUTH_FAILED',
  /** The platform refused the operation on its merits (`cod_error` in the body). */
  BUSINESS_ERROR: 'ASC_FLOW_BUSINESS_ERROR',
  /** Malformed request / unknown resource (4xx). */
  INVALID_REQUEST: 'ASC_FLOW_INVALID_REQUEST',
  /** Rate limit (429) — retryable. The platform documents no limits; mapped defensively. */
  RATE_LIMITED: 'ASC_FLOW_RATE_LIMITED',
  /** Local guard — the instance is not connected (no HTTP call made). */
  NOT_CONNECTED: 'ASC_FLOW_NOT_CONNECTED',
  /** 5xx upstream — retryable. */
  UPSTREAM_ERROR: 'ASC_FLOW_UPSTREAM_ERROR',
  /** Anything we couldn't classify. */
  UNKNOWN: 'ASC_FLOW_UNKNOWN',
} as const;

export type AscFlowErrorCodeType = (typeof AscFlowErrorCode)[AscFlowErrorCodeName];

const RETRYABLE_CODES = new Set<AscFlowErrorCodeType>([AscFlowErrorCode.RATE_LIMITED, AscFlowErrorCode.UPSTREAM_ERROR]);

/** ASC Flow code → core ErrorCode handed to the ChannelError constructor. */
const CORE_CODE_MAP: Record<string, CoreErrorCode> = {
  [AscFlowErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [AscFlowErrorCode.BUSINESS_ERROR]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [AscFlowErrorCode.INVALID_REQUEST]: ERROR_CODES.VALIDATION,
  [AscFlowErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [AscFlowErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [AscFlowErrorCode.UPSTREAM_ERROR]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [AscFlowErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

export interface AscFlowApiErrorContext {
  httpStatus?: number;
  operation?: string;
  /** The platform's `cod_error` when the body carried one. */
  codError?: number | string;
  raw?: string;
}

/** ASC Flow channel error — extends core ChannelError. */
export class AscFlowApiError extends ChannelError {
  readonly channelCode: string;
  readonly httpStatus?: number;
  readonly operation?: string;
  readonly codError?: number | string;

  constructor(code: AscFlowErrorCodeType, message: string, context: AscFlowApiErrorContext = {}) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'asc-flow', undefined, {
      recoverable: RETRYABLE_CODES.has(code),
      context: { ...context, channelCode: code },
    });
    this.name = 'AscFlowApiError';
    this.channelCode = code;
    this.httpStatus = context.httpStatus;
    this.operation = context.operation;
    this.codError = context.codError;
  }

  /** True when the error is eligible for retry with backoff. */
  get retryable(): boolean {
    return this.recoverable;
  }
}

/**
 * Map an HTTP status to an ASC Flow error code.
 *
 * `hasCodError` disambiguates the overloaded 401: with a `cod_error` in the
 * body the platform is reporting a business refusal, not a stale token.
 */
export function mapHttpStatusToAscFlowError(status: number, hasCodError = false): AscFlowErrorCodeType {
  if (status === 401 && hasCodError) return AscFlowErrorCode.BUSINESS_ERROR;
  if (status === 401 || status === 403) return AscFlowErrorCode.AUTH_FAILED;
  if (status === 429) return AscFlowErrorCode.RATE_LIMITED;
  if (status >= 400 && status < 500) return AscFlowErrorCode.INVALID_REQUEST;
  if (status >= 500) return AscFlowErrorCode.UPSTREAM_ERROR;
  return AscFlowErrorCode.UNKNOWN;
}

/** Check if an error is retryable (eligible for exponential backoff). */
export function isRetryable(error: unknown): boolean {
  return error instanceof AscFlowApiError && error.retryable;
}
