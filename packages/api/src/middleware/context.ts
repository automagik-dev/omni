/**
 * Context middleware - injects db, eventBus, channelRegistry, and services into context
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { createMiddleware } from 'hono/factory';
import { type Services, createServices } from '../services';
import type { AppVariables } from '../types';

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Context middleware result with services for external use
 */
export interface ContextMiddlewareResult {
  middleware: ReturnType<typeof createMiddleware<{ Variables: AppVariables }>>;
  services: Services;
}

/**
 * Create context middleware with database, event bus, and channel registry
 * Returns both the middleware and the services instance for scheduler setup
 */
export function createContextMiddleware(
  db: Database,
  eventBus: EventBus | null,
  channelRegistry: ChannelRegistry | null = null,
): ContextMiddlewareResult {
  // Create services once
  const services = createServices(db, eventBus);

  const middleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    // Set request ID
    const requestId = c.req.header('x-request-id') ?? generateRequestId();
    c.set('requestId', requestId);

    // Set database
    c.set('db', db);

    // Set event bus
    c.set('eventBus', eventBus);

    // Set channel registry
    c.set('channelRegistry', channelRegistry);

    // Set services
    c.set('services', services);

    // Add request ID to response headers
    c.res.headers.set('x-request-id', requestId);

    await next();
  });

  return { middleware, services };
}
