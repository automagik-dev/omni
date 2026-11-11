import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '88888888-8888-4888-8888-888888888888';
const STORED_TOKEN = 'stored-api-token';
const GENERIC_TOKEN = 'generic-body-token';
const ZENVIA_TOKEN = 'zenvia-body-token';

interface Captured {
  connectOptions?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

function mount(captured: Captured) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'zv-connect-token',
    channel: 'zenvia',
    zenviaApiToken: STORED_TOKEN,
    zenviaSenderId: '551140000000',
  };

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async () => instance),
        update: mock(async (_id: string, data: Record<string, unknown>) => {
          captured.updated = data;
          return { ...instance, ...data };
        }),
        updateStatus: mock(async () => instance),
      },
    } as never);

    c.set('channelRegistry', {
      get: () => ({
        id: instance.channel,
        capabilities: {},
        connect: mock(async (_id: string, config: Record<string, unknown>) => {
          captured.connectOptions = config.options as Record<string, unknown>;
        }),
        disconnect: mock(async () => {}),
        getStatus: mock(async () => ({ state: 'connected' })),
      }),
    } as never);

    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);

    await next();
  });

  app.route('/', instancesRoutes);
  return app;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /instances/:id/connect - zenvia generic token', () => {
  test('a generic token reaches the plugin and is persisted instead of the stored one', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ token: GENERIC_TOKEN }));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaApiToken).toBe(GENERIC_TOKEN);
    expect(captured.updated?.zenviaApiToken).toBe(GENERIC_TOKEN);
  });

  test('zenviaApiToken wins over the generic token', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(
      `/${INSTANCE_ID}/connect`,
      post({ token: GENERIC_TOKEN, zenviaApiToken: ZENVIA_TOKEN }),
    );

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaApiToken).toBe(ZENVIA_TOKEN);
    expect(captured.updated?.zenviaApiToken).toBe(ZENVIA_TOKEN);
  });

  test('without any token in the body the stored token is kept', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ zenviaSenderId: '551140000001' }));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaApiToken).toBe(STORED_TOKEN);
    expect(captured.updated?.zenviaApiToken).toBe(STORED_TOKEN);
  });
});
