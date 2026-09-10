/**
 * POST /api/v2/events/trigger — `causationId` boundary contract (#1072).
 *
 * Agent/CLI emissions mid-flow used to journal as roots because the trigger
 * body had no way to name a parent event. `causationId` is validated as a
 * UUID at the boundary and handed to the service exactly like `correlationId`.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { webhooksRoutes } from '../webhooks';

interface TriggerCall {
  eventType: string;
  metadata: { correlationId?: string; causationId?: string; instanceId?: string } | undefined;
}

function buildApp() {
  const triggered: TriggerCall[] = [];
  const services = {
    webhooks: {
      trigger: async (eventType: string, _payload: Record<string, unknown>, metadata?: TriggerCall['metadata']) => {
        triggered.push({ eventType, metadata });
        return { eventId: 'evt-1', published: true };
      },
    },
  } as unknown as AppVariables['services'];

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/api/v2', webhooksRoutes);
  return { app, triggered };
}

function trigger(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>) {
  return app.request('/api/v2/events/trigger', {
    method: 'POST',
    body: JSON.stringify({ eventType: 'custom.purchase.recorded', payload: {}, ...body }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/v2/events/trigger causationId (#1072)', () => {
  test('a UUID causationId reaches the service alongside correlationId', async () => {
    const { app, triggered } = buildApp();
    const causationId = crypto.randomUUID();

    const res = await trigger(app, { causationId, correlationId: 'flow-1' });

    expect(res.status).toBe(201);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.metadata?.causationId).toBe(causationId);
    expect(triggered[0]?.metadata?.correlationId).toBe('flow-1');
  });

  test('a non-UUID causationId is rejected at the boundary, nothing published', async () => {
    const { app, triggered } = buildApp();

    const res = await trigger(app, { causationId: 'not-an-event-id' });

    expect(res.status).toBe(400);
    expect(triggered).toHaveLength(0);
  });

  test('omitting causationId still triggers a root event', async () => {
    const { app, triggered } = buildApp();

    const res = await trigger(app, {});

    expect(res.status).toBe(201);
    expect(triggered[0]?.metadata?.causationId).toBeUndefined();
  });
});
