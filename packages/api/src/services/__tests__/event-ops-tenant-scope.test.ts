/**
 * Replay background execution must NOT inherit the request's tenant scope
 * (wish: omni-full-multitenancy, Group G4).
 *
 * `EventOpsService.startReplay` is a route-facing method: under a tenant
 * credential (POST /api/v2/event-ops/replay) it runs inside the request's
 * tenant transaction, and its own count query is correctly scoped to that
 * transaction. It then spawns `executeReplay` fire-and-forget. That executor
 * OUTLIVES the request — by the time its batch queries run, the request handler
 * has returned, the tenant transaction has COMMITTED, and the pooled connection
 * it held is back in the pool. If the executor still saw the request scope,
 * every query it makes via `this.db` (`scopedHandle(this.pool)`) would resolve
 * to that committed transaction — a use-after-commit on a released connection,
 * silently swallowed by the fire-and-forget `.catch`.
 *
 * Mirrors batch-jobs-tenant-scope.test.ts. The property proven: the spawned
 * executor observes NO tenant scope, both at its synchronous entry AND across
 * its `await` continuations, while the route path observes the tenant. Because
 * `scopedHandle` returns the ambient pool exactly when `currentTenantScope()` is
 * null, an executor that observes null scope is one whose `this.db` is the
 * ambient pool — the intended worker-context path.
 *
 * RED before the fix: `startReplay` spawned `this.executeReplay(...)` directly,
 * so the executor's synchronous entry ran inside the still-active scope and its
 * post-await continuations restored it — both observations would be TENANT_A.
 */

import { describe, expect, test } from 'bun:test';
import type { ReplayOptions } from '@omni/core';
import type { Database } from '@omni/db';
import type { AuthContext } from '../../tenancy/auth-context';
import { currentTenantScope, runInTenantScope } from '../../tenancy/tenant-scope';
import type { DeadLetterService } from '../dead-letters';
import { EventOpsService } from '../event-ops';
import type { PayloadStoreService } from '../payload-store';

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
 * A `Database` stand-in wired for the path `startReplay` walks: the tenant
 * boundary opens a transaction (`transaction`) and stamps it (`execute`), then
 * `startReplay` issues one count SELECT on the scoped handle. `queryScopes`
 * records the tenant observed when that SELECT resolves, so the test can prove
 * the route path stays scoped while the spawned executor does not.
 */
function fakePool(queryScopes: Array<string | null>): Database {
  const where = async () => {
    queryScopes.push(currentTenantScope()?.tenantId ?? null);
    return [{ count: 0 }];
  };
  const select = () => ({ from: () => ({ where }) });
  const tx = { __handle: 'tx', execute: async () => [], select };
  const pool = {
    __handle: 'pool',
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    select,
  };
  return pool as unknown as Database;
}

/** Reassign the (TypeScript-private) executor without `any`. */
interface ExecutorOverride {
  executeReplay(sessionId: string, options: ReplayOptions): Promise<void>;
}

describe('event-ops — background replay executor is detached from the request tenant scope', () => {
  test('startReplay runs scoped, but the executor it spawns observes no scope at entry and after await', async () => {
    const queryScopes: Array<string | null> = [];
    const pool = fakePool(queryScopes);
    const service = new EventOpsService(
      pool,
      null,
      {} as unknown as DeadLetterService,
      {} as unknown as PayloadStoreService,
    );

    // Observe the scope the executor sees. Two probes: the synchronous entry
    // (detached only if the SPAWN is detached) and after an await (detached only
    // if the whole continuation chain is detached, not merely its first tick).
    const observed: { entry: string | null; afterAwait: string | null } = { entry: null, afterAwait: null };
    let executorDone: Promise<void> = Promise.resolve();
    (service as unknown as ExecutorOverride).executeReplay = (_sessionId: string): Promise<void> => {
      observed.entry = currentTenantScope()?.tenantId ?? null;
      executorDone = (async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        observed.afterAwait = currentTenantScope()?.tenantId ?? null;
      })();
      return executorDone;
    };

    const options: ReplayOptions = { since: new Date('2026-01-01T00:00:00.000Z') };

    // Drive `startReplay` from inside a tenant scope, exactly as the edge does.
    await runInTenantScope(pool, tenantContext(TENANT_A), async () => {
      const session = await service.startReplay(options);
      expect(session.status).toBe('running');
      // The scope is still active here, as it is for the whole handler.
      expect(currentTenantScope()?.tenantId).toBe(TENANT_A);
    });

    // Let the detached executor's continuation run to completion.
    await executorDone;

    // The route path IS scoped: the count SELECT ran inside the tenant tx.
    expect(queryScopes).toEqual([TENANT_A]);

    // The background executor is NOT scoped — neither synchronously nor across
    // its awaits. This is precisely what keeps `this.db` on the ambient pool and
    // averts the use-after-commit on the request's released connection.
    expect(observed.entry).toBeNull();
    expect(observed.afterAwait).toBeNull();
  });
});
