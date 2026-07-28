/**
 * Schema contract tests for the multitenancy control plane
 * (wish: omni-full-multitenancy, Group G1).
 *
 * Pure type/structure-level tests — no DB roundtrips. They pin the contract the
 * later groups (auth bootstrap, RLS, route conversion) depend on: table shapes,
 * fixed role/status/class enums, and the additive-only guarantee.
 */

import { describe, expect, test } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  type AuthCredential,
  type CredentialClass,
  type Tenant,
  type TenantRole,
  authCredentialStatuses,
  authCredentials,
  credentialClasses,
  membershipStatuses,
  platformApiKeyStatuses,
  platformApiKeys,
  platformAuditLogs,
  principalStatuses,
  principalTypes,
  principals,
  tenantAuditLogs,
  tenantKeyLineage,
  tenantMemberships,
  tenantRolePolicies,
  tenantRoles,
  tenantStatuses,
  tenants,
} from './schema';

describe('multitenancy control-plane enums', () => {
  test('fixed tenant roles are exactly the four bounded roles', () => {
    expect([...tenantRoles]).toEqual(['tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer']);
  });

  test('tenant lifecycle has no hard-delete state (ends at archived)', () => {
    expect([...tenantStatuses]).toEqual(['active', 'suspended', 'archived']);
    expect(tenantStatuses).not.toContain('deleted');
  });

  test('credential classes are exactly tenant | platform', () => {
    expect([...credentialClasses]).toEqual(['tenant', 'platform']);
  });

  test('principal / membership / credential statuses are bounded', () => {
    expect([...principalTypes]).toEqual(['human', 'service']);
    expect([...principalStatuses]).toEqual(['active', 'disabled']);
    expect([...membershipStatuses]).toEqual(['active', 'disabled']);
    expect([...authCredentialStatuses]).toEqual(['active', 'revoked', 'expired']);
    expect([...platformApiKeyStatuses]).toEqual(['active', 'revoked']);
  });
});

describe('tenants table', () => {
  test('carries lifecycle, epochs, and immutable identity columns', () => {
    const cols = Object.keys(tenants);
    for (const c of [
      'id',
      'slug',
      'displayName',
      'status',
      'policyVersion',
      'revocationEpoch',
      'createdByPrincipalId',
      'createdAt',
      'updatedAt',
      'suspendedAt',
      'archivedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  test('select type exposes lifecycle + epoch fields', () => {
    const _shape: Pick<Tenant, 'id' | 'slug' | 'status' | 'policyVersion' | 'revocationEpoch'> = {
      id: '',
      slug: 't',
      status: 'active',
      policyVersion: 1,
      revocationEpoch: 0,
    };
    expect(_shape.status).toBe('active');
  });
});

describe('principals & memberships', () => {
  test('principals hold no tenant business data (identity-only columns)', () => {
    const cols = Object.keys(principals);
    for (const c of ['id', 'type', 'subject', 'status']) expect(cols).toContain(c);
    // A principal must NOT carry a tenant binding — that is the membership's job.
    expect(cols).not.toContain('tenantId');
  });

  test('memberships bind principal <-> tenant with a role + status', () => {
    const cols = Object.keys(tenantMemberships);
    for (const c of ['id', 'tenantId', 'principalId', 'role', 'status']) expect(cols).toContain(c);
  });
});

describe('role policy registry', () => {
  test('carries bounded ceiling columns', () => {
    const cols = Object.keys(tenantRolePolicies);
    for (const c of ['role', 'maxScopes', 'canManageMemberships', 'canDelegateKeys', 'maxDelegationDepth']) {
      expect(cols).toContain(c);
    }
  });
});

describe('credential class separation', () => {
  test('auth_credentials index carries class + isolated source links', () => {
    const cols = Object.keys(authCredentials);
    for (const c of [
      'id',
      'credentialClass',
      'keyHash',
      'tenantId',
      'principalId',
      'membershipId',
      'actorRole',
      'scopes',
      'status',
      'tenantKeyLineageId',
      'platformApiKeyId',
      'policySnapshotVersion',
      'revocationEpochSnapshot',
    ]) {
      expect(cols).toContain(c);
    }
  });

  test('tenant credential identity and role are bound to one canonical lineage row', () => {
    const lineageConfig = getTableConfig(tenantKeyLineage);
    const bindingIndex = lineageConfig.indexes.find(
      (candidate) => candidate.config.name === 'tenant_key_lineage_auth_binding_uq',
    );
    expect(bindingIndex?.config.unique).toBe(true);
    const bindingIndexColumnNames = bindingIndex?.config.columns.flatMap((column) =>
      'name' in column && typeof column.name === 'string' ? [column.name] : [],
    );
    expect(bindingIndexColumnNames).toEqual(['tenant_id', 'id', 'principal_id', 'membership_id', 'actor_role']);

    const credentialConfig = getTableConfig(authCredentials);
    const bindingFk = credentialConfig.foreignKeys.find(
      (candidate) => candidate.getName() === 'auth_credentials_tenant_lineage_binding_fk',
    );
    expect(bindingFk).toBeDefined();
    expect(bindingFk?.reference().columns.map((column) => column.name)).toEqual([
      'tenant_id',
      'tenant_key_lineage_id',
      'principal_id',
      'membership_id',
      'actor_role',
    ]);
    expect(bindingFk?.reference().foreignColumns.map((column) => column.name)).toEqual([
      'tenant_id',
      'id',
      'principal_id',
      'membership_id',
      'actor_role',
    ]);
  });

  test('platform keys and tenant lineage are distinct tables', () => {
    expect(Object.keys(platformApiKeys)).toContain('keyHash');
    // Hashes stay in the isolated platform-owned auth plane. Tenant-visible
    // lineage carries only the non-secret prefix and delegation metadata.
    expect(Object.keys(tenantKeyLineage)).not.toContain('keyHash');
    expect(Object.keys(tenantKeyLineage)).toContain('keyPrefix');
    // The tenant lineage table (NOT platform keys) carries delegation lineage.
    const lineageCols = Object.keys(tenantKeyLineage);
    for (const c of ['tenantId', 'parentKeyId', 'rootKeyId', 'depth', 'ancestorRevoked', 'ceilingSnapshot']) {
      expect(lineageCols).toContain(c);
    }
    expect(Object.keys(platformApiKeys)).not.toContain('parentKeyId');
  });

  test('AuthCredential class type is the bounded union', () => {
    const _class: CredentialClass = 'tenant';
    const _shape: Pick<AuthCredential, 'credentialClass' | 'keyHash'> = {
      credentialClass: _class,
      keyHash: 'deadbeef',
    };
    expect(_shape.credentialClass).toBe('tenant');
  });
});

describe('split audit stores', () => {
  test('tenant audit rows carry tenant_id; platform audit rows carry target tenant + reason', () => {
    expect(Object.keys(tenantAuditLogs)).toContain('tenantId');
    const platformCols = Object.keys(platformAuditLogs);
    for (const c of ['targetTenantId', 'reason', 'requestId', 'beforeMetadata', 'afterMetadata']) {
      expect(platformCols).toContain(c);
    }
  });
});

describe('lineage invariants', () => {
  test('tenant_key_lineage encodes parent/root/creator + delegation depth', () => {
    const cols = Object.keys(tenantKeyLineage);
    for (const c of ['parentKeyId', 'rootKeyId', 'depth', 'createdByPrincipalId', 'revocationEpoch']) {
      expect(cols).toContain(c);
    }
  });

  test('TenantRole type is assignable only from the fixed set', () => {
    const roles: TenantRole[] = ['tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer'];
    expect(roles).toHaveLength(4);
  });
});
