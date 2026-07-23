/**
 * The worker/consumer tenant boundary — G5's conversion device for async work
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * G4 established the per-request tenant scope (`tenant-scope.ts`): the edge opens
 * `withTenantTransaction`, and every converted service reads `scopedHandle(db)`
 * from an `AsyncLocalStorage`. That works because a request carries a credential
 * from which a tenant is derived. A NATS consumer, a cron/interval, or a
 * fire-and-forget executor has NO request and NO credential — so it has no scope,
 * and `scopedHandle` hands it the ambient pool. That is the unscoped worker
 * access the db-access guard books as `pending-G5-conversion`.
 *
 * This module is the worker counterpart of `runInTenantScope`. It takes a
 * TRUSTED tenant — derived by the producer and carried in the versioned envelope
 * (`@omni/core` `classifyEnvelope`), or read from a loaded resource's persisted
 * ownership — and runs one work item inside its own tenant-stamped transaction.
 * Once inside, a converted consumer's `scopedHandle(db)` returns that
 * transaction exactly as it does for a request, so the SAME service code is
 * scoped whether its caller is a route or a worker.
 *
 * TWO TRAPS THIS MODULE EXISTS TO AVOID (G4 leg-2 review)
 * ------------------------------------------------------
 *   1. **A worker must never inherit a request's ALS scope.** A worker spawned
 *      from inside a request (a fire-and-forget executor) would otherwise see the
 *      request's committed-and-released transaction through the ambient store —
 *      a use-after-commit, AND a cross-context tenant leak if the work item
 *      belongs to a different tenant than the request. So the FIRST thing this
 *      does is `runDetachedFromTenantScope`, suspending any inherited scope
 *      before establishing its own.
 *   2. **A worker transaction must never outlive its work item.** The scope is
 *      opened by `runInTenantScope` → `withTenantTransaction`, which commits when
 *      `fn` resolves. The transaction's lifetime is exactly `fn`'s. Background
 *      work `fn` itself spawns must open its OWN worker scope — this module does
 *      not lend its transaction across the fire-and-forget boundary.
 *
 * FAIL-CLOSED DERIVATION
 * ----------------------
 * The tenant is validated as a UUID before a transaction opens; a missing,
 * empty, or malformed value is refused. The provenance guarantee — that the
 * tenant was derived by a trusted producer and not asserted by a caller/payload
 * — is upheld by the CALL SITE: a consumer obtains this value from
 * `classifyEnvelope(...).tenantId` (which reads producer-stamped metadata, never
 * payload) or from a control-plane resource read, never from the event body.
 *
 * DUAL WORLD
 * ----------
 * Like `tenant-scope.ts`, this establishes a scope UNCONDITIONALLY (a worker
 * with a trusted tenant is always scoped); only the DB/RLS layer is
 * enforcement-gated. A flag-off deployment never reaches here with a tenant,
 * because nothing stamps one — legacy envelopes classify as `legacy` and the
 * consumer processes them on the ambient pool exactly as before.
 */

import { type OmniEvent, classifyEnvelope } from '@omni/core';
import type { Database } from '@omni/db';
import { type TenantAuthContext, freezeContext } from './auth-context';
import { runDetachedFromTenantScope, runInTenantScope } from './tenant-scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkerTenantContextError extends Error {
  readonly code = 'worker_tenant_context_denied';
  constructor(reason: string) {
    super(`worker-tenant-context: ${reason}`);
    this.name = 'WorkerTenantContextError';
  }
}

/**
 * Build the synthetic authenticated context a worker runs under.
 *
 * It is a `tenant`-class context carrying only what the tenant transaction
 * needs: the trusted tenant id. Everything else is a worker-appropriate,
 * NON-caller-controlled placeholder:
 *
 *   * `requestId` is freshly minted per work item (`crypto.randomUUID`), never
 *     an inbound/caller value — the same discipline the edge adopted after the
 *     leg-2 cross-tenant-DoS fix, so a worker's audit/trace id cannot be forged
 *     or collided by a caller.
 *   * `actorRole`/`scopes`/ceilings are the empty/most-restrictive shape: a
 *     worker acts on the tenant's own persisted resources, not on a delegated
 *     human's authority, so it carries no scopes to widen.
 *
 * @throws WorkerTenantContextError when `tenantId` is not a well-formed UUID.
 */
export function buildWorkerTenantContext(tenantId: string): TenantAuthContext {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
    throw new WorkerTenantContextError(`refusing a non-UUID tenant (${String(tenantId)})`);
  }
  return freezeContext({
    credentialClass: 'tenant',
    requestId: `worker-${crypto.randomUUID()}`,
    principalId: `worker-${tenantId}`,
    credentialId: `worker-${tenantId}`,
    tenantId,
    tenantSlug: null,
    actorRole: 'tenant-admin',
    scopes: [],
    membershipId: `worker-${tenantId}`,
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: `worker-${tenantId}`,
    policyVersion: 0,
    revocationEpoch: 0,
    tenantKeyLineageId: `worker-${tenantId}`,
  }) as TenantAuthContext;
}

/**
 * Run one work item under a fresh worker tenant scope.
 *
 * Detaches any inherited request scope, opens a tenant-stamped transaction for
 * `trustedTenantId`, and runs `fn` inside it. Converted consumer/worker code
 * reads `scopedHandle(db)` inside `fn` and gets that transaction.
 *
 * @throws WorkerTenantContextError - before any transaction opens - when
 *   `trustedTenantId` is missing/empty/malformed.
 */
export async function runInWorkerTenantScope<T>(
  db: Database,
  trustedTenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Validate BEFORE detaching/opening anything, so a bad tenant cannot even
  // start a transaction. `async` turns this fail-closed throw into a rejection,
  // so every failure mode reaches the caller through the same promise.
  const context = buildWorkerTenantContext(trustedTenantId);
  // Trap #1: suspend any inherited request scope, THEN establish our own. The
  // whole `runInTenantScope` chain runs detached from the outer scope.
  return runDetachedFromTenantScope(() => runInTenantScope(db, context, fn));
}

/**
 * The threaded-tenant bridge: run one DISCRETE DB block of a work item in the
 * right world from an explicitly threaded trusted tenant.
 *
 * This is the generalization of the dispatcher's `runDispatchDb` for services
 * whose worker callers thread a tenant instead of wrapping the whole call —
 * required wherever a method both writes the database AND publishes events,
 * because holding a worker transaction across a publish would make the event a
 * pre-commit side effect (a phantom on rollback). The caller derives
 * `trustedTenantId` from its envelope (`classifyEnvelope`) or the loaded
 * resource's persisted ownership, NEVER from a payload claim, and the method
 * wraps each DB block individually, publishing between blocks.
 *
 *   * tenant threaded → the block runs in its own worker tenant scope
 *     (detached, tenant-stamped, exactly one transaction for the block);
 *   * nothing threaded → the block runs as the caller found it: inside an
 *     active request scope it stays on that scope's transaction via
 *     `scopedHandle`, and on a legacy worker path it hits the ambient pool
 *     byte-identically.
 */
export async function runTenantWorkDb<T>(
  db: Database,
  trustedTenantId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!trustedTenantId) return fn();
  return runInWorkerTenantScope(db, trustedTenantId, fn);
}

/**
 * The consumer bridge: run an event handler's DB work in the right world.
 *
 * Classifies the inbound envelope and:
 *   * `tenant`     → runs `fn` inside a fresh worker tenant scope for the
 *                    envelope's trusted tenant (converted, scoped, RLS-policed);
 *   * `legacy`     → runs `fn` directly on the ambient pool — byte-identical to
 *                    pre-G5, the dual-world contract;
 *   * `quarantine` → refuses. The subscription layer rejects quarantined
 *                    envelopes before any handler runs, so this is defence in
 *                    depth: if one reaches here, it is a bug, and processing it
 *                    globally is exactly the fallback ADR-0008 forbids.
 *
 * A converted consumer wraps its DB work in this and reads `scopedHandle(db)`
 * inside `fn`; the same handler body is then correct in both worlds.
 */
export async function runConsumerInTenantContext<T>(
  db: Database,
  event: Pick<OmniEvent, 'metadata'>,
  fn: () => Promise<T>,
): Promise<T> {
  const classification = classifyEnvelope(event.metadata);
  if (classification.world === 'quarantine') {
    throw new WorkerTenantContextError(`refusing to process a quarantined envelope (${classification.reason})`);
  }
  if (classification.world === 'tenant') {
    return runInWorkerTenantScope(db, classification.tenantId, fn);
  }
  // legacy — no tenant context exists to establish; run as today.
  return fn();
}
