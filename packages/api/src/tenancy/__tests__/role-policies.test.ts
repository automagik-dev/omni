/**
 * Fixed role ceiling tests (wish: omni-full-multitenancy, Group G1; ADR-0006).
 */

import { describe, expect, test } from 'bun:test';
import { TENANT_ROLE_POLICIES, getRolePolicy, isPlatformOrWildcardScope, isTenantRole } from '../role-policies';

describe('TENANT_ROLE_POLICIES', () => {
  test('defines exactly the four fixed roles', () => {
    expect(Object.keys(TENANT_ROLE_POLICIES).sort()).toEqual(
      ['tenant-admin', 'tenant-operator', 'tenant-owner', 'tenant-viewer'].sort(),
    );
  });

  test('no role ever carries platform or wildcard authority', () => {
    for (const policy of Object.values(TENANT_ROLE_POLICIES)) {
      for (const scope of policy.maxScopes) {
        expect(isPlatformOrWildcardScope(scope)).toBe(false);
      }
    }
  });

  test('owner/admin may delegate at depth 1; operator/viewer may not delegate', () => {
    expect(getRolePolicy('tenant-owner').canDelegateKeys).toBe(true);
    expect(getRolePolicy('tenant-admin').canDelegateKeys).toBe(true);
    expect(getRolePolicy('tenant-admin').maxDelegationDepth).toBe(1);
    expect(getRolePolicy('tenant-operator').canDelegateKeys).toBe(false);
    expect(getRolePolicy('tenant-operator').maxDelegationDepth).toBe(0);
    expect(getRolePolicy('tenant-viewer').canDelegateKeys).toBe(false);
  });

  test('only owner/admin manage memberships', () => {
    expect(getRolePolicy('tenant-owner').canManageMemberships).toBe(true);
    expect(getRolePolicy('tenant-admin').canManageMemberships).toBe(true);
    expect(getRolePolicy('tenant-operator').canManageMemberships).toBe(false);
    expect(getRolePolicy('tenant-viewer').canManageMemberships).toBe(false);
  });

  test('viewer ceiling is read-only', () => {
    expect([...getRolePolicy('tenant-viewer').maxScopes]).toEqual(['tenant:read']);
  });

  test('the policy table is deeply frozen (immutable at runtime)', () => {
    expect(Object.isFrozen(TENANT_ROLE_POLICIES)).toBe(true);
    expect(Object.isFrozen(TENANT_ROLE_POLICIES['tenant-owner'])).toBe(true);
    expect(Object.isFrozen(TENANT_ROLE_POLICIES['tenant-owner'].maxScopes)).toBe(true);
  });
});

describe('isPlatformOrWildcardScope', () => {
  test('flags wildcard and platform-namespaced scopes', () => {
    expect(isPlatformOrWildcardScope('*')).toBe(true);
    expect(isPlatformOrWildcardScope('platform:tenants:write')).toBe(true);
    expect(isPlatformOrWildcardScope('platform:*')).toBe(true);
    expect(isPlatformOrWildcardScope('tenant:read')).toBe(false);
    expect(isPlatformOrWildcardScope('messages:write')).toBe(false);
  });
});

describe('isTenantRole', () => {
  test('accepts the fixed roles and rejects forgeries', () => {
    expect(isTenantRole('tenant-owner')).toBe(true);
    expect(isTenantRole('tenant-admin')).toBe(true);
    expect(isTenantRole('platform-admin')).toBe(false);
    expect(isTenantRole('super')).toBe(false);
    expect(isTenantRole(null)).toBe(false);
    expect(isTenantRole(42)).toBe(false);
  });
});
