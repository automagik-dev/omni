/**
 * instances.outbound_pacing_override is full-access-only to turn on.
 *
 * The flag lets a send request's `pacing: 'immediate'` skip the humanized
 * anti-ban pacing, so POST/PATCH /instances refuse `outboundPacingOverride:
 * true` (403) unless the key — and a signing host, when present — holds '*'.
 * Omitting the field or sending false behaves as for any other field.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '55555555-5555-4555-8555-555555555555';
const SCOPED = ['instances:read', 'instances:write'];

interface Captured {
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

function mount(captured: Captured, scopes: string[], signedByScopes?: string[]) {
  const app = new Hono<{ Variables: AppVariables }>();
  const instance = { id: INSTANCE_ID, name: 'pacing', channel: 'gupshup' };

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
    c.set('apiKey', { id: 'test', name: 'test', scopes, instanceIds: null, expiresAt: null } as never);
    if (signedByScopes) {
      c.set('signedBy', 'host-1');
      c.set('signedByScopes', signedByScopes);
    }
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

const createBody = (extra: Record<string, unknown>) => ({
  name: 'pacing',
  channel: 'gupshup',
  gupshupCallbackUrl: 'https://callbacks.example.com/abc',
  gupshupAuthToken: 'token',
  ...extra,
});

describe('PATCH /instances/:id — outboundPacingOverride', () => {
  test('true from a scoped key is 403 FORBIDDEN and nothing is written', async () => {
    const captured: Captured = {};
    const res = await mount(captured, SCOPED).request(
      `/${INSTANCE_ID}`,
      json('PATCH', { outboundPacingOverride: true }),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(captured.updated).toBeUndefined();
  });

  test('true from a full-access key is forwarded', async () => {
    const captured: Captured = {};
    const res = await mount(captured, ['*']).request(
      `/${INSTANCE_ID}`,
      json('PATCH', { outboundPacingOverride: true }),
    );

    expect(res.status).toBe(200);
    expect(captured.updated?.outboundPacingOverride).toBe(true);
  });

  test('true from a full-access key through a narrowed signing host is 403', async () => {
    const captured: Captured = {};
    const res = await mount(captured, ['*'], SCOPED).request(
      `/${INSTANCE_ID}`,
      json('PATCH', { outboundPacingOverride: true }),
    );

    expect(res.status).toBe(403);
    expect(captured.updated).toBeUndefined();
  });

  test('false from a scoped key is forwarded as before', async () => {
    const captured: Captured = {};
    const res = await mount(captured, SCOPED).request(
      `/${INSTANCE_ID}`,
      json('PATCH', { outboundPacingOverride: false }),
    );

    expect(res.status).toBe(200);
    expect(captured.updated?.outboundPacingOverride).toBe(false);
  });

  test('omitted from a scoped key leaves the update untouched', async () => {
    const captured: Captured = {};
    const res = await mount(captured, SCOPED).request(`/${INSTANCE_ID}`, json('PATCH', { name: 'renamed' }));

    expect(res.status).toBe(200);
    expect(captured.updated).toEqual({ name: 'renamed' });
  });
});

describe('POST /instances — outboundPacingOverride', () => {
  test('true from a scoped key is 403 FORBIDDEN and no instance is created', async () => {
    const captured: Captured = {};
    const res = await mount(captured, SCOPED).request('/', json('POST', createBody({ outboundPacingOverride: true })));

    expect(res.status).toBe(403);
    expect(captured.created).toBeUndefined();
  });

  test('true from a full-access key is persisted', async () => {
    const captured: Captured = {};
    const res = await mount(captured, ['*']).request('/', json('POST', createBody({ outboundPacingOverride: true })));

    expect(res.status).toBe(201);
    expect(captured.created?.outboundPacingOverride).toBe(true);
  });

  test('omitted from a scoped key creates with the default false', async () => {
    const captured: Captured = {};
    const res = await mount(captured, SCOPED).request('/', json('POST', createBody({})));

    expect(res.status).toBe(201);
    expect(captured.created?.outboundPacingOverride).toBe(false);
  });
});
