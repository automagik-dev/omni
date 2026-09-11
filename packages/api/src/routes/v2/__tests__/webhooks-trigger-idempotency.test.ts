/**
 * POST /api/v2/events/trigger — `idempotencyKey` boundary contract (#1109).
 *
 * Custom events had no ingress key, so every producer reimplemented dedup
 * outside the journal. The key rides the same path as `causationId` (CLI flag
 * → SDK → OpenAPI/Zod → route → service claim) and the dedup verdict rides
 * back out in the response.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { webhooksRoutes } from '../webhooks';

interface TriggerCall {
  eventType: string;
  metadata: { instanceId?: string; idempotencyKey?: string } | undefined;
}

/** Services fake whose trigger dedupes on the key it is handed, like the real one. */
function buildApp() {
  const triggered: TriggerCall[] = [];
  const seen = new Map<string, string>();
  const services = {
    webhooks: {
      trigger: async (eventType: string, _payload: Record<string, unknown>, metadata?: TriggerCall['metadata']) => {
        triggered.push({ eventType, metadata });
        const key = metadata?.idempotencyKey;
        if (!key) return { eventId: crypto.randomUUID(), published: true };
        const existing = seen.get(key);
        if (existing) return { eventId: existing, published: false, duplicate: true };
        const eventId = crypto.randomUUID();
        seen.set(key, eventId);
        return { eventId, published: true, duplicate: false };
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
    body: JSON.stringify({ eventType: 'custom.connector.window', payload: { items: 3 }, ...body }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/v2/events/trigger idempotencyKey (#1109)', () => {
  test('the key reaches the service and the replay answers with the same id, flagged', async () => {
    const { app, triggered } = buildApp();

    const first = await trigger(app, { idempotencyKey: 'window-1' });
    const second = await trigger(app, { idempotencyKey: 'window-1' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(triggered[0]?.metadata?.idempotencyKey).toBe('window-1');

    const firstBody = (await first.json()) as { eventId: string; duplicate?: boolean };
    const secondBody = (await second.json()) as { eventId: string; duplicate?: boolean };
    expect(firstBody.duplicate).toBe(false);
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.eventId).toBe(firstBody.eventId);
  });

  test('omitting the key keeps the undeduped behaviour', async () => {
    const { app, triggered } = buildApp();

    const first = await trigger(app, {});
    const second = await trigger(app, {});

    expect(triggered[0]?.metadata?.idempotencyKey).toBeUndefined();
    const firstBody = (await first.json()) as { eventId: string; duplicate?: boolean };
    const secondBody = (await second.json()) as { eventId: string; duplicate?: boolean };
    expect(secondBody.eventId).not.toBe(firstBody.eventId);
    expect(secondBody.duplicate).toBeUndefined();
  });

  test('an empty key is rejected at the boundary, nothing triggered', async () => {
    const { app, triggered } = buildApp();

    const res = await trigger(app, { idempotencyKey: '' });

    expect(res.status).toBe(400);
    expect(triggered).toHaveLength(0);
  });
});
