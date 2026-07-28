/**
 * Tenant control-plane service (wish: omni-full-multitenancy, Group G1; ADR-0005).
 *
 * Platform-admin lifecycle + membership operations. Every STATE CHANGE:
 *   - requires an explicit actor (principal/credential/request id) and a reason;
 *   - appends an immutable `platform_audit_logs` row with target tenant, actor,
 *     reason, request id, and before/after metadata.
 *
 * Deliberate non-capabilities:
 *   - No hard tenant delete. Lifecycle ends at `archived`. There is no `delete`
 *     method here and no DELETE route.
 *   - Suspension/archive bump the tenant `revocation_epoch`, which invalidates
 *     the tenant's credentials on their next auth-bootstrap lookup (fail closed).
 *
 * This service never mints tenant/platform credentials.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type Tenant,
  type TenantMembership,
  type TenantRole,
  platformAuditLogs,
  tenantMemberships,
  tenants,
} from '@omni/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type PlatformMutationActor, platformActorFreshnessFailure } from '../tenancy/transactional-auth';

const log = createLogger('tenant-control-plane');

/** The transaction handle passed to `db.transaction(fn)`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type PlatformActor = PlatformMutationActor;

export interface CreateTenantInput {
  slug: string;
  displayName: string;
  maxKeyTtlSeconds: number;
  maxKeyRateLimit: number;
  maxKeyBudget: number;
  createdByPrincipalId?: string | null;
}

export interface AttachMembershipInput {
  tenantId: string;
  principalId: string;
  role: TenantRole;
  invitedByPrincipalId?: string | null;
}

export type LifecycleResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not_found' }
  | { status: 'conflict'; message: string };

export class TenantControlPlaneService {
  constructor(private db: Database) {}

  async createTenant(input: CreateTenantInput, actor: PlatformActor, reason: string): Promise<LifecycleResult<Tenant>> {
    this.assertActorBinding(actor, 'tenant.create', null);
    return this.db.transaction(async (tx): Promise<LifecycleResult<Tenant>> => {
      await this.assertFreshActor(tx, actor);
      const [existing] = await tx.select().from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
      if (existing) return { status: 'conflict', message: 'slug already exists' };

      const [created] = await tx
        .insert(tenants)
        .values({
          slug: input.slug,
          displayName: input.displayName,
          maxKeyTtlSeconds: input.maxKeyTtlSeconds,
          maxKeyRateLimit: input.maxKeyRateLimit,
          maxKeyBudget: input.maxKeyBudget,
          status: 'active',
          createdByPrincipalId: input.createdByPrincipalId ?? null,
        })
        .returning();
      if (!created) return { status: 'conflict', message: 'failed to create tenant' };

      await this.audit(tx, actor, 'tenant.create', created.id, reason, null, tenantSnapshot(created));
      log.info('tenant created', { tenantId: created.id, slug: created.slug });
      return { status: 'ok', value: created };
    });
  }

  async listTenants(actor: PlatformActor, reason: string, limit = 50): Promise<Tenant[]> {
    this.assertActorBinding(actor, 'tenant.list', null);
    return this.db.transaction(async (tx) => {
      await this.assertFreshActor(tx, actor);
      const rows = await tx
        .select()
        .from(tenants)
        .orderBy(desc(tenants.createdAt))
        .limit(Math.min(Math.max(limit, 1), 200));
      await this.audit(tx, actor, 'tenant.list', null, reason, null, { resultCount: rows.length });
      return rows;
    });
  }

  async getTenant(id: string, actor: PlatformActor, reason: string): Promise<Tenant | null> {
    this.assertActorBinding(actor, 'tenant.read', id);
    return this.db.transaction(async (tx) => {
      await this.assertFreshActor(tx, actor);
      const [row] = await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1);
      if (!row) return null;
      await this.audit(tx, actor, 'tenant.read', id, reason, null, tenantSnapshot(row));
      return row;
    });
  }

  async suspendTenant(id: string, reason: string, actor: PlatformActor): Promise<LifecycleResult<Tenant>> {
    return this.transitionLifecycle(id, 'suspended', reason, actor);
  }

  async archiveTenant(id: string, reason: string, actor: PlatformActor): Promise<LifecycleResult<Tenant>> {
    return this.transitionLifecycle(id, 'archived', reason, actor);
  }

  private async transitionLifecycle(
    id: string,
    target: 'suspended' | 'archived',
    reason: string,
    actor: PlatformActor,
  ): Promise<LifecycleResult<Tenant>> {
    const action = target === 'suspended' ? 'tenant.suspend' : 'tenant.archive';
    this.assertActorBinding(actor, action, id);
    return this.db.transaction(async (tx): Promise<LifecycleResult<Tenant>> => {
      await this.assertFreshActor(tx, actor);
      const [current] = await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1).for('update');
      if (!current) return { status: 'not_found' };

      // Archived is terminal; suspending an archived tenant is a no-op conflict.
      if (current.status === 'archived') {
        return { status: 'conflict', message: 'tenant is archived (terminal)' };
      }
      if (current.status === target) {
        return { status: 'conflict', message: `tenant already ${target}` };
      }

      const now = new Date();
      const [updated] = await tx
        .update(tenants)
        .set({
          status: target,
          revocationEpoch: sql`${tenants.revocationEpoch} + 1`,
          suspendedAt: target === 'suspended' ? now : current.suspendedAt,
          archivedAt: target === 'archived' ? now : current.archivedAt,
          updatedAt: now,
        })
        .where(eq(tenants.id, id))
        .returning();
      if (!updated) return { status: 'not_found' };

      await this.audit(tx, actor, action, updated.id, reason, tenantSnapshot(current), tenantSnapshot(updated));
      log.info('tenant lifecycle transition', { tenantId: id, from: current.status, to: target });
      return { status: 'ok', value: updated };
    });
  }

  async attachMembership(
    input: AttachMembershipInput,
    actor: PlatformActor,
    reason: string,
  ): Promise<LifecycleResult<TenantMembership>> {
    this.assertActorBinding(actor, 'membership.attach', input.tenantId);
    return this.db.transaction(async (tx): Promise<LifecycleResult<TenantMembership>> => {
      await this.assertFreshActor(tx, actor);
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1).for('update');
      if (!tenant) return { status: 'not_found' };
      if (tenant.status !== 'active') return { status: 'conflict', message: `tenant is ${tenant.status}` };

      const [existing] = await tx
        .select()
        .from(tenantMemberships)
        .where(
          and(eq(tenantMemberships.tenantId, input.tenantId), eq(tenantMemberships.principalId, input.principalId)),
        )
        .limit(1);
      if (existing) return { status: 'conflict', message: 'membership already exists' };

      const [created] = await tx
        .insert(tenantMemberships)
        .values({
          tenantId: input.tenantId,
          principalId: input.principalId,
          role: input.role,
          status: 'active',
          invitedByPrincipalId: input.invitedByPrincipalId ?? null,
        })
        .returning();
      if (!created) return { status: 'conflict', message: 'failed to attach membership' };

      await this.audit(tx, actor, 'membership.attach', input.tenantId, reason, null, membershipSnapshot(created));
      return { status: 'ok', value: created };
    });
  }

  /** Detach = soft-disable. Rows are never hard-deleted (audit/lineage preserved). */
  async detachMembership(
    membershipId: string,
    reason: string,
    actor: PlatformActor,
  ): Promise<LifecycleResult<TenantMembership>> {
    return this.setMembershipStatus(membershipId, 'disabled', reason, actor, 'membership.detach');
  }

  async setMembershipStatus(
    membershipId: string,
    status: 'active' | 'disabled',
    reason: string,
    actor: PlatformActor,
    action = 'membership.status',
  ): Promise<LifecycleResult<TenantMembership>> {
    const targetTenantId = this.assertOneTenantActor(actor, action);
    return this.db.transaction(async (tx): Promise<LifecycleResult<TenantMembership>> => {
      await this.assertFreshActor(tx, actor);
      // Discover the immutable tenant binding, then lock tenant -> membership.
      // This matches key-issuance lock order and avoids suspension/issuance races.
      const [observed] = await tx
        .select()
        .from(tenantMemberships)
        .where(eq(tenantMemberships.id, membershipId))
        .limit(1);
      if (!observed) return { status: 'not_found' };
      if (observed.tenantId !== targetTenantId) return { status: 'not_found' };
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, observed.tenantId)).limit(1).for('update');
      if (!tenant) return { status: 'not_found' };
      const [current] = await tx
        .select()
        .from(tenantMemberships)
        .where(eq(tenantMemberships.id, membershipId))
        .limit(1)
        .for('update');
      if (!current) return { status: 'not_found' };
      if (current.tenantId !== tenant.id) return { status: 'conflict', message: 'membership tenant binding changed' };
      if (current.status === status) return { status: 'conflict', message: `membership already ${status}` };
      if (status === 'active' && tenant.status !== 'active') {
        return { status: 'conflict', message: `tenant is ${tenant.status}` };
      }

      const now = new Date();
      const [updated] = await tx
        .update(tenantMemberships)
        .set({ status, disabledAt: status === 'disabled' ? now : null, updatedAt: now })
        .where(eq(tenantMemberships.id, membershipId))
        .returning();
      if (!updated) return { status: 'not_found' };

      await tx
        .update(tenants)
        .set({ revocationEpoch: sql`${tenants.revocationEpoch} + 1`, updatedAt: now })
        .where(eq(tenants.id, current.tenantId));

      await this.audit(
        tx,
        actor,
        action,
        current.tenantId,
        reason,
        membershipSnapshot(current),
        membershipSnapshot(updated),
      );
      return { status: 'ok', value: updated };
    });
  }

  async setMembershipRole(
    membershipId: string,
    role: TenantRole,
    reason: string,
    actor: PlatformActor,
  ): Promise<LifecycleResult<TenantMembership>> {
    const targetTenantId = this.assertOneTenantActor(actor, 'membership.role');
    return this.db.transaction(async (tx): Promise<LifecycleResult<TenantMembership>> => {
      await this.assertFreshActor(tx, actor);
      const [observed] = await tx
        .select()
        .from(tenantMemberships)
        .where(eq(tenantMemberships.id, membershipId))
        .limit(1);
      if (!observed) return { status: 'not_found' };
      if (observed.tenantId !== targetTenantId) return { status: 'not_found' };
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, observed.tenantId)).limit(1).for('update');
      if (!tenant) return { status: 'not_found' };
      if (tenant.status !== 'active') return { status: 'conflict', message: `tenant is ${tenant.status}` };
      const [current] = await tx
        .select()
        .from(tenantMemberships)
        .where(eq(tenantMemberships.id, membershipId))
        .limit(1)
        .for('update');
      if (!current) return { status: 'not_found' };
      if (current.tenantId !== tenant.id) return { status: 'conflict', message: 'membership tenant binding changed' };
      if (current.role === role) return { status: 'conflict', message: `membership already ${role}` };

      const now = new Date();
      const [updated] = await tx
        .update(tenantMemberships)
        .set({ role, updatedAt: now })
        .where(eq(tenantMemberships.id, membershipId))
        .returning();
      if (!updated) return { status: 'not_found' };

      await tx
        .update(tenants)
        .set({ revocationEpoch: sql`${tenants.revocationEpoch} + 1`, updatedAt: now })
        .where(eq(tenants.id, current.tenantId));

      await this.audit(
        tx,
        actor,
        'membership.role',
        current.tenantId,
        reason,
        membershipSnapshot(current),
        membershipSnapshot(updated),
      );
      return { status: 'ok', value: updated };
    });
  }

  async listMemberships(tenantId: string, actor: PlatformActor, reason: string): Promise<TenantMembership[]> {
    this.assertActorBinding(actor, 'membership.list', tenantId);
    return this.db.transaction(async (tx) => {
      await this.assertFreshActor(tx, actor);
      const rows = await tx
        .select()
        .from(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, tenantId))
        .orderBy(desc(tenantMemberships.createdAt));
      await this.audit(tx, actor, 'membership.list', tenantId, reason, null, { resultCount: rows.length });
      return rows;
    });
  }

  /** Append-only audit write. No update/delete path exists for audit rows. */
  private async assertFreshActor(tx: Tx, actor: PlatformActor): Promise<void> {
    const failure = await platformActorFreshnessFailure(tx, actor);
    if (failure) throw new Error(`unauthorized platform actor: ${failure}`);
  }

  private assertOneTenantActor(actor: PlatformActor, action: string): string {
    if (actor.platformAction !== action) {
      throw new Error(`platform action binding mismatch: expected ${action}`);
    }
    if (actor.targetTenantId === null) throw new Error('platform target tenant binding mismatch');
    return actor.targetTenantId;
  }

  private assertActorBinding(actor: PlatformActor, action: string, targetTenantId: string | null): void {
    if (actor.platformAction !== action) {
      throw new Error(`platform action binding mismatch: expected ${action}`);
    }
    if (actor.targetTenantId !== targetTenantId) throw new Error('platform target tenant binding mismatch');
  }

  private async audit(
    tx: Tx,
    actor: PlatformActor,
    action: string,
    targetTenantId: string | null,
    reason: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) throw new Error('platform audit reason is required');
    if (actor.platformAction !== action) {
      throw new Error(`platform action binding mismatch: expected ${action}`);
    }
    const targetMatches =
      (action === 'tenant.create' && actor.targetTenantId === null && targetTenantId !== null) ||
      actor.targetTenantId === targetTenantId;
    if (!targetMatches) {
      throw new Error('platform target tenant binding mismatch');
    }
    await tx.insert(platformAuditLogs).values({
      actorPrincipalId: actor.principalId,
      actorCredentialId: actor.credentialId,
      action,
      targetTenantId,
      reason: trimmedReason,
      requestId: actor.requestId,
      beforeMetadata: before,
      afterMetadata: after,
    });
  }
}

function tenantSnapshot(t: Tenant): Record<string, unknown> {
  return {
    id: t.id,
    slug: t.slug,
    displayName: t.displayName,
    status: t.status,
    revocationEpoch: t.revocationEpoch,
    policyVersion: t.policyVersion,
  };
}

function membershipSnapshot(m: TenantMembership): Record<string, unknown> {
  return { id: m.id, tenantId: m.tenantId, principalId: m.principalId, role: m.role, status: m.status };
}
