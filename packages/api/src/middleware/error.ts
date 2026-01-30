/**
 * Error handling middleware
 */

import { ERROR_CODES, NotFoundError, OmniError, ValidationError } from '@omni/core';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ApiErrorResponse, AppVariables } from '../types';

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
 * Error handling middleware
 */
export const errorMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  try {
    await next();
  } catch (error) {
    // Log the error
    const requestId = c.get('requestId') ?? 'unknown';
    console.error(`[${requestId}] Error:`, error);

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return c.json(formatZodError(error), 400);
    }

    // Handle Hono HTTP exceptions
    if (error instanceof HTTPException) {
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

    // Handle OmniError (our typed errors)
    if (error instanceof OmniError) {
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

    // Handle NotFoundError specifically
    if (error instanceof NotFoundError) {
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

    // Handle ValidationError specifically
    if (error instanceof ValidationError) {
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

    // Handle unknown errors
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
});
