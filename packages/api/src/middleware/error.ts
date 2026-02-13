/**
 * Error handling middleware and onError handler
 */

import { ConflictError, ERROR_CODES, NotFoundError, OmniError, ValidationError, createLogger } from '@omni/core';
import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ApiErrorResponse, AppVariables } from '../types';

const log = createLogger('api:error');

/**
 * Map error codes to HTTP status codes
 */
const ERROR_STATUS_MAP: Record<string, 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503 | 504> = {
  [ERROR_CODES.VALIDATION]: 400,
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.CHANNEL_NOT_CONNECTED]: 503,
  [ERROR_CODES.CHANNEL_CONNECTION_FAILED]: 503,
  [ERROR_CODES.CHANNEL_SEND_FAILED]: 502,
  [ERROR_CODES.CHANNEL_TIMEOUT]: 504,
  [ERROR_CODES.AGENT_UNAVAILABLE]: 503,
  [ERROR_CODES.AGENT_TIMEOUT]: 504,
  [ERROR_CODES.AGENT_ERROR]: 502,
  [ERROR_CODES.DB_CONNECTION_FAILED]: 503,
  [ERROR_CODES.DB_QUERY_FAILED]: 500,
  [ERROR_CODES.EVENT_PUBLISH_FAILED]: 500,
  [ERROR_CODES.EVENT_SUBSCRIBE_FAILED]: 500,
  [ERROR_CODES.UNKNOWN]: 500,
};

/**
 * Format Zod errors into a user-friendly structure
 */
function formatZodError(error: ZodError): ApiErrorResponse {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!details[path]) {
      details[path] = [];
    }
    details[path].push(issue.message);
  }

  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: { fields: details },
    },
  };
}

/**
 * Handle ZodError
 */
function handleZodError(c: Context, error: ZodError): Response {
  return c.json(formatZodError(error), 400);
}

/**
 * Handle HTTPException from Hono
 */
function handleHTTPException(c: Context, error: HTTPException): Response {
  return c.json(
    {
      error: {
        code: error.status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR',
        message: error.message,
      },
    },
    error.status,
  );
}

/**
 * Handle OmniError (our typed errors)
 */
function handleOmniError(c: Context, error: OmniError): Response {
  const status = ERROR_STATUS_MAP[error.code] ?? 500;
  const response: ApiErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      details: error.context,
    },
  };
  return c.json(response, status);
}

/**
 * Handle NotFoundError
 */
function handleNotFoundError(c: Context, error: NotFoundError): Response {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: error.message,
        details: {
          resourceType: error.resourceType,
          resourceId: error.resourceId,
        },
      },
    },
    404,
  );
}

/**
 * Handle ValidationError
 */
function handleValidationError(c: Context, error: ValidationError): Response {
  return c.json(
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: { fields: error.fields },
      },
    },
    400,
  );
}

/**
 * Handle ConflictError
 */
function handleConflictError(c: Context, error: ConflictError): Response {
  return c.json(
    {
      error: {
        code: 'CONFLICT',
        message: error.message,
        details: {
          resourceType: error.resourceType,
          conflictReason: error.conflictReason,
          ...error.context,
        },
      },
    },
    409,
  );
}

/**
 * Channel error code → HTTP status + user-friendly message.
 * Hoisted to module scope to avoid re-creation on every error.
 */
const CHANNEL_ERROR_MAP: Record<string, { status: 400 | 401 | 429 | 502 | 503; message: string }> = {
  WHATSAPP_NOT_CONNECTED: {
    status: 503,
    message: 'WhatsApp instance is disconnected. Re-scan QR code to reconnect.',
  },
  WHATSAPP_AUTH_FAILED: { status: 401, message: 'WhatsApp authentication failed. Re-scan QR code.' },
  WHATSAPP_RATE_LIMITED: { status: 429, message: 'WhatsApp rate limit reached. Try again later.' },
  WHATSAPP_INVALID_JID: { status: 400, message: 'Invalid WhatsApp JID format.' },
  WHATSAPP_INVALID_PHONE: { status: 400, message: 'Invalid phone number format.' },
  WHATSAPP_SEND_FAILED: { status: 502, message: 'Failed to send message via WhatsApp.' },
  WHATSAPP_MEDIA_UPLOAD_FAILED: { status: 502, message: 'Failed to upload media to WhatsApp.' },
  TELEGRAM_NOT_CONNECTED: { status: 503, message: 'Telegram bot is disconnected.' },
};

/**
 * Handle channel plugin errors (WhatsAppError, TelegramError, etc.)
 * Maps known channel error codes to friendly HTTP responses.
 */
function handleChannelError(c: Context, error: Error & { code?: string; retryable?: boolean }): Response | null {
  const code = error.code;
  if (!code || typeof code !== 'string') return null;

  // Safe lookup — guard against Object.prototype keys (constructor, __proto__, etc.)
  const mapped = Object.prototype.hasOwnProperty.call(CHANNEL_ERROR_MAP, code) ? CHANNEL_ERROR_MAP[code] : null;
  if (!mapped) return null;

  return c.json(
    {
      error: {
        code,
        message: mapped.message,
        retryable: error.retryable ?? false,
      },
    },
    mapped.status,
  );
}

/**
 * Handle PostgreSQL database errors (unique constraint violations, etc.)
 * Duck-typed by error.code to avoid importing pg types.
 */
function handleDatabaseError(
  c: Context,
  error: Error & { code?: string; detail?: string; constraint?: string },
): Response | null {
  // PostgreSQL unique_violation
  if (error.code === '23505') {
    // Extract useful info from the detail string, e.g. 'Key (name)=(foo) already exists.'
    const field = error.detail?.match(/\(([^)]+)\)/)?.[1] ?? 'unknown';
    return c.json(
      {
        error: {
          code: 'CONFLICT',
          message: `A record with that ${field} already exists.`,
          details: {
            constraint: error.constraint,
            field,
          },
        },
      },
      409,
    );
  }

  // PostgreSQL foreign_key_violation
  if (error.code === '23503') {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Referenced record does not exist.',
          details: { constraint: error.constraint },
        },
      },
      400,
    );
  }

  return null;
}

/**
 * Handle unknown errors
 */
function handleUnknownError(c: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
      },
    },
    500,
  );
}

/**
 * Route error to appropriate handler
 * Note: Check specific error types BEFORE their parent types
 */
function routeError(c: Context, error: unknown): Response {
  if (error instanceof ZodError) {
    return handleZodError(c, error);
  }
  if (error instanceof HTTPException) {
    return handleHTTPException(c, error);
  }
  // Check specific OmniError subtypes BEFORE generic OmniError
  if (error instanceof NotFoundError) {
    return handleNotFoundError(c, error);
  }
  if (error instanceof ValidationError) {
    return handleValidationError(c, error);
  }
  if (error instanceof ConflictError) {
    return handleConflictError(c, error);
  }
  if (error instanceof OmniError) {
    return handleOmniError(c, error);
  }
  // Channel plugin errors (WhatsAppError, TelegramError, etc.) — duck-typed by code
  if (error instanceof Error && 'code' in error) {
    const channelResult = handleChannelError(c, error as Error & { code?: string; retryable?: boolean });
    if (channelResult) return channelResult;
  }
  // PostgreSQL errors (unique constraint, foreign key, etc.) — duck-typed by numeric code
  if (error instanceof Error && 'code' in error) {
    const dbResult = handleDatabaseError(c, error as Error & { code?: string; detail?: string; constraint?: string });
    if (dbResult) return dbResult;
  }
  return handleUnknownError(c, error);
}

/** PostgreSQL error codes that represent client mistakes (not server errors) */
const PG_CLIENT_ERROR_CODES = new Set(['23505', '23503']); // unique_violation, foreign_key_violation

/**
 * Check if a string error code maps to a client-side error.
 * Covers channel plugin codes and PostgreSQL constraint violations.
 */
function isCodeClientError(code: string): boolean {
  if (PG_CLIENT_ERROR_CODES.has(code)) return true;
  const mapped = Object.prototype.hasOwnProperty.call(CHANNEL_ERROR_MAP, code) ? CHANNEL_ERROR_MAP[code] : null;
  return mapped ? mapped.status < 500 : false;
}

/**
 * Determine if an error is a client error (4xx) vs server error (5xx)
 */
function isClientError(error: unknown): boolean {
  // Expected client errors - don't log as ERROR
  if (error instanceof ZodError) return true;
  if (error instanceof NotFoundError) return true;
  if (error instanceof ValidationError) return true;
  if (error instanceof ConflictError) return true;
  if (error instanceof HTTPException && error.status < 500) return true;
  if (error instanceof OmniError) {
    const status = ERROR_STATUS_MAP[error.code] ?? 500;
    return status < 500;
  }
  // Duck-typed errors with a string code (channel plugins, PostgreSQL)
  if (error instanceof Error && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return isCodeClientError((error as { code: string }).code);
  }
  return false;
}

/**
 * Error handler for use with app.onError()
 * This is the recommended way to handle errors in Hono
 */
export const errorHandler: ErrorHandler<{ Variables: AppVariables }> = (error, c) => {
  const requestId = c.get('requestId') ?? 'unknown';

  if (isClientError(error)) {
    // Client errors (4xx) - log at debug level, no stack trace
    log.debug('Client error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  } else {
    // Server errors (5xx) - log at error level with stack trace
    log.error('Server error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  return routeError(c, error);
};

/**
 * Legacy middleware export for backwards compatibility
 * @deprecated Use errorHandler with app.onError() instead
 */
export const errorMiddleware = errorHandler;
