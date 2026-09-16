/**
 * #1211: historyIdentity/syncFullHistory are persisted on PATCH and returned by
 * GET, and PATCH rejects unknown fields (400 naming the key) instead of dropping them.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';

function mount() {
  const app = new Hono<{ Variables: AppVariables }>();
  let row: Record<string, unknown> = {
    id: INSTANCE_ID,
    name: 'i1211',
    channel: 'whatsapp-baileys',
    agentId: null,
    historyIdentity: 'desktop',
    syncFullHistory: false,
  };
  const update = mock(async (_id: string, data: Record<string, unknown>) => {
    row = { ...row, ...data };
    return row;
  });
  app.use('*', async (c, next) => {
    c.set('services', { instances: { getById: mock(async () => row), update } } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/instances', instancesRoutes);
  const patch = (body: unknown) =>
    app.request(`/instances/${INSTANCE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { app, update, patch };
}

describe('instance history identity (#1211)', () => {
  test('PATCH persists historyIdentity + syncFullHistory and GET returns them', async () => {
    const { app, patch, update } = mount();
    expect((await patch({ historyIdentity: 'web', syncFullHistory: true })).status).toBe(200);
    expect(update.mock.calls[0]?.[1]).toMatchObject({ historyIdentity: 'web', syncFullHistory: true });
    const body = (await (await app.request(`/instances/${INSTANCE_ID}`)).json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ historyIdentity: 'web', syncFullHistory: true });
  });

  test('PATCH rejects an invalid identity', async () => {
    const { patch, update } = mount();
    expect((await patch({ historyIdentity: 'linux' })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  test('PATCH with an unknown field is a 400 naming the field', async () => {
    const { patch, update } = mount();
    const res = await patch({ name: 'x', notARealField: 1 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('notARealField');
    expect(update).not.toHaveBeenCalled();
  });
});
