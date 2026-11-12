/**
 * POST /automations/:id/test with `eventId` (#1073): the route loads the REAL
 * journaled row, shapes it like the engine would have seen it (rawPayload as
 * payload, envelope metadata merged for conditions), and returns the dry run.
 */

import { describe, expect, mock, test } from 'bun:test';
import { CONDITION_OPERATORS, NotFoundError } from '@omni/core';
import type { Automation, Database, OmniEvent } from '@omni/db';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import { AutomationService } from '../../../services/automations';
import type { AppVariables } from '../../../types';
import { automationsRoutes } from '../automations';

const AUTOMATION_ID = '66666666-6666-4666-8666-666666666666';
const EVENT_ID = '77777777-7777-4777-8777-777777777777';
const INSTANCE_ID = '88888888-8888-4888-8888-888888888888';

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

function buildApp({ automation = row, event = {} }: { automation?: Automation; event?: Partial<OmniEvent> } = {}) {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([automation]) }) }) }),
  } as unknown as Database;
  const getById = mock(async (id: string) => {
    if (id !== EVENT_ID) throw new NotFoundError('Event', id);
    return {
      id: EVENT_ID,
      eventType: 'custom.webhook.github',
      channel: 'internal',
      rawPayload: { action: 'opened' },
      metadata: { correlationId: 'corr-9' },
      receivedAt: new Date(0),
      ...event,
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

  test('message eventId dry run matches instance and envelope conditions from journal columns', async () => {
    const envelope = {
      instanceId: INSTANCE_ID,
      channelType: 'whatsapp-baileys',
      personId: '11111111-1111-4111-8111-111111111111',
      platformIdentityId: '22222222-2222-4222-8222-222222222222',
      agentId: '33333333-3333-4333-8333-333333333333',
      producingKeyId: '44444444-4444-4444-8444-444444444444',
      causationId: '55555555-5555-4555-8555-555555555555',
      tenantId: '99999999-9999-4999-8999-999999999999',
    };
    const { channelType, ...columns } = envelope;
    const { app } = buildApp({
      automation: {
        ...row,
        triggerEventType: 'message.received',
        triggerConditions: [
          ...Object.entries(envelope).map(([field, value]) => ({ field, operator: 'eq' as const, value })),
          { field: 'content.text', operator: 'regex', value: 'code: [0-9]+' },
        ],
        actions: [
          {
            type: 'log',
            config: { level: 'info', message: '{{event.metadata.instanceId}} {{event.metadata.correlationId}}' },
          },
        ],
      },
      event: {
        ...columns,
        channel: channelType as OmniEvent['channel'],
        eventType: 'message.received',
        contentType: 'text',
        textContent: 'Sign-in code: 123456',
        rawPayload: { key: { fromMe: false } },
        metadata: { correlationId: 'corr-message', from: 'person', instanceId: 'stale', channelType: 'stale' },
      },
    });
    const res = await post(app, `/automations/${AUTOMATION_ID}/test`, { eventId: EVENT_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ matched: true, eventId: EVENT_ID, dryRun: true });
    expect(
      body.conditions.every(
        (condition: { resolved: boolean; matched: boolean }) => condition.resolved && condition.matched,
      ),
    ).toBe(true);
    expect(body.actions[0].config.message).toBe(`${INSTANCE_ID} corr-message`);
  });

  test('message eventId dry run does not match another instance', async () => {
    const { app } = buildApp({
      automation: {
        ...row,
        triggerEventType: 'message.received',
        triggerConditions: [{ field: 'instanceId', operator: 'eq', value: '00000000-0000-4000-8000-000000000000' }],
      },
      event: {
        eventType: 'message.received',
        channel: 'whatsapp-baileys',
        instanceId: INSTANCE_ID,
        rawPayload: {},
        metadata: { correlationId: 'corr-message', from: 'person' },
      },
    });
    const res = await post(app, `/automations/${AUTOMATION_ID}/test`, { eventId: EVENT_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ matched: false, eventId: EVENT_ID, dryRun: true });
    expect(body.conditions[0]).toMatchObject({ actual: INSTANCE_ID, resolved: true, matched: false });
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

describe('POST /automations condition operator validation (#1119)', () => {
  test('invalid operator returns VALIDATION_ERROR listing CONDITION_OPERATORS', async () => {
    const { app } = buildApp();
    const res = await post(app, '/automations', {
      name: 'x',
      triggerEventType: 'message.received',
      triggerConditions: [{ field: 'chatId', operator: 'equals', value: 'x' }],
      actions: [{ type: 'log', config: { level: 'info', message: 'hi' } }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain(
      `triggerConditions.0.operator: Invalid operator. Expected one of: ${CONDITION_OPERATORS.join(', ')}`,
    );
  });
});
