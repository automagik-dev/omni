/**
 * Hono application setup
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import { type EventBus, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

const httpLog = createLogger('http');

/**
 * Get allowed CORS origins from environment
 * OMNI_CORS_ORIGINS can be comma-separated list or '*' for development
 */
function getAllowedOrigins(): string[] | '*' {
  const envOrigins = process.env.OMNI_CORS_ORIGINS;

  // If not set, default to restrictive (localhost only in dev)
  if (!envOrigins) {
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      return ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];
    }
    // Production: require explicit configuration
    return [];
  }

  // Allow wildcard for development
  if (envOrigins === '*') {
    return '*';
  }

  // Parse comma-separated origins
  return envOrigins.split(',').map((origin) => origin.trim());
}

import { authMiddleware } from './middleware/auth';
import { defaultBodyLimitMiddleware } from './middleware/body-limit';
import { gzipMiddleware } from './middleware/compression';
import { createContextMiddleware } from './middleware/context';
import { errorHandler } from './middleware/error';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { defaultTimeoutMiddleware } from './middleware/timeout';
import { healthRoutes } from './routes/health';
import { openapiRoutes } from './routes/openapi';
import { v2Routes } from './routes/v2';
import type { Services } from './services';
import type { AppVariables } from './types';

/**
 * Create app result with app and services
 */
export interface CreateAppResult {
  app: Hono<{ Variables: AppVariables }>;
  services: Services;
}

/**
 * Create the Hono application
 */
export function createApp(
  db: Database,
  eventBus: EventBus | null = null,
  channelRegistry: ChannelRegistry | null = null,
): CreateAppResult {
  const app = new Hono<{ Variables: AppVariables }>();

  // Create context middleware and get services
  const { middleware: contextMiddleware, services } = createContextMiddleware(db, eventBus, channelRegistry);

  // Global middleware
  app.use('*', timing());

  // Request safety: timeout and body size limits
  app.use('*', defaultTimeoutMiddleware);
  app.use('*', defaultBodyLimitMiddleware);

  // HTTP logging
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    httpLog.info(`→ ${c.req.method} ${c.req.path}`, { status: c.res.status, ms });
  });

  // Response compression (gzip)
  app.use('*', gzipMiddleware);
  // Configure CORS with allowed origins
  const allowedOrigins = getAllowedOrigins();
  app.use(
    '*',
    cors({
      origin: allowedOrigins === '*' ? '*' : allowedOrigins,
      allowHeaders: ['Content-Type', 'x-api-key', 'x-request-id'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['x-request-id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      maxAge: 86400,
    }),
  );
  app.use('*', secureHeaders());
  app.use('*', contextMiddleware);

  // Error handler - must be registered with onError, not as middleware
  app.onError(errorHandler);

  // Health routes (no auth required)
  app.route('/api/v2', healthRoutes);

  // OpenAPI spec and Swagger UI (no auth required)
  app.route('/api/v2', openapiRoutes);

  // Protected routes
  const protectedApp = new Hono<{ Variables: AppVariables }>();
  protectedApp.use('*', authMiddleware);
  protectedApp.use('*', rateLimitMiddleware);

  // Mount v2 routes
  protectedApp.route('/', v2Routes);

  app.route('/api/v2', protectedApp);

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Endpoint not found: ${c.req.method} ${c.req.path}`,
        },
      },
      404,
    );
  });

  return { app, services };
}

export type App = Hono<{ Variables: AppVariables }>;
