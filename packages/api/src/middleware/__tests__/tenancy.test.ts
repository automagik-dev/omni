/**
 * The tenancy edge (wish: omni-full-multitenancy, Group G4).
 *
 * This middleware is where the two worlds are chosen between, so its tests are
 * written as a pair: every tenant-world assertion has a legacy-world twin that
 * proves the same request is untouched. A regression that scoped a legacy
 * request — or failed to scope a tenant one — must turn exactly one of these
 * red, not merely change a body somewhere downstream.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AuthContext } from '../../tenancy/auth-context';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import type { AppVariables } from '../../types';
import { tenancyMiddleware } from '../tenancy';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

// The edge only consults the auth plane when the control plane that issues
// tenant credentials is mounted. Every existing assertion here is about the
// flag-ON world (a tenant credential can exist); a dedicated flag-OFF block
// below proves the lookup is skipped entirely. Set per test so the
// environment never leaks between blocks.
beforeEach(() => {
  process.env[MULTITENANCY_FLAG_ENV] = 'true';
});
afterEach(() => {
  delete process.env[MULTITENANCY_FLAG_ENV];
});

function tenantContext(tenantId: string, overrides: Partial<Record<string, unknown>> = {}): AuthContext {
  return {
    credentialClass: 'tenant',
    requestId: 'req-1',
    principalId: 'principal-1',
    credentialId: 'credential-1',
    tenantId,
    actorRole: 'tenant-admin',
    scopes: ['messages:read', 'messages:write'],
    membershipId: 'membership-1',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 1,
    tenantKeyLineageId: 'lineage-1',
    ...overrides,
  } as AuthContext;
}

/** Minimal harness: a route that reports what the edge established. */
function harness(authenticate: (input: unknown) => Promise<unknown>) {
  const app = new Hono<{ Variables: AppVariables }>();
  const db = {
    __handle: 'pool',
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ __handle: 'tx', execute: async () => [] }),
  };
  app.use('*', async (c, next) => {
    c.set('db', db as never);
    c.set('requestId', 'req-1');
    c.set('services', { requestAuthenticator: { authenticate, release: () => {} } } as never);
    await next();
  });
  app.use('*', tenancyMiddleware);
  app.get('/probe', (c) =>
    c.json({
      scopedTenant: currentTenantScope()?.tenantId ?? null,
      contextTenant: (c.get('authContext') as { tenantId?: string } | undefined)?.tenantId ?? null,
      apiKeyId: c.get('apiKey')?.id ?? null,
      scopes: c.get('apiKey')?.scopes ?? null,
    }),
  );
  // A handler that reaches for the database directly, as several v2 routes do.
  app.get('/raw-db', (c) => c.json({ handle: (c.get('db') as unknown as { __handle: string }).__handle }));
  return app;
}

describe('tenancy edge — legacy world (default, flag off)', () => {
  test('a legacy credential establishes no context and no scope', async () => {
    const app = harness(async () => ({ ok: false, reason: 'not_found' }));
    const res = await app.request('/probe', { headers: { 'x-api-key': 'legacy-key' } });

    expect(res.status).toBe(200);
    // The whole legacy contract in one assertion: nothing was established, so
    // downstream services see the ambient pool exactly as they did pre-G4.
    expect(await res.json()).toEqual({ scopedTenant: null, contextTenant: null, apiKeyId: null, scopes: null });
  });

  test('an unauthenticated request is passed through untouched for authMiddleware to reject', async () => {
    const authenticate = mock(async () => ({ ok: false, reason: 'not_found' }));
    const app = harness(authenticate);
    const res = await app.request('/probe');

    expect(res.status).toBe(200);
    // No credential means no auth-plane lookup at all — the edge must not turn
    // an anonymous request into a credential probe.
    expect(authenticate).not.toHaveBeenCalled();
  });

  test('an auth-plane outage does not convert a legacy request into a failure', async () => {
    const app = harness(async () => ({ ok: false, reason: 'auth_plane_error' }));
    const res = await app.request('/probe', { headers: { 'x-api-key': 'legacy-key' } });

    // A tenant credential cannot be confirmed, so the request continues as
    // legacy and authMiddleware decides. Failing the request here would break
    // flag-off availability on an auth-plane blip.
    expect(res.status).toBe(200);
    expect(((await res.json()) as { scopedTenant: string | null }).scopedTenant).toBeNull();
  });
});

describe('tenancy edge — flag off (no control plane mounted)', () => {
  // A flag-off deployment has no tenant control plane, so no tenant credential
  // can exist. The edge must therefore add ZERO database round-trips over its
  // pre-G4 behaviour: it may not probe the auth plane at all, even when a
  // credential is presented. Turn the flag OFF for this block only.
  beforeEach(() => {
    delete process.env[MULTITENANCY_FLAG_ENV];
  });

  test('a presented credential does NOT trigger an auth-plane lookup', async () => {
    const authenticate = mock(async () => ({ ok: false, reason: 'not_found' }));
    const app = harness(authenticate);
    const res = await app.request('/probe', { headers: { 'x-api-key': 'some-key' } });

    expect(res.status).toBe(200);
    // The lookup is a `lookupBySecret` SELECT on auth_credentials. Flag off, it
    // could only ever return not_found, so it must never be issued: legacy
    // traffic stays byte-for-byte legacy with no extra DB work.
    expect(authenticate).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ scopedTenant: null, contextTenant: null, apiKeyId: null, scopes: null });
  });

  test('a bearer credential likewise reaches the legacy world untouched', async () => {
    const authenticate = mock(async () => ({ ok: false, reason: 'not_found' }));
    const app = harness(authenticate);
    const res = await app.request('/raw-db', { headers: { authorization: 'Bearer some-key' } });

    expect(res.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
    // No scope established, so a handler that reads the db sees the ambient pool.
    expect(await res.json()).toEqual({ handle: 'pool' });
  });
});

describe('tenancy edge — tenant world (flag on)', () => {
  test('a recognised tenant credential is scoped once the flag is on', async () => {
    // The flag gates only WHETHER the auth plane is consulted (proven in the
    // flag-off block above: flag off ⇒ zero round-trips, no scope). Once the
    // flag is on and a credential is RECOGNISED as tenant-class, scoping is not
    // re-litigated per request — the recognised credential is always scoped.
    const app = harness(async () => ({ ok: true, context: tenantContext(TENANT_A), tenantSource: 'credential' }));
    const res = await app.request('/probe', { headers: { 'x-api-key': 'tenant-key' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scopedTenant: TENANT_A,
      contextTenant: TENANT_A,
      apiKeyId: 'credential-1',
      scopes: ['messages:read', 'messages:write'],
    });
  });

  test('the scope is torn down after the response', async () => {
    const app = harness(async () => ({ ok: true, context: tenantContext(TENANT_A), tenantSource: 'credential' }));
    await app.request('/probe', { headers: { 'x-api-key': 'tenant-key' } });
    expect(currentTenantScope()).toBeNull();
  });

  test('a confirming tenant header is accepted and reported as validated', async () => {
    const seen: unknown[] = [];
    const app = harness(async (input) => {
      seen.push(input);
      return { ok: true, context: tenantContext(TENANT_A), tenantSource: 'validated_membership' };
    });
    const res = await app.request('/probe', {
      headers: { 'x-api-key': 'tenant-key', 'x-omni-tenant-id': TENANT_A },
    });

    expect(res.status).toBe(200);
    // The hint is forwarded as ADVISORY input to the authenticator — the edge
    // never resolves it itself.
    expect((seen[0] as { requestedTenantId?: string }).requestedTenantId).toBe(TENANT_A);
    expect(((await res.json()) as { scopedTenant: string | null }).scopedTenant).toBe(TENANT_A);
  });
});

describe('tenancy edge — tenant header confusion', () => {
  test('a header naming another tenant is rejected uniformly', async () => {
    const app = harness(async () => ({ ok: false, reason: 'tenant_selection_rejected' }));
    const res = await app.request('/probe', {
      headers: { 'x-api-key': 'tenant-key', 'x-omni-tenant-id': TENANT_B },
    });

    expect(res.status).toBe(401);
    // Uniform, non-enumerating: the body must not reveal that the OTHER tenant
    // exists, nor that the rejection was about tenant selection specifically.
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(body)).not.toContain(TENANT_B);
    expect(JSON.stringify(body)).not.toContain('tenant_selection_rejected');
  });

  test('rejection is identical whether or not the caller holds a membership elsewhere', async () => {
    // Both cases surface as the same typed failure from the authenticator, and
    // the edge must not distinguish them — otherwise the response is a
    // membership oracle for foreign tenants.
    const withMembership = harness(async () => ({ ok: false, reason: 'tenant_selection_rejected' }));
    const withoutMembership = harness(async () => ({ ok: false, reason: 'tenant_selection_rejected' }));

    const a = await withMembership.request('/probe', {
      headers: { 'x-api-key': 'tenant-key', 'x-omni-tenant-id': TENANT_B },
    });
    const b = await withoutMembership.request('/probe', {
      headers: { 'x-api-key': 'tenant-key', 'x-omni-tenant-id': TENANT_B },
    });

    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
  });

  test('a revoked membership on a confirming hint is rejected', async () => {
    const app = harness(async () => ({ ok: false, reason: 'membership_disabled' }));
    const res = await app.request('/probe', {
      headers: { 'x-api-key': 'tenant-key', 'x-omni-tenant-id': TENANT_A },
    });

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });
});

describe('tenancy edge — handlers that use the database directly', () => {
  test('a tenant request sees the transaction, not the pool', async () => {
    const app = harness(async () => ({ ok: true, context: tenantContext(TENANT_A), tenantSource: 'credential' }));
    const res = await app.request('/raw-db', { headers: { 'x-api-key': 'tenant-key' } });

    // Routes like v2/messages and v2/handoffs query through `c.get('db')`.
    // If this returned the pool they would read across tenants while every
    // service around them stayed correctly scoped.
    expect(await res.json()).toEqual({ handle: 'tx' });
  });

  test('a legacy request still sees the ambient pool', async () => {
    const app = harness(async () => ({ ok: false, reason: 'not_found' }));
    const res = await app.request('/raw-db', { headers: { 'x-api-key': 'legacy-key' } });

    expect(await res.json()).toEqual({ handle: 'pool' });
  });
});

describe('tenancy edge — the single-construction guard is not caller-addressable', () => {
  test('two requests sharing a caller-supplied x-request-id both succeed', async () => {
    // `RequestAuthenticator` refuses a second construction per request id, and
    // the context middleware honours an inbound `x-request-id`. If the edge
    // keyed the guard on that header, any caller could name another tenant's
    // in-flight request id and force it to 401 — a cross-tenant denial of
    // service requiring no credential at all.
    const seen: string[] = [];
    const app = harness(async (input) => {
      const id = (input as { requestId: string }).requestId;
      if (seen.includes(id)) return { ok: false, reason: 'context_already_constructed' };
      seen.push(id);
      return { ok: true, context: tenantContext(TENANT_A), tenantSource: 'credential' };
    });

    const headers = { 'x-api-key': 'tenant-key', 'x-request-id': 'collide-on-me' };
    const first = await app.request('/probe', { headers });
    const second = await app.request('/probe', { headers });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Distinct internal tokens, neither of them the caller's value.
    expect(new Set(seen).size).toBe(2);
    expect(seen).not.toContain('collide-on-me');
  });
});
