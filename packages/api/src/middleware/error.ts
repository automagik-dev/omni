/**
 * Error handling middleware and onError handler
 */

import { ERROR_CODES, NotFoundError, OmniError, ValidationError, createLogger } from '@omni/core';
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
  if (error instanceof OmniError) {
    return handleOmniError(c, error);
  }
  return handleUnknownError(c, error);
}

/**
 * Error handler for use with app.onError()
 * This is the recommended way to handle errors in Hono
 */
export const errorHandler: ErrorHandler<{ Variables: AppVariables }> = (error, c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  log.error('Request error', {
    requestId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return routeError(c, error);
};

/**
 * Legacy middleware export for backwards compatibility
 * @deprecated Use errorHandler with app.onError() instead
 */
export const errorMiddleware = errorHandler;
