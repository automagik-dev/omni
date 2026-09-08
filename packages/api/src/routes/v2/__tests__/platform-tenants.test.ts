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

/**
 * A realistic issued-root-key shape. `keyHash` is present exactly because the
 * real lineage row never carries one — the credential index does — so a route
 * that spreads whatever the service returns instead of projecting explicit
 * fields is caught leaking it.
 */
const issuedRootLineage = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  tenantId: '11111111-1111-1111-1111-111111111111',
  principalId: '22222222-2222-2222-2222-222222222222',
  membershipId: '33333333-3333-3333-3333-333333333333',
  actorRole: 'tenant-admin',
  name: 'bootstrap root',
  keyPrefix: 'abcd1234',
  scopes: ['tenant:*', 'keys:delegate'],
  resourceConstraints: {},
  status: 'active',
  parentKeyId: null,
  rootKeyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  depth: 0,
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  rateLimit: 100,
  budget: 1000,
  keyHash: 'deadbeef'.repeat(8),
};

function buildApp(
  authResult: AuthResult,
  controlPlaneOverrides: Record<string, unknown> = {},
  tenantKeyOverrides: Record<string, unknown> = {},
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

  const tenantKeys = {
    issueRootKey: record('issueRootKey', { lineage: issuedRootLineage, plainTextKey: 'omni_tk_rootPlaintextOnce' }),
    ...tenantKeyOverrides,
  };

  const services = {
    authBootstrap: { lookupBySecret: async () => authResult },
    tenantControlPlane,
    tenantKeys,
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

describe('root key issuance — POST /tenants/:id/keys/root (#979)', () => {
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const ISSUE_SCOPES = ['platform:tenant-keys:write', 'platform:tenants:write'];
  const validBody = {
    principalId: '22222222-2222-2222-2222-222222222222',
    membershipId: '33333333-3333-3333-3333-333333333333',
    role: 'tenant-admin',
    name: 'bootstrap root',
    scopes: ['tenant:*', 'keys:delegate'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    rateLimit: 100,
    budget: 1000,
    reason: 'bootstrap issuance OPS-1',
  };
  const issue = (app: Hono, body: unknown = validBody, tenantId = TENANT_ID) =>
    app.request(`/api/v2/platform/tenants/${tenantId}/keys/root`, {
      method: 'POST',
      ...AUTH,
      body: JSON.stringify(body),
    });
  const throwing = (message: string) => ({
    issueRootKey: async () => {
      throw new Error(message);
    },
  });

  test('happy path: 201, actor bound to the action and the path tenant, plaintext returned once', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(ISSUE_SCOPES) });
    const res = await issue(app);
    expect(res.status).toBe(201);

    const call = spy.calls.find((c) => c.method === 'issueRootKey');
    expect(call).toBeDefined();
    const options = call?.args[0] as {
      actor: { platformAction: string; targetTenantId: string | null };
      tenantId: string;
      actorRole: string;
      scopes: string[];
      reason: string;
      expiresAt: Date;
    };
    expect(options.actor.platformAction).toBe('tenant_key.issue_root');
    expect(options.actor.targetTenantId).toBe(TENANT_ID);
    expect(options.tenantId).toBe(TENANT_ID);
    expect(options.actorRole).toBe('tenant-admin');
    expect(options.scopes).toEqual(['tenant:*', 'keys:delegate']);
    expect(options.reason).toBe('bootstrap issuance OPS-1');
    expect(options.expiresAt).toBeInstanceOf(Date);

    const text = await res.text();
    const { data } = JSON.parse(text) as { data: Record<string, unknown> };
    expect(data.plainTextKey).toBe('omni_tk_rootPlaintextOnce');
    // Exactly once in the whole payload.
    expect(text.split('omni_tk_rootPlaintextOnce').length - 1).toBe(1);
    expect(data.delegationDepth).toBe(0);
    expect(data.tenantId).toBe(TENANT_ID);
    // The credential-index material never leaves the service.
    expect(data.keyHash).toBeUndefined();
    expect(data.keyPrefix).toBeUndefined();
    expect(text).not.toContain('deadbeef');
  });

  test('unauthenticated (no credential) → 401', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(ISSUE_SCOPES) });
    const res = await app.request(`/api/v2/platform/tenants/${TENANT_ID}/keys/root`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
    expect(spy.calls.find((c) => c.method === 'issueRootKey')).toBeUndefined();
  });

  test('legacy/unknown credential (not in the auth index) → uniform 401', async () => {
    const { app, spy } = buildApp({ ok: false, reason: 'not_found' });
    expect((await issue(app)).status).toBe(401);
    expect(spy.calls.find((c) => c.method === 'issueRootKey')).toBeUndefined();
  });

  test('tenant-class credential → 403, service never reached', async () => {
    const { app, spy } = buildApp({ ok: true, context: tenantCtx() });
    expect((await issue(app)).status).toBe(403);
    expect(spy.calls.find((c) => c.method === 'issueRootKey')).toBeUndefined();
  });

  test('platform credential without platform:tenant-keys:write → 403, service never reached', async () => {
    const { app, spy } = buildApp({
      ok: true,
      context: platformCtx(['platform:tenants:write', 'platform:memberships:write']),
    });
    expect((await issue(app)).status).toBe(403);
    expect(spy.calls.find((c) => c.method === 'issueRootKey')).toBeUndefined();
  });

  test('missing reason → 400, service never reached', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(ISSUE_SCOPES) });
    const { reason: _omitted, ...withoutReason } = validBody;
    expect((await issue(app, withoutReason)).status).toBe(400);
    expect(spy.calls.find((c) => c.method === 'issueRootKey')).toBeUndefined();
  });

  test('empty scopes → 400 before the service is reached', async () => {
    const { app, spy } = buildApp({ ok: true, context: platformCtx(ISSUE_SCOPES) });
    expect((await issue(app, { ...validBody, scopes: [] })).status).toBe(400);
    expect(spy.calls.find((c) => c.method === 'issueRootKey')).toBeUndefined();
  });

  test('wildcard/platform scopes fail closed as 400', async () => {
    const { app } = buildApp(
      { ok: true, context: platformCtx(ISSUE_SCOPES) },
      {},
      throwing('invalid root key request: scope "*" grants platform/wildcard authority'),
    );
    const res = await issue(app, { ...validBody, scopes: ['*'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('unknown tenant and cross-tenant subject are the SAME bare 404 — no membership oracle', async () => {
    const { app: unknownTenant } = buildApp(
      { ok: true, context: platformCtx(ISSUE_SCOPES) },
      {},
      throwing('tenant not found'),
    );
    const { app: foreignSubject } = buildApp(
      { ok: true, context: platformCtx(ISSUE_SCOPES) },
      {},
      throwing('invalid root key subject: membership not found'),
    );
    const a = await issue(unknownTenant);
    const b = await issue(foreignSubject);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
  });

  test('inactive tenant → 409 without echoing the lifecycle state', async () => {
    const { app } = buildApp({ ok: true, context: platformCtx(ISSUE_SCOPES) }, {}, throwing('tenant is suspended'));
    const res = await issue(app);
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain('suspended');
  });

  test('tenant policy ceiling violation → 403', async () => {
    const { app } = buildApp(
      { ok: true, context: platformCtx(ISSUE_SCOPES) },
      {},
      throwing('root key exceeds tenant policy: rate limit exceeds tenant policy'),
    );
    expect((await issue(app)).status).toBe(403);
  });

  test('a stale/underprivileged issuer is a 403, not a 500', async () => {
    const { app } = buildApp(
      { ok: true, context: platformCtx(ISSUE_SCOPES) },
      {},
      throwing('unauthorized root key issuer: platform credential is revoked'),
    );
    expect((await issue(app)).status).toBe(403);
  });

  test('an issuer lacking platform:tenants:write is refused by the service and mapped to 403', async () => {
    const { app } = buildApp(
      { ok: true, context: platformCtx(['platform:tenant-keys:write']) },
      {},
      throwing('root key issuance requires platform:tenants:write'),
    );
    expect((await issue(app)).status).toBe(403);
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
