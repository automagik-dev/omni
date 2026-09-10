/**
 * POST /automations/:id/test with `eventId` (#1073): the route loads the REAL
 * journaled row, shapes it like the engine would have seen it (rawPayload as
 * payload, envelope metadata merged for conditions), and returns the dry run.
 */

import { describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import type { Automation, Database } from '@omni/db';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import { AutomationService } from '../../../services/automations';
import type { AppVariables } from '../../../types';
import { automationsRoutes } from '../automations';

const AUTOMATION_ID = '66666666-6666-4666-8666-666666666666';
const EVENT_ID = '77777777-7777-4777-8777-777777777777';

const row = {
  id: AUTOMATION_ID,
  tenantId: null,
  name: 'gh',
  triggerEventType: 'custom.webhook.github',
  triggerConditions: [{ field: 'action', operator: 'eq', value: 'opened' }],
  conditionLogic: 'and',
  actions: [{ type: 'log', config: { level: 'info', message: '{{payload.action}} {{event.metadata.correlationId}}' } }],
  enabled: true,
  managedByAgentId: null,
} as unknown as Automation;

function buildApp() {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([row]) }) }) }),
  } as unknown as Database;
  const getById = mock(async (id: string) => {
    if (id !== EVENT_ID) throw new NotFoundError('Event', id);
    return {
      id: EVENT_ID,
      eventType: 'custom.webhook.github',
      rawPayload: { action: 'opened' },
      metadata: { correlationId: 'corr-9' },
      receivedAt: new Date(0),
    };
  });
  const services = {
    automations: new AutomationService(db, null),
    events: { getById },
  } as unknown as AppVariables['services'];
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/automations', automationsRoutes);
  return { app, getById };
}

async function post(app: Hono<{ Variables: AppVariables }>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /automations/:id/test with eventId (#1073)', () => {
  test('dry-runs against the journaled row', async () => {
    const { app, getById } = buildApp();
    const res = await post(app, `/automations/${AUTOMATION_ID}/test`, { eventId: EVENT_ID });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matched: boolean;
      eventId: string;
      actions: Array<{ config: { message: string } }>;
    };
    expect(getById).toHaveBeenCalledWith(EVENT_ID);
    expect(body.matched).toBe(true);
    expect(body.eventId).toBe(EVENT_ID);
    expect(body.actions[0]?.config.message).toBe('opened corr-9');
  });

  test('unknown event id → 404', async () => {
    const { app } = buildApp();
    const res = await post(app, `/automations/${AUTOMATION_ID}/test`, {
      eventId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
  });

  test('event and eventId are mutually exclusive and one is required', async () => {
    const { app } = buildApp();
    expect((await post(app, `/automations/${AUTOMATION_ID}/test`, {})).status).toBe(400);
    expect(
      (
        await post(app, `/automations/${AUTOMATION_ID}/test`, {
          eventId: EVENT_ID,
          event: { type: 'x', payload: {} },
        })
      ).status,
    ).toBe(400);
  });

  test('inline event still works', async () => {
    const { app } = buildApp();
    const res = await post(app, `/automations/${AUTOMATION_ID}/test`, {
      event: { type: 'custom.webhook.github', payload: { action: 'closed' } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matched: boolean; conditions: Array<{ actual: unknown }> };
    expect(body.matched).toBe(false);
    expect(body.conditions[0]?.actual).toBe('closed');
  });
});
