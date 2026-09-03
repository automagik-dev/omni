/**
 * Gupshup per-instance handoff options round-trip through the API.
 *
 * The channel plugin validates `gupshupHandoffOptions` in `connect()` and
 * applies it to every HANDOFF it emits. That only helps if the column reaches
 * the plugin on every path an instance can be (re)connected from: create,
 * PATCH and the generic connect route.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

const HANDOFF_OPTIONS = {
  defaultFields: { queue: 'DEFAULT' },
  fieldsByPhonePrefix: [{ prefixes: ['5511'], fields: { queue: 'SOUTHEAST' } }],
  customerFields: [
    { apiKey: 'Queue', from: 'queue' },
    { apiKey: 'Source', value: 'assistant' },
  ],
};

interface Captured {
  connectOptions?: Record<string, unknown>;
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

/** Mount the routes over a fake instance service + gupshup plugin. */
function mount(captured: Captured, instanceOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'gs-handoff',
    channel: 'gupshup',
    gupshupCallbackUrl: 'https://callbacks.example.com/abc',
    gupshupAuthToken: 'persisted-token',
    gupshupEventId: 'nx_omni_agent_reply',
    gupshupHandoffOptions: HANDOFF_OPTIONS,
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
        id: 'gupshup',
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

describe('POST /instances — gupshupHandoffOptions', () => {
  test('is persisted and handed to the plugin on the initial connect', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(
      '/',
      json('POST', {
        name: 'gs-handoff',
        channel: 'gupshup',
        gupshupCallbackUrl: 'https://callbacks.example.com/abc',
        gupshupAuthToken: 'persisted-token',
        gupshupHandoffOptions: HANDOFF_OPTIONS,
      }),
    );

    expect(res.status).toBe(201);
    expect(captured.created?.gupshupHandoffOptions).toEqual(HANDOFF_OPTIONS);
    expect(captured.connectOptions?.gupshupHandoffOptions).toEqual(HANDOFF_OPTIONS);
  });

  test('rejects a malformed template before anything is written', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const bad = [
      // exactly one of value/from per customerFields entry
      { customerFields: [{ apiKey: 'Queue', value: 'a', from: 'b' }] },
      { customerFields: [{ apiKey: 'Queue' }] },
      // prefixes are digits only
      { fieldsByPhonePrefix: [{ prefixes: ['+55'], fields: { queue: 'x' } }] },
      // strict object: a typo must not be silently dropped
      { defaultField: { queue: 'x' } },
    ];
    for (const gupshupHandoffOptions of bad) {
      const res = await app.request(
        '/',
        json('POST', { name: 'gs-handoff', channel: 'gupshup', gupshupHandoffOptions }),
      );
      expect(res.status).toBe(400);
    }
    expect(captured.created).toBeUndefined();
    expect(captured.connectOptions).toBeUndefined();
  });
});

describe('PATCH /instances/:id — gupshupHandoffOptions', () => {
  test('is forwarded to the update untouched', async () => {
    const captured: Captured = {};
    const app = mount(captured, { gupshupHandoffOptions: null });

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { gupshupHandoffOptions: HANDOFF_OPTIONS }));

    expect(res.status).toBe(200);
    expect(captured.updated?.gupshupHandoffOptions).toEqual(HANDOFF_OPTIONS);
  });

  test('null clears it', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { gupshupHandoffOptions: null }));

    expect(res.status).toBe(200);
    expect(captured.updated).toHaveProperty('gupshupHandoffOptions', null);
  });
});

describe('POST /instances/:id/connect — persisted options reach the plugin', () => {
  test('hydrates gupshupHandoffOptions from the row next to the credentials', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}));

    expect(res.status).toBe(200);
    expect(captured.connectOptions?.gupshupCallbackUrl).toBe('https://callbacks.example.com/abc');
    expect(captured.connectOptions?.gupshupAuthToken).toBe('persisted-token');
    expect(captured.connectOptions?.gupshupHandoffOptions).toEqual(HANDOFF_OPTIONS);
  });

  test('omits the key entirely when the row has none', async () => {
    const captured: Captured = {};
    const app = mount(captured, { gupshupHandoffOptions: null });

    await app.request(`/${INSTANCE_ID}/connect`, json('POST', {}));

    expect(captured.connectOptions).not.toHaveProperty('gupshupHandoffOptions');
  });
});
