/**
 * Delegation invariant tests (wish: omni-full-multitenancy, Group G1; ADR-0006).
 *
 * Exercises every ceiling rule against a canonical active parent, then perturbs
 * one dimension per case to prove each invariant fails closed.
 */

import { describe, expect, test } from 'bun:test';
import {
  type DelegationRequest,
  type ParentKeySnapshot,
  type ParentTenantSnapshot,
  evaluateDelegation,
  scopeCovered,
} from '../delegation';

const TENANT: ParentTenantSnapshot = {
  id: 'tenant-1',
  status: 'active',
  maxKeyExpiresAt: new Date('2029-06-01T00:00:00Z'),
  maxKeyRateLimit: 100,
  maxKeyBudget: 1000,
};

const PARENT: ParentKeySnapshot = {
  tenantId: 'tenant-1',
  actorRole: 'tenant-admin',
  scopes: ['tenant:read', 'tenant:write', 'keys:delegate'],
  resourceConstraints: { instanceIds: ['i1', 'i2'] },
  depth: 0,
  rootKeyId: 'root-1',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  rateLimit: 100,
  budget: 1000,
  status: 'active',
  ancestorRevoked: false,
};

function req(overrides: Partial<DelegationRequest> = {}): DelegationRequest {
  return {
    scopes: ['tenant:read'],
    resourceConstraints: { instanceIds: ['i1'] },
    expiresAt: new Date('2029-01-01T00:00:00Z'),
    rateLimit: 50,
    budget: 500,
    ...overrides,
  };
}

describe('evaluateDelegation — happy path', () => {
  test('a narrowing child within every ceiling is accepted', () => {
    const result = evaluateDelegation(TENANT, PARENT, req());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.tenantId).toBe('tenant-1'); // §1 child tenant == parent
      expect(result.resolved.depth).toBe(1); // §6 depth increments
      expect(result.resolved.rootKeyId).toBe('root-1'); // §7 lineage preserved
      expect(result.resolved.ceilingSnapshot.parentScopes).toEqual(['tenant:read', 'tenant:write', 'keys:delegate']);
    }
  });

  test('a null child limit inherits the parent cap rather than widening', () => {
    const result = evaluateDelegation(TENANT, PARENT, req({ rateLimit: null, budget: null }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.rateLimit).toBe(100);
      expect(result.resolved.budget).toBe(1000);
    }
  });
});

describe('evaluateDelegation — invariant violations fail closed', () => {
  test('§2/§9 rejects the platform wildcard `*`', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ scopes: ['*'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('platform/wildcard');
  });

  test('§9 rejects a platform-namespaced scope', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ scopes: ['platform:tenants:write'] }));
    expect(r.ok).toBe(false);
  });

  test('§2 rejects a scope outside parent scopes', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ scopes: ['tenant:admin'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('not within parent scopes');
  });

  test('§2 rejects a scope outside the child role ceiling', () => {
    // Requested role viewer (read-only ceiling) but asking for write.
    const r = evaluateDelegation(TENANT, PARENT, req({ role: 'tenant-viewer', scopes: ['tenant:write'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('role ceiling');
  });

  test('§3 rejects widening a resource constraint', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ resourceConstraints: { instanceIds: ['i1', 'i3'] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('widens beyond parent');
  });

  test('§3 rejects omitting a constraint the parent restricts', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ resourceConstraints: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('unrestricted on child');
  });

  test('§4 rejects an expiry later than the parent', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ expiresAt: new Date('2031-01-01T00:00:00Z') }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('expiry');
  });

  test('§4 rejects a never-expiring child under a bounded parent', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ expiresAt: null }));
    expect(r.ok).toBe(false);
  });

  test('§5 rejects a rate limit above the parent', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ rateLimit: 200 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('rate limit');
  });

  test('§5 rejects a budget above the parent', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ budget: 5000 }));
    expect(r.ok).toBe(false);
  });

  test('§5 rejects rate/budget above tenant policy even when the parent is broader', () => {
    const broadParent: ParentKeySnapshot = { ...PARENT, rateLimit: 500, budget: 5000 };
    const r = evaluateDelegation(TENANT, broadParent, req({ rateLimit: 101, budget: 1001 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('tenant policy');
  });

  test('§6 requires the parent credential to carry keys:delegate explicitly', () => {
    const noDelegationCapability: ParentKeySnapshot = {
      ...PARENT,
      scopes: ['tenant:read', 'tenant:write'],
    };
    const r = evaluateDelegation(TENANT, noDelegationCapability, req());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('keys:delegate');
  });

  test('§6 rejects delegation past the role depth ceiling', () => {
    const deepParent: ParentKeySnapshot = { ...PARENT, depth: 1 }; // admin ceiling is 1
    const r = evaluateDelegation(TENANT, deepParent, req());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('delegation depth');
  });

  test('§6 rejects delegation by a non-delegating role', () => {
    const opParent: ParentKeySnapshot = { ...PARENT, actorRole: 'tenant-operator' };
    const r = evaluateDelegation(TENANT, opParent, req());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('may not delegate');
  });

  test('§8 rejects delegation for a suspended tenant', () => {
    const r = evaluateDelegation({ ...TENANT, status: 'suspended' }, PARENT, req());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('suspended');
  });

  test('§8 rejects delegation from a revoked parent', () => {
    const r = evaluateDelegation(TENANT, { ...PARENT, status: 'revoked' }, req());
    expect(r.ok).toBe(false);
  });

  test('§8 rejects delegation when an ancestor is revoked', () => {
    const r = evaluateDelegation(TENANT, { ...PARENT, ancestorRevoked: true }, req());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('ancestor');
  });

  test('§1 rejects a parent whose tenant mismatches the tenant context', () => {
    const r = evaluateDelegation({ ...TENANT, id: 'tenant-2' }, PARENT, req());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('does not match');
  });

  test('rejects role escalation from tenant-admin to tenant-owner', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ role: 'tenant-owner' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('role');
  });

  test('a present empty parent constraint is deny-all, not unrestricted', () => {
    const parent: ParentKeySnapshot = { ...PARENT, resourceConstraints: { instanceIds: [] } };
    const r = evaluateDelegation(TENANT, parent, req({ resourceConstraints: { instanceIds: ['i1'] } }));
    expect(r.ok).toBe(false);
  });

  test('rejects malformed constraints added only by the child', () => {
    const r = evaluateDelegation(
      TENANT,
      PARENT,
      req({ resourceConstraints: { instanceIds: ['i1'], forged: [42] as unknown as string[] } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('malformed');
  });

  test('rejects negative rate and budget limits', () => {
    const r = evaluateDelegation(TENANT, PARENT, req({ rateLimit: -1, budget: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(' ')).toContain('positive');
  });
});

describe('scopeCovered', () => {
  test('covers exact, namespace-wildcard, and global authority', () => {
    expect(scopeCovered(['tenant:read'], 'tenant:read')).toBe(true);
    expect(scopeCovered(['tenant:*'], 'tenant:read')).toBe(true);
    expect(scopeCovered(['*'], 'anything:goes')).toBe(true);
    expect(scopeCovered(['tenant:read'], 'tenant:write')).toBe(false);
  });
});
