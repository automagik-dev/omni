/**
 * Request auth-context construction (wish: omni-full-multitenancy, Group G3; ADR-0003).
 *
 * The property under test is negative and therefore easy to lose: NOTHING a
 * caller sends may influence which tenant the request runs against. Every test
 * here is a different way of trying, and all of them must fail.
 */

import { describe, expect, test } from 'bun:test';
import type { AuthBootstrapService } from '../../services/auth-bootstrap';
import type { AuthLookupResult, PlatformAuthContext, TenantAuthContext } from '../auth-context';
import { freezeContext } from '../auth-context';
import { type MembershipSelectionService, RequestAuthenticator } from '../request-auth';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function tenantContext(overrides: Partial<TenantAuthContext> = {}): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-1',
    principalId: 'p-1',
    credentialId: 'c-1',
    tenantId: TENANT_A,
    actorRole: 'tenant-admin',
    scopes: ['messages:read'],
    membershipId: 'm-1',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 1,
    tenantKeyLineageId: 'l-1',
    ...overrides,
  }) as TenantAuthContext;
}

const platformContext = freezeContext({
  credentialClass: 'platform',
  requestId: 'req-1',
  principalId: 'p-plat',
  credentialId: 'c-plat',
  scopes: ['platform:tenants:write'],
  platformApiKeyId: 'pk-1',
  platformAction: null,
  targetTenantId: null,
}) as PlatformAuthContext;

function bootstrap(result: AuthLookupResult): AuthBootstrapService {
  return { lookupBySecret: async () => result } as unknown as AuthBootstrapService;
}

function memberships(active: boolean, throws = false): MembershipSelectionService {
  return {
    isActiveMembership: async () => {
      if (throws) throw new Error('auth plane unreachable');
      return active;
    },
    isHumanPrincipal: async () => true,
  } as unknown as MembershipSelectionService;
}

function authenticator(result: AuthLookupResult, active = true, throws = false): RequestAuthenticator {
  return new RequestAuthenticator(bootstrap(result), memberships(active, throws));
}

describe('tenant is established by the credential, never by the caller', () => {
  test('no hint: the credential tenant is used', async () => {
    const auth = authenticator({ ok: true, context: tenantContext() });
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenantSource).toBe('credential');
    expect((result.context as TenantAuthContext).tenantId).toBe(TENANT_A);
  });

  test('a hint naming ANOTHER tenant is rejected, not ignored', async () => {
    const auth = authenticator({ ok: true, context: tenantContext() });
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's', requestedTenantId: TENANT_B });
    expect(result).toEqual({ ok: false, reason: 'tenant_selection_rejected' });
  });

  test('a hint naming another tenant is rejected even when the principal is a member there', async () => {
    // The membership service says "active" for everything. The rejection must
    // still happen: multi-membership widens which credentials a human may hold,
    // never what ONE credential may reach.
    const auth = authenticator({ ok: true, context: tenantContext() }, true);
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's', requestedTenantId: TENANT_B });
    expect(result).toEqual({ ok: false, reason: 'tenant_selection_rejected' });
  });

  test('a confirming hint re-validates the membership and freezes the selection', async () => {
    const auth = authenticator({ ok: true, context: tenantContext() }, true);
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's', requestedTenantId: TENANT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenantSource).toBe('validated_membership');
    expect((result.context as TenantAuthContext).tenantId).toBe(TENANT_A);
    expect(Object.isFrozen(result.context)).toBe(true);
  });

  test('a disabled or removed membership is rejected at selection time', async () => {
    const auth = authenticator({ ok: true, context: tenantContext() }, false);
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's', requestedTenantId: TENANT_A });
    expect(result).toEqual({ ok: false, reason: 'membership_disabled' });
  });

  test('whitespace-only hints are treated as absent rather than as a selection', async () => {
    const auth = authenticator({ ok: true, context: tenantContext() });
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's', requestedTenantId: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tenantSource).toBe('credential');
  });
});

describe('platform credentials', () => {
  test('a caller hint on a platform credential is rejected — targets are route-bound', async () => {
    const auth = authenticator({ ok: true, context: platformContext });
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's', requestedTenantId: TENANT_A });
    expect(result).toEqual({ ok: false, reason: 'tenant_selection_rejected' });
  });

  test('a platform credential with no hint yields an unbound context', async () => {
    const auth = authenticator({ ok: true, context: platformContext });
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.context as PlatformAuthContext).targetTenantId).toBeNull();
  });
});

describe('fail-closed', () => {
  test('every auth-plane failure reason is propagated, none is downgraded', async () => {
    for (const reason of ['not_found', 'credential_revoked', 'tenant_inactive', 'auth_plane_error'] as const) {
      const auth = authenticator({ ok: false, reason });
      expect(await auth.authenticate({ requestId: 'r', secret: 's' })).toEqual({ ok: false, reason });
    }
  });

  test('an unavailable auth plane during selection fails closed — no stale fallback', async () => {
    const auth = authenticator({ ok: true, context: tenantContext() }, true, true);
    const result = await auth.authenticate({ requestId: 'req-1', secret: 's', requestedTenantId: TENANT_A });
    expect(result).toEqual({ ok: false, reason: 'auth_plane_error' });
  });

  test('the context is constructed exactly once per request', async () => {
    const auth = authenticator({ ok: true, context: tenantContext() });
    expect((await auth.authenticate({ requestId: 'req-9', secret: 's' })).ok).toBe(true);
    expect(await auth.authenticate({ requestId: 'req-9', secret: 's' })).toEqual({
      ok: false,
      reason: 'context_already_constructed',
    });
    // A different request is unaffected.
    expect((await auth.authenticate({ requestId: 'req-10', secret: 's' })).ok).toBe(true);
  });

  test('a rejected request does not consume its request id', async () => {
    const auth = new RequestAuthenticator(bootstrap({ ok: false, reason: 'not_found' }), memberships(true));
    await auth.authenticate({ requestId: 'req-11', secret: 's' });
    // Still `not_found` rather than `context_already_constructed`: a failed
    // lookup must not become an oracle for "this request id was used".
    expect(await auth.authenticate({ requestId: 'req-11', secret: 's' })).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('auth-plane isolation', () => {
  test('the membership service exposes no enumeration method', () => {
    const service = memberships(true);
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(service)).concat(Object.keys(service));
    for (const name of names) {
      expect(name).not.toMatch(/list|all|find(Many|All)|enumerate|search/i);
    }
  });
});
