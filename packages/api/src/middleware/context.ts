/**
 * Context middleware - injects db, eventBus, and services into context
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { createMiddleware } from 'hono/factory';
import { createServices } from '../services';
import type { AppVariables } from '../types';

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create context middleware with database and optional event bus
 */
export function createContextMiddleware(db: Database, eventBus: EventBus | null) {
  // Create services once
  const services = createServices(db, eventBus);

  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    // Set request ID
    const requestId = c.req.header('x-request-id') ?? generateRequestId();
    c.set('requestId', requestId);

    // Set database
    c.set('db', db);

    // Set event bus
    c.set('eventBus', eventBus);

    // Set services
    c.set('services', services);

    // Add request ID to response headers
    c.res.headers.set('x-request-id', requestId);

    await next();
  });
}
