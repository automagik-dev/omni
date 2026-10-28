/**
 * ClickUp channel errors (issue #1413)
 *
 * Two layers, following the asc/hermes precedent:
 *   - `ClickUpError` is a local, human-readable failure (missing token, no
 *     default list, not connected, invalid action input).
 *   - `ClickUpApiError` is a non-2xx ClickUp response, carrying the HTTP status
 *     and ClickUp's own `ECODE` so a caller can tell an expired token from a
 *     malformed request.
 *
 * SECURITY: the personal API token is never interpolated into a message. The
 * client redacts it from any ClickUp-provided error text before constructing
 * these (see `client.ts`), so errors are safe to log and return.
 */

/** Closed taxonomy of local/API failure kinds. */
export type ClickUpErrorCode =
  | 'AUTH_FAILED'
  | 'NOT_CONNECTED'
  | 'INVALID_REQUEST'
  | 'MISSING_LIST'
  | 'MISSING_TASK'
  | 'TEAM_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'API_ERROR';

export class ClickUpError extends Error {
  readonly code: ClickUpErrorCode;

  constructor(code: ClickUpErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ClickUpError';
    this.code = code;
  }
}

/**
 * A non-2xx ClickUp API response. `status` is the HTTP status; `clickupCode` is
 * ClickUp's `ECODE` when the body carried one.
 */
export class ClickUpApiError extends ClickUpError {
  readonly status: number;
  readonly clickupCode?: string;

  constructor(status: number, message: string, clickupCode?: string) {
    super(codeForStatus(status), message);
    this.name = 'ClickUpApiError';
    this.status = status;
    this.clickupCode = clickupCode;
  }
}

function codeForStatus(status: number): ClickUpErrorCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status >= 400 && status < 500) return 'INVALID_REQUEST';
  return 'API_ERROR';
}
