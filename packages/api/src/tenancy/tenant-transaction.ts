/**
 * The single tenant data-access boundary
 * (wish: omni-full-multitenancy, Group G3; ADR-0004, ADR-0005).
 *
 * Every tenant-scoped query in the system is supposed to arrive here and
 * nowhere else. `withTenantTransaction` opens ONE transaction, stamps
 * `app.tenant_id` into it, and hands the caller a transaction handle. The
 * repository/service code it calls receives that handle and cannot reach around
 * it — there is no ambient `db` in scope inside the callback.
 *
 * WHY TRANSACTION-LOCAL, NOT SESSION-LEVEL
 * ----------------------------------------
 * postgres.js hands out POOLED connections. A session-level
 * `SET app.tenant_id` would survive the query, go back into the pool with the
 * connection, and be inherited by whatever request picked that connection up
 * next — a cross-tenant read with no bug anywhere in the application code. The
 * third argument to `set_config(name, value, true)` makes the setting
 * transaction-local: PostgreSQL discards it at COMMIT or ROLLBACK, so the
 * connection returns to the pool with no tenant identity at all. The
 * "no leakage across transactions that reuse a pooled connection" probe in
 * `rls-postgres.test.ts` is what proves this rather than assumes it.
 *
 * FAIL-CLOSED
 * -----------
 * Every rejection happens BEFORE `db.transaction` is called, so a context
 * problem cannot leave a half-open transaction and cannot execute a single
 * statement. There is no "default tenant", no "global" mode, and no way to pass
 * a tenant id directly — the tenant comes from the authenticated context or the
 * call does not happen.
 *
 * ADR-0005: a platform context is admissible here only when a route has bound
 * it to exactly ONE explicit target tenant via `bindPlatformOperation`. It then
 * runs under the same forced-RLS policies as a tenant credential would. A
 * platform context with no target tenant is rejected like any other
 * tenant-less context: there is no data-plane BYPASSRLS path.
 */

import type { Database } from '@omni/db';
import { sql } from 'drizzle-orm';
import type { AuthContext } from './auth-context';

/** Transaction handle Drizzle passes to a `db.transaction` callback. */
export type TenantTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type TenantContextFailure =
  /** No context at all — an unauthenticated or mis-wired call site. */
  | 'missing_context'
  /** The context is structurally not one of the two known classes. */
  | 'malformed_context'
  /** A tenant context whose tenant id is absent or not a UUID. */
  | 'invalid_tenant'
  /** A platform context that was never bound to one target tenant (ADR-0005). */
  | 'platform_target_tenant_required'
  /** A platform context bound to a target but with no audited action. */
  | 'platform_action_required';

export class TenantContextError extends Error {
  readonly code = 'tenant_context_denied';
  constructor(readonly reason: TenantContextFailure) {
    super(`omni: tenant transaction denied (${reason})`);
    this.name = 'TenantContextError';
  }
}

/**
 * RFC 4122 shape. The value is interpolated as a bound parameter, so this is
 * not an injection guard — it is a fail-closed guard: `set_config` accepts any
 * string, and a non-UUID would be rejected only later, by the policy's cast,
 * AFTER the transaction opened and possibly after statements ran.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The one tenant this operation may touch, or a typed failure.
 *
 * Exported because the platform-admin wrapper and the static-guard tests need
 * to reason about admissibility without opening a transaction.
 */
export function resolveTransactionTenantId(context: AuthContext | null | undefined): string {
  if (!context || typeof context !== 'object') throw new TenantContextError('missing_context');

  if (context.credentialClass === 'tenant') {
    const { tenantId } = context;
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) throw new TenantContextError('invalid_tenant');
    return tenantId;
  }

  if (context.credentialClass === 'platform') {
    // ADR-0005: one explicit target, through the same forced-RLS boundary.
    if (context.targetTenantId === null || context.targetTenantId === undefined) {
      throw new TenantContextError('platform_target_tenant_required');
    }
    if (typeof context.targetTenantId !== 'string' || !UUID.test(context.targetTenantId)) {
      throw new TenantContextError('invalid_tenant');
    }
    // A target with no action would be an unaudited cross-tenant read.
    if (typeof context.platformAction !== 'string' || context.platformAction.trim().length === 0) {
      throw new TenantContextError('platform_action_required');
    }
    return context.targetTenantId;
  }

  throw new TenantContextError('malformed_context');
}

export interface TenantTransactionOptions {
  /**
   * Set when the caller has already validated the context and wants the
   * resolved tenant reported back (audit wrappers use this).
   */
  readonly onTenantResolved?: (tenantId: string) => void;
}

/**
 * Run `fn` inside one transaction stamped with the context's tenant.
 *
 * @throws TenantContextError - before any statement executes, when the context
 *   is missing, malformed, or carries no admissible tenant.
 */
export async function withTenantTransaction<T>(
  db: Database,
  context: AuthContext | null | undefined,
  fn: (tx: TenantTx, tenantId: string) => Promise<T>,
  options: TenantTransactionOptions = {},
): Promise<T> {
  // Resolve FIRST. A failure here must not open a transaction.
  const tenantId = resolveTransactionTenantId(context);
  options.onTenantResolved?.(tenantId);

  return db.transaction(async (tx) => {
    // `true` = transaction-local. This is the entire pooled-connection safety
    // story; changing it to `false` would silently re-introduce leakage.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx, tenantId);
  });
}

/**
 * Read back the tenant stamped on a transaction.
 *
 * Used by the leakage probes and by defensive assertions in repository code
 * that wants to prove it is inside a boundary rather than trust that it is.
 * Returns null when nothing is set, which — outside enforcement mode — is the
 * normal state of a connection freshly taken from the pool.
 */
export async function readTransactionTenantId(tx: TenantTx | Database): Promise<string | null> {
  const rows = (await tx.execute(sql`SELECT current_setting('app.tenant_id', true) AS tenant_id`)) as unknown as {
    tenant_id: string | null;
  }[];
  const value = rows[0]?.tenant_id;
  return value === undefined || value === null || value === '' ? null : value;
}
