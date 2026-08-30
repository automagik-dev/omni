/**
 * whatsapp-business persisted Meta credentials on generic connect/restart (#894).
 *
 * The plugin's `connect()` requires metaAccessToken / metaPhoneNumberId /
 * metaWabaId (from `config.credentials` or `config.options`). The generic
 * connect route threaded persisted credentials for baileys/telegram/slack/
 * twilio/gupshup/hermes but had no whatsapp-business branch, and the restart
 * route built its options ad-hoc without the meta* fields — so a plain
 * `POST /instances/:id/restart` disconnected the instance and then failed
 * with "metaAccessToken is required", leaving the channel down until someone
 * manually hit the whatsapp-cloud connect route with the token.
 *
 * Same class of bug as the hermes fix (d6721c95 / 0d933a06).
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';

interface Captured {
  connectOptions?: Record<string, unknown>;
  connectCredentials?: Record<string, unknown>;
  disconnected?: boolean;
}

/** Mount the routes over a fake instance service + whatsapp-business plugin. */
function mount(captured: Captured, instanceOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'wab894',
    channel: 'whatsapp-business',
    metaAccessToken: 'EAA-persisted-token',
    metaPhoneNumberId: '111222333444555',
    metaWabaId: '999888777666555',
    metaAppId: 'app-1',
    metaBusinessId: 'biz-1',
    metaApiVersion: 'v25.0',
    metaDisplayPhoneNumber: '+5511999998888',
    metaConnectionMethod: 'manual',
    ...instanceOverrides,
  };

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async () => instance),
        update: mock(async (_id: string, data: Record<string, unknown>) => ({ ...instance, ...data })),
        updateStatus: mock(async () => instance),
      },
    } as never);

    c.set('channelRegistry', {
      get: () => ({
        id: 'whatsapp-business',
        capabilities: {},
        connect: mock(async (_id: string, config: Record<string, unknown>) => {
          captured.connectOptions = config.options as Record<string, unknown>;
          captured.connectCredentials = config.credentials as Record<string, unknown>;
        }),
        disconnect: mock(async () => {
          captured.disconnected = true;
        }),
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

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('POST /instances/:id/connect — persisted Meta credentials reach the plugin', () => {
  test('hydrates metaAccessToken/PhoneNumberId/WabaId from the instance row', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/connect`, post({}));

    expect(res.status).toBe(200);
    // Without these the plugin throws "metaAccessToken is required to connect
    // a whatsapp-business instance" — the exact 500 seen against the real API.
    expect(captured.connectOptions?.metaAccessToken).toBe('EAA-persisted-token');
    expect(captured.connectOptions?.metaPhoneNumberId).toBe('111222333444555');
    expect(captured.connectOptions?.metaWabaId).toBe('999888777666555');
  });

  test('carries the optional Meta fields alongside the required trio', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    await app.request(`/${INSTANCE_ID}/connect`, post({}));

    expect(captured.connectOptions?.metaAppId).toBe('app-1');
    expect(captured.connectOptions?.metaBusinessId).toBe('biz-1');
    expect(captured.connectOptions?.metaApiVersion).toBe('v25.0');
    expect(captured.connectOptions?.metaConnectionMethod).toBe('manual');
  });

  test('omits meta keys entirely when the row has none persisted', async () => {
    const captured: Captured = {};
    const app = mount(captured, {
      metaAccessToken: null,
      metaPhoneNumberId: null,
      metaWabaId: null,
      metaAppId: null,
      metaBusinessId: null,
      metaApiVersion: null,
      metaDisplayPhoneNumber: null,
      metaConnectionMethod: null,
    });

    await app.request(`/${INSTANCE_ID}/connect`, post({}));

    expect('metaAccessToken' in (captured.connectOptions ?? {})).toBe(false);
  });
});

describe('POST /instances/:id/restart — restart must not brick the instance', () => {
  test('reconnects with the persisted Meta credentials after disconnect', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}/restart`, post());

    expect(res.status).toBe(200);
    expect(captured.disconnected).toBe(true);
    expect(captured.connectOptions?.metaAccessToken).toBe('EAA-persisted-token');
    expect(captured.connectOptions?.metaPhoneNumberId).toBe('111222333444555');
    expect(captured.connectOptions?.metaWabaId).toBe('999888777666555');
  });
});
