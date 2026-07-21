/**
 * Immutable authenticated context (wish: omni-full-multitenancy, Group G1).
 *
 * Produced ONLY by the isolated auth-bootstrap service after a hash/subject
 * lookup against `auth_credentials`. It is the minimal, frozen context every
 * authenticated operation receives BEFORE any tenant transaction opens
 * (WISH "Auth context", ADR-0003).
 *
 * Tenant authority is derived exclusively from the credential index + active
 * membership. Caller headers/path/body/customer metadata can NEVER select
 * tenant authority.
 */

import type { TenantRole } from '@omni/db';

export interface TenantAuthContext {
  readonly credentialClass: 'tenant';
  readonly requestId: string;
  readonly principalId: string;
  readonly credentialId: string;
  /** Always present for tenant-class credentials; immutable for the request. */
  readonly tenantId: string;
  readonly actorRole: TenantRole;
  readonly scopes: readonly string[];
  readonly membershipId: string;
  /** Effective immutable ceilings inherited from the authenticated lineage row. */
  readonly resourceConstraints: Readonly<Record<string, readonly string[]>>;
  readonly expiresAt: Date | null;
  readonly rateLimit: number | null;
  readonly budget: number | null;
  readonly delegationDepth: number;
  readonly rootKeyId: string;
  /** Freshness epochs snapshotted at lookup and validated against live tenant epochs. */
  readonly policyVersion: number;
  readonly revocationEpoch: number;
  readonly tenantKeyLineageId: string;
}

export interface PlatformAuthContext {
  readonly credentialClass: 'platform';
  readonly requestId: string;
  readonly principalId: string | null;
  readonly credentialId: string;
  readonly scopes: readonly string[];
  readonly platformApiKeyId: string;
  /** Explicit, audited platform action + target — set by the platform route, not by the caller. */
  readonly platformAction: string | null;
  readonly targetTenantId: string | null;
}

export type AuthContext = TenantAuthContext | PlatformAuthContext;

export type AuthFailureReason =
  | 'not_found'
  | 'credential_revoked'
  | 'credential_expired'
  | 'tenant_inactive'
  | 'principal_disabled'
  | 'membership_disabled'
  | 'ancestor_revoked'
  | 'stale_policy_epoch'
  | 'stale_revocation_epoch'
  | 'invalid_role_binding'
  | 'invalid_class_binding'
  | 'malformed_context'
  | 'auth_plane_error';

export type AuthLookupResult = { ok: true; context: AuthContext } | { ok: false; reason: AuthFailureReason };

/**
 * Recursively freeze a context object so downstream code cannot mutate the
 * derived authority (scopes arrays included).
 */
export function freezeContext<T extends object>(context: T): Readonly<T> {
  for (const value of Object.values(context)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      freezeContext(value as object);
    }
  }
  return Object.freeze(context);
}

/**
 * Bind a platform identity to one route-selected operation. Caller-controlled
 * headers/body never participate; each refinement returns a newly frozen
 * context so the authenticated identity remains immutable.
 */
export function bindPlatformOperation(
  context: PlatformAuthContext,
  platformAction: string,
  targetTenantId: string | null = null,
): PlatformAuthContext {
  if (platformAction.trim().length === 0) throw new Error('platform action is required');
  return freezeContext({ ...context, platformAction, targetTenantId });
}
