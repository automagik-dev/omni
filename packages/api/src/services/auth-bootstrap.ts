/**
 * Isolated auth-bootstrap service (wish: omni-full-multitenancy, Group G1; ADR-0003).
 *
 * The ONLY read path into the `auth_credentials` index. It performs a narrow
 * hash-equality lookup and resolves the minimal immutable context needed to
 * establish credential class, tenant, principal, status, role/ceiling, and
 * membership BEFORE any tenant transaction opens.
 *
 * Deliberate non-capabilities (enforced by absence):
 *   - No list / enumerate / read-all method. Tenant routes have no way to walk
 *     the global credential index.
 *   - No plaintext comparison and no secret-dependent branching: the secret is
 *     hashed once and looked up through the unique `key_hash` index.
 *   - Every failure returns a typed reason; the caller maps ALL of them to one
 *     uniform, non-enumerating 401 so lookups cannot be used as an oracle.
 *
 * Fail-closed for: unknown hash, revoked/expired credential, inactive tenant,
 * disabled principal/membership, ancestor revocation, stale policy/revocation
 * epoch, invalid role/class binding, malformed rows, and auth-plane errors.
 * Never falls back to legacy global authority.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type AuthCredential,
  authCredentials,
  platformApiKeys,
  principals,
  tenantKeyLineage,
  tenantMemberships,
  tenants,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import {
  type AuthFailureReason,
  type AuthLookupResult,
  type TenantAuthContext,
  freezeContext,
} from '../tenancy/auth-context';
import { hashSecret } from '../tenancy/hash';
import { isPlatformOrWildcardScope, isTenantRole } from '../tenancy/role-policies';

const log = createLogger('auth-bootstrap');

/** Small helper so the resolver reads as a flat sequence of guard clauses. */
function fail(reason: AuthFailureReason): AuthLookupResult {
  return { ok: false, reason };
}

/** Freshness: the epochs snapshotted at issuance must match the live tenant. */
function tenantFreshnessReason(
  tenant: { status: string; policyVersion: number; revocationEpoch: number },
  credential: AuthCredential,
): AuthFailureReason | null {
  if (tenant.status !== 'active') return 'tenant_inactive';
  if (credential.policySnapshotVersion !== tenant.policyVersion) return 'stale_policy_epoch';
  if (credential.revocationEpochSnapshot !== tenant.revocationEpoch) return 'stale_revocation_epoch';
  return null;
}

/** Lineage must belong to the same tenant, be active, and have no revoked ancestor. */
function lineageReason(
  lineage: {
    tenantId: string;
    principalId: string | null;
    membershipId: string | null;
    actorRole: string;
    keyPrefix: string;
    scopes: string[];
    status: string;
    ancestorRevoked: boolean;
    revocationEpoch: number;
    expiresAt: Date | null;
  },
  credential: AuthCredential,
  tenantId: string,
): AuthFailureReason | null {
  if (lineage.tenantId !== tenantId) return 'invalid_class_binding';
  if (lineage.status !== 'active') return lineage.status === 'expired' ? 'credential_expired' : 'credential_revoked';
  if (lineage.ancestorRevoked) return 'ancestor_revoked';
  if (lineage.actorRole !== credential.actorRole) return 'invalid_role_binding';
  if (
    lineage.principalId !== credential.principalId ||
    lineage.membershipId !== credential.membershipId ||
    lineage.keyPrefix !== credential.keyPrefix ||
    lineage.revocationEpoch !== credential.revocationEpochSnapshot ||
    !sameStringArray(lineage.scopes, credential.scopes) ||
    !sameNullableDate(lineage.expiresAt, credential.expiresAt)
  ) {
    return 'invalid_class_binding';
  }
  return null;
}

export class AuthBootstrapService {
  constructor(private db: Database) {}

  /**
   * Resolve immutable context for a plaintext secret. Hashes once, then defers
   * to the hash lookup. A malformed/unknown secret is indistinguishable from a
   * missing credential (uniform `not_found`).
   */
  async lookupBySecret(secret: string, requestId: string): Promise<AuthLookupResult> {
    let keyHash: string;
    try {
      keyHash = await hashSecret(secret);
    } catch {
      return { ok: false, reason: 'not_found' };
    }
    return this.lookupBySecretHash(keyHash, requestId);
  }

  /**
   * Core lookup by secret hash. Single indexed equality query, no
   * secret-dependent branching. All resolution/validation happens on the row.
   */
  async lookupBySecretHash(keyHash: string, requestId: string): Promise<AuthLookupResult> {
    let credential: AuthCredential | undefined;
    try {
      [credential] = await this.db.select().from(authCredentials).where(eq(authCredentials.keyHash, keyHash)).limit(1);
    } catch (error) {
      log.error('auth-plane lookup failed', { error: String(error) });
      return { ok: false, reason: 'auth_plane_error' };
    }

    if (!credential) return { ok: false, reason: 'not_found' };

    // Credential-level status/expiry/revocation gates (class-independent).
    if (credential.status !== 'active') {
      return { ok: false, reason: credential.status === 'expired' ? 'credential_expired' : 'credential_revoked' };
    }
    if (credential.revokedAt) return { ok: false, reason: 'credential_revoked' };
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: 'credential_expired' };
    }

    if (credential.credentialClass === 'tenant') {
      return this.resolveTenantContext(credential, requestId);
    }
    if (credential.credentialClass === 'platform') {
      return this.resolvePlatformContext(credential, requestId);
    }
    return { ok: false, reason: 'invalid_class_binding' };
  }

  private async resolveTenantContext(credential: AuthCredential, requestId: string): Promise<AuthLookupResult> {
    // Structural class-binding invariants (defense in depth over DB CHECKs).
    const { tenantId, tenantKeyLineageId, actorRole, principalId, membershipId } = credential;
    if (!tenantId || !tenantKeyLineageId || !actorRole || !principalId || !membershipId) {
      return fail('invalid_class_binding');
    }
    if (credential.scopes.some(isPlatformOrWildcardScope)) return fail('invalid_class_binding');
    if (!isTenantRole(actorRole)) return fail('invalid_role_binding');

    try {
      const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (!tenant) return fail('malformed_context');
      const freshnessReason = tenantFreshnessReason(tenant, credential);
      if (freshnessReason) return fail(freshnessReason);

      const [lineage] = await this.db
        .select()
        .from(tenantKeyLineage)
        .where(eq(tenantKeyLineage.id, tenantKeyLineageId))
        .limit(1);
      if (!lineage) return fail('malformed_context');
      const lineageFailure = lineageReason(lineage, credential, tenantId);
      if (lineageFailure) return fail(lineageFailure);
      const resourceConstraints = parseResourceConstraints(lineage.resourceConstraints);
      if (!resourceConstraints || !lineage.rootKeyId || lineage.depth < 0 || lineage.depth > 1) {
        return fail('malformed_context');
      }

      const principalFailure = await this.checkPrincipal(principalId);
      if (principalFailure) return fail(principalFailure);

      const membershipFailure = await this.checkMembership(membershipId, tenantId, principalId, actorRole);
      if (membershipFailure) return fail(membershipFailure);

      const context: TenantAuthContext = {
        credentialClass: 'tenant',
        requestId,
        principalId,
        credentialId: credential.id,
        tenantId,
        actorRole,
        scopes: [...credential.scopes],
        membershipId,
        resourceConstraints,
        expiresAt: lineage.expiresAt,
        rateLimit: lineage.rateLimit,
        budget: lineage.budget,
        delegationDepth: lineage.depth,
        rootKeyId: lineage.rootKeyId,
        policyVersion: tenant.policyVersion,
        revocationEpoch: tenant.revocationEpoch,
        tenantKeyLineageId,
      };
      return { ok: true, context: freezeContext(context) };
    } catch (error) {
      log.error('tenant context resolution failed', { error: String(error) });
      return fail('auth_plane_error');
    }
  }

  /** Returns a failure reason when the linked principal is missing/disabled, else null. */
  private async checkPrincipal(principalId: string): Promise<AuthFailureReason | null> {
    const [principal] = await this.db.select().from(principals).where(eq(principals.id, principalId)).limit(1);
    if (!principal) return 'malformed_context';
    return principal.status !== 'active' ? 'principal_disabled' : null;
  }

  /** Returns a failure reason when the linked membership is invalid, else null. */
  private async checkMembership(
    membershipId: string,
    tenantId: string,
    principalId: string,
    actorRole: string,
  ): Promise<AuthFailureReason | null> {
    const [membership] = await this.db
      .select()
      .from(tenantMemberships)
      .where(eq(tenantMemberships.id, membershipId))
      .limit(1);
    if (!membership) return 'malformed_context';
    if (membership.tenantId !== tenantId) return 'invalid_class_binding';
    if (membership.principalId !== principalId) return 'invalid_class_binding';
    if (membership.status !== 'active') return 'membership_disabled';
    // Tenant authority derives from the credential + active membership only.
    return membership.role !== actorRole ? 'invalid_role_binding' : null;
  }

  private async resolvePlatformContext(credential: AuthCredential, requestId: string): Promise<AuthLookupResult> {
    if (
      !credential.platformApiKeyId ||
      !credential.principalId ||
      credential.tenantId ||
      credential.membershipId ||
      credential.tenantKeyLineageId
    ) {
      return { ok: false, reason: 'invalid_class_binding' };
    }
    try {
      const [sourceKey] = await this.db
        .select()
        .from(platformApiKeys)
        .where(eq(platformApiKeys.id, credential.platformApiKeyId))
        .limit(1);
      if (!sourceKey) return fail('malformed_context');
      if (
        sourceKey.keyHash !== credential.keyHash ||
        sourceKey.principalId !== credential.principalId ||
        !sameStringArray(sourceKey.scopes, credential.scopes)
      ) {
        return fail('invalid_class_binding');
      }
      if (sourceKey.status !== 'active' || sourceKey.revokedAt) return fail('credential_revoked');
      if (sourceKey.expiresAt && sourceKey.expiresAt.getTime() <= Date.now()) return fail('credential_expired');

      if (credential.principalId) {
        const [principal] = await this.db
          .select()
          .from(principals)
          .where(eq(principals.id, credential.principalId))
          .limit(1);
        if (!principal) return { ok: false, reason: 'malformed_context' };
        if (principal.status !== 'active') return { ok: false, reason: 'principal_disabled' };
      }

      return {
        ok: true,
        context: freezeContext({
          credentialClass: 'platform',
          requestId,
          principalId: credential.principalId ?? null,
          credentialId: credential.id,
          scopes: [...credential.scopes],
          platformApiKeyId: credential.platformApiKeyId,
          platformAction: null,
          targetTenantId: null,
        }),
      };
    } catch (error) {
      log.error('platform context resolution failed', { error: String(error) });
      return { ok: false, reason: 'auth_plane_error' };
    }
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameNullableDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function parseResourceConstraints(value: unknown): Record<string, readonly string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed: Record<string, readonly string[]> = {};
  for (const [key, entries] of Object.entries(value)) {
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) return null;
    parsed[key] = [...entries];
  }
  return parsed;
}
