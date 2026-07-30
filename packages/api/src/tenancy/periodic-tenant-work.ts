/**
 * Periodic-work tenant fan-out (wish: omni-full-multitenancy, Group G5;
 * ADR-0008, ADR-0003).
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * A consumer derives its tenant from the versioned envelope; a cron/interval
 * loop has NO envelope and no credential — it wakes on a timer and must
 * DISCOVER whose work exists. Under RLS enforcement the runtime role cannot
 * run that discovery ambient: every tenant-scoped query outside a tenant
 * transaction RAISES (`omni_current_tenant_id()` is fail-closed), so "scan the
 * whole table, then sort out ownership" stops being expressible. Periodic work
 * therefore needs a tenant ENUMERATION step, then a per-tenant scope for each
 * pass — the same shape `runConsumerInTenantContext` gives a consumer, driven
 * from a list instead of an envelope.
 *
 * WHERE THE TENANT LIST COMES FROM
 * --------------------------------
 * The one pre-context read surface ADR-0003 gives the runtime process is the
 * auth plane: its role is granted SELECT on the credential index — including
 * `tenants` (`AUTH_PLANE_TABLES`, tenancy-roles.ts), which `auth-bootstrap.ts`
 * already reads on this same connection for the freshness check. Enumerating
 * `status = 'active'` tenants there is a trusted, non-caller-controlled
 * derivation: the list is persisted control-plane state, not anything a
 * payload could assert. Suspended/archived tenants are excluded, so a
 * suspension stops that tenant's periodic work at the NEXT tick — dequeue-time
 * revalidation for cron work, bounded by the cron cadence.
 *
 * Under enforcement WITHOUT a dedicated `OMNI_DB_AUTH_PLANE_URL`, the shared
 * runtime handle cannot read `tenants` and the enumeration FAILS CLOSED (the
 * caller's tick errors; nothing runs unscoped) — the same documented posture
 * as the confirming-hint path in `auth-plane-connection.ts`.
 *
 * THE DUAL WORLD
 * --------------
 * Flag-off, this module runs NO query and enumerates nothing: callers keep
 * their pre-G5 single ambient pass byte-identically. The fan-out binds only to
 * the multitenancy world, where the enumerated tenants exist at all.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { resolveEnforcementMode, tenants } from '@omni/db';
import { eq } from 'drizzle-orm';
import { isMultitenancyEnabled } from './feature-flag';
import { runInWorkerTenantScope } from './worker-tenant-context';

const log = createLogger('periodic-tenant-work');

/**
 * Enumerate the tenants whose periodic work should run this tick.
 *
 * Returns `[]` without touching the database when multitenancy is off — the
 * flag-off world has no tenants and its crons must not gain a query.
 *
 * @param authPlaneDb - the auth-plane read connection
 *   (`services.authPlane.db`); the only runtime-process identity that may read
 *   `tenants` under enforcement.
 */
export async function enumerateActiveWorkTenants(
  authPlaneDb: Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  if (!isMultitenancyEnabled(env)) return [];
  const rows = await authPlaneDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'active'));
  return rows.map((row) => row.id);
}

/**
 * Dequeue-time tenant admissibility for QUEUED work (RELEASE_SLOS
 * "queued_retry_delayed_dlq_check"; ADR-0008, ADR-0003).
 *
 * A consumer/executor derives its tenant at PRODUCE time (envelope stamp) or
 * CREATE time (request scope), then the work item sits in a queue or a
 * fire-and-forget background loop that may outlive the moment of derivation by
 * seconds, minutes, or a full process restart. Between derivation and dequeue
 * the tenant may have been suspended or archived. This is the gate that stops a
 * suspended tenant's still-queued work from running: the executor calls it
 * BEFORE it begins a tenant job AND again immediately before each durable
 * side-effect batch, and refuses to proceed when it returns false.
 *
 * WHY A `tenants.status` READ IS THE RIGHT GATE HERE
 * --------------------------------------------------
 * Suspension/archival of a tenant bumps that tenant's revocation epoch (the
 * control-plane invariant every credential-issuing path honours). A full
 * per-credential epoch-snapshot comparison — "was this exact credential's epoch
 * superseded" — belongs to callback-token/credential work, where a token
 * carries the epoch it was minted under. A fire-and-forget executor holds no
 * such token: it acts on the tenant's OWN persisted resources under a synthetic
 * worker context. For it, the admissibility question collapses to "is the tenant
 * itself still active", and the `tenants.status` read on the auth plane is the
 * epoch-propagation gate for that question — the same trusted, non-caller
 * controlled read `enumerateActiveWorkTenants` uses, narrowed to one tenant.
 *
 * A NULL/absent tenant is admissible by definition: a legacy (flag-off / pre-G2)
 * job has no tenant to revalidate and runs on the ambient pool byte-identically,
 * so this returns true WITHOUT touching the database. Flag-off callers therefore
 * never gain a query.
 *
 * @param authPlaneDb - the auth-plane read connection (`services.authPlane.db`);
 *   the only runtime-process identity that may read `tenants` under enforcement.
 * @param tenantId - the trusted tenant of the work item, or null/undefined for a
 *   legacy job.
 */
export async function isTenantWorkAdmissible(
  authPlaneDb: Database,
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (!tenantId) return true;
  const [row] = await authPlaneDb
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.status === 'active';
}

export interface TenantFanOutStats {
  /** Tenants enumerated for this tick. */
  tenants: number;
  /** Tenant passes that completed. */
  succeeded: number;
  /** Tenant passes that threw (logged, never propagated to siblings). */
  failed: number;
}

/**
 * Run one periodic pass per active tenant, each inside its own worker tenant
 * scope (`runInWorkerTenantScope` — detached from any inherited request scope,
 * one tenant-stamped transaction per pass).
 *
 * One tenant's failure is logged and counted, never propagated: tenant A's
 * broken state must not starve tenant B's sweep — the same isolation rule the
 * converted batch consumers apply per item.
 *
 * Flag-off this enumerates nothing and runs nothing; the caller is expected to
 * keep its legacy single-pass path unchanged.
 */
export async function runForEachActiveWorkTenant(
  db: Database,
  authPlaneDb: Database,
  jobName: string,
  fn: (tenantId: string) => Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantFanOutStats> {
  const tenantIds = await enumerateActiveWorkTenants(authPlaneDb, env);
  const stats: TenantFanOutStats = { tenants: tenantIds.length, succeeded: 0, failed: 0 };
  for (const tenantId of tenantIds) {
    try {
      await runInWorkerTenantScope(db, tenantId, async () => fn(tenantId));
      stats.succeeded += 1;
    } catch (err) {
      stats.failed += 1;
      log.warn('periodic tenant pass failed', {
        job: jobName,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return stats;
}

/** A row a periodic "list-then-act" job fans out over; carries its ownership. */
export interface TenantOwnedRow {
  tenantId: string | null;
}

export interface RowFanOutStats extends TenantFanOutStats {
  /** Rows `perRow` was invoked for, summed across every pass this tick. */
  rows: number;
}

/**
 * Fan out a periodic "list the active rows, then act on each" job across
 * tenants (G5, ADR-0008) — the shape for a cron/interval whose read is a
 * whole-table scan (`listActive`) followed by a per-row side effect that
 * PUBLISHES an event or performs a NETWORK call (create-sync-job, plugin
 * health-probe, reconnect).
 *
 * Unlike {@link runForEachActiveWorkTenant}, which wraps a tenant's WHOLE pass
 * in one worker transaction, this scopes ONLY the discrete `listActive` READ per
 * tenant and runs `perRow` OUTSIDE that scope — because holding a worker
 * transaction across a publish would make the event a pre-commit side effect,
 * and holding one across a network wait would pin a connection for the round
 * trip. `perRow` receives the pass's trusted tenant so a converted downstream
 * (`syncJobs.create({ ..., tenantId })`, `runTenantWorkDb`) can scope its OWN
 * short DB block and stamp its OWN envelope.
 *
 * The three worlds mirror the follow-up sweeper:
 *   * flag-off      — one ambient `listActive`, `perRow(row, null)` for each; no
 *                     enumeration, no predicate, byte-identical to pre-G5.
 *   * `tenant`      — per active tenant: the read runs in a worker scope (so it
 *                     succeeds under RLS enforcement) and is narrowed to the
 *                     tenant's own rows by an explicit `row.tenantId === tenantId`
 *                     filter (defense in depth before enforcement installs RLS;
 *                     redundant after). `perRow(row, tenantId)` runs detached.
 *   * `legacy-rows` — flag-on transitional: NULL-tenant rows act ambient exactly
 *                     as before. Skipped under enforcement, where the mixed state
 *                     cannot exist and an ambient read would fail closed.
 *
 * One tenant's failure is logged and isolated; siblings still run. `perRow` owns
 * its OWN per-item error handling (the pre-G5 loops already caught per row).
 */
export async function runForEachActiveTenantRow<Row extends TenantOwnedRow>(
  deps: {
    db: Database;
    authPlaneDb: Database;
    jobName: string;
    listActive: () => Promise<Row[]>;
    env?: NodeJS.ProcessEnv;
  },
  perRow: (row: Row, tenantId: string | null) => Promise<void>,
): Promise<RowFanOutStats> {
  const env = deps.env ?? process.env;
  const stats: RowFanOutStats = { tenants: 0, succeeded: 0, failed: 0, rows: 0 };

  // Flag-off: the single pre-G5 ambient pass, byte-identical — no enumeration,
  // no tenant predicate, no new query of any kind.
  if (!isMultitenancyEnabled(env)) {
    const rows = await deps.listActive();
    for (const row of rows) {
      await perRow(row, null);
      stats.rows += 1;
    }
    return stats;
  }

  // Flag-on: one pass per active tenant, then the transitional NULL-tenant pass
  // outside enforcement.
  const tenantIds = await enumerateActiveWorkTenants(deps.authPlaneDb, env);
  stats.tenants = tenantIds.length;
  for (const tenantId of tenantIds) {
    try {
      // Discrete DB READ block only — scope closes before `perRow` runs.
      const rows = await runInWorkerTenantScope(deps.db, tenantId, () => deps.listActive());
      for (const row of rows.filter((r) => r.tenantId === tenantId)) {
        await perRow(row, tenantId);
        stats.rows += 1;
      }
      stats.succeeded += 1;
    } catch (err) {
      stats.failed += 1;
      log.warn('periodic tenant pass failed', {
        job: deps.jobName,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (resolveEnforcementMode(env) !== 'enforced') {
    const rows = (await deps.listActive()).filter((r) => r.tenantId == null);
    for (const row of rows) {
      await perRow(row, null);
      stats.rows += 1;
    }
  }
  return stats;
}
