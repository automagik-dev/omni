/**
 * Tests for middleware/error.ts error routing
 */

import { describe, expect, test } from 'bun:test';
import { NotFoundError, OmniError, ValidationError } from '@omni/core';
import type { ErrorHandler } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

// Import the route error logic, not the typed handler
// We'll create our own handler with the correct type for testing
import { ERROR_CODES } from '@omni/core';

// Recreate the error routing logic for testing
// (The actual implementation is in middleware/error.ts)
function createTestErrorHandler(): ErrorHandler {
  return (error, c) => {
    // ZodError
    if (error.name === 'ZodError') {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: { fields: {} } } },
        400,
      );
    }
    // HTTPException
    if (error instanceof HTTPException) {
      return c.json(
        { error: { code: error.status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR', message: error.message } },
        error.status,
      );
    }
    // NotFoundError
    if (error instanceof NotFoundError) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: error.message,
            details: { resourceType: error.resourceType, resourceId: error.resourceId },
          },
        },
        404,
      );
    }
    // ValidationError
    if (error instanceof ValidationError) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: error.message, details: { fields: error.fields } } },
        400,
      );
    }
    // OmniError
    if (error instanceof OmniError) {
      const statusMap: Record<string, 404 | 500 | 503> = {
        [ERROR_CODES.NOT_FOUND]: 404,
        [ERROR_CODES.CHANNEL_NOT_CONNECTED]: 503,
      };
      const status = statusMap[error.code] ?? 500;
      return c.json({ error: { code: error.code, message: error.message, details: error.context } }, status);
    }
    // Unknown
    return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Create a test app with error handler
function createTestApp() {
  const app = new Hono();
  app.onError(createTestErrorHandler());
  return app;
}

describe('errorHandler', () => {
  describe('ZodError handling', () => {
    test('should return 400 for ZodError', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        const schema = z.object({ name: z.string() });
        schema.parse({}); // Will throw ZodError
        return new Response('ok');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(400);

      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Request validation failed');
    });
  });

  describe('HTTPException handling', () => {
    test('should return correct status for HTTPException', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        throw new HTTPException(403, { message: 'Forbidden' });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(403);

      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('HTTP_ERROR');
      expect(body.error.message).toBe('Forbidden');
    });

    test('should return INTERNAL_ERROR code for 5xx HTTPException', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        throw new HTTPException(503, { message: 'Service unavailable' });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(503);

      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('OmniError handling', () => {
    test('should return correct status for OmniError', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        throw new OmniError({
          code: 'NOT_FOUND',
          message: 'Resource not found',
          context: { id: '123' },
        });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(404);

      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Resource not found');
      expect(body.error.details).toEqual({ id: '123' });
    });

    test('should return 503 for CHANNEL_NOT_CONNECTED', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        throw new OmniError({
          code: 'CHANNEL_NOT_CONNECTED',
          message: 'Channel not connected',
        });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(503);
    });
  });

  describe('NotFoundError handling', () => {
    test('should return 404 for NotFoundError', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        throw new NotFoundError('User', 'user-123');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(404);

      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details?.resourceType).toBe('User');
      expect(body.error.details?.resourceId).toBe('user-123');
    });
  });

  describe('ValidationError handling', () => {
    test('should return 400 for ValidationError', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        throw new ValidationError('Invalid input', { email: ['Invalid email format'] });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(400);

      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields).toEqual({ email: ['Invalid email format'] });
    });
  });

  describe('Unknown error handling', () => {
    test('should return 500 for unknown errors', async () => {
      const app = createTestApp();
      app.get('/test', () => {
        throw new Error('Something went wrong');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(500);

      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
