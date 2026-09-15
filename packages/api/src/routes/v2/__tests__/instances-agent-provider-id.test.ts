/**
 * #1168: instances link to a provider only through their agent. Responses must
 * surface the agent's provider id, and PATCH must reject agentProviderId rather
 * than silently stripping it.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';

function mount() {
  const app = new Hono<{ Variables: AppVariables }>();
  const instance = { id: INSTANCE_ID, name: 'i1168', channel: 'telegram', agentId: AGENT_ID };
  const update = mock(async (_id: string, data: Record<string, unknown>) => ({ ...instance, ...data }));

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async () => instance),
        list: mock(async () => ({ items: [instance], hasMore: false, cursor: null })),
        update,
      },
      agents: { getById: mock(async () => ({ id: AGENT_ID, agentProviderId: PROVIDER_ID })) },
    } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/instances', instancesRoutes);
  return { app, update };
}

describe('instance agentProviderId (#1168)', () => {
  test('GET /:id carries the agent provider id', async () => {
    const { app } = mount();
    const body = (await (await app.request(`/instances/${INSTANCE_ID}`)).json()) as { data: Record<string, unknown> };
    expect(body.data.agentProviderId).toBe(PROVIDER_ID);
  });

  test('GET / carries the agent provider id', async () => {
    const { app } = mount();
    const body = (await (await app.request('/instances')).json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]?.agentProviderId).toBe(PROVIDER_ID);
  });

  test('PATCH with agentProviderId is rejected and nothing is persisted', async () => {
    const { app, update } = mount();
    const res = await app.request(`/instances/${INSTANCE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentProviderId: PROVIDER_ID }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('omni agents update');
    expect(update).not.toHaveBeenCalled();
  });
});
