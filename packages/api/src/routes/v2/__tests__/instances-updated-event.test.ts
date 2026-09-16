/**
 * PATCH /instances/:id publishes `instance.updated` with the changed key names
 * (omni#1220) through the real InstanceService, and publishes nothing when the
 * update fails.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { InstanceService } from '../../../services/instances';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '55555555-5555-4555-8555-555555555555';

function mount(returning: unknown[]) {
  const publish = mock(async (_type: string, _payload: unknown) => ({}) as never);
  const db = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => returning }) }) }),
  };
  const service = new InstanceService(db as never, { publish } as never);

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', { instances: service } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/', instancesRoutes);
  app.onError((err, c) => c.json({ error: err.message }, 404));
  return { app, publish };
}

const patch = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('PATCH /instances/:id — instance.updated event', () => {
  test('publishes the changed keys, never values', async () => {
    const row = { id: INSTANCE_ID, name: 'renamed', channel: 'gupshup', closeContactConfig: null };
    const { app, publish } = mount([row]);

    const res = await app.request(`/${INSTANCE_ID}`, patch({ name: 'renamed', closeContactConfig: null }));

    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledTimes(1);
    const [type, payload] = publish.mock.calls[0] ?? [];
    expect(type).toBe('instance.updated');
    expect(payload).toEqual({
      instanceId: INSTANCE_ID,
      channelType: 'gupshup',
      changedKeys: expect.arrayContaining(['name', 'closeContactConfig']),
    });
  });

  test('does not publish when the update fails', async () => {
    const { app, publish } = mount([]);

    const res = await app.request(`/${INSTANCE_ID}`, patch({ name: 'renamed' }));

    expect(res.status).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });
});
