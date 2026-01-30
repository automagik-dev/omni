/**
 * Typed error classes for Omni SDK
 */

export interface ApiErrorDetails {
  code: string;
  message: string;
  details?: Record<string, unknown>;
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
    if (error && typeof error === 'object' && 'error' in error) {
      const apiError = (error as { error: ApiErrorDetails }).error;
      return new OmniApiError(apiError.message, apiError.code, apiError.details as Record<string, unknown>, status);
    }

    if (error instanceof Error) {
      return new OmniApiError(error.message, 'UNKNOWN_ERROR', undefined, status);
    }

    return new OmniApiError(String(error), 'UNKNOWN_ERROR', undefined, status);
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
