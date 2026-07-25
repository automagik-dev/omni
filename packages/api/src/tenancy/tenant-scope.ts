/**
 * The per-request tenant scope — G4's conversion device
 * (wish: omni-full-multitenancy, Group G4; ADR-0004).
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * G3 delivered `withTenantTransaction`: one transaction, one stamped tenant, a
 * handle passed explicitly to repository code. That shape is correct and it is
 * what `tenant-repository.ts` uses. It does not, on its own, scale to the
 * conversion G4 owns.
 *
 * The services in this package are long-lived singletons constructed once with
 * a `Database` (`services/index.ts`), and their methods are called from ~150
 * places per service: route handlers, the tRPC router, channel plugins, the
 * scheduler, and the CLI. Threading a transaction handle down as a new first
 * parameter would mean editing every one of those call sites for every service.
 * That is a diff whose size is itself a security problem: a reviewer cannot
 * audit it, and a single missed call site fails open silently.
 *
 * So the transaction is carried the other way — the scope is established ONCE at
 * the edge, and the service reads its handle from it. ADR-0004 requires that
 * "all repository/service queries [run] in the same transaction"; it does not
 * dictate how the handle reaches them. `AsyncLocalStorage` is the runtime's own
 * mechanism for exactly this and it propagates across `await` correctly.
 *
 * THE DUAL WORLD
 * --------------
 * This module is the single place where the two worlds diverge, which is what
 * makes the invariance auditable rather than asserted:
 *
 *   * **Tenant credential** — the edge opens `withTenantTransaction` and runs
 *     the whole handler inside it. `scopedHandle()` returns that transaction, so
 *     every converted service query is stamped and (under enforcement) policed
 *     by RLS. This is UNCONDITIONAL: it does not consult the feature flag,
 *     because a tenant credential cannot exist without the control plane that
 *     issues it. Only the DB/RLS layer is enforcement-gated.
 *
 *   * **Legacy credential** — no scope is ever established, `scopedHandle()`
 *     returns the ambient pool, and the query is byte-for-byte the query the
 *     service issued before G4 touched it. Same SQL, same connection semantics,
 *     same ordering, same side effects. The flag-off contract is preserved by
 *     construction rather than by a matching pair of code paths.
 *
 * WHY `scopedHandle` CANNOT BE THE HOLE IT LOOKS LIKE
 * ---------------------------------------------------
 * A reader's first objection to an ambient handle is that a caller could ignore
 * it and use the raw pool. That objection is answered outside this file: the
 * static db-access guard (`tenancy-db-access-guard.ts`) enumerates EVERY
 * database access site in the repository and fails the build on any site that
 * is not registered with an explicit class. A service that reaches around this
 * module does not quietly work — it fails the guard.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from '@omni/db';
import type { AuthContext } from './auth-context';
import { type TenantTx, withTenantTransaction } from './tenant-transaction';

export interface TenantScopeState {
  /** The open, tenant-stamped transaction for this request. */
  readonly tx: TenantTx;
  /** The one tenant this request may touch. Resolved by the G3 boundary. */
  readonly tenantId: string;
}

/**
 * Not exported. A caller that could `enterWith()` this store could establish a
 * tenant scope without opening a stamped transaction — the one thing this
 * module exists to make impossible. `runInTenantScope` is the only entry point.
 */
const storage = new AsyncLocalStorage<TenantScopeState>();

/** The active scope, or null when running legacy/worker/control-plane code. */
export function currentTenantScope(): TenantScopeState | null {
  return storage.getStore() ?? null;
}

/**
 * The handle a converted service must use in place of its injected `Database`.
 *
 * Returns the request's tenant transaction when one is active, and the ambient
 * pool otherwise. The cast is the deliberate, single, documented place where a
 * transaction handle is presented as a `Database`: Drizzle's `PgTransaction`
 * carries the full query builder surface (`select`/`insert`/`update`/`delete`)
 * plus `transaction()`, which nests as a SAVEPOINT. Widening it here keeps the
 * ~150 downstream call sites — and their types — completely unchanged, which is
 * what makes the conversion reviewable.
 */
export function scopedHandle(db: Database): Database {
  const scope = storage.getStore();
  return scope ? (scope.tx as unknown as Database) : db;
}

/**
 * Open the request's tenant transaction and run `fn` inside it.
 *
 * Delegates admissibility entirely to `withTenantTransaction`, so every
 * fail-closed rule G3 established (no tenant id, unbound platform context,
 * missing audited action) rejects here too, BEFORE a transaction opens.
 *
 * Nesting is refused rather than flattened. A second scope inside a first would
 * mean one request holding two tenant identities, and the inner one is the
 * interesting one for an attacker — so it is an error, not a no-op.
 */
export async function runInTenantScope<T>(db: Database, context: AuthContext, fn: () => Promise<T>): Promise<T> {
  if (storage.getStore()) {
    throw new Error('tenant-scope: a tenant scope is already active for this request');
  }
  return withTenantTransaction(db, context, async (tx, tenantId) => storage.run({ tx, tenantId }, fn));
}

/**
 * Run `fn` with any active tenant scope SUSPENDED, so it and every asynchronous
 * operation it starts observe no scope — `scopedHandle` returns the ambient pool
 * throughout, exactly as it does for a legacy request.
 *
 * This exists for background work spawned from inside a request. A request runs
 * inside `withTenantTransaction`; that transaction commits and its pooled
 * connection is released the moment the handler returns. A fire-and-forget task
 * started from the handler must NOT inherit that transaction through the ambient
 * scope — by the time its detached continuations run, the transaction is
 * committed and the connection is back in the pool, so a query issued on it is a
 * use-after-commit on a released connection. Detaching pins such a task to the
 * ambient pool, where it runs as a worker-context path (G5 owns its eventual
 * conversion per ADR-0008).
 *
 * `AsyncLocalStorage.exit` disables the store for the synchronous body AND for
 * every async resource created within it, so the whole spawned promise chain is
 * detached, not merely its first tick. A caller that is already scope-free (the
 * resume-on-boot path, the scheduler, the CLI) wraps to a harmless no-op.
 */
export function runDetachedFromTenantScope<T>(fn: () => T): T {
  return storage.exit(fn);
}

/**
 * Assert that converted code is genuinely inside the boundary.
 *
 * Used by tests and by defensive checks that want to PROVE containment rather
 * than trust it. Returns the tenant id so a caller can assert on identity, not
 * merely on presence.
 */
export function requireTenantScope(): TenantScopeState {
  const scope = storage.getStore();
  if (!scope) throw new Error('tenant-scope: expected an active tenant scope');
  return scope;
}
