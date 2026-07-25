/**
 * Fixed tenant role registry and bounded ceilings
 * (wish: omni-full-multitenancy, Group G1; ADR-0006).
 *
 * There are EXACTLY four fixed roles. None of them may ever grant or mint the
 * platform `*` capability — this is guaranteed here (the `*` assertion below),
 * in the `tenant_role_policies` CHECK constraint, and in the `auth_credentials`
 * / `tenant_key_lineage` schema CHECKs. This module is the runtime source of
 * truth; the `tenant_role_policies` table mirrors it for auditability.
 */

import { type TenantRole, tenantRoles } from '@omni/db';

export interface TenantRolePolicyDefinition {
  readonly role: TenantRole;
  readonly description: string;
  /** Bounded scope ceiling. Never contains `*` or a `platform:*` grant. */
  readonly maxScopes: readonly string[];
  readonly canManageMemberships: boolean;
  readonly canDelegateKeys: boolean;
  /** Maximum delegation depth this role may create. Capped at 1 for G1 (ADR-0006 §6). */
  readonly maxDelegationDepth: number;
}

/**
 * The fixed policies. Kept in sync with migration 0040's seed rows.
 */
export const TENANT_ROLE_POLICIES: Readonly<Record<TenantRole, TenantRolePolicyDefinition>> = Object.freeze({
  'tenant-owner': Object.freeze({
    role: 'tenant-owner',
    description: 'Membership/lifecycle authority inside the tenant; cannot create platform authority.',
    maxScopes: Object.freeze(['tenant:*', 'keys:delegate']),
    canManageMemberships: true,
    canDelegateKeys: true,
    maxDelegationDepth: 1,
  }),
  'tenant-admin': Object.freeze({
    role: 'tenant-admin',
    description: 'Full tenant resource administration and bounded delegation.',
    maxScopes: Object.freeze(['tenant:*', 'keys:delegate']),
    canManageMemberships: true,
    canDelegateKeys: true,
    maxDelegationDepth: 1,
  }),
  'tenant-operator': Object.freeze({
    role: 'tenant-operator',
    description: 'Operational write access without membership/key-policy administration.',
    maxScopes: Object.freeze(['tenant:read', 'tenant:write']),
    canManageMemberships: false,
    canDelegateKeys: false,
    maxDelegationDepth: 0,
  }),
  'tenant-viewer': Object.freeze({
    role: 'tenant-viewer',
    description: 'Read-only tenant access.',
    maxScopes: Object.freeze(['tenant:read']),
    canManageMemberships: false,
    canDelegateKeys: false,
    maxDelegationDepth: 0,
  }),
});

/**
 * A scope that would grant platform-class or wildcard authority. Tenant roles,
 * memberships, and delegated keys must never carry any of these.
 */
export function isPlatformOrWildcardScope(scope: string): boolean {
  if (scope === '*') return true;
  const [namespace] = scope.split(':');
  return namespace === 'platform';
}

export function getRolePolicy(role: TenantRole): TenantRolePolicyDefinition {
  return TENANT_ROLE_POLICIES[role];
}

/** Runtime guard: reject an unknown/forged role string before trusting it. */
export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && (tenantRoles as readonly string[]).includes(value);
}

// Defensive invariant — fail the module load if a policy ever encodes platform
// authority. This makes an accidental future edit a hard, immediate failure.
for (const policy of Object.values(TENANT_ROLE_POLICIES)) {
  if (policy.maxScopes.some(isPlatformOrWildcardScope)) {
    throw new Error(`Tenant role ${policy.role} must not carry platform/wildcard authority`);
  }
}
