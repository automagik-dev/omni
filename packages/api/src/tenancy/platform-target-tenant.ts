/**
 * Platform-admin access to one target tenant
 * (wish: omni-full-multitenancy, Group G3; ADR-0005).
 *
 * A platform administrator needs to operate inside a tenant for lifecycle and
 * support work. The tempting implementation is a second connection pool whose
 * role holds `BYPASSRLS`. ADR-0005 forbids exactly that, and this module is the
 * alternative: the platform credential goes through the SAME
 * `withTenantTransaction` boundary, under the SAME forced policies, bound to
 * exactly ONE target tenant chosen by the route.
 *
 * The practical consequence is worth stating plainly: a platform admin acting
 * through this path can read and write tenant X's rows and is structurally
 * incapable of seeing tenant Y's in the same transaction, because the policy
 * predicate does not know or care that the caller is a platform credential —
 * it only sees `app.tenant_id`. Cross-tenant aggregates are therefore NOT
 * available here at all; they belong to narrow, separately audited
 * control-plane services.
 *
 * Every operation writes an audit row carrying actor, target tenant, reason,
 * request id, and before/after metadata. The audit write happens INSIDE the
 * same transaction as the operation, so an operation cannot commit without its
 * audit record and an audit record cannot survive a rolled-back operation.
 */

import type { Database } from '@omni/db';
import { tenantAuditLogs } from '@omni/db';
import { type PlatformAuthContext, bindPlatformOperation } from './auth-context';
import { type TenantTx, withTenantTransaction } from './tenant-transaction';

export class PlatformTargetTenantError extends Error {
  readonly code = 'platform_target_denied';
  constructor(message: string) {
    super(`omni: platform target-tenant access denied — ${message}`);
    this.name = 'PlatformTargetTenantError';
  }
}

export interface PlatformOperationRequest {
  /** The ONE tenant this operation may touch. Route-selected, never caller-selected. */
  readonly targetTenantId: string;
  /** Audited action name, e.g. `tenant.instance.suspend`. */
  readonly action: string;
  /** Free-text operator justification. Required: an unexplained action is not admissible. */
  readonly reason: string;
  /** Optional pre-image the audit record should carry. */
  readonly before?: unknown;
}

export interface PlatformOperationResult<T> {
  readonly value: T;
  readonly auditId: string;
  readonly targetTenantId: string;
}

/**
 * Run one audited platform operation against one tenant.
 *
 * `fn` may return an `after` image; whatever it returns is stored in the audit
 * metadata alongside `before`, so a support action is reconstructable from the
 * audit trail alone.
 */
export async function withPlatformTargetTenant<T>(
  db: Database,
  platform: PlatformAuthContext,
  request: PlatformOperationRequest,
  fn: (tx: TenantTx, tenantId: string) => Promise<{ value: T; after?: unknown }>,
): Promise<PlatformOperationResult<T>> {
  if (platform?.credentialClass !== 'platform') {
    throw new PlatformTargetTenantError('a platform-class credential is required');
  }
  if (typeof request.reason !== 'string' || request.reason.trim().length === 0) {
    throw new PlatformTargetTenantError('an explicit reason is required');
  }
  if (typeof request.action !== 'string' || request.action.trim().length === 0) {
    throw new PlatformTargetTenantError('an explicit action is required');
  }
  if (platform.principalId === null) {
    throw new PlatformTargetTenantError('platform credential has no principal to attribute the action to');
  }

  // Bind action + target onto a NEW frozen context. The caller's context object
  // is unchanged, so a second operation in the same request cannot inherit the
  // first one's target by accident.
  const bound = bindPlatformOperation(platform, request.action, request.targetTenantId);

  let auditId = '';
  const value = await withTenantTransaction(db, bound, async (tx, tenantId) => {
    const outcome = await fn(tx, tenantId);
    const [audit] = await tx
      .insert(tenantAuditLogs)
      .values({
        tenantId,
        actorPrincipalId: bound.principalId,
        actorCredentialId: bound.credentialId,
        action: request.action,
        targetType: 'tenant',
        targetId: tenantId,
        requestId: bound.requestId,
        metadata: {
          reason: request.reason,
          platformAction: request.action,
          actorCredentialClass: 'platform',
          before: request.before ?? null,
          after: outcome.after ?? null,
        },
      })
      .returning({ id: tenantAuditLogs.id });
    auditId = audit?.id ?? '';
    return outcome.value;
  });

  return { value, auditId, targetTenantId: request.targetTenantId };
}
