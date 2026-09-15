/**
 * #1169 — GET /instances/:id/status for an instance that exists in the DB but
 * is not loaded by its plugin (inactive, e.g. after an API restart) must say
 * so instead of "Instance not found". Unknown ids still 404.
 */

import { describe, expect, test } from 'bun:test';
import { WhatsAppBusinessPlugin } from '@omni/channel-whatsapp-business';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';

function mount(exists: boolean) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: async (id: string) => {
          if (!exists) throw new NotFoundError('Instance', id);
          return { id, channel: 'whatsapp-business', isActive: false };
        },
      },
    } as never);
    // Real base-plugin getStatus with nothing loaded — the post-restart state.
    c.set('channelRegistry', { get: () => new WhatsAppBusinessPlugin() } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/', instancesRoutes);
  return app;
}

describe('GET /instances/:id/status (#1169)', () => {
  test('existing but unloaded instance reports inactive, not "not found"', async () => {
    const res = await mount(true).request(`/${INSTANCE_ID}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { state: string; message: string } };
    expect(body.data.state).toBe('disconnected');
    expect(body.data.message).toBe('Instance inactive (not connected)');
  });

  test('unknown id still 404s', async () => {
    const res = await mount(false).request(`/${INSTANCE_ID}/status`);
    expect(res.status).toBe(404);
  });
});
