/**
 * Typed error classes for Omni SDK
 */

export interface ApiErrorDetails {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Extract error info from an object-shaped API response */
function parseErrorObject(error: object, status?: number): OmniApiError | null {
  // Skip plain Error instances — they have .message but aren't API response shapes.
  // Let the caller handle them with UNKNOWN_ERROR via instanceof Error check.
  if (error instanceof Error && !('error' in error)) {
    return null;
  }

  // Handle { error: "string" | { message, code, details } }
  if ('error' in error) {
    const rawError = (error as { error: unknown }).error;
    if (typeof rawError === 'string') {
      return new OmniApiError(rawError, 'API_ERROR', undefined, status);
    }
    if (rawError && typeof rawError === 'object') {
      const apiError = rawError as ApiErrorDetails;
      return new OmniApiError(
        apiError.message ?? `API error (status ${status ?? 'unknown'})`,
        apiError.code ?? 'API_ERROR',
        apiError.details as Record<string, unknown>,
        status,
      );
    }
  }
  // Handle { message: "..." } without error wrapper
  if ('message' in error) {
    const msg = (error as { message: unknown }).message;
    if (typeof msg === 'string') {
      return new OmniApiError(msg, 'API_ERROR', undefined, status);
    }
  }
  return null;
}

/**
 * Error thrown when an API request fails
 */
export class OmniApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(message: string, code: string, details?: Record<string, unknown>, status?: number) {
    super(message);
    this.name = 'OmniApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }

  /**
   * Create from API error response
   */
  static from(error: unknown, status?: number): OmniApiError {
    if (error && typeof error === 'object') {
      const result = parseErrorObject(error, status);
      if (result) return result;
    }

    if (error instanceof Error) {
      return new OmniApiError(error.message, 'UNKNOWN_ERROR', undefined, status);
    }

    return new OmniApiError(
      typeof error === 'string' ? error : `API error (status ${status ?? 'unknown'})`,
      'UNKNOWN_ERROR',
      undefined,
      status,
    );
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      status: this.status,
    };
  }
}

/**
 * Error thrown when the client is not configured correctly
 */
export class OmniConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmniConfigError';
  }
}
