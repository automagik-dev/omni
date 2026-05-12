/**
 * Meta WhatsApp Cloud API error mapping.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export const MetaErrorCode = {
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
  /** 5xx upstream — retryable. */
  UPSTREAM_ERROR: 'META_UPSTREAM_ERROR',
  /** Anything we couldn't classify. */
  UNKNOWN: 'META_UNKNOWN',
} as const;

export type MetaErrorCodeType = (typeof MetaErrorCode)[keyof typeof MetaErrorCode];

const RETRYABLE_CODES = new Set<MetaErrorCodeType>([
  MetaErrorCode.RATE_LIMITED,
  MetaErrorCode.UPSTREAM_ERROR,
]);

export interface MetaApiErrorContext {
  httpStatus?: number;
  operation?: string;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  fbtraceId?: string;
  raw?: unknown;
}

export class MetaApiError extends Error {
  readonly code: MetaErrorCodeType;
  readonly context: MetaApiErrorContext;

  constructor(code: MetaErrorCodeType, message: string, context: MetaApiErrorContext = {}) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.context = context;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
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
export function mapHttpStatusToMetaError(codeOrStatus: number): MetaErrorCodeType {
  // HTTP status fallbacks (when no Meta code envelope was returned).
  if (codeOrStatus === 401 || codeOrStatus === 403 || codeOrStatus === 190) return MetaErrorCode.AUTH_FAILED;
  if (codeOrStatus === 404) return MetaErrorCode.PHONE_NOT_FOUND;
  if (codeOrStatus === 429) return MetaErrorCode.RATE_LIMITED;
  if (codeOrStatus >= 500 && codeOrStatus < 600) return MetaErrorCode.UPSTREAM_ERROR;

  // Meta error codes.
  // 1, 2 — API service / unknown — Meta-side transient errors, retryable upstream.
  if (codeOrStatus === 1 || codeOrStatus === 2) return MetaErrorCode.UPSTREAM_ERROR;
  // 100 — invalid parameter; 131009 — parameter value invalid.
  if (codeOrStatus === 100 || codeOrStatus === 131009) return MetaErrorCode.INVALID_REQUEST;
  // 131053 — media too large (still a client-side problem, just a richer 400).
  if (codeOrStatus === 131053) return MetaErrorCode.INVALID_REQUEST;
  // 4, 80007 — app/account rate limit; 130429 — per-app; 131056 — per phone.
  if (codeOrStatus === 4 || codeOrStatus === 80007 || codeOrStatus === 130429 || codeOrStatus === 131056) {
    return MetaErrorCode.RATE_LIMITED;
  }
  if (codeOrStatus === 131026) return MetaErrorCode.RECIPIENT_NOT_FOUND;
  if (codeOrStatus === 131047 || codeOrStatus === 131051) return MetaErrorCode.OUTSIDE_24H_WINDOW;
  // 200 — permission error; 270 — invalid OAuth permission; 272 — app not allowed
  // to access user data. All map to auth failure — the caller needs new perms.
  if (codeOrStatus === 200 || codeOrStatus === 270 || codeOrStatus === 272) return MetaErrorCode.AUTH_FAILED;
  if (codeOrStatus >= 132000 && codeOrStatus < 132100) return MetaErrorCode.TEMPLATE_NOT_APPROVED;
  if (codeOrStatus >= 133000 && codeOrStatus < 133100) return MetaErrorCode.PHONE_NOT_FOUND;

  return MetaErrorCode.UNKNOWN;
}
