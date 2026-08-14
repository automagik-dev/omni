/**
 * Slack HTTP mode reachability through the API (#889).
 *
 * These guard two failures that shipped past typecheck AND the whole unit
 * suite, because nothing exercised the HTTP path end to end:
 *
 *   1. `profileMetadata` was missing from updateInstanceSchema, so a PATCH
 *      carrying it returned 200 and zod stripped it. The caller believed it
 *      had saved; the column stayed null.
 *   2. The connect route built plugin options from tokens alone.
 *      `applySlackProfileMetadata` ran only on the RESTART path, so an
 *      instance configured for `mode: 'http'` still came up in Socket Mode
 *      and died asking for an appToken.
 *
 * Both are silent-success bugs, which is why they need tests rather than
 * types: nothing threw, nothing logged, the state was just wrong.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '22222222-2222-4222-8222-222222222222';

interface Captured {
  update?: Record<string, unknown>;
  connectOptions?: Record<string, unknown>;
}

/** Mount the routes over a fake instance service + Slack plugin. */
function mount(captured: Captured, instanceOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  const instance = {
    id: INSTANCE_ID,
    name: 'slack889',
    channel: 'slack',
    slackBotToken: 'xoxb-test',
    slackUserToken: 'xoxp-test',
    slackAuthMode: 'user',
    slackSigningSecret: 'sig',
    slackAppToken: null,
    profileMetadata: null as Record<string, unknown> | null,
    ...instanceOverrides,
  };

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async () => instance),
        update: mock(async (_id: string, data: Record<string, unknown>) => {
          captured.update = data;
          return { ...instance, ...data };
        }),
        updateStatus: mock(async () => instance),
      },
    } as never);

    c.set('channelRegistry', {
      get: () => ({
        id: 'slack',
        capabilities: {},
        connect: mock(async (_id: string, config: Record<string, unknown>) => {
          captured.connectOptions = config.options as Record<string, unknown>;
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

const json = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('PATCH /instances/:id — profileMetadata survives validation', () => {
  test('reaches the update service instead of being stripped by zod', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(
      `/${INSTANCE_ID}`,
      json({ profileMetadata: { mode: 'http', httpPort: 3899, dmPolicy: 'open' } }),
    );

    expect(res.status).toBe(200);
    // The regression: a 200 with the field silently absent from the write.
    expect(captured.update?.profileMetadata).toEqual({
      mode: 'http',
      httpPort: 3899,
      dmPolicy: 'open',
    });
  });

  test('a 200 alone does not prove the write — assert the payload', async () => {
    const captured: Captured = {};
    const app = mount(captured);

    const res = await app.request(`/${INSTANCE_ID}`, json({ profileMetadata: { mode: 'http' } }));

    expect(res.status).toBe(200);
    expect(captured.update).toBeDefined();
    expect(Object.keys(captured.update ?? {})).toContain('profileMetadata');
  });
});

describe('POST /instances/:id/connect — profileMetadata reaches the plugin', () => {
  test('carries mode and httpPort so HTTP mode is actually selectable', async () => {
    const captured: Captured = {};
    const app = mount(captured, {
      profileMetadata: { mode: 'http', httpPort: 3899, dmPolicy: 'open' },
    });

    const res = await app.request(`/${INSTANCE_ID}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    // Without this the plugin defaults to socket and fails on the missing
    // appToken — the exact 500 seen against the real server.
    expect(captured.connectOptions?.mode).toBe('http');
    expect(captured.connectOptions?.httpPort).toBe(3899);
  });

  test('still forwards the user-mode identity alongside the transport', async () => {
    const captured: Captured = {};
    const app = mount(captured, { profileMetadata: { mode: 'http', httpPort: 3899 } });

    await app.request(`/${INSTANCE_ID}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(captured.connectOptions?.authMode).toBe('user');
    expect(captured.connectOptions?.userToken).toBe('xoxp-test');
  });

  test('leaves an instance with no metadata on the socket default', async () => {
    const captured: Captured = {};
    const app = mount(captured, { profileMetadata: null, slackAppToken: 'xapp-test' });

    await app.request(`/${INSTANCE_ID}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(captured.connectOptions?.mode).toBeUndefined();
  });
});
