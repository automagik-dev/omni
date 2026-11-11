import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '99999999-9999-4999-8999-999999999999';
const PERSISTED_TOKEN = 'persisted-verify-token';
const ROTATED_TOKEN = 'rotated-verify-token';

interface Captured {
  connectOptions?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

function mount(captured: Captured, instanceOverrides: Record<string, unknown> = {}, connectError?: Error) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'zv-verify-token',
    channel: 'zenvia',
    zenviaApiToken: 'persisted-api-token',
    zenviaSenderId: '551140000000',
    webhookVerifyToken: PERSISTED_TOKEN,
    ...instanceOverrides,
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
          if (connectError) throw connectError;
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

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('POST /instances/:id/connect - zenvia webhookVerifyToken', () => {
  test('a token in the body reaches the plugin and is persisted, so it can be rotated', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ webhookVerifyToken: ROTATED_TOKEN }));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.webhookVerifyToken).toBe(ROTATED_TOKEN);
    expect(captured.updated?.webhookVerifyToken).toBe(ROTATED_TOKEN);
  });

  test('never echoes the token in the response', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ webhookVerifyToken: ROTATED_TOKEN }));

    const text = await res.text();
    expect(text).not.toContain(ROTATED_TOKEN);
    expect(text).not.toContain(PERSISTED_TOKEN);
  });

  test('keeps the persisted token, and writes nothing about it, when the body has none', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({}));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.webhookVerifyToken).toBe(PERSISTED_TOKEN);
    expect(captured.updated).not.toHaveProperty('webhookVerifyToken');
  });

  test('connects an instance that has no persisted token when the body supplies one', async () => {
    const captured: Captured = {};
    const app = mount(captured, { webhookVerifyToken: null });

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ webhookVerifyToken: ROTATED_TOKEN }));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.webhookVerifyToken).toBe(ROTATED_TOKEN);
    expect(captured.updated?.webhookVerifyToken).toBe(ROTATED_TOKEN);
  });

  test('rejects an empty token with a 400 before connecting', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ webhookVerifyToken: '' }));

    expect(res.status).toBe(400);
    expect(captured.connectOptions).toBeUndefined();
    expect(captured.updated).toBeUndefined();
  });

  test('persists nothing, and does not leak the token, when the connect fails', async () => {
    const captured: Captured = {};
    const app = mount(captured, {}, new Error('Zenvia API rejected the token'));

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ webhookVerifyToken: ROTATED_TOKEN }));

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(ROTATED_TOKEN);
    expect(captured.updated).toBeUndefined();
  });

  test('is ignored for a channel other than zenvia: the persisted token stays and nothing is written', async () => {
    const captured: Captured = {};
    const app = mount(captured, { channel: 'gupshup' });

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({ webhookVerifyToken: ROTATED_TOKEN }));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.webhookVerifyToken).toBe(PERSISTED_TOKEN);
    expect(captured.updated).not.toHaveProperty('webhookVerifyToken');
  });
});
