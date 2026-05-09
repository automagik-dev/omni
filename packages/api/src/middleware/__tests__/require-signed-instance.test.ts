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
import { isUnlockOnlyBody, requireSignedInstanceMiddleware } from '../require-signed-instance';

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
  app.patch('/api/v2/instances/:id', async (c) => c.json({ ok: true, patched: await c.req.json() }));
  app.post('/api/v2/messages/send', async (c) => c.json({ ok: true }));
  app.get('/api/v2/agents', (c) => c.json({ ok: true }));
  return app;
}

async function patchJson(app: Hono<{ Variables: AppVariables }>, path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
    // Error message points operators at both recovery paths: signing
    // (via genie omni handshake) and the bearer-only kill-switch unlock.
    expect(body.error.message).toContain('genie omni handshake');
    expect(body.error.message).toContain('"requireGenieSignature": false');
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

describe('isUnlockOnlyBody — body shape predicate', () => {
  test('exact unlock body → true', () => {
    expect(isUnlockOnlyBody({ requireGenieSignature: false })).toBe(true);
  });

  test('mixed body (unlock + other field) → false (no smuggling)', () => {
    expect(isUnlockOnlyBody({ requireGenieSignature: false, name: 'sneaky' })).toBe(false);
  });

  test('lock body (true) → false (no recovery scenario for the inverse)', () => {
    expect(isUnlockOnlyBody({ requireGenieSignature: true })).toBe(false);
  });

  test('wrong type for the unlock value → false', () => {
    expect(isUnlockOnlyBody({ requireGenieSignature: 'false' })).toBe(false);
    expect(isUnlockOnlyBody({ requireGenieSignature: 0 })).toBe(false);
    expect(isUnlockOnlyBody({ requireGenieSignature: null })).toBe(false);
  });

  test('no requireGenieSignature key → false', () => {
    expect(isUnlockOnlyBody({ name: 'foo' })).toBe(false);
    expect(isUnlockOnlyBody({})).toBe(false);
  });

  test('non-objects → false', () => {
    expect(isUnlockOnlyBody(null)).toBe(false);
    expect(isUnlockOnlyBody(undefined)).toBe(false);
    expect(isUnlockOnlyBody('string')).toBe(false);
    expect(isUnlockOnlyBody(42)).toBe(false);
    expect(isUnlockOnlyBody([{ requireGenieSignature: false }])).toBe(false);
  });
});

describe('require-signed-instance — kill-switch exemption (operator lockout prevention)', () => {
  test('PATCH unlock body on locked instance → 200 (bearer-only allowed)', async () => {
    // The whole point: an operator with a bearer-only client (the omni
    // CLI itself today) MUST be able to flip require_genie_signature back
    // off. Without this exemption, lockdown is a one-way door.
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
    });
    const res = await patchJson(app, '/api/v2/instances/i1', { requireGenieSignature: false });
    expect(res.status).toBe(200);
  });

  test('PATCH mixed body (unlock + other field) on locked instance → 401', async () => {
    // Smuggling check: an attacker who flipped the gate ON shouldn't be
    // able to combine unlock with other writes from a bearer-only path.
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
    });
    const res = await patchJson(app, '/api/v2/instances/i1', {
      requireGenieSignature: false,
      name: 'rename-attempt',
    });
    expect(res.status).toBe(401);
  });

  test('PATCH lock body (true) on already-locked instance → 401', async () => {
    // Locking a locked instance is a no-op-equivalent admin action and
    // there's no operator-recovery scenario for it. Stay locked down.
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
    });
    const res = await patchJson(app, '/api/v2/instances/i1', { requireGenieSignature: true });
    expect(res.status).toBe(401);
  });

  test('PATCH unrelated field on locked instance → 401 (only the unlock body is exempt)', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
    });
    const res = await patchJson(app, '/api/v2/instances/i1', { name: 'rename' });
    expect(res.status).toBe(401);
  });

  test('PATCH unlock body on UNLOCKED instance → 200 (no-op-equivalent, never gated)', async () => {
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: false },
    });
    const res = await patchJson(app, '/api/v2/instances/i1', { requireGenieSignature: false });
    expect(res.status).toBe(200);
  });

  test('signed PATCH with mixed body on locked instance → 200 (signature path bypasses the gate)', async () => {
    // The exemption is for bearer-only callers. Signed callers have the
    // full surface available, so a signed PATCH with whatever body shape
    // still goes through the regular allow path.
    const app = mountWithStub({
      instance: { id: 'i1', requireGenieSignature: true },
      signedBy: 'host-uuid',
    });
    const res = await patchJson(app, '/api/v2/instances/i1', {
      requireGenieSignature: false,
      name: 'rename',
    });
    expect(res.status).toBe(200);
  });
});
