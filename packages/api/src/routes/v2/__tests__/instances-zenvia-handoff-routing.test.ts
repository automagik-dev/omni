import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { buildInstanceConnectOptions } from '../../../plugins/instance-monitor';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '88888888-8888-4888-8888-888888888888';

const ROUTING = { field: 'queue_field', groups: { 'queue-a': 'group-1', 'queue-b': 'group-2' } };

interface Captured {
  connectOptions?: Record<string, unknown>;
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

function mount(captured: Captured, instanceOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'zv-routing',
    channel: 'zenvia',
    zenviaApiToken: 'persisted-api-token',
    zenviaSenderId: '551140000000',
    zenviaSalesApiKey: 'persisted-sales-key',
    zenviaHandoffGroupId: 'group-default',
    webhookVerifyToken: 'persisted-verify-token',
    zenviaHandoffRouting: ROUTING,
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
        id: 'zenvia',
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

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createBody = {
  name: 'zv-routing',
  channel: 'zenvia',
  zenviaApiToken: 'persisted-api-token',
  zenviaSenderId: '551140000000',
  webhookVerifyToken: 'persisted-verify-token',
  zenviaSalesApiKey: 'persisted-sales-key',
  zenviaHandoffGroupId: 'group-default',
};

describe('POST /instances - zenviaHandoffRouting', () => {
  test('is persisted and handed to the plugin on the initial connect', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request('/', json('POST', { ...createBody, zenviaHandoffRouting: ROUTING }));

    expect(res.status).toBe(201);
    expect(captured.created?.zenviaHandoffRouting).toEqual(ROUTING);
    expect(captured.connectOptions?.zenviaHandoffRouting).toEqual(ROUTING);
    expect(captured.connectOptions?.zenviaHandoffGroupId).toBe('group-default');
  });

  test('rejects an invalid map before anything is written', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const bad = [
      { field: '', groups: { a: 'g' } },
      { groups: { a: 'g' } },
      { field: 'queue_field', groups: {} },
      { field: 'queue_field', groups: { a: 12 } },
      { field: 'queue_field', groups: { a: '' } },
      { field: 'queue_field', groups: { 'Queue A': 'g1', ' queue   a': 'g2' } },
      { field: 'queue_field', groups: { a: 'g' }, extra: true },
      'queue_field',
    ];
    for (const zenviaHandoffRouting of bad) {
      const res = await app.request('/', json('POST', { ...createBody, zenviaHandoffRouting }));
      expect(res.status).toBe(400);
    }
    expect(captured.created).toBeUndefined();
    expect(captured.connectOptions).toBeUndefined();
  });

  test('omits the key from the connect options when none is given', async () => {
    const captured: Captured = {};
    const app = mount(captured, { zenviaHandoffRouting: null });

    const res = await app.request('/', json('POST', createBody));

    expect(res.status).toBe(201);
    expect(captured.connectOptions).not.toHaveProperty('zenviaHandoffRouting');
  });
});

describe('PATCH /instances/:id - zenviaHandoffRouting', () => {
  test('is forwarded to the update untouched', async () => {
    const captured: Captured = {};
    const app = mount(captured, { zenviaHandoffRouting: null });

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { zenviaHandoffRouting: ROUTING }));

    expect(res.status).toBe(200);
    expect(captured.updated?.zenviaHandoffRouting).toEqual(ROUTING);
  });

  test('null clears it', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { zenviaHandoffRouting: null }));

    expect(res.status).toBe(200);
    expect(captured.updated).toHaveProperty('zenviaHandoffRouting', null);
  });

  test('an invalid map is a 400 and nothing is updated', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(
      `/${INSTANCE_ID}`,
      json('PATCH', { name: 'renamed', zenviaHandoffRouting: { field: 'queue_field', groups: {} } }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('needs 1 to 256 entries');
    expect(captured.updated).toBeUndefined();
  });
});

describe('POST /instances/:id/connect - the persisted map reaches the plugin', () => {
  test('hydrates zenviaHandoffRouting from the row next to the credentials', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaSalesApiKey).toBe('persisted-sales-key');
    expect(captured.connectOptions?.zenviaHandoffRouting).toEqual(ROUTING);
  });

  test('a body value wins over the row and is persisted', async () => {
    const captured: Captured = {};
    const app = mount(captured);
    const next = { field: 'other_field', groups: { x: 'group-9' } };

    const res = await app.request(`/${INSTANCE_ID}/connect`, json('POST', { zenviaHandoffRouting: next }));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaHandoffRouting).toEqual(next);
    expect(captured.updated?.zenviaHandoffRouting).toEqual(next);
  });

  test('omits the key entirely when the row has none', async () => {
    const captured: Captured = {};
    const app = mount(captured, { zenviaHandoffRouting: null });

    await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}));

    expect(captured.connectOptions).not.toHaveProperty('zenviaHandoffRouting');
  });
});

describe('POST /instances/:id/restart - re-reads the persisted map', () => {
  test('threads the routing map into the reconnect', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/restart`, json('POST'));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaHandoffRouting).toEqual(ROUTING);
  });
});

describe('buildInstanceConnectOptions - boot reconnect', () => {
  test('carries the routing map of a zenvia row and leaves other channels alone', () => {
    const row = { zenviaApiToken: 't', zenviaSenderId: '55', zenviaHandoffRouting: ROUTING };

    expect(buildInstanceConnectOptions({ channel: 'zenvia', ...row })).toMatchObject({
      zenviaHandoffRouting: ROUTING,
    });
    expect(buildInstanceConnectOptions({ channel: 'zenvia', ...row, zenviaHandoffRouting: null })).not.toHaveProperty(
      'zenviaHandoffRouting',
    );
    expect(buildInstanceConnectOptions({ channel: 'gupshup', ...row })).not.toHaveProperty('zenviaHandoffRouting');
  });
});
