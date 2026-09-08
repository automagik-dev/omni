/**
 * Managed-automation protection at the API boundary (RFC #925 G4b, #986).
 *
 * Automations with `managedByAgentId` set are the compiled plan of an agent's
 * event manifest. The normal automations API must REJECT manual mutation of
 * them (409 Conflict, message pointing at the owning agent's manifest) so the
 * compiled plan cannot drift silently — there is deliberately no force
 * override; the manifest is the only edit path. Hand-made rows (NULL marker)
 * keep full CRUD.
 *
 * Uses the REAL AutomationService over a mocked Database so the service-level
 * guard and its HTTP mapping (ConflictError → 409 via errorHandler) are both
 * exercised.
 */

import { describe, expect, test } from 'bun:test';
import { ValidationError } from '@omni/core';
import type { Automation, Database } from '@omni/db';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import { AutomationService } from '../../../services/automations';
import type { AppVariables } from '../../../types';
import { automationsRoutes } from '../automations';

const MANAGED_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_AGENT_ID = '11111111-1111-4111-8111-111111111111';

function managedAutomation(): Automation {
  return {
    id: MANAGED_ID,
    tenantId: null,
    name: `manifest:${OWNER_AGENT_ID}:message.received#abcdef123456`,
    description: 'compiled row',
    triggerEventType: 'message.received',
    triggerConditions: null,
    conditionLogic: 'and',
    actions: [{ type: 'call_agent', config: { agentId: OWNER_AGENT_ID } }],
    debounce: null,
    enabled: true,
    priority: 0,
    transactionalEmissions: false,
    managedByAgentId: OWNER_AGENT_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Automation;
}

/** Minimal Database double: getById's select chain resolves to the row. */
function mockDb(row: Automation): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([row]),
        }),
      }),
    }),
  } as unknown as Database;
}

function buildApp(row: Automation) {
  const services = { automations: new AutomationService(mockDb(row), null) } as unknown as AppVariables['services'];
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/automations', automationsRoutes);
  return app;
}

describe('managed automations refuse manual mutation (#986)', () => {
  test('PATCH /automations/:id → 409 pointing at the owning agent manifest', async () => {
    const res = await buildApp(managedAutomation()).request(`/automations/${MANAGED_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed by hand' }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain(OWNER_AGENT_ID);
    expect(body.error.message).toContain('manifest');
  });

  test('DELETE /automations/:id → 409 (no force override — edit the manifest)', async () => {
    const res = await buildApp(managedAutomation()).request(`/automations/${MANAGED_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
  });

  test('POST /automations/:id/disable → 409 (enable/disable is an update)', async () => {
    const res = await buildApp(managedAutomation()).request(`/automations/${MANAGED_ID}/disable`, { method: 'POST' });
    expect(res.status).toBe(409);
  });

  test('GET /automations/:id stays readable and exposes managedByAgentId', async () => {
    const res = await buildApp(managedAutomation()).request(`/automations/${MANAGED_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { managedByAgentId: string } };
    expect(body.data.managedByAgentId).toBe(OWNER_AGENT_ID);
  });

  test('hand-made rows (NULL marker) still update through the same path', async () => {
    const handMade = { ...managedAutomation(), managedByAgentId: null } as Automation;
    // The update chain is only reached when the guard passes.
    const db = {
      ...mockDb(handMade),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([{ ...handMade, name: 'renamed' }]),
          }),
        }),
      }),
    } as unknown as Database;

    const services = { automations: new AutomationService(db, null) } as unknown as AppVariables['services'];
    const app = new Hono<{ Variables: AppVariables }>();
    app.onError(errorHandler);
    app.use('*', async (c, next) => {
      c.set('services', services);
      await next();
    });
    app.route('/automations', automationsRoutes);

    const res = await app.request(`/automations/${MANAGED_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(res.status).toBe(200);
  });

  test('service-level create refuses caller-supplied provenance', () => {
    const service = new AutomationService(mockDb(managedAutomation()), null);
    expect(
      service.create({
        name: 'sneaky',
        triggerEventType: 'message.received',
        actions: [],
        managedByAgentId: OWNER_AGENT_ID,
      }),
    ).rejects.toThrow(ValidationError);
  });
});
