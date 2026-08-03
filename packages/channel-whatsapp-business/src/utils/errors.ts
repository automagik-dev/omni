/**
 * Meta WhatsApp Cloud API error mapping.
 *
 * `MetaApiError` extends `ChannelError` from `@omni/core` (SDK compliance:
 * every channel error participates in the core hierarchy) while preserving
 * the historical public surface:
 *   - `.code` carries the Meta wire code (`META_*`) — callers such as
 *     `@omni/api/src/routes/v2/whatsapp-business.ts` compare it against
 *     `MetaErrorCode` values.
 *   - `.context` carries the structured Graph API context (httpStatus,
 *     fbtrace_id, …).
 *   - `.retryable` stays derived from the Meta code (rate limit / 5xx only).
 * The mapped core `ErrorCode` is what `ChannelError`'s constructor receives
 * (see CORE_CODE_MAP) so hierarchy-level consumers get `recoverable`,
 * `channelType`, and `toJSON()` semantics for free.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/** Keys of the Meta error taxonomy. */
type MetaErrorCodeName =
  | 'AUTH_FAILED'
  | 'PHONE_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'OUTSIDE_24H_WINDOW'
  | 'TEMPLATE_NOT_APPROVED'
  | 'RATE_LIMITED'
  | 'RECIPIENT_NOT_FOUND'
  | 'NOT_CONNECTED'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN';

/**
 * Meta wire codes. Values are channel-specific (`META_*`) and intentionally
 * NOT part of the core `ErrorCode` union — members are typed `string` so
 * comparisons against the inherited `code: ErrorCode` property stay valid
 * for TypeScript while runtime values are preserved.
 */
export const MetaErrorCode: Record<MetaErrorCodeName, string> = {
  /** Bearer token rejected (401/190). */
  AUTH_FAILED: 'META_AUTH_FAILED',
  /** Phone number id unknown / not registered (404/100). */
  PHONE_NOT_FOUND: 'META_PHONE_NOT_FOUND',
  /** Required parameter missing (100). */
  INVALID_REQUEST: 'META_INVALID_REQUEST',
  /** 24h messaging window expired — only templates allowed (131047/131051). */
  OUTSIDE_24H_WINDOW: 'OMNI_OUTSIDE_24H_WINDOW',
  /** Template not approved / paused / disabled (132000-132099). */
  TEMPLATE_NOT_APPROVED: 'META_TEMPLATE_NOT_APPROVED',
  /** Rate limit (80007, 130429, 131056). */
  RATE_LIMITED: 'META_RATE_LIMITED',
  /** Recipient phone is not a WhatsApp user (1006/131026). */
  RECIPIENT_NOT_FOUND: 'META_RECIPIENT_NOT_FOUND',
  /** Local guard — the instance is not connected (no Graph API call made). */
  NOT_CONNECTED: 'META_NOT_CONNECTED',
  /** 5xx upstream — retryable. */
  UPSTREAM_ERROR: 'META_UPSTREAM_ERROR',
  /** Anything we couldn't classify. */
  UNKNOWN: 'META_UNKNOWN',
} as const;

export type MetaErrorCodeType = (typeof MetaErrorCode)[MetaErrorCodeName];

const RETRYABLE_CODES = new Set<MetaErrorCodeType>([MetaErrorCode.RATE_LIMITED, MetaErrorCode.UPSTREAM_ERROR]);

/** Meta code → core ErrorCode handed to the ChannelError constructor. */
const CORE_CODE_MAP: Record<string, CoreErrorCode> = {
  [MetaErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [MetaErrorCode.PHONE_NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [MetaErrorCode.INVALID_REQUEST]: ERROR_CODES.VALIDATION,
  [MetaErrorCode.OUTSIDE_24H_WINDOW]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [MetaErrorCode.TEMPLATE_NOT_APPROVED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [MetaErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [MetaErrorCode.RECIPIENT_NOT_FOUND]: ERROR_CODES.RECIPIENT_NOT_ON_CHANNEL,
  [MetaErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [MetaErrorCode.UPSTREAM_ERROR]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [MetaErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

/**
 * Structured Graph API failure context.
 *
 * A type alias (not an interface) so it structurally satisfies the base
 * class's `context?: Record<string, unknown>` declaration.
 */
export type MetaApiErrorContext = {
  httpStatus?: number;
  operation?: string;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  fbtraceId?: string;
  raw?: unknown;
};

export class MetaApiError extends ChannelError {
  /** Channel-specific code — same META_* value as `.code` (SDK compliance surface). */
  readonly channelCode: MetaErrorCodeType;
  declare readonly context: MetaApiErrorContext;

  constructor(code: MetaErrorCodeType, message: string, context: MetaApiErrorContext = {}) {
    super(CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN, message, 'whatsapp-business', undefined, {
      recoverable: RETRYABLE_CODES.has(code),
      context: { ...context },
    });
    this.name = 'MetaApiError';
    this.channelCode = code;
    // Backwards compatibility: `.code` keeps the Meta wire code (`META_*`).
    // The ChannelError constructor above already received the mapped core
    // ErrorCode; here we restore the Meta value on the instance so existing
    // callers comparing against MetaErrorCode keep working.
    Object.defineProperty(this, 'code', { value: code, enumerable: true, writable: false, configurable: true });
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.channelCode);
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof MetaApiError && error.retryable;
}

/**
 * Map a Meta-side error code (numeric) or raw HTTP status to a normalized
 * MetaErrorCode. Falls back to UNKNOWN.
 *
 * Common codes:
 *   - 0      → unknown / generic
 *   - 1, 2   → API service / unknown
 *   - 4, 80007 → rate limit
 *   - 100    → invalid parameter
 *   - 130429 → rate limit (per-app)
 *   - 131009 → parameter invalid
 *   - 131026 → recipient not a WhatsApp user
 *   - 131047 → re-engagement message (24h window expired)
 *   - 131051 → unsupported message type
 *   - 131053 → media too large
 *   - 131056 → rate limit per phone_number_id
 *   - 132000-132099 → template-related (not approved, paused, mismatched, etc.)
 *   - 133006-133015 → phone registration / number issues
 *   - 190    → access token issues
 *   - 200/270/272 → permission errors
 */
/** 401/403 HTTP fallbacks; 190 — access token issues; 200 — permission error;
 * 270 — invalid OAuth permission; 272 — app not allowed to access user data.
 * All map to auth failure — the caller needs new perms. */
const AUTH_FAILED_CODES = new Set([401, 403, 190, 200, 270, 272]);
/** 429 HTTP fallback; 4, 80007 — app/account rate limit; 130429 — per-app; 131056 — per phone. */
const RATE_LIMITED_CODES = new Set([429, 4, 80007, 130429, 131056]);
/** 100 — invalid parameter; 131009 — parameter value invalid;
 * 131053 — media too large (still a client-side problem, just a richer 400). */
const INVALID_REQUEST_CODES = new Set([100, 131009, 131053]);
/** 1, 2 — API service / unknown — Meta-side transient errors, retryable upstream. */
const UPSTREAM_ERROR_CODES = new Set([1, 2]);
/** 131047 — re-engagement message (24h window expired); 131051 — unsupported message type. */
const OUTSIDE_24H_WINDOW_CODES = new Set([131047, 131051]);

export function mapHttpStatusToMetaError(codeOrStatus: number): MetaErrorCodeType {
  // Exact-match codes (HTTP status fallbacks + Meta error codes — disjoint sets).
  if (AUTH_FAILED_CODES.has(codeOrStatus)) return MetaErrorCode.AUTH_FAILED;
  if (RATE_LIMITED_CODES.has(codeOrStatus)) return MetaErrorCode.RATE_LIMITED;
  if (INVALID_REQUEST_CODES.has(codeOrStatus)) return MetaErrorCode.INVALID_REQUEST;
  if (UPSTREAM_ERROR_CODES.has(codeOrStatus)) return MetaErrorCode.UPSTREAM_ERROR;
  if (OUTSIDE_24H_WINDOW_CODES.has(codeOrStatus)) return MetaErrorCode.OUTSIDE_24H_WINDOW;
  if (codeOrStatus === 404) return MetaErrorCode.PHONE_NOT_FOUND;
  if (codeOrStatus === 131026) return MetaErrorCode.RECIPIENT_NOT_FOUND;

  // Range-based codes.
  // 5xx HTTP fallback (when no Meta code envelope was returned).
  if (codeOrStatus >= 500 && codeOrStatus < 600) return MetaErrorCode.UPSTREAM_ERROR;
  // 132000-132099 — template-related (not approved, paused, mismatched, etc.).
  if (codeOrStatus >= 132000 && codeOrStatus < 132100) return MetaErrorCode.TEMPLATE_NOT_APPROVED;
  // 133000-133099 — phone registration / number issues.
  if (codeOrStatus >= 133000 && codeOrStatus < 133100) return MetaErrorCode.PHONE_NOT_FOUND;

  return MetaErrorCode.UNKNOWN;
}
