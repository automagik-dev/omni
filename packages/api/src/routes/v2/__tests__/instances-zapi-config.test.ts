import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

const CONFIG = {
  driver: 'web' as const,
  instanceId: 'vendor-instance',
  instanceToken: 'instance-token-12345',
  clientToken: 'client-token-12345',
  webhookToken: 'webhook-token-12345678901234567890',
};
const OFFICIAL = {
  driver: 'omni' as const,
  channelId: 'official',
  secretKey: 'official-secret-12345',
  signingSecret: 'signing-secret-12345',
};

interface Captured {
  connectOptions?: Record<string, unknown>;
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

/** No services or database are started; verify route-to-plugin wiring. */
function mount(captured: Captured, instanceOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'zapi-test',
    channel: 'zapi-web',
    zapiConfig: CONFIG,
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
          captured.updated = data;
          return { ...instance, ...data };
        }),
        updateStatus: mock(async () => instance),
      },
    } as never);

    c.set('channelRegistry', {
      get: () => ({
        id: 'zapi-web',
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

describe('Z-API instance configuration', () => {
  for (const channel of ['zapi-web', 'zapi-omni'] as const) {
    test(`${channel}: create persists configuration and hides secrets in response`, async () => {
      const config = channel === 'zapi-web' ? CONFIG : OFFICIAL;
      const captured: Captured = {};
      const app = mount(captured, { channel, zapiConfig: config });
      const res = await app.request('/', json('POST', { name: 'zapi-test', channel, zapiConfig: config }));
      expect(res.status).toBe(201);
      expect(captured.created?.zapiConfig).toEqual(config);
      expect(captured.connectOptions?.zapiConfig).toEqual(config);
      expect(((await res.json()) as { data: Record<string, unknown> }).data).not.toHaveProperty('zapiConfig');
    });
  }
  test('missing, wrong driver, unexpected fields and malformed secrets reject before write', async () => {
    const captured: Captured = {};
    const app = mount(captured);
    for (const zapiConfig of [
      undefined,
      OFFICIAL,
      { ...CONFIG, instanceToken: 'short' },
      { ...CONFIG, server: 'https://bad.example' },
    ]) {
      const res = await app.request('/', json('POST', { name: 'zapi-test', channel: 'zapi-web', zapiConfig }));
      expect(res.status).toBe(400);
    }
    expect(captured.created).toBeUndefined();
    expect(captured.connectOptions).toBeUndefined();
  });
  test('connect, rotation and restart use persisted credentials', async () => {
    const captured: Captured = {};
    const app = mount(captured);
    expect((await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}))).status).toBe(200);
    expect(captured.connectOptions?.zapiConfig).toEqual(CONFIG);
    const rotated = { ...CONFIG, clientToken: 'rotated-client-token-12345' };
    expect((await app.request(`/${INSTANCE_ID}/connect`, json('POST', { zapiConfig: rotated }))).status).toBe(200);
    expect(captured.updated?.zapiConfig).toEqual(rotated);
    expect(captured.connectOptions?.zapiConfig).toEqual(rotated);
    expect((await app.request(`/${INSTANCE_ID}/restart`, json('POST'))).status).toBe(200);
    expect(captured.connectOptions?.zapiConfig).toEqual(CONFIG);
  });
  test('update and connect reject mismatched credentials before plugin calls', async () => {
    const captured: Captured = {};
    const app = mount(captured);
    expect((await app.request(`/${INSTANCE_ID}`, json('PATCH', { zapiConfig: OFFICIAL }))).status).toBe(400);
    expect((await app.request(`/${INSTANCE_ID}/connect`, json('POST', { zapiConfig: OFFICIAL }))).status).toBe(400);
    expect(captured.updated).toBeUndefined();
    expect(captured.connectOptions).toBeUndefined();
  });
});
