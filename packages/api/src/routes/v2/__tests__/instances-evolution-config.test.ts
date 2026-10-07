import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';
const CONFIG = {
  baseUrl: 'https://evolution.example.com',
  instanceName: 'vendor',
  apiKey: 'api-key-123456789012345',
  webhookToken: 'webhook-token-1234567890123456789012345',
};
interface Captured {
  connectOptions?: Record<string, unknown>;
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

/** No services or database are started; verify route-to-plugin wiring. */
function mount(
  captured: Captured,
  instanceOverrides: Record<string, unknown> = {},
  beforeUpdate: () => Promise<void> = async () => {},
) {
  const app = new Hono<{ Variables: AppVariables }>();

  let instance = {
    id: INSTANCE_ID,
    name: 'evolution-test',
    channel: 'evolution-api',
    evolutionConfig: CONFIG,
    ...instanceOverrides,
  };

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async () => instance),
        create: mock(async (data: Record<string, unknown>) => {
          captured.created = data;
          return { ...instance, ...data };
        }),
        update: mock(async (_id: string, data: Record<string, unknown>) => {
          await beforeUpdate();
          captured.updated = data;
          instance = { ...instance, ...data };
          return instance;
        }),
        updateStatus: mock(async () => instance),
      },
    } as never);

    c.set('channelRegistry', {
      get: () => ({
        id: 'evolution-api',
        capabilities: {},
        connect: mock(async (_id: string, config: Record<string, unknown>) => {
          captured.connectOptions = config.options as Record<string, unknown>;
        }),
        disconnect: mock(async () => {}),
        getStatus: mock(async () => ({ state: 'connected' })),
      }),
    } as never);

    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);

    await next();
  });

  app.route('/', instancesRoutes);
  return app;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('Evolution instance configuration', () => {
  test('create persists config, forwards it to the plugin and hides it in response', async () => {
    const captured: Captured = {};
    const app = mount(captured);
    const res = await app.request(
      '/',
      json('POST', { name: 'evolution', channel: 'evolution-api', evolutionConfig: CONFIG }),
    );
    expect(res.status).toBe(201);
    expect(captured.created?.evolutionConfig).toEqual(CONFIG);
    expect(captured.connectOptions?.evolutionConfig).toEqual(CONFIG);
    expect(((await res.json()) as { data: Record<string, unknown> }).data).not.toHaveProperty('evolutionConfig');
  });
  test('missing configuration and wrong channel reject before writing', async () => {
    const captured: Captured = {};
    const app = mount(captured);
    expect((await app.request('/', json('POST', { name: 'e', channel: 'evolution-api' }))).status).toBe(400);
    expect(
      (await app.request('/', json('POST', { name: 'e', channel: 'discord', evolutionConfig: CONFIG }))).status,
    ).toBe(400);
    expect(captured.created).toBeUndefined();
  });
  test('connect, credential rotation and restart use persisted config', async () => {
    const captured: Captured = {};
    const app = mount(captured);
    expect((await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}))).status).toBe(200);
    expect(captured.connectOptions?.evolutionConfig).toEqual(CONFIG);
    const rotated = { ...CONFIG, apiKey: 'rotated-api-key-1234567890' };
    expect((await app.request(`/${INSTANCE_ID}/connect`, json('POST', { evolutionConfig: rotated }))).status).toBe(200);
    expect(captured.updated?.evolutionConfig).toEqual(rotated);
    expect(captured.connectOptions?.evolutionConfig).toEqual(rotated);
    expect((await app.request(`/${INSTANCE_ID}/restart`, json('POST'))).status).toBe(200);
    expect(captured.connectOptions?.evolutionConfig).toEqual(rotated);
  });
  test('PATCH cannot remove mandatory config or assign it to other channels', async () => {
    const captured: Captured = {};
    expect((await mount(captured).request(`/${INSTANCE_ID}`, json('PATCH', { evolutionConfig: null }))).status).toBe(
      400,
    );
    expect(
      (
        await mount(captured, { channel: 'discord', evolutionConfig: null }).request(
          `/${INSTANCE_ID}`,
          json('PATCH', { evolutionConfig: CONFIG }),
        )
      ).status,
    ).toBe(400);
    expect(captured.updated).toBeUndefined();
  });
});

test('a queued connect without credentials cannot restore the configuration read before a rotation', async () => {
  const captured: Captured = {};
  let entered = () => {};
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const app = mount(captured, {}, async () => {
    if (++writes === 1) {
      entered();
      await blocked;
    }
  });
  const rotated = { ...CONFIG, apiKey: 'rotated-api-key-1234567890' };
  const rotation = app.request(`/${INSTANCE_ID}/connect`, json('POST', { evolutionConfig: rotated }));
  await started;
  const reconnect = app.request(`/${INSTANCE_ID}/connect`, json('POST', {}));
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  const responses = await Promise.all([rotation, reconnect]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(captured.updated?.evolutionConfig).toEqual(rotated);
  expect(captured.connectOptions?.evolutionConfig).toEqual(rotated);
});
