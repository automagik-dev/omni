/**
 * Sync-worker `instances` read scope (wish: omni-full-multitenancy, Group G5;
 * ADR-0008).
 *
 * The `sync.started` handler classifies its envelope up front and scopes the
 * per-item work (`inSyncWorkerScope`) — but the instance lookup that decides
 * the channel type ran BARE between `syncJobs.start` and the per-item loop, so
 * a tenant-world job still read `instances` on the ambient pool. That kept
 * `services/instances.ts::instances` held by this caller (a site is only as
 * scoped as its least-scoped caller — the run12 lesson).
 *
 * Probes: a tenant-stamped `sync.started` envelope runs the instance read
 * inside a worker scope for the envelope tenant; a legacy envelope leaves it
 * unscoped, byte-identical.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { setupSyncWorker } from '../sync-worker';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

function fakeDb(): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({
        execute: async () => [] as unknown,
      }),
  } as unknown as Database;
}

function harness() {
  let handler: ((event: unknown) => Promise<void>) | null = null;
  const instanceScopes: (string | null)[] = [];

  const bus = {
    subscribe: mock(async (eventType: string, cb: (event: unknown) => Promise<void>) => {
      if (eventType === 'sync.started') handler = cb;
      return { unsubscribe: mock(async () => {}) };
    }),
    subscribePattern: mock(async () => ({ unsubscribe: mock(async () => {}) })),
    publish: mock(async () => ({ id: 'evt-1' })),
  } as unknown as EventBus;

  const services = {
    syncJobs: {
      start: mock(async () => {}),
      complete: mock(async () => {}),
      fail: mock(async () => {}),
    },
    instances: {
      getById: mock(async () => {
        instanceScopes.push(currentTenantScope()?.tenantId ?? null);
        return { id: 'inst-1', channel: 'whatsapp-baileys' };
      }),
    },
  } as never;

  const registry = { get: mock(() => undefined) } as never;

  const fire = async (metadata: Record<string, unknown>) => {
    if (!handler) throw new Error('sync.started handler not registered');
    // An unknown job type: the handler reads the instance, then fails the job —
    // the cheapest deterministic path through the read under test.
    await handler({
      payload: { jobId: 'job-1', instanceId: 'inst-1', type: 'unknown-probe-type', config: {} },
      metadata: { correlationId: 'corr-1', instanceId: 'inst-1', ...metadata },
    });
  };

  return { bus, services, registry, instanceScopes, fire };
}

describe('sync-worker scopes its instance read (G5, ADR-0008)', () => {
  test('tenant envelope: the instance read runs inside the worker tenant scope', async () => {
    const h = harness();
    await setupSyncWorker(h.bus, h.services, h.registry, fakeDb());
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A });
    expect(h.instanceScopes).toEqual([TENANT_A]);
  });

  test('legacy envelope: the instance read stays unscoped — byte-identical', async () => {
    const h = harness();
    await setupSyncWorker(h.bus, h.services, h.registry, fakeDb());
    await h.fire({});
    expect(h.instanceScopes).toEqual([null]);
  });
});
