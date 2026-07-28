/**
 * Batch-job background execution must NOT inherit the request's tenant scope
 * (wish: omni-full-multitenancy, Group G4).
 *
 * `BatchJobService.create` is a route-facing method: under a tenant credential
 * it runs inside the request's tenant transaction, and its own INSERT is
 * correctly scoped to that transaction. It then spawns `executeJob`
 * fire-and-forget. That executor OUTLIVES the request — by the time its
 * continuations run, the request handler has returned, the tenant transaction
 * has COMMITTED, and the pooled connection it held is back in the pool. If the
 * executor still saw the request scope, every query it makes via `this.db`
 * (`scopedHandle(this.pool)`) would resolve to that committed transaction — a
 * use-after-commit on a released connection, silently swallowed by the
 * fire-and-forget `.catch`.
 *
 * The property proven here: the spawned executor observes NO tenant scope, both
 * at its synchronous entry AND across its `await` continuations. Because
 * `scopedHandle` returns the ambient pool exactly when `currentTenantScope()` is
 * null (see tenant-scope.test.ts), an executor that observes null scope is one
 * whose `this.db` is the ambient pool — the intended worker-context path. The
 * request path is asserted in the same test as its twin: the create INSERT DOES
 * run scoped, so the fix detaches the background work WITHOUT unscoping the
 * route.
 *
 * RED before the fix: `create` spawned `this.executeJob(id)` directly, so the
 * executor's synchronous entry ran inside the still-active scope and its
 * post-await continuations restored it — both observations would be TENANT_A.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import type { AuthContext } from '../../tenancy/auth-context';
import { currentTenantScope, runInTenantScope } from '../../tenancy/tenant-scope';
import { BatchJobService } from '../batch-jobs';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

function tenantContext(tenantId: string): AuthContext {
  return {
    credentialClass: 'tenant',
    requestId: `req-${tenantId}`,
    principalId: 'principal-1',
    credentialId: 'credential-1',
    tenantId,
    actorRole: 'tenant-admin',
    scopes: [],
    membershipId: 'membership-1',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 1,
    tenantKeyLineageId: 'lineage-1',
  } as AuthContext;
}

/**
 * A `Database` stand-in wired for exactly the path `create` walks: the tenant
 * boundary opens a transaction (`transaction`) and stamps it (`execute`), then
 * `create` issues one INSERT ... RETURNING on the scoped handle. `insertScopes`
 * records the tenant observed when that INSERT is built, so the test can prove
 * the route path stays scoped while the spawned executor does not.
 */
function fakePool(insertScopes: Array<string | null>): Database {
  const created = { id: 'job-1', instanceId: 'inst-1', jobType: 'time_based_batch', status: 'pending' };
  const insert = () => ({
    values: () => {
      insertScopes.push(currentTenantScope()?.tenantId ?? null);
      return { returning: async () => [created] };
    },
  });
  const tx = { __handle: 'tx', execute: async () => [], insert };
  const pool = {
    __handle: 'pool',
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    insert,
  };
  return pool as unknown as Database;
}

/** Reassign the (TypeScript-private) executor without `any`. */
interface ExecutorOverride {
  executeJob(jobId: string): Promise<void>;
}

describe('batch-jobs — background executor is detached from the request tenant scope', () => {
  test('create runs scoped, but the executor it spawns observes no scope at entry and after await', async () => {
    const insertScopes: Array<string | null> = [];
    const pool = fakePool(insertScopes);
    const service = new BatchJobService(pool, null);

    // Observe the scope the executor sees. Two probes: the synchronous entry
    // (detached only if the SPAWN is detached) and after an await (detached only
    // if the whole continuation chain is detached, not merely its first tick).
    const observed: { entry: string | null; afterAwait: string | null } = { entry: null, afterAwait: null };
    let executorDone: Promise<void> = Promise.resolve();
    (service as unknown as ExecutorOverride).executeJob = (_jobId: string): Promise<void> => {
      observed.entry = currentTenantScope()?.tenantId ?? null;
      executorDone = (async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        observed.afterAwait = currentTenantScope()?.tenantId ?? null;
      })();
      return executorDone;
    };

    // Drive `create` from inside a tenant scope, exactly as the edge does.
    await runInTenantScope(pool, tenantContext(TENANT_A), async () => {
      const job = await service.create({ jobType: 'time_based_batch', instanceId: 'inst-1', daysBack: 1 });
      expect(job.id).toBe('job-1');
      // The scope is still active here, as it is for the whole handler.
      expect(currentTenantScope()?.tenantId).toBe(TENANT_A);
    });

    // Let the detached executor's continuation run to completion.
    await executorDone;

    // The route path IS scoped: the create INSERT ran inside the tenant tx.
    expect(insertScopes).toEqual([TENANT_A]);

    // The background executor is NOT scoped — neither synchronously nor across
    // its awaits. This is precisely what keeps `this.db` on the ambient pool and
    // averts the use-after-commit on the request's released connection.
    expect(observed.entry).toBeNull();
    expect(observed.afterAwait).toBeNull();
  });
});
