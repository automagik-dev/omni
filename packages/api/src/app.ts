/**
 * Hono application setup
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

import { authMiddleware } from './middleware/auth';
import { createContextMiddleware } from './middleware/context';
import { errorHandler } from './middleware/error';
import { rateLimitMiddleware } from './middleware/rate-limit';
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
  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: '*', // TODO: Configure for production
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
