/**
 * Error handling middleware and onError handler
 */

import { ConflictError, ERROR_CODES, NotFoundError, OmniError, ValidationError, createLogger } from '@omni/core';
import * as Sentry from '@sentry/bun';
import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ApiErrorResponse, AppVariables } from '../types';

const log = createLogger('api:error');

/**
 * Fields that must never appear in HTTP responses.
 * Matched case-insensitively against context keys.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'credential',
  'credentials',
  'authorization',
  'cookie',
  'session',
  'connectionstring',
  'dsn',
  'apikey',
  'privatekey',
  'accesstoken',
  'refreshtoken',
]);

/**
 * Sanitize error context before including it in HTTP responses.
 * Strips sensitive fields (tokens, credentials, connection strings, etc.)
 * while preserving safe debugging info for API consumers.
 *
 * Full unsanitized context remains in server logs and Sentry.
 */
function sanitizeErrorContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    // Strip stack traces that may leak file paths
    if (key === 'stack' || key === 'stackTrace') continue;
    sanitized[key] = value;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Map error codes to HTTP status codes
 */
const ERROR_STATUS_MAP: Record<string, 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504> = {
  [ERROR_CODES.VALIDATION]: 400,
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.CHANNEL_NOT_CONNECTED]: 503,
  [ERROR_CODES.CHANNEL_CONNECTION_FAILED]: 503,
  [ERROR_CODES.CHANNEL_SEND_FAILED]: 502,
  [ERROR_CODES.CHANNEL_TIMEOUT]: 504,
  [ERROR_CODES.CHANNEL_RATE_LIMITED]: 429,
  [ERROR_CODES.CHANNEL_AUTH_FAILED]: 401,
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
      details: sanitizeErrorContext(error.context),
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
          ...sanitizeErrorContext(error.context),
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
const CHANNEL_ERROR_MAP: Record<string, { status: 400 | 401 | 403 | 429 | 502 | 503; message: string }> = {
  // WhatsApp
  WHATSAPP_NOT_CONNECTED: { status: 503, message: 'WhatsApp instance is disconnected. Re-scan QR code to reconnect.' },
  WHATSAPP_AUTH_FAILED: { status: 401, message: 'WhatsApp authentication failed. Re-scan QR code.' },
  WHATSAPP_RATE_LIMITED: { status: 429, message: 'WhatsApp rate limit reached. Try again later.' },
  WHATSAPP_INVALID_JID: { status: 400, message: 'Invalid WhatsApp JID format.' },
  WHATSAPP_INVALID_PHONE: { status: 400, message: 'Invalid phone number format.' },
  WHATSAPP_SEND_FAILED: { status: 502, message: 'Failed to send message via WhatsApp.' },
  WHATSAPP_MEDIA_UPLOAD_FAILED: { status: 502, message: 'Failed to upload media to WhatsApp.' },
  WHATSAPP_PAIRING_FAILED: { status: 503, message: 'WhatsApp pairing failed. Try scanning QR code again.' },
  WHATSAPP_UNKNOWN_ERROR: { status: 502, message: 'An unexpected WhatsApp error occurred.' },

  // Telegram
  TELEGRAM_NOT_CONNECTED: { status: 503, message: 'Telegram bot is disconnected.' },
  TELEGRAM_SEND_FAILED: { status: 502, message: 'Failed to send message via Telegram.' },
  TELEGRAM_AUTH_FAILED: { status: 401, message: 'Telegram bot token is invalid or revoked.' },
  TELEGRAM_RATE_LIMITED: { status: 429, message: 'Telegram rate limit reached. Try again later.' },
  TELEGRAM_BOT_BLOCKED: { status: 403, message: 'Telegram bot was blocked by the user.' },
  TELEGRAM_BOT_MISSING: { status: 503, message: 'Telegram bot not found for this instance.' },
  TELEGRAM_WEBHOOK_FAILED: { status: 502, message: 'Failed to configure Telegram webhook.' },
  TELEGRAM_UNKNOWN_ERROR: { status: 502, message: 'An unexpected Telegram error occurred.' },

  // Discord
  DISCORD_NOT_CONNECTED: { status: 503, message: 'Discord bot is disconnected.' },
  DISCORD_SEND_FAILED: { status: 502, message: 'Failed to send message via Discord.' },
  DISCORD_AUTH_FAILED: { status: 401, message: 'Discord authentication failed.' },
  DISCORD_RATE_LIMITED: { status: 429, message: 'Discord rate limit reached. Try again later.' },
  DISCORD_NOT_FOUND: { status: 400, message: 'Discord resource not found.' },
  DISCORD_MISSING_ACCESS: { status: 403, message: 'Discord bot lacks access to the requested resource.' },
  DISCORD_MISSING_PERMISSIONS: { status: 403, message: 'Discord bot lacks required permissions.' },
  DISCORD_INVALID_TOKEN: { status: 401, message: 'Discord bot token is invalid.' },
  DISCORD_UNKNOWN_ERROR: { status: 502, message: 'An unexpected Discord error occurred.' },

  // Slack
  SLACK_NOT_CONNECTED: { status: 503, message: 'Slack bot is disconnected.' },
  SLACK_SEND_FAILED: { status: 502, message: 'Failed to send message via Slack.' },
  SLACK_INVALID_TOKEN: { status: 401, message: 'Slack bot token is invalid or expired.' },
  SLACK_RATE_LIMITED: { status: 429, message: 'Slack rate limit reached. Try again later.' },
  SLACK_FILE_UPLOAD_FAILED: { status: 502, message: 'Failed to upload file to Slack.' },
  SLACK_FILE_DOWNLOAD_FAILED: { status: 502, message: 'Failed to download file from Slack.' },
  SLACK_CONNECTION_FAILED: { status: 503, message: 'Failed to connect to Slack.' },
  SLACK_DM_REJECTED: { status: 403, message: 'Slack DM was rejected by the recipient.' },
  SLACK_UNKNOWN_ERROR: { status: 502, message: 'An unexpected Slack error occurred.' },
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

    // Capture server errors to Sentry with rich context
    Sentry.withScope((scope) => {
      scope.setTag('request_id', requestId);
      scope.setTag('http.method', c.req.method);
      scope.setTag('http.url', c.req.path);

      const cliVersion = c.req.header('x-omni-cli-version');
      if (cliVersion) scope.setTag('cli_version', cliVersion);

      if (error instanceof OmniError) {
        scope.setTag('error.code', error.code);
        if (error.context) {
          scope.setExtra('error.context', error.context);
        }
      }

      Sentry.captureException(error);
    });
  }

  return routeError(c, error);
};
