/**
 * Event schema registry routes (issue #959).
 *
 * Route-level contract with a mocked service, mounted in the PRODUCTION
 * order (registry at root before /events): eventsRoutes carries a `/:id`
 * catch-all that must not swallow `/events/schemas`.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { eventSchemasRoutes } from '../event-schemas';
import { eventsRoutes } from '../events';

interface RegisteredCall {
  eventType: string;
  schema: Record<string, unknown>;
  description?: string;
  enabled?: boolean;
}

function buildApp() {
  const registered: RegisteredCall[] = [];
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    eventType: 'custom.github.push',
    version: 1,
    schema: { type: 'object' },
    description: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: null,
  };

  const services = {
    eventSchemas: {
      list: async () => [row],
      getByTypeOrThrow: async (eventType: string) => ({ ...row, eventType }),
      register: async (input: RegisteredCall) => {
        registered.push(input);
        return { ...row, eventType: input.eventType, schema: input.schema };
      },
    },
    // The events catch-all must never be reached by /events/schemas paths.
    events: new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('eventsRoutes service must not be touched by /events/schemas requests');
        },
      },
    ),
  } as unknown as AppVariables['services'];

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  // Production mount order (routes/v2/index.ts): registry first, then /events.
  app.route('/api/v2', eventSchemasRoutes);
  app.route('/api/v2/events', eventsRoutes);
  return { app, registered };
}

describe('event schema registry routes', () => {
  test('GET /events/schemas lists registrations (not swallowed by the /events/:id catch-all)', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v2/events/schemas');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: { eventType: string }[] };
    expect(json.items[0]?.eventType).toBe('custom.github.push');
  });

  test('GET /events/schemas/:eventType returns the stored artifact', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v2/events/schemas/custom.github.push');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { eventType: string; schema: Record<string, unknown> } };
    expect(json.data.eventType).toBe('custom.github.push');
    expect(json.data.schema).toEqual({ type: 'object' });
  });

  test('POST /events/schemas registers through the service', async () => {
    const { app, registered } = buildApp();
    const res = await app.request('/api/v2/events/schemas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventType: 'custom.github.push',
        schema: { type: 'object', required: ['ref'] },
        description: 'push contract',
      }),
    });
    expect(res.status).toBe(201);
    expect(registered.length).toBe(1);
    expect(registered[0]?.eventType).toBe('custom.github.push');
    expect(registered[0]?.schema).toEqual({ type: 'object', required: ['ref'] });
  });

  test('POST /events/schemas refuses a malformed event type at the boundary', async () => {
    const { app, registered } = buildApp();
    const res = await app.request('/api/v2/events/schemas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: 'Not A Type!', schema: { type: 'object' } }),
    });
    expect(res.status).toBe(400);
    expect(registered.length).toBe(0);
  });

  test('POST /events/schemas refuses a missing schema at the boundary', async () => {
    const { app, registered } = buildApp();
    const res = await app.request('/api/v2/events/schemas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: 'custom.github.push' }),
    });
    expect(res.status).toBe(400);
    expect(registered.length).toBe(0);
  });
});
