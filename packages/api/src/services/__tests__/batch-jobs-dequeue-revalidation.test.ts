/**
 * Batch-job dequeue-time tenant revalidation (wish: omni-full-multitenancy,
 * Group G5; ADR-0008, ADR-0006; RELEASE_SLOS "queued_retry_delayed_dlq_check").
 *
 * A batch job is created (or resumed) with a trusted tenant, then sits until a
 * detached executor runs it — possibly across a process restart. Between
 * derivation and dequeue the tenant may be suspended/archived. The executor
 * MUST revalidate the tenant is still admissible BEFORE it begins, and stop the
 * job with no side effect when it is not.
 *
 * Synthetic clock/epoch: the "epoch" here is the auth-plane `tenants.status`
 * transition active→suspended (suspension bumps the revocation epoch — see
 * periodic-tenant-work.ts). We flip the fake auth-plane's answer and assert the
 * executor's behavior changes accordingly. No production timing is claimed.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { BatchJobService } from '../batch-jobs';

const TENANT_A = '11111111-1111-4111-8111-1111111111ba';

/**
 * A pool whose `update(...).set(...).where(...)` records the status written, and
 * whose `select` (getById) returns a pending job. `transaction` runs the
 * callback (worker scope opens one). Enough surface for `executeJob`'s stop
 * path; the processing path is never reached when the tenant is inadmissible.
 */
function fakePool(writes: Array<{ status?: string; errorMessage?: string }>): Database {
  const job = {
    id: 'job-1',
    instanceId: 'inst-1',
    jobType: 'time_based_batch',
    status: 'pending',
    requestParams: { daysBack: 1 },
    tenantId: TENANT_A,
  };
  const handle = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(handle),
    execute: async () => [],
    update: () => ({
      set: (values: { status?: string; errorMessage?: string }) => ({
        where: async () => {
          writes.push({ status: values.status, errorMessage: values.errorMessage });
          return [];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [job] }),
      }),
    }),
  };
  return handle as unknown as Database;
}

/** True when a write is the dequeue fail-stop (its message names admissibility). */
const isDequeueStop = (w: { status?: string; errorMessage?: string }): boolean =>
  w.status === 'failed' && (w.errorMessage ?? '').includes('not admissible');

/** A fake auth-plane whose tenant status is switchable to simulate suspension. */
function fakeAuthPlane(status: { value: 'active' | 'suspended' }): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ status: status.value }] }),
      }),
    }),
  } as unknown as Database;
}

interface ExecutorAccess {
  executeJob(jobId: string, jobTenantId: string | null): Promise<void>;
}

describe('batch-jobs dequeue-time tenant revalidation', () => {
  test('a suspended tenant stops the job at dequeue with NO processing side effect', async () => {
    const writes: Array<{ status?: string; errorMessage?: string }> = [];
    const service = new BatchJobService(fakePool(writes), null);
    service.setAuthPlane(fakeAuthPlane({ value: 'suspended' }));

    await (service as unknown as ExecutorAccess).executeJob('job-1', TENANT_A);

    // Exactly one write: the dequeue fail-stop. No 'running', no processing.
    expect(writes.length).toBe(1);
    expect(writes[0] && isDequeueStop(writes[0])).toBe(true);
  });

  test('a legacy (null-tenant) job is always admissible and never stops at dequeue', async () => {
    const writes: Array<{ status?: string; errorMessage?: string }> = [];
    const service = new BatchJobService(fakePool(writes), null);
    // No auth plane injected: a null-tenant job must not need one. It passes the
    // gate and then fails on the unwired processing path (via handleJobError) —
    // which is NOT the dequeue fail-stop.
    await (service as unknown as ExecutorAccess).executeJob('job-1', null);
    expect(writes.some(isDequeueStop)).toBe(false);
  });

  test('an active tenant is admissible — the dequeue gate does not stop it', async () => {
    const writes: Array<{ status?: string; errorMessage?: string }> = [];
    const service = new BatchJobService(fakePool(writes), null);
    service.setAuthPlane(fakeAuthPlane({ value: 'active' }));
    await (service as unknown as ExecutorAccess).executeJob('job-1', TENANT_A);
    expect(writes.some(isDequeueStop)).toBe(false);
  });
});
