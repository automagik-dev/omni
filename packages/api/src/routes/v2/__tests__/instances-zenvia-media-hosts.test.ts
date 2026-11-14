import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { buildInstanceConnectOptions } from '../../../plugins/instance-monitor';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '99999999-9999-4999-8999-999999999999';

const HOSTS = ['zenvia.com', 'media.example.org'];

interface Captured {
  connectOptions?: Record<string, unknown>;
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

function mount(captured: Captured, instanceOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'zv-media',
    channel: 'zenvia',
    zenviaApiToken: 'persisted-api-token',
    zenviaSenderId: '551140000000',
    webhookVerifyToken: 'persisted-verify-token',
    zenviaMediaHosts: HOSTS,
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
  name: 'zv-media',
  channel: 'zenvia',
  zenviaApiToken: 'persisted-api-token',
  zenviaSenderId: '551140000000',
  webhookVerifyToken: 'persisted-verify-token',
};

describe('POST /instances - zenviaMediaHosts', () => {
  test('is persisted lower-cased and trimmed and handed to the plugin on the initial connect', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(
      '/',
      json('POST', { ...createBody, zenviaMediaHosts: [' Zenvia.COM ', 'media.example.org'] }),
    );

    expect(res.status).toBe(201);
    expect(captured.created?.zenviaMediaHosts).toEqual(HOSTS);
    expect(captured.connectOptions?.zenviaMediaHosts).toEqual(HOSTS);
  });

  test('rejects an invalid list before anything is written', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const bad = [
      ['https://zenvia.com'],
      ['zenvia.com/files'],
      ['zenvia.com:443'],
      ['*.zenvia.com'],
      ['10.0.0.1'],
      ['localhost'],
      [''],
      [42],
      'zenvia.com',
      Array.from({ length: 65 }, (_, i) => `h${i}.example.org`),
    ];
    for (const zenviaMediaHosts of bad) {
      const res = await app.request('/', json('POST', { ...createBody, zenviaMediaHosts }));
      expect(res.status).toBe(400);
    }
    expect(captured.created).toBeUndefined();
    expect(captured.connectOptions).toBeUndefined();
  });

  test('omits the key from the connect options when the list is absent or empty', async () => {
    for (const extra of [{}, { zenviaMediaHosts: [] }]) {
      const captured: Captured = {};
      const app = mount(captured, { zenviaMediaHosts: null });

      const res = await app.request('/', json('POST', { ...createBody, ...extra }));

      expect(res.status).toBe(201);
      expect(captured.connectOptions).not.toHaveProperty('zenviaMediaHosts');
    }
  });
});

describe('PATCH /instances/:id - zenviaMediaHosts', () => {
  test('is forwarded to the update', async () => {
    const captured: Captured = {};
    const app = mount(captured, { zenviaMediaHosts: null });

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { zenviaMediaHosts: HOSTS }));

    expect(res.status).toBe(200);
    expect(captured.updated?.zenviaMediaHosts).toEqual(HOSTS);
  });

  test('null clears it', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { zenviaMediaHosts: null }));

    expect(res.status).toBe(200);
    expect(captured.updated).toHaveProperty('zenviaMediaHosts', null);
  });

  test('an invalid list is a 400 and nothing is updated', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(
      `/${INSTANCE_ID}`,
      json('PATCH', { name: 'renamed', zenviaMediaHosts: ['https://zenvia.com'] }),
    );

    expect(res.status).toBe(400);
    expect(captured.updated).toBeUndefined();
  });
});

describe('POST /instances/:id/connect - the persisted list reaches the plugin', () => {
  test('hydrates zenviaMediaHosts from the row', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaMediaHosts).toEqual(HOSTS);
  });

  test('a body value wins over the row and is persisted', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, json('POST', { zenviaMediaHosts: ['cdn.example.net'] }));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaMediaHosts).toEqual(['cdn.example.net']);
    expect(captured.updated?.zenviaMediaHosts).toEqual(['cdn.example.net']);
  });

  test('omits the key entirely when the row has none', async () => {
    const captured: Captured = {};
    const app = mount(captured, { zenviaMediaHosts: null });

    await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}));

    expect(captured.connectOptions).not.toHaveProperty('zenviaMediaHosts');
  });
});

describe('POST /instances/:id/restart - re-reads the persisted list', () => {
  test('threads the list into the reconnect', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/restart`, json('POST'));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.zenviaMediaHosts).toEqual(HOSTS);
  });
});

describe('buildInstanceConnectOptions - boot reconnect', () => {
  test('carries the list of a zenvia row and leaves other channels alone', () => {
    const row = { zenviaApiToken: 't', zenviaSenderId: '55', zenviaMediaHosts: HOSTS };

    expect(buildInstanceConnectOptions({ channel: 'zenvia', ...row })).toMatchObject({ zenviaMediaHosts: HOSTS });
    expect(buildInstanceConnectOptions({ channel: 'zenvia', ...row, zenviaMediaHosts: [] })).not.toHaveProperty(
      'zenviaMediaHosts',
    );
    expect(buildInstanceConnectOptions({ channel: 'gupshup', ...row })).not.toHaveProperty('zenviaMediaHosts');
  });
});
