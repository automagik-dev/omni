/**
 * Per-host scope intersection tests for the scope-enforcer middleware.
 *
 * Wish: omni-host-fingerprint-trust, Group 5.
 *
 * Contract: when a request carries a verified `signedBy` host id (set by
 * the genie-signature middleware in Group 4), the EFFECTIVE permissions
 * are the intersection of:
 *   - the bearer key's scopes (`apiKey.scopes`)
 *   - the signing host's scopes (`signedByScopes`)
 *
 * Both must allow the route. Either side denying → 403.
 *
 * Backward compat: hosts default to `['*']` on first handshake, so this
 * check is a no-op until an operator narrows via `omni trust update`.
 *
 * Strategy: mount only the scope-enforcer middleware on a stub Hono app,
 * pre-set `apiKey` and `signedBy*` on the context to simulate prior
 * middleware, hit a route mapped in SCOPE_MAP, and assert the response
 * code. No DB, no real auth — the goal is to lock down the intersection
 * decision in isolation.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ApiKeyData, AppVariables } from '../../types';
import { scopeEnforcerMiddleware } from '../scope-enforcer';

interface CtxOverrides {
  bearerScopes: string[];
  signedBy?: string;
  /** `null` simulates malformed runtime context despite the production type. */
  signedByScopes?: string[] | null;
}

/**
 * Build a tiny app with the scope-enforcer middleware in front of a
 * pass-through `GET /agents` route (mapped to scope `agents:read` in
 * SCOPE_MAP). All other auth is stubbed via context-setter middleware.
 */
function mountWithCtx(overrides: CtxOverrides): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    const apiKey: ApiKeyData = {
      id: 'k1',
      name: 'test',
      scopes: overrides.bearerScopes,
      instanceIds: null,
      expiresAt: null,
      profile: null,
      chatAllowlist: [],
      instanceAllowlist: [],
      outboundRecipientAllowlist: [],
    };
    c.set('apiKey', apiKey);
    if (overrides.signedBy) c.set('signedBy', overrides.signedBy);
    if (overrides.signedByScopes !== undefined) c.set('signedByScopes', overrides.signedByScopes as never);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  // Two routes from SCOPE_MAP we exercise below:
  //   GET /api/v2/agents          → agents:read
  //   POST /api/v2/agents         → agents:write
  app.get('/api/v2/agents', (c) => c.json({ ok: true }));
  app.post('/api/v2/agents', async (c) => c.json({ ok: true }));
  return app;
}

describe('scope-enforcer — bearer-only path (no signature)', () => {
  test('bearer with `*` → 200 (regression: existing behavior unchanged)', async () => {
    const app = mountWithCtx({ bearerScopes: ['*'] });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(200);
  });

  test('bearer with namespace wildcard → 200', async () => {
    const app = mountWithCtx({ bearerScopes: ['agents:*'] });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(200);
  });

  test('bearer missing required scope → 403', async () => {
    const app = mountWithCtx({ bearerScopes: ['messages:read'] });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(403);
  });
});

describe('scope-enforcer — signed request, host wildcard (back-compat default)', () => {
  test('bearer=`*` + host=`*` → 200 (default handshake state)', async () => {
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      signedByScopes: ['*'],
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(200);
  });

  test('bearer=`agents:read` + host=`*` → 200', async () => {
    const app = mountWithCtx({
      bearerScopes: ['agents:read'],
      signedBy: 'host-uuid',
      signedByScopes: ['*'],
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(200);
  });
});

describe('scope-enforcer — signed request, host narrowed (Group 5 intersection)', () => {
  test('bearer=`*` + host=`agents:read` allows GET /agents → 200', async () => {
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      signedByScopes: ['agents:read'],
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(200);
  });

  test('bearer=`*` + host=`agents:read` DENIES POST /agents → 403', async () => {
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      signedByScopes: ['agents:read'],
    });
    const res = await app.request('/api/v2/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; host?: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.host).toBe('host-uuid');
  });

  test('bearer=`agents:read` + host=`agents:write` DENIES GET /agents (bearer side rejects first)', async () => {
    // The bearer dimension fires before the host dimension. The bearer is
    // missing `agents:read`, so we get the bearer error message — NOT the
    // host-specific one. This locks down the order-of-evaluation.
    const app = mountWithCtx({
      bearerScopes: ['agents:read'],
      signedBy: 'host-uuid',
      signedByScopes: ['agents:write'],
    });
    const res = await app.request('/api/v2/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; host?: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    // Bearer-side denial: no `host` field (that's only set on host-side denials).
    expect(body.error.host).toBeUndefined();
  });

  test('bearer=`agents:write` + host=`agents:write` → 200 on POST', async () => {
    const app = mountWithCtx({
      bearerScopes: ['agents:write'],
      signedBy: 'host-uuid',
      signedByScopes: ['agents:write'],
    });
    const res = await app.request('/api/v2/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
  });

  test('bearer=`*` + host=[] (empty array) DENIES every scoped route', async () => {
    // Operators who explicitly clear all scopes on a host effectively
    // disable that host without revoking it. Useful for "freeze this host"
    // operations during incident response.
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      signedByScopes: [],
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(403);
  });

  test('bearer=`*` + host=`messages:read` DENIES /agents (different namespace)', async () => {
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      signedByScopes: ['messages:read'],
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(403);
  });

  test('host scopes apply even when bearer has wildcard (no bypass)', async () => {
    // Critical security property: an admin bearer key MUST NOT bypass
    // per-host restrictions. Otherwise a compromised bearer signed by a
    // narrowed host would still get full admin.
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      signedByScopes: ['agents:read'],
    });
    const res = await app.request('/api/v2/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});

describe('scope-enforcer — signed request without scopes set on context', () => {
  test('signedBy set but signedByScopes absent → fail closed', async () => {
    // A verified signing identity without its authorization context must never
    // degrade to bearer-only permissions. Otherwise a wildcard bearer can
    // bypass host narrowing when upstream context population drifts.
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      // signedByScopes intentionally omitted
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; host?: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.host).toBe('host-uuid');
  });

  test('signedBy set but signedByScopes is null at runtime → fail closed', async () => {
    const app = mountWithCtx({
      bearerScopes: ['*'],
      signedBy: 'host-uuid',
      signedByScopes: null,
    });
    const res = await app.request('/api/v2/agents');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; host?: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.host).toBe('host-uuid');
  });
});
