/**
 * Contract tests for the per-instance signature requirement gate.
 *
 * Wish: omni-host-fingerprint-trust, Group 6.
 *
 * Strategy: mount only the require-signed-instance middleware in front of
 * a pass-through route, stub `services.instances.getById`, and assert the
 * status code + error envelope across the matrix:
 *
 *   instance.requireGenieSignature × signedBy × routeHasInstanceTarget
 *
 * Default state (requireGenieSignature=false everywhere) must be a no-op
 * for the rollout to stay additive. Opt-in instances reject bearer-only
 * requests with 401 + GENIE_SIGNATURE_REQUIRED.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { requireSignedInstanceMiddleware } from '../require-signed-instance';

interface FakeInstance {
  id: string;
  requireGenieSignature: boolean;
}

function mountWithStub(opts: {
  instance?: FakeInstance | null;
  signedBy?: string;
  /** Throw on getById to simulate "instance not found". */
  notFound?: boolean;
}): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: async (id: string) => {
          if (opts.notFound) throw new Error('not found');
          if (opts.instance && opts.instance.id === id) return opts.instance;
          throw new Error('not found');
        },
      },
    } as never);
    if (opts.signedBy) c.set('signedBy', opts.signedBy);
    c.set('apiKey', {
      id: 'k1',
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    await next();
  });
  app.use('*', requireSignedInstanceMiddleware);
  app.get('/api/v2/instances/:id', (c) => c.json({ ok: true }));
  app.post('/api/v2/messages/send', async (c) => c.json({ ok: true }));
  app.get('/api/v2/agents', (c) => c.json({ ok: true }));
  return app;
}

describe('require-signed-instance — default behavior (rollout additive)', () => {
  test('instance.requireGenieSignature=false → bearer-only request passes', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: false },
    });
    const res = await app.request('/api/v2/instances/i1');
    expect(res.status).toBe(200);
  });

  test('route without instance target (no path param, no body) → bypassed', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(200);
  });

  test('unknown instance id → 404 deferred to route handler (no 401 leak)', async () => {
    // The middleware MUST NOT 401 on unknown ids — that would let attackers
    // probe the instance namespace. Instead it falls through to the route,
    // which handles the 404.
    const app = mountWithStub({ notFound: true });
    const res = await app.request('/api/v2/instances/probe-attempt');
    // Our test app's GET /instances/:id returns 200; in production it would
    // 404. The point is the middleware doesn't shortcut — it lets the
    // request through.
    expect(res.status).toBe(200);
  });

  test('signed request → always passes regardless of instance setting', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
      signedBy: 'host-uuid',
    });
    const res = await app.request('/api/v2/instances/i1');
    expect(res.status).toBe(200);
  });
});

describe('require-signed-instance — opt-in enforcement', () => {
  test('require=true + bearer-only path-param request → 401 GENIE_SIGNATURE_REQUIRED', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
    });
    const res = await app.request('/api/v2/instances/i1');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; instance: string; message: string } };
    expect(body.error.code).toBe('GENIE_SIGNATURE_REQUIRED');
    expect(body.error.instance).toBe('i1');
    expect(body.error.message).toContain('omni instances update');
  });

  test('require=true + bearer-only body-instance request → 401', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
    });
    const res = await app.request('/api/v2/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'i1', to: 'x', text: 'y' }),
    });
    expect(res.status).toBe(401);
  });

  test('require=true + signedBy set → 200', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
      signedBy: 'host-uuid',
    });
    const res = await app.request('/api/v2/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'i1', to: 'x', text: 'y' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('require-signed-instance — defensive fallbacks', () => {
  test('services registry missing → middleware falls through (no false 401)', async () => {
    // If the service registry isn't wired (boot order glitch or healthcheck
    // path), don't fail closed — that would brick the API for an internal
    // config issue. Bearer auth or downstream still gates.
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('services', undefined as never);
      await next();
    });
    app.use('*', requireSignedInstanceMiddleware);
    app.get('/api/v2/instances/i1', (c) => c.json({ ok: true }));
    const res = await app.request('/api/v2/instances/i1');
    expect(res.status).toBe(200);
  });
});
