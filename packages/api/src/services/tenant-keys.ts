/**
 * Tenant key issuance + delegation service
 * (wish: omni-full-multitenancy, Group G1; ADR-0006).
 *
 * The transactionally enforced boundary that crosses into the auth plane to
 * mint tenant-class credentials. Child-key creation:
 *   - locks the parent lineage row (SELECT ... FOR UPDATE) and re-reads the
 *     tenant so concurrent delegation races cannot compose over a stale ceiling;
 *   - evaluates ALL ADR-0006 invariants via the pure `evaluateDelegation`;
 *   - writes the child `tenant_key_lineage` row and its `auth_credentials`
 *     index row in the SAME transaction — a child is fixed to the parent tenant
 *     and can never become platform-class or receive `*`.
 *
 * Never mints platform credentials. Never auto-mints on tenant creation.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type AuthCredential,
  type TenantKeyLineage,
  type TenantRole,
  authCredentials,
  platformAuditLogs,
  principals,
  tenantAuditLogs,
  tenantKeyLineage,
  tenantMemberships,
  tenants,
} from '@omni/db';
import { and, eq } from 'drizzle-orm';
import type { PlatformAuthContext, TenantAuthContext } from '../tenancy/auth-context';
import {
  type DelegationRequest,
  type ParentKeySnapshot,
  type ResolvedDelegation,
  type ResourceConstraints,
  evaluateDelegation,
} from '../tenancy/delegation';
import { generateSecret, hashSecret, secretPrefix } from '../tenancy/hash';
import { getRolePolicy, isPlatformOrWildcardScope, isTenantRole } from '../tenancy/role-policies';
import { type PlatformMutationActor, platformActorFreshnessFailure } from '../tenancy/transactional-auth';

const log = createLogger('tenant-keys');

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface IssueRootKeyOptions {
  actor: PlatformAuthContext;
  tenantId: string;
  actorRole: TenantRole;
  name: string;
  reason: string;
  scopes: string[];
  principalId: string;
  membershipId: string;
  resourceConstraints?: ResourceConstraints;
  expiresAt: Date;
  rateLimit: number;
  budget: number;
}

export interface CreateChildKeyOptions {
  actor: TenantAuthContext;
  parentKeyId: string;
  name: string;
  reason: string;
  request: DelegationRequest;
}

export interface IssuedKey {
  lineage: TenantKeyLineage;
  /** Plaintext returned ONCE. Callers must never persist/log it. */
  plainTextKey: string;
}

export type CreateChildKeyResult =
  | { status: 'created'; issued: IssuedKey }
  | { status: 'parent_not_found' }
  | { status: 'denied'; violations: string[] };

export interface RevokeTenantKeyOptions {
  actor: TenantAuthContext;
  lineageId: string;
  reason: string;
}

export type RevokeTenantKeyResult =
  | { status: 'revoked'; lineageId: string; tenantId: string }
  | { status: 'not_found' }
  | { status: 'already_revoked' };

export class TenantKeyService {
  constructor(private db: Database) {}

  /**
   * Issue a tenant ROOT key (depth 0, no parent). Explicit only — never called
   * automatically on tenant creation. Enforces the tenant is active and the
   * scopes carry no platform/wildcard authority (the schema CHECK is the
   * backstop).
   */
  async issueRootKey(options: IssueRootKeyOptions): Promise<IssuedKey> {
    const reason = requiredAuditReason(options.reason, 'root key issuance');
    const actor = validatedRootIssuanceActor(options.actor, options.tenantId);
    const violations = rootRequestViolations(options);
    if (violations.length > 0) throw new Error(`invalid root key request: ${violations.join('; ')}`);

    const plainTextKey = generateSecret();
    const keyHash = await hashSecret(plainTextKey);
    const keyPrefix = secretPrefix(plainTextKey);

    return this.db.transaction(async (tx) => {
      const actorFailure = await platformActorFreshnessFailure(tx, actor);
      if (actorFailure) throw new Error(`unauthorized root key issuer: ${actorFailure}`);

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, options.tenantId)).limit(1).for('update');
      if (!tenant) throw new Error('tenant not found');
      if (tenant.status !== 'active') throw new Error(`tenant is ${tenant.status}`);

      const tenantPolicyViolations = rootTenantPolicyViolations(options, tenant);
      if (tenantPolicyViolations.length > 0) {
        throw new Error(`root key exceeds tenant policy: ${tenantPolicyViolations.join('; ')}`);
      }

      const subjectFailure = await this.subjectBindingFailure(
        tx,
        options.tenantId,
        options.principalId,
        options.membershipId,
        options.actorRole,
      );
      if (subjectFailure) throw new Error(`invalid root key subject: ${subjectFailure}`);

      const lineageId = crypto.randomUUID();
      const [lineage] = await tx
        .insert(tenantKeyLineage)
        .values({
          id: lineageId,
          tenantId: options.tenantId,
          principalId: options.principalId,
          membershipId: options.membershipId,
          actorRole: options.actorRole,
          name: options.name,
          keyPrefix,
          scopes: options.scopes,
          resourceConstraints: options.resourceConstraints ?? {},
          status: 'active',
          parentKeyId: null,
          rootKeyId: lineageId,
          depth: 0,
          createdByPrincipalId: options.actor.principalId,
          expiresAt: options.expiresAt,
          rateLimit: options.rateLimit,
          budget: options.budget,
          revocationEpoch: tenant.revocationEpoch,
          ceilingSnapshot: {},
        })
        .returning();
      if (!lineage) throw new Error('failed to create root key lineage');

      await tx.insert(authCredentials).values({
        credentialClass: 'tenant',
        keyHash,
        keyPrefix,
        tenantId: options.tenantId,
        principalId: options.principalId,
        membershipId: options.membershipId,
        actorRole: options.actorRole,
        scopes: options.scopes,
        status: 'active',
        tenantKeyLineageId: lineageId,
        platformApiKeyId: null,
        policySnapshotVersion: tenant.policyVersion,
        revocationEpochSnapshot: tenant.revocationEpoch,
        expiresAt: options.expiresAt,
      });
      await tx.insert(platformAuditLogs).values({
        actorPrincipalId: options.actor.principalId,
        actorCredentialId: options.actor.credentialId,
        action: 'tenant_key.issue_root',
        targetTenantId: options.tenantId,
        reason,
        requestId: options.actor.requestId,
        beforeMetadata: null,
        afterMetadata: { lineageId, principalId: options.principalId, membershipId: options.membershipId },
      });

      log.info('tenant root key issued', { tenantId: options.tenantId, lineageId, keyPrefix });
      return { lineage, plainTextKey };
    });
  }

  /**
   * Create a bounded child key under a parent, enforcing every delegation
   * ceiling transactionally.
   */
  async createChildKey(options: CreateChildKeyOptions): Promise<CreateChildKeyResult> {
    const reason = requiredAuditReason(options.reason, 'child key delegation');
    const plainTextKey = generateSecret();
    const keyHash = await hashSecret(plainTextKey);
    const keyPrefix = secretPrefix(plainTextKey);

    return this.db.transaction(async (tx): Promise<CreateChildKeyResult> => {
      const [parent] = await tx
        .select()
        .from(tenantKeyLineage)
        .where(and(eq(tenantKeyLineage.id, options.parentKeyId), eq(tenantKeyLineage.tenantId, options.actor.tenantId)))
        .limit(1)
        .for('update');
      if (!parent || parent.tenantId !== options.actor.tenantId) return { status: 'parent_not_found' };

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, parent.tenantId)).limit(1).for('update');
      if (!tenant) return { status: 'parent_not_found' };

      const [parentCredential] = await tx
        .select()
        .from(authCredentials)
        .where(eq(authCredentials.tenantKeyLineageId, parent.id))
        .limit(1)
        .for('update');
      const parentCredentialFailure = validateParentCredential(parent, parentCredential, tenant);
      if (parentCredentialFailure) return { status: 'denied', violations: [parentCredentialFailure] };
      const actorFailure = validateTenantActorCredential(options.actor, parentCredential, tenant);
      if (actorFailure) return { status: 'denied', violations: [actorFailure] };
      if (options.actor.tenantKeyLineageId !== parent.id) {
        return { status: 'denied', violations: ['authenticated actor does not possess the parent credential'] };
      }
      if (!parent.rootKeyId) return { status: 'denied', violations: ['parent root lineage is missing'] };

      const parentSnapshot: ParentKeySnapshot = {
        tenantId: parent.tenantId,
        actorRole: parent.actorRole,
        scopes: parent.scopes,
        resourceConstraints: (parent.resourceConstraints as ResourceConstraints) ?? {},
        depth: parent.depth,
        rootKeyId: parent.rootKeyId,
        expiresAt: parent.expiresAt,
        rateLimit: parent.rateLimit,
        budget: parent.budget,
        status: parent.status,
        ancestorRevoked: parent.ancestorRevoked,
      };

      const evaluation = evaluateDelegation(
        {
          id: tenant.id,
          status: tenant.status,
          maxKeyExpiresAt: new Date(Date.now() + tenant.maxKeyTtlSeconds * 1_000),
          maxKeyRateLimit: tenant.maxKeyRateLimit,
          maxKeyBudget: tenant.maxKeyBudget,
        },
        parentSnapshot,
        options.request,
      );
      if (!evaluation.ok) return { status: 'denied', violations: evaluation.violations };

      const resolved: ResolvedDelegation = evaluation.resolved;
      const subjectFailure = await this.subjectBindingFailure(
        tx,
        resolved.tenantId,
        options.actor.principalId,
        options.actor.membershipId,
        resolved.actorRole,
      );
      if (subjectFailure) return { status: 'denied', violations: [subjectFailure] };

      const lineageId = crypto.randomUUID();
      const [lineage] = await tx
        .insert(tenantKeyLineage)
        .values({
          id: lineageId,
          tenantId: resolved.tenantId,
          principalId: options.actor.principalId,
          membershipId: options.actor.membershipId,
          actorRole: resolved.actorRole,
          name: options.name,
          keyPrefix,
          scopes: [...resolved.scopes],
          resourceConstraints: resolved.resourceConstraints,
          status: 'active',
          parentKeyId: parent.id,
          rootKeyId: resolved.rootKeyId,
          depth: resolved.depth,
          createdByPrincipalId: options.actor.principalId,
          expiresAt: resolved.expiresAt,
          rateLimit: resolved.rateLimit,
          budget: resolved.budget,
          revocationEpoch: tenant.revocationEpoch,
          ceilingSnapshot: resolved.ceilingSnapshot,
        })
        .returning();
      if (!lineage) return { status: 'parent_not_found' };

      await tx.insert(authCredentials).values({
        credentialClass: 'tenant',
        keyHash,
        keyPrefix,
        tenantId: resolved.tenantId,
        principalId: options.actor.principalId,
        membershipId: options.actor.membershipId,
        actorRole: resolved.actorRole,
        scopes: [...resolved.scopes],
        status: 'active',
        tenantKeyLineageId: lineageId,
        platformApiKeyId: null,
        policySnapshotVersion: tenant.policyVersion,
        revocationEpochSnapshot: tenant.revocationEpoch,
        expiresAt: resolved.expiresAt,
      });
      await tx.insert(tenantAuditLogs).values({
        tenantId: resolved.tenantId,
        actorPrincipalId: options.actor.principalId,
        actorCredentialId: options.actor.credentialId,
        action: 'tenant_key.create_child',
        targetType: 'tenant_key_lineage',
        targetId: lineageId,
        requestId: options.actor.requestId,
        metadata: { reason, parentKeyId: parent.id, rootKeyId: resolved.rootKeyId },
      });

      log.info('tenant child key created', {
        tenantId: resolved.tenantId,
        parentKeyId: parent.id,
        lineageId,
        depth: resolved.depth,
      });
      return { status: 'created', issued: { lineage, plainTextKey } };
    });
  }

  /**
   * Soft-revoke one tenant key and atomically propagate denial to descendants.
   * G1 caps delegation depth at one, so marking direct children is transitive.
   * The tenant-wide epoch is deliberately unchanged: unrelated credentials
   * remain valid while the target credential and its descendants fail closed
   * through credential status and lineage state.
   */
  async revokeKey(options: RevokeTenantKeyOptions): Promise<RevokeTenantKeyResult> {
    const reason = options.reason.trim();
    if (reason.length < 3) throw new Error('tenant key revocation reason is required');

    return this.db.transaction(async (tx): Promise<RevokeTenantKeyResult> => {
      const [lineage] = await tx
        .select()
        .from(tenantKeyLineage)
        .where(and(eq(tenantKeyLineage.id, options.lineageId), eq(tenantKeyLineage.tenantId, options.actor.tenantId)))
        .limit(1)
        .for('update');
      if (!lineage || lineage.tenantId !== options.actor.tenantId) return { status: 'not_found' };
      if (lineage.status !== 'active') return { status: 'already_revoked' };

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, lineage.tenantId)).limit(1).for('update');
      if (!tenant) return { status: 'not_found' };

      const [actorCredential] = await tx
        .select()
        .from(authCredentials)
        .where(eq(authCredentials.id, options.actor.credentialId))
        .limit(1)
        .for('update');
      const actorFailure = validateTenantActorCredential(options.actor, actorCredential, tenant);
      if (actorFailure || options.actor.tenantId !== lineage.tenantId) {
        throw new Error(`unauthorized tenant key revocation: ${actorFailure ?? 'target tenant binding mismatch'}`);
      }
      const actorLineage =
        options.actor.tenantKeyLineageId === lineage.id
          ? lineage
          : (
              await tx
                .select()
                .from(tenantKeyLineage)
                .where(eq(tenantKeyLineage.id, options.actor.tenantKeyLineageId))
                .limit(1)
                .for('update')
            )[0];
      const actorLineageFailure = validateTenantActorLineage(options.actor, actorLineage, tenant);
      if (actorLineageFailure) {
        throw new Error(`unauthorized tenant key revocation: ${actorLineageFailure}`);
      }
      const actorSubjectFailure = await this.subjectBindingFailure(
        tx,
        tenant.id,
        options.actor.principalId,
        options.actor.membershipId,
        options.actor.actorRole,
      );
      if (actorSubjectFailure) {
        throw new Error(`unauthorized tenant key revocation: tenant actor ${actorSubjectFailure}`);
      }

      const now = new Date();
      await tx
        .update(tenantKeyLineage)
        .set({
          status: 'revoked',
          revokedAt: now,
          revokeReason: reason,
          updatedAt: now,
        })
        .where(eq(tenantKeyLineage.id, lineage.id));
      await tx
        .update(tenantKeyLineage)
        .set({ ancestorRevoked: true })
        .where(eq(tenantKeyLineage.parentKeyId, lineage.id));
      await tx
        .update(authCredentials)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(eq(authCredentials.tenantKeyLineageId, lineage.id));
      await tx.insert(tenantAuditLogs).values({
        tenantId: lineage.tenantId,
        actorPrincipalId: options.actor.principalId,
        actorCredentialId: options.actor.credentialId,
        action: 'tenant_key.revoke',
        targetType: 'tenant_key_lineage',
        targetId: lineage.id,
        requestId: options.actor.requestId,
        metadata: { reason, parentKeyId: lineage.parentKeyId, rootKeyId: lineage.rootKeyId },
      });

      log.info('tenant key revoked', { tenantId: lineage.tenantId, lineageId: lineage.id });
      return { status: 'revoked', lineageId: lineage.id, tenantId: lineage.tenantId };
    });
  }

  private async subjectBindingFailure(
    tx: Tx,
    tenantId: string,
    principalId: string | null,
    membershipId: string | null,
    actorRole: TenantRole,
  ): Promise<string | null> {
    if (principalId === null && membershipId === null) return null;
    if (principalId === null || membershipId === null) return 'principal and membership must be bound together';

    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.principalId, principalId),
        ),
      )
      .limit(1)
      .for('update');
    if (!membership) return 'membership not found';
    if (membership.status !== 'active') return 'membership is not active';
    if (membership.tenantId !== tenantId || membership.principalId !== principalId) {
      // A test fake may return a row that the composite SQL predicate cannot.
      // Keep that impossible/cross-tenant case indistinguishable from absence.
      return 'membership not found';
    }
    const [principal] = await tx.select().from(principals).where(eq(principals.id, principalId)).limit(1).for('update');
    if (!principal) return 'principal not found';
    if (principal.status !== 'active') return 'principal is not active';
    return membership.role === actorRole ? null : 'membership role does not match issued role';
  }
}

function requiredAuditReason(value: string, operation: string): string {
  const reason = value.trim();
  if (reason.length < 3) throw new Error(`${operation} reason is required`);
  return reason;
}

function validatedRootIssuanceActor(actor: PlatformAuthContext, tenantId: string): PlatformMutationActor {
  if (actor.credentialClass !== 'platform' || !actor.principalId) {
    throw new Error('root key issuance requires an authenticated platform principal');
  }
  if (actor.platformAction !== 'tenant_key.issue_root') {
    throw new Error('root key issuance action binding mismatch');
  }
  if (actor.targetTenantId !== tenantId) {
    throw new Error('root key issuance target tenant binding mismatch');
  }
  if (!scopeCoveredBy(actor.scopes, 'platform:tenants:write')) {
    throw new Error('root key issuance requires platform:tenants:write');
  }
  return { ...actor, principalId: actor.principalId, platformAction: actor.platformAction };
}

function validateTenantActorCredential(
  actor: TenantAuthContext,
  credential: AuthCredential | undefined,
  tenant: { id: string; status: string; policyVersion: number; revocationEpoch: number },
): string | null {
  if (tenant.status !== 'active') return 'tenant actor tenant is not active';
  if (!credential) return 'tenant actor credential is missing';
  if (credential.status !== 'active' || credential.revokedAt) return 'tenant actor credential is revoked';
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) return 'tenant actor credential is expired';
  if (
    credential.id !== actor.credentialId ||
    credential.credentialClass !== 'tenant' ||
    credential.tenantId !== tenant.id ||
    actor.tenantId !== tenant.id ||
    credential.principalId !== actor.principalId ||
    credential.membershipId !== actor.membershipId ||
    credential.actorRole !== actor.actorRole ||
    credential.tenantKeyLineageId !== actor.tenantKeyLineageId ||
    !sameStringArray(credential.scopes, actor.scopes)
  ) {
    return 'tenant actor credential binding is invalid';
  }
  if (
    credential.policySnapshotVersion !== tenant.policyVersion ||
    actor.policyVersion !== tenant.policyVersion ||
    credential.revocationEpochSnapshot !== tenant.revocationEpoch ||
    actor.revocationEpoch !== tenant.revocationEpoch
  ) {
    return 'tenant actor credential epoch is stale';
  }
  if (!actor.scopes.includes('keys:delegate') || !getRolePolicy(actor.actorRole).canDelegateKeys) {
    return 'tenant actor lacks keys:delegate capability';
  }
  return null;
}

function validateTenantActorLineage(
  actor: TenantAuthContext,
  lineage: TenantKeyLineage | undefined,
  tenant: { id: string; revocationEpoch: number },
): string | null {
  if (!lineage) return 'tenant actor lineage is missing';
  if (lineage.status !== 'active' || lineage.revokedAt) return 'tenant actor lineage is revoked';
  if (lineage.ancestorRevoked) return 'tenant actor lineage has a revoked ancestor';
  if (lineage.expiresAt && lineage.expiresAt.getTime() <= Date.now()) return 'tenant actor lineage is expired';
  if (
    lineage.id !== actor.tenantKeyLineageId ||
    lineage.tenantId !== tenant.id ||
    lineage.tenantId !== actor.tenantId ||
    lineage.principalId !== actor.principalId ||
    lineage.membershipId !== actor.membershipId ||
    lineage.actorRole !== actor.actorRole ||
    lineage.rootKeyId !== actor.rootKeyId ||
    lineage.depth !== actor.delegationDepth ||
    lineage.rateLimit !== actor.rateLimit ||
    lineage.budget !== actor.budget ||
    lineage.revocationEpoch !== tenant.revocationEpoch ||
    !sameDate(lineage.expiresAt, actor.expiresAt) ||
    !sameStringArray(lineage.scopes, actor.scopes) ||
    !sameResourceConstraints(lineage.resourceConstraints, actor.resourceConstraints)
  ) {
    return 'tenant actor lineage binding is invalid';
  }
  return null;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function sameResourceConstraints(left: unknown, right: Readonly<Record<string, readonly string[]>>): boolean {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false;
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value], index) => {
    const rightEntry = rightEntries[index];
    return (
      rightEntry !== undefined &&
      key === rightEntry[0] &&
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string') &&
      sameStringArray(value as string[], rightEntry[1])
    );
  });
}

function rootTenantPolicyViolations(
  options: IssueRootKeyOptions,
  tenant: { maxKeyTtlSeconds: number; maxKeyRateLimit: number; maxKeyBudget: number },
): string[] {
  const violations: string[] = [];
  if (
    !Number.isInteger(tenant.maxKeyTtlSeconds) ||
    tenant.maxKeyTtlSeconds <= 0 ||
    !Number.isInteger(tenant.maxKeyRateLimit) ||
    tenant.maxKeyRateLimit <= 0 ||
    !Number.isInteger(tenant.maxKeyBudget) ||
    tenant.maxKeyBudget <= 0
  ) {
    return ['tenant key policy is malformed'];
  }
  if (options.expiresAt.getTime() > Date.now() + tenant.maxKeyTtlSeconds * 1_000) {
    violations.push('expiry exceeds tenant policy');
  }
  if (options.rateLimit > tenant.maxKeyRateLimit) violations.push('rate limit exceeds tenant policy');
  if (options.budget > tenant.maxKeyBudget) violations.push('budget exceeds tenant policy');
  return violations;
}

function rootRequestViolations(options: IssueRootKeyOptions): string[] {
  const violations: string[] = [];
  if (!isTenantRole(options.actorRole)) return ['unknown tenant role'];

  violations.push(...rootScopeViolations(options.scopes, options.actorRole));
  violations.push(...rootConstraintViolations(options.resourceConstraints ?? {}));

  const hasPrincipal = options.principalId != null;
  const hasMembership = options.membershipId != null;
  if (hasPrincipal !== hasMembership) violations.push('principal and membership must be bound together');

  const expiry = options.expiresAt;
  if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) {
    violations.push('expiry must be a valid future timestamp');
  }
  violations.push(...rootLimitViolations(options.rateLimit, options.budget));
  return violations;
}

function rootScopeViolations(scopes: readonly string[], actorRole: TenantRole): string[] {
  const violations: string[] = [];
  const roleCeiling = getRolePolicy(actorRole).maxScopes;
  if (scopes.length === 0) violations.push('at least one scope is required');
  for (const scope of scopes) {
    if (typeof scope !== 'string' || scope.length === 0) {
      violations.push('scope is malformed');
    } else if (isPlatformOrWildcardScope(scope)) {
      violations.push(`scope "${scope}" grants platform/wildcard authority`);
    } else if (!scopeCoveredBy(roleCeiling, scope)) {
      violations.push(`scope "${scope}" is outside the ${actorRole} role ceiling`);
    }
  }
  return violations;
}

function rootConstraintViolations(constraints: ResourceConstraints): string[] {
  const violations: string[] = [];
  for (const [key, values] of Object.entries(constraints)) {
    if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
      violations.push(`resource constraint "${key}" is malformed`);
    }
  }
  return violations;
}

function rootLimitViolations(rateLimit: number | null | undefined, budget: number | null | undefined): string[] {
  const violations: string[] = [];
  for (const [name, value] of [
    ['rate limit', rateLimit],
    ['budget', budget],
  ] as const) {
    if (value != null && (!Number.isInteger(value) || value <= 0)) {
      violations.push(`${name} must be a positive integer`);
    }
  }
  return violations;
}

function scopeCoveredBy(authorityScopes: readonly string[], requested: string): boolean {
  if (authorityScopes.includes(requested)) return true;
  const [namespace] = requested.split(':');
  return authorityScopes.includes(`${namespace}:*`);
}

function validateParentCredential(
  parent: TenantKeyLineage,
  credential:
    | {
        credentialClass: string;
        tenantId: string | null;
        principalId: string | null;
        membershipId: string | null;
        actorRole: string | null;
        keyPrefix: string;
        scopes: string[];
        status: string;
        tenantKeyLineageId: string | null;
        policySnapshotVersion: number;
        revocationEpochSnapshot: number;
        expiresAt: Date | null;
        revokedAt: Date | null;
      }
    | undefined,
  tenant: { id: string; policyVersion: number; revocationEpoch: number },
): string | null {
  if (!credential) return 'parent auth credential is missing';
  if (credential.status !== 'active' || credential.revokedAt) return 'parent auth credential is revoked';
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) return 'parent auth credential is expired';
  if (
    credential.credentialClass !== 'tenant' ||
    credential.tenantId !== tenant.id ||
    credential.tenantKeyLineageId !== parent.id ||
    credential.principalId !== parent.principalId ||
    credential.membershipId !== parent.membershipId ||
    credential.actorRole !== parent.actorRole ||
    credential.keyPrefix !== parent.keyPrefix ||
    !sameStringArray(credential.scopes, parent.scopes)
  ) {
    return 'parent auth credential binding is invalid';
  }
  if (credential.policySnapshotVersion !== tenant.policyVersion) return 'parent policy epoch is stale';
  if (
    credential.revocationEpochSnapshot !== tenant.revocationEpoch ||
    parent.revocationEpoch !== tenant.revocationEpoch
  ) {
    return 'parent revocation epoch is stale';
  }
  return null;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
