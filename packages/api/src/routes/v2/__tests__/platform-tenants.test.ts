/**
 * Platform control-plane route tests (wish: omni-full-multitenancy, Group G1).
 *
 * Exercises the REAL platformAuthMiddleware + routes with stubbed services:
 *   - flag off → surface absent (404); flag on → mounted;
 *   - platform positive path; tenant/legacy credential denial;
 *   - create/list/get/suspend/archive; reason + audit requirements;
 *   - no DELETE route exists.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { isMultitenancyEnabled } from '../../../tenancy/feature-flag';
import type { AppVariables } from '../../../types';
import { platformTenantRoutes } from '../platform-tenants';

type AuthResult = { ok: true; context: unknown } | { ok: false; reason: string };

interface Spy {
  calls: { method: string; args: unknown[] }[];
}

function platformCtx(scopes: string[]) {
  return {
    credentialClass: 'platform' as const,
    requestId: 'req-test',
    principalId: 'prin-1',
    credentialId: 'cred-1',
    scopes,
    platformApiKeyId: 'pk-1',
    platformAction: null,
    targetTenantId: null,
  };
}

function tenantCtx() {
  return {
    credentialClass: 'tenant' as const,
    requestId: 'req-test',
    principalId: 'prin-1',
    credentialId: 'cred-t',
    tenantId: 'tenant-1',
    actorRole: 'tenant-admin' as const,
    scopes: ['tenant:*'],
    membershipId: 'mem-1',
    policyVersion: 1,
    revocationEpoch: 0,
    tenantKeyLineageId: 'lin-1',
  };
}

function buildApp(
  authResult: AuthResult,
  controlPlaneOverrides: Record<string, unknown> = {},
): { app: Hono; spy: Spy } {
  const spy: Spy = { calls: [] };
  const record =
    (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      spy.calls.push({ method, args });
      return result;
    };

  const tenantControlPlane = {
    createTenant: record('createTenant', { status: 'ok', value: { id: 'tenant-new', slug: 'acme' } }),
    listTenants: record('listTenants', [{ id: 'tenant-1' }]),
    getTenant: record('getTenant', { id: 'tenant-1', slug: 'acme' }),
    suspendTenant: record('suspendTenant', { status: 'ok', value: { id: 'tenant-1', status: 'suspended' } }),
    archiveTenant: record('archiveTenant', { status: 'ok', value: { id: 'tenant-1', status: 'archived' } }),
    attachMembership: record('attachMembership', { status: 'ok', value: { id: 'mem-new' } }),
    listMemberships: record('listMemberships', []),
    detachMembership: record('detachMembership', { status: 'ok', value: { id: 'mem-1', status: 'disabled' } }),
    setMembershipStatus: record('setMembershipStatus', { status: 'ok', value: { id: 'mem-1' } }),
    setMembershipRole: record('setMembershipRole', { status: 'ok', value: { id: 'mem-1' } }),
    ...controlPlaneOverrides,
  };

  const services = {
    authBootstrap: { lookupBySecret: async () => authResult },
    tenantControlPlane,
  };

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-test');
    c.set('services', services as never);
    await next();
  });
  app.route('/api/v2/platform', platformTenantRoutes);
  return { app: app as unknown as Hono, spy };
}

const AUTH = {
  headers: {
    'x-api-key': 'omni_sk_test',
    'x-platform-reason': 'approved control-plane inspection',
    'Content-Type': 'application/json',
  },
};
const TENANT_KEY_POLICY = { maxKeyTtlSeconds: 3_600, maxKeyRateLimit: 100, maxKeyBudget: 1_000 };

describe('feature-flag gating of the control-plane mount', () => {
  test('flag off → routes are not mounted (404)', async () => {
    // Mirror app.ts: only mount when the flag is enabled.
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'r');
      c.set('services', {
        authBootstrap: { lookupBySecret: async () => ({ ok: true, context: platformCtx(['*']) }) },
      } as never);
      await next();
    });
    if (isMultitenancyEnabled({})) app.route('/api/v2/platform', platformTenantRoutes);
    const res = await app.request('/api/v2/platform/tenants', AUTH);
    expect(res.status).toBe(404);
  });

  test('flag on → routes are mounted', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'r');
      c.set('services', {
        authBootstrap: { lookupBySecret: async () => ({ ok: true, context: platformCtx(['*']) }) },
        tenantControlPlane: { listTenants: async () => [] },
      } as never);
      await next();
    });
    if (isMultitenancyEnabled({ OMNI_MULTITENANCY_ENABLED: 'true' })) {
      app.route('/api/v2/platform', platformTenantRoutes);
    }
    const res = await app.request('/api/v2/platform/tenants', AUTH);
    expect(res.status).toBe(200);
  });
});

describe('platform auth denial', () => {
  test('unauthenticated (no credential) → 401', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['*']) });
    const res = await app.request('/api/v2/platform/tenants');
    expect(res.status).toBe(401);
  });

  test('legacy/unknown credential (not in auth index) → uniform 401', async () => {
    const { app } = buildApp({ ok: false, reason: 'not_found' });
    const res = await app.request('/api/v2/platform/tenants', AUTH);
    expect(res.status).toBe(401);
  });

  test('tenant-class credential → 403 (cannot acquire platform authority)', async () => {
    const { app, spy } = buildApp({ ok: true, context: tenantCtx() });
    const res = await app.request('/api/v2/platform/tenants', AUTH);
    expect(res.status).toBe(403);
    expect(spy.calls.find((c) => c.method === 'listTenants')).toBeUndefined();
  });

  test('platform credentials are never accepted from a query string', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['*']) });
    const res = await app.request('/api/v2/platform/tenants?api_key=platform-secret');
    expect(res.status).toBe(401);
  });

  test('platform credential lacking the required scope → 403', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['platform:tenants:read']) });
    const res = await app.request('/api/v2/platform/tenants', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({
        slug: 'acme',
        displayName: 'Acme',
        ...TENANT_KEY_POLICY,
        reason: 'onboarding new tenant',
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe('tenant lifecycle — platform positive paths', () => {
  test('create requires a reason (missing → 400)', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['*']) });
    const res = await app.request('/api/v2/platform/tenants', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({ slug: 'acme', displayName: 'Acme', ...TENANT_KEY_POLICY }),
    });
    expect(res.status).toBe(400);
  });

  test('create succeeds and forwards the reason to the audited service', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(['*']) });
    const res = await app.request('/api/v2/platform/tenants', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({
        slug: 'acme',
        displayName: 'Acme',
        ...TENANT_KEY_POLICY,
        reason: 'onboarding new tenant',
      }),
    });
    expect(res.status).toBe(201);
    const call = spy.calls.find((c) => c.method === 'createTenant');
    expect(call).toBeDefined();
    // (input, actor, reason)
    expect(call?.args[2]).toBe('onboarding new tenant');
    const actor = call?.args[1] as {
      credentialId: string;
      requestId: string;
      platformAction: string;
      targetTenantId: string | null;
    };
    expect(actor.credentialId).toBe('cred-1');
    expect(actor.requestId).toBe('req-test');
    expect(actor.platformAction).toBe('tenant.create');
    expect(actor.targetTenantId).toBeNull();
  });

  test('list + get positive paths are audited with reason and target binding', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(['*']) });
    expect((await app.request('/api/v2/platform/tenants', AUTH)).status).toBe(200);
    const get = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111', AUTH);
    expect(get.status).toBe(200);
    expect(spy.calls.find((call) => call.method === 'listTenants')?.args).toEqual([
      expect.objectContaining({ platformAction: 'tenant.list', targetTenantId: null }),
      'approved control-plane inspection',
    ]);
    expect(spy.calls.find((call) => call.method === 'getTenant')?.args).toEqual([
      '11111111-1111-1111-1111-111111111111',
      expect.objectContaining({
        platformAction: 'tenant.read',
        targetTenantId: '11111111-1111-1111-1111-111111111111',
      }),
      'approved control-plane inspection',
    ]);
  });

  test('read/list rejects a missing or whitespace-only audit reason', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(['*']) });
    const missing = await app.request('/api/v2/platform/tenants', {
      headers: { 'x-api-key': 'omni_sk_test' },
    });
    const whitespace = await app.request('/api/v2/platform/tenants', {
      headers: { 'x-api-key': 'omni_sk_test', 'x-platform-reason': '   ' },
    });
    expect(missing.status).toBe(400);
    expect(whitespace.status).toBe(400);
    expect(spy.calls.find((call) => call.method === 'listTenants')).toBeUndefined();
  });

  test('get unknown tenant → non-enumerating 404', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['*']) }, { getTenant: async () => null });
    const res = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111', AUTH);
    expect(res.status).toBe(404);
  });

  test('suspend requires a reason and returns the updated tenant', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(['*']) });
    const missing = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111/suspend', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const ok = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111/suspend', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({ reason: 'abuse investigation' }),
    });
    expect(ok.status).toBe(200);
    const call = spy.calls.find((c) => c.method === 'suspendTenant');
    expect(call?.args[1]).toBe('abuse investigation');
    expect(call?.args[2]).toMatchObject({
      platformAction: 'tenant.suspend',
      targetTenantId: '11111111-1111-1111-1111-111111111111',
    });
  });

  test('archive positive path', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['*']) });
    const res = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111/archive', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({ reason: 'end of contract' }),
    });
    expect(res.status).toBe(200);
  });

  test('membership attach requires membership-write scope', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['platform:tenants:write']) });
    const res = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111/memberships', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({
        principalId: '22222222-2222-2222-2222-222222222222',
        role: 'tenant-admin',
        reason: 'add admin',
      }),
    });
    expect(res.status).toBe(403);
  });

  test('membership attach positive path with proper scope', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(['platform:memberships:write']) });
    const res = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111/memberships', {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({
        principalId: '22222222-2222-2222-2222-222222222222',
        role: 'tenant-admin',
        reason: 'add admin',
      }),
    });
    expect(res.status).toBe(201);
    expect(spy.calls.find((c) => c.method === 'attachMembership')?.args[1]).toMatchObject({
      platformAction: 'membership.attach',
      targetTenantId: '11111111-1111-1111-1111-111111111111',
    });
  });

  test('membership mutation uses a nested tenant path and binds that exact tenant', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(['platform:memberships:write']) });
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const membershipId = '33333333-3333-3333-3333-333333333333';
    const response = await app.request(`/api/v2/platform/tenants/${tenantId}/memberships/${membershipId}/disable`, {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({ reason: 'approved offboarding' }),
    });
    expect(response.status).toBe(200);
    expect(spy.calls.find((call) => call.method === 'detachMembership')?.args[2]).toMatchObject({
      platformAction: 'membership.detach',
      targetTenantId: tenantId,
    });

    const oldGlobalPath = await app.request(`/api/v2/platform/memberships/${membershipId}/disable`, {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify({ reason: 'must not select globally' }),
    });
    expect([404, 405]).toContain(oldGlobalPath.status);
  });
});

describe('no hard delete', () => {
  test('DELETE on a tenant route does not exist (404/405, never 200)', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(['*']) });
    const res = await app.request('/api/v2/platform/tenants/11111111-1111-1111-1111-111111111111', {
      method: 'DELETE',
      ...AUTH,
    });
    expect([404, 405]).toContain(res.status);
  });
});
