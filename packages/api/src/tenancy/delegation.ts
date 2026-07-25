/**
 * Tenant-key delegation ceiling evaluation
 * (wish: omni-full-multitenancy, Group G1; ADR-0006).
 *
 * PURE logic — no I/O. The transactional write path (`TenantKeyService`) reads
 * the locked parent row, calls `evaluateDelegation`, and only inserts when it
 * returns `{ ok: true }`. Keeping the invariants pure makes every ADR-0006 rule
 * unit-testable without a database.
 *
 * Invariants enforced (ADR-0006 §1-9):
 *   1. Child tenant == parent tenant (structural — caller always passes parent's).
 *   2. Child scopes ⊆ parent effective scopes ∩ role ceiling; never `*`/platform.
 *   3. Child resource constraints ⊆ parent constraints.
 *   4. Child expiry ≤ parent expiry (and ≤ tenant policy max when provided).
 *   5. Child rate/budget ≤ parent rate/budget.
 *   6. Delegation depth explicit and capped by the role policy (≤ 1 in G1).
 *   7. Parent/root/creator lineage is captured by the caller from this result.
 *   8. Suspended tenant / revoked / disabled / ancestor-revoked parent denies.
 *   9. Tenant admins never receive or mint platform `*`.
 */

import type { TenantRole } from '@omni/db';
import { getRolePolicy, isPlatformOrWildcardScope } from './role-policies';

/** Map of constraint key -> allowed values (e.g. { instanceIds: [...] }). */
export type ResourceConstraints = Record<string, readonly string[]>;

export interface ParentKeySnapshot {
  readonly tenantId: string;
  readonly actorRole: TenantRole;
  readonly scopes: readonly string[];
  readonly resourceConstraints: ResourceConstraints;
  readonly depth: number;
  readonly rootKeyId: string;
  readonly expiresAt: Date | null;
  readonly rateLimit: number | null;
  readonly budget: number | null;
  readonly status: 'active' | 'revoked' | 'expired';
  readonly ancestorRevoked: boolean;
}

export interface ParentTenantSnapshot {
  readonly id: string;
  readonly status: 'active' | 'suspended' | 'archived';
  /** Tenant-wide issuance ceilings, resolved from the locked tenant policy. */
  readonly maxKeyExpiresAt: Date;
  readonly maxKeyRateLimit: number;
  readonly maxKeyBudget: number;
}

export interface DelegationRequest {
  readonly scopes: readonly string[];
  readonly resourceConstraints?: ResourceConstraints;
  readonly expiresAt?: Date | null;
  readonly rateLimit?: number | null;
  readonly budget?: number | null;
  readonly role?: TenantRole;
}

export interface ResolvedDelegation {
  readonly tenantId: string;
  readonly actorRole: TenantRole;
  readonly scopes: readonly string[];
  readonly resourceConstraints: ResourceConstraints;
  readonly depth: number;
  readonly rootKeyId: string;
  readonly parentDepth: number;
  readonly expiresAt: Date | null;
  readonly rateLimit: number | null;
  readonly budget: number | null;
  /** Immutable ceiling snapshot to persist for audit/reproducibility. */
  readonly ceilingSnapshot: {
    readonly parentScopes: readonly string[];
    readonly roleCeiling: readonly string[];
    readonly parentResourceConstraints: ResourceConstraints;
    readonly parentExpiresAt: string | null;
    readonly parentRateLimit: number | null;
    readonly parentBudget: number | null;
    readonly tenantMaxExpiresAt: string;
    readonly tenantMaxRateLimit: number;
    readonly tenantMaxBudget: number;
  };
}

export type DelegationResult = { ok: true; resolved: ResolvedDelegation } | { ok: false; violations: string[] };

const ROLE_RANK: Readonly<Record<TenantRole, number>> = Object.freeze({
  'tenant-owner': 3,
  'tenant-admin': 2,
  'tenant-operator': 1,
  'tenant-viewer': 0,
});

/**
 * Covering relation used for scope-subset checks. Mirrors
 * `ApiKeyService.scopeAllows` but is duplicated here to keep the tenancy
 * delegation logic free of a service dependency. `*` in the authority covers
 * everything; a `ns:*` authority covers `ns:<verb>`.
 */
export function scopeCovered(authorityScopes: readonly string[], requested: string): boolean {
  if (authorityScopes.includes('*')) return true;
  if (authorityScopes.includes(requested)) return true;
  const [namespace] = requested.split(':');
  return authorityScopes.includes(`${namespace}:*`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Every constraint the parent restricts must also be restricted by the child to
 * a subset. A child that omits (i.e. leaves unrestricted) a key the parent
 * restricts is a widening and fails closed. A child may add restrictions on
 * keys the parent leaves open (narrowing) — that is always allowed.
 */
function resourceConstraintsSubset(
  parent: ResourceConstraints,
  child: ResourceConstraints,
): { ok: true } | { ok: false; violations: string[] } {
  const violations: string[] = [];
  for (const [key, childValues] of Object.entries(child)) {
    if (!isStringArray(childValues)) violations.push(`resource constraint "${key}" is malformed`);
  }
  for (const [key, parentValues] of Object.entries(parent)) {
    if (!isStringArray(parentValues)) {
      violations.push(`parent resource constraint "${key}" is malformed`);
      continue;
    }
    const childValues = child[key];
    if (childValues === undefined) {
      violations.push(`resource constraint "${key}" is restricted on parent but unrestricted on child`);
      continue;
    }
    if (!isStringArray(childValues)) {
      violations.push(`resource constraint "${key}" is malformed`);
      continue;
    }
    const allowed = new Set(parentValues);
    const widened = childValues.filter((v) => !allowed.has(v));
    if (widened.length > 0) {
      violations.push(`resource constraint "${key}" widens beyond parent: ${widened.join(', ')}`);
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/** §8 — tenant/parent freshness gates (fail closed). */
function freshnessViolations(parentTenant: ParentTenantSnapshot, parent: ParentKeySnapshot): string[] {
  const v: string[] = [];
  if (parentTenant.status !== 'active') v.push(`tenant is ${parentTenant.status}; delegation denied`);
  if (parentTenant.id !== parent.tenantId) v.push('parent key tenant does not match tenant context');
  if (parent.status !== 'active') v.push(`parent key is ${parent.status}; delegation denied`);
  if (parent.ancestorRevoked) v.push('an ancestor key is revoked; delegation denied');
  return v;
}

/** §6 plus role monotonicity — a child cannot gain role or delegation authority. */
function delegationAuthorityViolations(parent: ParentKeySnapshot, childRole: TenantRole, childDepth: number): string[] {
  const violations: string[] = [];
  const parentPolicy = getRolePolicy(parent.actorRole);
  if (ROLE_RANK[childRole] > ROLE_RANK[parent.actorRole]) {
    violations.push(`role ${childRole} exceeds parent role ${parent.actorRole}`);
  }
  if (!parentPolicy.canDelegateKeys) violations.push(`role ${parent.actorRole} may not delegate keys`);
  if (!scopeCovered(parent.scopes, 'keys:delegate')) {
    violations.push('parent credential does not carry the explicit keys:delegate capability');
  }
  if (childDepth > parentPolicy.maxDelegationDepth) {
    violations.push(
      `delegation depth ${childDepth} exceeds role ${parent.actorRole} ceiling ${parentPolicy.maxDelegationDepth}`,
    );
  }
  return violations;
}

/** §4 — child expiry is valid and never exceeds the effective ceiling. */
function expiryViolations(requestedExpiry: Date | null, effectiveCeiling: Date | null): string[] {
  const violations: string[] = [];
  if (requestedExpiry && (!Number.isFinite(requestedExpiry.getTime()) || requestedExpiry.getTime() <= Date.now())) {
    violations.push('child expiry must be a valid future timestamp');
  }
  if (effectiveCeiling && (requestedExpiry === null || requestedExpiry.getTime() > effectiveCeiling.getTime())) {
    violations.push('child expiry must be no later than parent expiry / tenant policy maximum');
  }
  return violations;
}

/** §2 / §9 — scope subset ∩ role ceiling; never platform/wildcard. */
function scopeViolations(
  requestedScopes: readonly string[],
  parentScopes: readonly string[],
  roleCeiling: readonly string[],
  childRole: TenantRole,
): string[] {
  const v: string[] = [];
  for (const scope of requestedScopes) {
    if (isPlatformOrWildcardScope(scope)) {
      v.push(`scope "${scope}" grants platform/wildcard authority and is forbidden for tenant keys`);
      continue;
    }
    if (!scopeCovered(parentScopes, scope)) v.push(`scope "${scope}" is not within parent scopes`);
    if (!scopeCovered(roleCeiling, scope)) v.push(`scope "${scope}" is not within the ${childRole} role ceiling`);
  }
  return v;
}

export function evaluateDelegation(
  parentTenant: ParentTenantSnapshot,
  parent: ParentKeySnapshot,
  request: DelegationRequest,
): DelegationResult {
  const violations: string[] = [...freshnessViolations(parentTenant, parent)];

  // The delegated key inherits the parent's role unless a narrower role is
  // requested. It can NEVER be broader than the parent role.
  const childRole: TenantRole = request.role ?? parent.actorRole;
  const roleCeiling = getRolePolicy(childRole).maxScopes;
  const childDepth = parent.depth + 1;
  violations.push(...delegationAuthorityViolations(parent, childRole, childDepth));

  violations.push(...scopeViolations(request.scopes, parent.scopes, roleCeiling, childRole));

  // §3 — resource constraint subset.
  const childConstraints = request.resourceConstraints ?? {};
  const constraintCheck = resourceConstraintsSubset(parent.resourceConstraints, childConstraints);
  if (!constraintCheck.ok) violations.push(...constraintCheck.violations);

  // §4 — expiry no later than parent (or tenant policy max).
  const parentExpiry = parent.expiresAt;
  const tenantMax = parentTenant.maxKeyExpiresAt;
  const effectiveCeiling = minDate(parentExpiry, tenantMax);
  // Omission inherits the effective ceiling. Explicit null still means a
  // never-expiring request and is rejected beneath any finite ceiling.
  const requestedExpiry = request.expiresAt === undefined ? effectiveCeiling : request.expiresAt;
  violations.push(...expiryViolations(requestedExpiry, effectiveCeiling));

  // §5 — rate/budget no broader than parent.
  const resolvedRate = resolveBoundedLimit(
    'rate limit',
    parent.rateLimit,
    parentTenant.maxKeyRateLimit,
    request.rateLimit ?? null,
  );
  if (resolvedRate.violation) violations.push(`rate limit ${resolvedRate.violation}`);
  const resolvedBudget = resolveBoundedLimit(
    'budget',
    parent.budget,
    parentTenant.maxKeyBudget,
    request.budget ?? null,
  );
  if (resolvedBudget.violation) violations.push(`budget ${resolvedBudget.violation}`);

  if (violations.length > 0) return { ok: false, violations };

  return {
    ok: true,
    resolved: {
      tenantId: parent.tenantId,
      actorRole: childRole,
      scopes: [...request.scopes],
      resourceConstraints: childConstraints,
      depth: childDepth,
      rootKeyId: parent.rootKeyId,
      parentDepth: parent.depth,
      expiresAt: requestedExpiry ?? effectiveCeiling ?? null,
      rateLimit: resolvedRate.value,
      budget: resolvedBudget.value,
      ceilingSnapshot: {
        parentScopes: [...parent.scopes],
        roleCeiling: [...roleCeiling],
        parentResourceConstraints: parent.resourceConstraints,
        parentExpiresAt: parentExpiry ? parentExpiry.toISOString() : null,
        parentRateLimit: parent.rateLimit,
        parentBudget: parent.budget,
        tenantMaxExpiresAt: tenantMax.toISOString(),
        tenantMaxRateLimit: parentTenant.maxKeyRateLimit,
        tenantMaxBudget: parentTenant.maxKeyBudget,
      },
    },
  };
}

function minDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * A null parent limit is unbounded, so any child value is allowed. A concrete
 * parent limit caps the child: a null (unbounded) child request or a larger
 * value is a violation.
 */
function resolveBoundedLimit(
  name: string,
  parentLimit: number | null,
  tenantPolicyLimit: number,
  requested: number | null,
): { value: number | null; violation: string | null } {
  if (!Number.isInteger(tenantPolicyLimit) || tenantPolicyLimit <= 0) {
    return { value: null, violation: `tenant policy ${name} ${tenantPolicyLimit} is not a positive integer` };
  }
  if (parentLimit !== null && (!Number.isInteger(parentLimit) || parentLimit <= 0)) {
    return { value: null, violation: `parent limit ${parentLimit} is not a positive integer` };
  }
  if (requested !== null && (!Number.isInteger(requested) || requested <= 0)) {
    return { value: null, violation: `${requested} is not a positive integer` };
  }
  const effectiveLimit = parentLimit === null ? tenantPolicyLimit : Math.min(parentLimit, tenantPolicyLimit);
  if (requested === null) return { value: effectiveLimit, violation: null };
  if (requested > tenantPolicyLimit) {
    return { value: null, violation: `${requested} exceeds tenant policy limit ${tenantPolicyLimit}` };
  }
  if (parentLimit !== null && requested > parentLimit) {
    return { value: null, violation: `${requested} exceeds parent limit ${parentLimit}` };
  }
  return { value: requested, violation: null };
}
