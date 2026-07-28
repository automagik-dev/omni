/**
 * The post-sync media backfill THREADS the job's tenant (G5; ADR-0008).
 *
 * `services/batch-jobs.ts` was ratcheted to `tenant-boundary` on a justification
 * naming two trusted-tenant sources for `create`: `currentTenantScope()` for a
 * request caller, and "threaded trustedTenantId for the sync-worker's post-sync
 * backfill". The second half described code that did not exist —
 * `processMessageSync` held `jobTenantId`, threaded it to `updateProgress` and
 * `complete`, and then called `queueMediaBackfillAfterSync` without it.
 *
 * That call site is OUTSIDE every scope: `inSyncWorkerScope` wraps only the
 * per-item closures, which have closed by then, and the handler is a NATS
 * consumer with no ambient scope of its own. So `create` saw
 * `trustedTenantId === undefined` AND `currentTenantScope() === null` and
 * enqueued a NULL-tenant row, whose detached executor then read `messages` and
 * wrote `media_content` for that tenant's instance entirely unscoped — and
 * `isTenantWorkAdmissible(authPlane, null)` returns true, so the dequeue-time
 * revocation gate was skipped as well.
 *
 * This probe drives the REAL `sync.started` handler, because the threading is a
 * property of the call site: a probe that invoked the helper directly would stay
 * green if the argument were dropped again.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { setupSyncWorker } from '../sync-worker';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

function fakeDb(): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({ execute: async () => [] as unknown }),
  } as unknown as Database;
}

/** Auth plane for the in-flight revocation gate: the tenant is active. */
function fakeAuthPlaneDb(): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ status: 'active' }] }),
      }),
    }),
  } as unknown as Database;
}

interface CreateCall {
  instanceId: string;
  trustedTenantId: string | null | undefined;
  /** The scope observed AT the call — the backfill enqueues outside every scope. */
  scope: string | null;
}

function harness() {
  let handler: ((event: unknown) => Promise<void>) | null = null;
  const creates: CreateCall[] = [];

  const bus = {
    subscribe: mock(async (eventType: string, cb: (event: unknown) => Promise<void>) => {
      if (eventType === 'sync.started') handler = cb;
      return { unsubscribe: mock(async () => {}) };
    }),
    subscribePattern: mock(async () => ({ unsubscribe: mock(async () => {}) })),
    publish: mock(async () => ({ id: 'evt-1' })),
  } as unknown as EventBus;

  const services = {
    authPlane: { db: fakeAuthPlaneDb() },
    syncJobs: {
      start: mock(async () => {}),
      complete: mock(async () => {}),
      fail: mock(async () => {}),
      updateProgress: mock(async () => {}),
    },
    instances: {
      getById: mock(async () => ({ id: 'inst-1', channel: 'telegram' })),
    },
    chats: {
      findOrCreate: mock(async () => ({ chat: { id: 'chat-1' } })),
    },
    messages: {
      getByExternalId: mock(async () => null),
      create: mock(async () => ({ id: 'msg-1' })),
    },
    batchJobs: {
      create: mock(async (options: { instanceId: string }, trustedTenantId?: string | null) => {
        creates.push({
          instanceId: options.instanceId,
          trustedTenantId,
          scope: currentTenantScope()?.tenantId ?? null,
        });
        return { id: 'batch-1' };
      }),
    },
  } as never;

  // A telegram plugin whose history fetch yields exactly one storable message,
  // so `stored > 0` and the backfill guard is satisfied.
  const registry = {
    get: mock(() => ({
      fetchHistory: async (
        _instanceId: string,
        options: { onMessage: (msg: Record<string, unknown>) => Promise<void> },
      ) => {
        await options.onMessage({
          chatId: 'chat-ext-1',
          externalId: 'msg-ext-1',
          content: { type: 'text', text: 'hello' },
          timestamp: new Date(),
          from: 'sender-1',
          isFromMe: false,
          rawPayload: {},
        });
      },
    })),
  } as never;

  const fire = async (metadata: Record<string, unknown>) => {
    if (!handler) throw new Error('sync.started handler not registered');
    await handler({
      payload: {
        jobId: 'job-1',
        instanceId: 'inst-1',
        type: 'messages',
        config: { backfillMedia: true, depth: '7d' },
      },
      metadata: { correlationId: 'corr-1', instanceId: 'inst-1', ...metadata },
    });
  };

  return { bus, services, registry, creates, fire };
}

describe('sync-worker post-sync media backfill (G5, ADR-0008)', () => {
  test('tenant envelope: the backfill batch job is enqueued with the JOB’s tenant', async () => {
    const h = harness();
    await setupSyncWorker(h.bus, h.services, h.registry, fakeDb());

    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A });

    expect(h.creates.length).toBe(1);
    expect(h.creates[0]?.trustedTenantId).toBe(TENANT_A);
    // …and it is genuinely THREADED, not inherited: the enqueue happens outside
    // every scope (the per-item scopes closed before this ran), so the value has
    // to travel as an argument or it is lost.
    expect(h.creates[0]?.scope).toBeNull();
  });

  test('legacy envelope: nothing is threaded and the enqueue is byte-identical', async () => {
    const h = harness();
    await setupSyncWorker(h.bus, h.services, h.registry, fakeDb());

    await h.fire({});

    expect(h.creates.length).toBe(1);
    // A legacy job has no tenant to stamp; `null` forces the pre-G5 ambient job
    // exactly as the unthreaded call produced before.
    expect(h.creates[0]?.trustedTenantId ?? null).toBeNull();
    expect(h.creates[0]?.scope).toBeNull();
  });
});
