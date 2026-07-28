/**
 * Tenant child-key creation over HTTP
 * (wish: omni-full-multitenancy, Group G4; ADR-0006).
 *
 * `route-ownership.ts` declares the `/keys` surface control-plane on the
 * grounds that "child keys are same-tenant only and cannot exceed the parent
 * scope/expiry/role ceiling". Until now that was a property of
 * `TenantKeyService` that no HTTP caller could reach: `POST /keys` always went
 * to the LEGACY `ApiKeyService`, so a tenant credential minting a key produced
 * a legacy `api_keys` row with no lineage, no tenant binding, and no ceiling —
 * a hole underneath the declaration. This suite is the contract for closing it.
 *
 * WHICH SERVICE HANDLES THE REQUEST IS DECIDED BY THE CREDENTIAL, NOT THE BODY
 * ---------------------------------------------------------------------------
 * A tenant auth context routes to the delegation path; its absence routes to
 * the legacy path, unchanged. That is the dual-world invariant for this route,
 * and the first test asserts the legacy side is not merely still working but
 * still reaching the SAME service with the SAME arguments.
 *
 * WHAT THE ROUTE ITSELF MUST ENFORCE
 * ----------------------------------
 * `TenantKeyService.createChildKey` enforces every ceiling transactionally, and
 * that is the real boundary. The route additionally refuses a scope the caller
 * does not hold BEFORE opening a transaction, so the ceiling is enforced at the
 * route as the WISH requires and a denial costs no database work. The tests
 * distinguish the two: a route-level refusal must never reach the service.
 *
 * The tenant is taken from the authenticated context and from nowhere else — a
 * `tenantId` in the body is inert, which is asserted rather than assumed.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { type TenantAuthContext, freezeContext } from '../../../tenancy/auth-context';
import type { ApiKeyData, AppVariables } from '../../../types';
import { keysRoutes } from '../keys';

const TENANT_ID = '11111111-1111-4111-8111-11111111111a';
const OTHER_TENANT = '22222222-2222-4222-8222-22222222222b';
const LINEAGE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INSTANCE_A = '55555555-5555-4555-8555-55555555555a';

type ChildCall = {
  actor: TenantAuthContext;
  parentKeyId: string;
  name: string;
  reason: string;
  request: {
    scopes: readonly string[];
    resourceConstraints?: Record<string, readonly string[]>;
    expiresAt?: Date | null;
    rateLimit?: number | null;
    budget?: number | null;
    role?: string;
  };
};

/** The single recorded delegation call, or a hard failure. */
function onlyCall(calls: ChildCall[]): ChildCall {
  const call = calls[0];
  if (!call) throw new Error('expected exactly one createChildKey call, got none');
  return call;
}

function tenantContext(overrides: Partial<TenantAuthContext> = {}): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-1',
    principalId: '33333333-3333-4333-8333-333333333331',
    credentialId: '99999999-9999-4999-8999-999999999992',
    tenantId: TENANT_ID,
    tenantSlug: 'tenant-a',
    actorRole: 'tenant-admin',
    scopes: ['keys:write', 'messages:read', 'chats:read'],
    membershipId: '44444444-4444-4444-8444-444444444441',
    resourceConstraints: { instanceAllowlist: [INSTANCE_A] },
    expiresAt: null,
    rateLimit: 100,
    budget: 1000,
    delegationDepth: 0,
    rootKeyId: LINEAGE_ID,
    policyVersion: 1,
    revocationEpoch: 0,
    tenantKeyLineageId: LINEAGE_ID,
    ...overrides,
  }) as TenantAuthContext;
}

type ChildResult =
  | { status: 'created'; issued: { lineage: Record<string, unknown>; plainTextKey: string } }
  | { status: 'parent_not_found' }
  | { status: 'denied'; violations: string[] };

const createdLineage = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  tenantId: TENANT_ID,
  actorRole: 'tenant-operator',
  scopes: ['messages:read'],
  resourceConstraints: { instanceAllowlist: [INSTANCE_A] },
  depth: 1,
  rootKeyId: LINEAGE_ID,
  expiresAt: null,
  rateLimit: 10,
  budget: 100,
  // Present on the real row, and must NOT be echoed to the caller.
  keyHash: 'deadbeef'.repeat(8),
};

function mount(options: { authContext?: TenantAuthContext; childResult?: ChildResult } = {}) {
  const childCalls: ChildCall[] = [];
  const legacyCalls: Record<string, unknown>[] = [];
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('services', {
      apiKeys: {
        create: mock(async (opts: Record<string, unknown>) => {
          legacyCalls.push(opts);
          return { key: { id: 'k_1', ...opts }, plainTextKey: 'omni_legacy_key' };
        }),
      },
      tenantKeys: {
        createChildKey: mock(async (opts: ChildCall) => {
          childCalls.push(opts);
          return (
            options.childResult ?? {
              status: 'created',
              issued: { lineage: createdLineage, plainTextKey: 'omni_sk_childPlaintext' },
            }
          );
        }),
      },
    } as never);
    c.set('apiKey', {
      id: 'minter',
      name: 'minter',
      scopes: options.authContext ? [...options.authContext.scopes] : ['*'],
      instanceIds: null,
      expiresAt: null,
      profile: null,
      chatAllowlist: [],
      instanceAllowlist: [],
      outboundRecipientAllowlist: [],
    } satisfies ApiKeyData);
    if (options.authContext) c.set('authContext', options.authContext);
    await next();
  });
  app.route('/keys', keysRoutes);

  const post = (body: unknown) =>
    app.request('/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return { post, childCalls, legacyCalls };
}

describe('the legacy world is untouched', () => {
  test('a caller with no tenant context still mints through ApiKeyService', async () => {
    const { post, childCalls, legacyCalls } = mount();
    const response = await post({ name: 'ops', scopes: ['messages:read'] });

    expect(response.status).toBe(201);
    expect(childCalls).toHaveLength(0);
    expect(legacyCalls).toHaveLength(1);
    expect(legacyCalls[0]).toMatchObject({ name: 'ops', scopes: ['messages:read'] });
    const body = (await response.json()) as { data: { plainTextKey: string } };
    expect(body.data.plainTextKey).toBe('omni_legacy_key');
  });
});

describe('a tenant credential mints a bounded child key instead', () => {
  test('the delegation request is built from the body and the context', async () => {
    const { post, childCalls, legacyCalls } = mount({ authContext: tenantContext() });
    const response = await post({
      name: 'reader',
      scopes: ['messages:read'],
      instanceAllowlist: [INSTANCE_A],
      rateLimit: 10,
      expiresAt: '2026-09-01T00:00:00.000Z',
      reason: 'read-only integration key',
    });

    expect(response.status).toBe(201);
    expect(legacyCalls).toHaveLength(0);
    expect(childCalls).toHaveLength(1);

    const call = onlyCall(childCalls);
    // The parent is the caller's OWN lineage — never anything from the body.
    expect(call.parentKeyId).toBe(LINEAGE_ID);
    expect(call.actor.tenantId).toBe(TENANT_ID);
    expect(call.name).toBe('reader');
    expect(call.reason).toBe('read-only integration key');
    expect(call.request.scopes).toEqual(['messages:read']);
    expect(call.request.resourceConstraints).toEqual({ instanceAllowlist: [INSTANCE_A] });
    expect(call.request.rateLimit).toBe(10);
    expect(call.request.expiresAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  test('the response returns the plaintext once and never the stored digest', async () => {
    const { post } = mount({ authContext: tenantContext() });
    const response = await post({ name: 'reader', scopes: ['messages:read'] });
    const raw = await response.text();

    expect(raw).toContain('omni_sk_childPlaintext');
    expect(raw).not.toContain(createdLineage.keyHash);
    expect(raw).not.toMatch(/keyHash|key_hash/i);

    const body = JSON.parse(raw) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      id: createdLineage.id,
      tenantId: TENANT_ID,
      role: 'tenant-operator',
      scopes: ['messages:read'],
      delegationDepth: 1,
    });
  });

  test('a body tenantId naming another tenant is inert', async () => {
    const { post, childCalls } = mount({ authContext: tenantContext() });
    await post({ name: 'reader', scopes: ['messages:read'], tenantId: OTHER_TENANT });
    expect(onlyCall(childCalls).actor.tenantId).toBe(TENANT_ID);
    expect(JSON.stringify(onlyCall(childCalls).request)).not.toContain(OTHER_TENANT);
  });

  test('a narrower role is passed through', async () => {
    const { post, childCalls } = mount({ authContext: tenantContext() });
    await post({ name: 'reader', scopes: ['messages:read'], role: 'tenant-viewer' });
    expect(onlyCall(childCalls).request.role).toBe('tenant-viewer');
  });

  test('an unknown role is rejected before any transaction opens', async () => {
    const { post, childCalls } = mount({ authContext: tenantContext() });
    const response = await post({ name: 'reader', scopes: ['messages:read'], role: 'root' });
    expect(response.status).toBe(400);
    expect(childCalls).toHaveLength(0);
  });
});

describe('ceilings are enforced at the route as well as in the transaction', () => {
  test('a scope the caller does not hold is refused without touching the service', async () => {
    const { post, childCalls } = mount({ authContext: tenantContext() });
    const response = await post({ name: 'escalate', scopes: ['*'] });

    expect(response.status).toBe(403);
    expect(childCalls).toHaveLength(0);
  });

  test('a transactional denial surfaces as 403 with its violations', async () => {
    const { post } = mount({
      authContext: tenantContext(),
      childResult: { status: 'denied', violations: ['expiry exceeds parent ceiling'] },
    });
    const response = await post({ name: 'reader', scopes: ['messages:read'] });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { details?: { violations?: string[] } } };
    expect(body.error.details?.violations).toEqual(['expiry exceeds parent ceiling']);
  });

  test('a missing parent lineage is a 404, not a 500', async () => {
    const { post } = mount({
      authContext: tenantContext(),
      childResult: { status: 'parent_not_found' },
    });
    expect((await post({ name: 'reader', scopes: ['messages:read'] })).status).toBe(404);
  });

  test('scopes are required — a tenant child key is never implicitly broad', async () => {
    const { post, childCalls } = mount({ authContext: tenantContext() });
    expect((await post({ name: 'reader' })).status).toBe(400);
    expect(childCalls).toHaveLength(0);
  });

  test('a legacy profile cannot be used to shape a tenant child key', async () => {
    // Profiles resolve to legacy scope bundles with legacy allowlist semantics;
    // routing one into the delegation path would mean a ceiling evaluated
    // against scopes the tenant role policy never vetted.
    const { post, childCalls } = mount({ authContext: tenantContext() });
    const response = await post({ name: 'reader', profile: 'cs' });
    expect(response.status).toBe(400);
    expect(childCalls).toHaveLength(0);
  });

  test('the admin-profile refusal still fires first for a tenant caller', async () => {
    const { post, childCalls } = mount({ authContext: tenantContext() });
    const response = await post({ name: 'god', profile: 'admin', scopes: ['messages:read'] });
    expect(response.status).toBe(403);
    expect(childCalls).toHaveLength(0);
  });
});
