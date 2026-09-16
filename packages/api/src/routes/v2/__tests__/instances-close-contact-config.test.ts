/**
 * instances.close_contact_config round-trips through POST/PATCH /instances.
 *
 * The close-contact route resolves cooldown/escalation per outcome from this
 * column; the API is the only validation point, so a bad shape must be a 400
 * rather than being silently ignored by the resolver at close time.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

const CLOSE_CONTACT_CONFIG = {
  no_response: { escalationThreshold: null },
  other: { cooldownMs: 3_600_000, escalationThreshold: 5, escalationWindowMs: 604_800_000 },
};

interface Captured {
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

function mount(captured: Captured) {
  const app = new Hono<{ Variables: AppVariables }>();
  const instance = { id: INSTANCE_ID, name: 'close-config', channel: 'gupshup', closeContactConfig: null };

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
        connect: mock(async () => undefined),
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

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('PATCH /instances/:id — closeContactConfig', () => {
  test('is forwarded to the update untouched', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { closeContactConfig: CLOSE_CONTACT_CONFIG }));

    expect(res.status).toBe(200);
    expect(captured.updated?.closeContactConfig).toEqual(CLOSE_CONTACT_CONFIG);
  });

  test('null clears it', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { closeContactConfig: null }));

    expect(res.status).toBe(200);
    expect(captured.updated).toHaveProperty('closeContactConfig', null);
  });

  test('rejects malformed overrides before anything is written', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const bad = [
      // unknown outcome
      { closed_sale: { cooldownMs: 1000 } },
      // typo in a key: strict object, never silently dropped
      { no_response: { escalationTreshold: null } },
      // negative / non-integer values
      { no_response: { cooldownMs: -1 } },
      { other: { escalationThreshold: 1.5 } },
      { other: { escalationWindowMs: 0 } },
    ];
    for (const closeContactConfig of bad) {
      const res = await app.request(`/${INSTANCE_ID}`, json('PATCH', { closeContactConfig }));
      expect(res.status).toBe(400);
    }
    expect(captured.updated).toBeUndefined();
  });
});

describe('POST /instances — closeContactConfig', () => {
  test('is persisted on create', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(
      '/',
      json('POST', {
        name: 'close-config',
        channel: 'gupshup',
        gupshupCallbackUrl: 'https://callbacks.example.com/abc',
        gupshupAuthToken: 'token',
        closeContactConfig: CLOSE_CONTACT_CONFIG,
      }),
    );

    expect(res.status).toBe(201);
    expect(captured.created?.closeContactConfig).toEqual(CLOSE_CONTACT_CONFIG);
  });
});
