/**
 * `services/batch-jobs.ts::{batch_jobs,media_content,messages}` — the LAST
 * unscoped caller (G5; ADR-0008).
 *
 * Earlier legs converted the whole fire-and-forget executor: every discrete DB
 * block inside `executeJob` runs in `runTenantWorkDb(pool, jobTenantId, …)`,
 * with the job's TRUSTED tenant captured from the request scope at create time
 * or threaded by a worker caller. What stayed ambient was `resumeJobs()` — the
 * restart-recovery path, which scans the WHOLE `batch_jobs` table for
 * `status = 'running'` with no request, no credential and no envelope. Under RLS
 * enforcement that global scan is not expressible at all, so recovery must
 * ENUMERATE whose jobs exist rather than scan and sort out ownership afterwards.
 *
 * This probe pins:
 *   1. LEGACY WORLD IS BYTE-IDENTICAL — no auth plane wired (the shape every
 *      existing test and every flag-off deployment produces): one ambient scan,
 *      no enumeration, no transaction.
 *   2. ENUMERATED, NOT SCANNED — flag-on the scan runs once per ACTIVE tenant
 *      inside that tenant's worker scope.
 *   3. THE RESUMED EXECUTOR CARRIES THE ROW'S OWN TENANT — not the pass's, not
 *      an ambient one: `executeJob` is handed `job.tenantId`, which is what makes
 *      the dequeue revalidation and every downstream block target the right
 *      tenant.
 *   4. NO CROSS-TENANT BLEED — a job owned by tenant B is not resumed in tenant
 *      A's pass.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { BatchJobService } from '../batch-jobs';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

const FLAG_ON: NodeJS.ProcessEnv = { [MULTITENANCY_FLAG_ENV]: 'true' };
const FLAG_OFF: NodeJS.ProcessEnv = {};

function scope(): string | null {
  return currentTenantScope()?.tenantId ?? null;
}

function chain<T>(result: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

interface Observed {
  op: string;
  scope: string | null;
}

function fakeAuthPlaneDb(ids: string[], counter: { selects: number }): Database {
  return {
    select: () => {
      counter.selects += 1;
      return {
        from: () => ({
          where: Object.assign(async () => ids.map((id) => ({ id, status: 'active' })), {
            limit: async () => ids.map((id) => ({ id, status: 'active' })),
          }),
        }),
      };
    },
  } as unknown as Database;
}

function makeDb(observed: Observed[], rows: unknown[], counters: { transactions: number }): Database {
  const db = {
    select: () => {
      observed.push({ op: 'select', scope: scope() });
      return chain(rows);
    },
    update: () => {
      observed.push({ op: 'update', scope: scope() });
      return chain([]);
    },
    insert: () => {
      observed.push({ op: 'insert', scope: scope() });
      return chain([]);
    },
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      counters.transactions += 1;
      return cb(db);
    },
    execute: async () => [],
  };
  return db as unknown as Database;
}

function jobRow(id: string, tenantId: string | null) {
  return { id, tenantId, status: 'running', instanceId: 'inst-1', jobType: 'time_based_batch' };
}

/**
 * Build the service and replace `executeJob` with a recorder. That method is the
 * already-converted executor; what this file probes is the RESUME path that
 * feeds it — which tenant each resumed job is dispatched with.
 */
function makeService(rows: unknown[], observed: Observed[], counters: { transactions: number }) {
  const executed: Array<{ jobId: string; tenantId: string | null }> = [];
  const db = makeDb(observed, rows, counters);
  const service = new BatchJobService(db, null);
  (service as unknown as { executeJob: (id: string, t: string | null) => Promise<void> }).executeJob = async (
    jobId,
    tenantId,
  ) => {
    executed.push({ jobId, tenantId });
  };
  return { service, executed };
}

describe('batch-jobs resumeJobs — legacy world is byte-identical', () => {
  test('no auth plane wired: one ambient scan, no enumeration, no transaction', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service, executed } = makeService([jobRow('job-1', null)], observed, counters);

    await service.resumeJobs();

    expect(observed.filter((o) => o.op === 'select').length).toBe(1);
    expect(observed.every((o) => o.scope === null)).toBe(true);
    expect(counters.transactions).toBe(0);
    expect(executed).toEqual([{ jobId: 'job-1', tenantId: null }]);
  });

  test('auth plane wired but flag OFF: still one ambient pass and NO auth-plane query', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const authCounter = { selects: 0 };
    const { service } = makeService([jobRow('job-1', null)], observed, counters);
    service.setAuthPlane(fakeAuthPlaneDb([TENANT_A], authCounter));
    service.setResumeEnv(FLAG_OFF);

    await service.resumeJobs();

    expect(observed.filter((o) => o.op === 'select').length).toBe(1);
    expect(authCounter.selects).toBe(0);
    expect(observed.every((o) => o.scope === null)).toBe(true);
  });
});

describe('batch-jobs resumeJobs — tenant world', () => {
  test('the running-job scan is ENUMERATED per tenant and runs inside that tenant scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const authCounter = { selects: 0 };
    const { service } = makeService([], observed, counters);
    service.setAuthPlane(fakeAuthPlaneDb([TENANT_A, TENANT_B], authCounter));
    service.setResumeEnv(FLAG_ON);

    await service.resumeJobs();

    expect(authCounter.selects).toBe(1);
    const selects = observed.filter((o) => o.op === 'select').map((o) => o.scope);
    expect(selects).toEqual([TENANT_A, TENANT_B, null]);
  });

  test('the resumed executor is handed the ROW’s own tenant, outside the read scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service, executed } = makeService([jobRow('job-a', TENANT_A)], observed, counters);
    service.setAuthPlane(fakeAuthPlaneDb([TENANT_A], { selects: 0 }));
    service.setResumeEnv(FLAG_ON);

    await service.resumeJobs();

    expect(executed).toEqual([{ jobId: 'job-a', tenantId: TENANT_A }]);
  });

  test('a job owned by tenant B is not resumed in tenant A’s pass', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service, executed } = makeService([jobRow('job-b', TENANT_B)], observed, counters);
    service.setAuthPlane(fakeAuthPlaneDb([TENANT_A], { selects: 0 }));
    // Enforced, so the transitional NULL-tenant pass is skipped too. `'on'` is
    // the ONLY value `resolveEnforcementMode` accepts (tenancy-startup.ts:
    // deliberately not truthy-ish) — spelling it 'enforced' would resolve to the
    // legacy mode and this test would pass for the wrong reason.
    service.setResumeEnv({ ...FLAG_ON, OMNI_DB_ENFORCEMENT: 'on' });

    await service.resumeJobs();

    expect(executed).toEqual([]);
    // The NULL-tenant pass really was skipped: only tenant A's scoped read ran.
    expect(observed.filter((o) => o.op === 'select').map((o) => o.scope)).toEqual([TENANT_A]);
  });
});
