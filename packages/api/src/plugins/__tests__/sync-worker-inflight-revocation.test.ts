/**
 * Sync-worker in-flight revocation gate (wish: omni-full-multitenancy, Group
 * G5, deliverable (c); RELEASE_SLOS
 * `revocation.inflight_privileged_work_revocation_seconds_max: 30`).
 *
 * A message sync is the repository's longest-running consumer work item — a
 * multi-thousand-message backfill can outlive any dequeue-time check by
 * minutes. The `createInflightRevocationMonitor` gate gives its loop the
 * bounded observation the ceiling requires (cadence proven with a synthetic
 * clock in tenancy/__tests__/inflight-revocation.test.ts); THIS suite proves
 * the wiring, in all three tenant-gated processors (messages/contacts/groups):
 *
 *   * a REVOKED tenant's job performs ZERO side effects — the first gate
 *     (which doubles as dequeue-time revalidation) refuses before any store,
 *     and the job is failed, not completed;
 *   * a MID-FLIGHT revocation (tenant flips after items have started flowing)
 *     is observed at the recheck cadence: once the gate refuses, later
 *     onMessage/onContact/onGroup deliveries from the channel plugin are
 *     dropped without side effects (the sticky-refusal shape), post-flip
 *     progress writes are suppressed, and the job fails, never completes.
 *     The cadence tick is driven with `setSystemTime` — the monitor's default
 *     clock — so no wall-clock waits;
 *   * an UNREACHABLE auth plane refuses fail-closed: a job whose admissibility
 *     read throws stores nothing and fails;
 *   * an ACTIVE tenant's job stores normally;
 *   * a LEGACY job never consults the auth plane at all — byte-identical.
 */

import { afterEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import type { SyncJobType } from '@omni/db';
import { setupSyncWorker } from '../sync-worker';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

/** One tick past the monitor's recheck cadence (half the 30s ceiling). */
const PAST_RECHECK_MS = 16_000;

afterEach(() => {
  setSystemTime(); // restore the real clock after mid-flight cadence tests
});

function fakeDb(storedGroups: string[]): Database {
  // The worker-scope transaction handle needs just enough drizzle surface for
  // `upsertSyncedGroup` (select→from→where→limit, insert→values) plus the
  // `set_config` execute; everything else in these tests goes through service
  // mocks. Ambient-pool reads (the legacy world's anchor discovery) resolve to
  // empty result sets.
  const tx = {
    execute: async () => [] as unknown,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [] as unknown[],
        }),
      }),
    }),
    insert: () => ({
      values: async (row: { externalId: string }) => {
        storedGroups.push(row.externalId);
      },
    }),
  };
  return {
    execute: async () => [] as unknown,
    transaction: async <T>(cb: (t: unknown) => Promise<T>): Promise<T> => cb(tx),
  } as unknown as Database;
}

function harness(tenantStatus: 'active' | 'suspended') {
  let handler: ((event: unknown) => Promise<void>) | null = null;
  const authPlaneReads = { count: 0 };
  const progressUpdates = { count: 0 };
  const storedMessages: string[] = [];
  const storedContacts: string[] = [];
  const storedGroups: string[] = [];
  const jobOutcomes: string[] = [];

  // Mutable auth-plane state: mid-flight tests flip `status` between item
  // deliveries; `readError` makes every admissibility read throw (the
  // auth-plane-unreachable shape).
  const tenantState: { status: 'active' | 'suspended'; readError: Error | null } = {
    status: tenantStatus,
    readError: null,
  };

  // Per-processor feeds. `afterFirstItem` runs after the FIRST delivery of the
  // fired feed — the mid-flight flip point. `progressAfterFeed` has the plugin
  // report progress after the last delivery (post-flip in mid-flight tests).
  const feed = {
    messages: ['m-1', 'm-2'],
    contacts: ['c-1', 'c-2'],
    groups: ['g-1', 'g-2'],
    afterFirstItem: null as (() => void) | null,
    progressAfterFeed: false,
  };

  const bus = {
    subscribe: mock(async (eventType: string, cb: (event: unknown) => Promise<void>) => {
      if (eventType === 'sync.started') handler = cb;
      return { unsubscribe: mock(async () => {}) };
    }),
    subscribePattern: mock(async () => ({ unsubscribe: mock(async () => {}) })),
    publish: mock(async () => ({ id: 'evt-1' })),
  } as unknown as EventBus;

  const authPlaneDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            authPlaneReads.count++;
            if (tenantState.readError) throw tenantState.readError;
            return [{ status: tenantState.status }];
          },
        }),
      }),
    }),
  } as unknown as Database;

  const services = {
    authPlane: { db: authPlaneDb },
    syncJobs: {
      start: mock(async () => {}),
      complete: mock(async () => {
        jobOutcomes.push('complete');
      }),
      fail: mock(async (_id: string, error: string) => {
        jobOutcomes.push(`fail:${error}`);
      }),
      updateProgress: mock(async () => {
        progressUpdates.count++;
      }),
    },
    instances: {
      getById: mock(async () => ({ id: 'inst-1', channel: 'whatsapp-baileys' })),
    },
    chats: {
      findOrCreate: mock(async () => ({ chat: { id: 'chat-1' }, created: false })),
      getAllExternalIds: mock(async () => []),
      findByExternalIdSmart: mock(async () => null),
      update: mock(async () => ({})),
    },
    messages: {
      getByExternalId: mock(async () => null),
      create: mock(async (data: { externalId: string }) => {
        storedMessages.push(data.externalId);
        return {};
      }),
    },
    persons: {
      findOrCreateIdentity: mock(async (identity: { platformUserId: string }) => {
        storedContacts.push(identity.platformUserId);
        return { isNew: true, wasLinked: false };
      }),
    },
  } as never;

  // A plugin that keeps feeding items regardless of gate state — the worker,
  // not the channel, owns the revocation boundary.
  const registry = {
    get: mock(() => ({
      fetchHistory: async (
        _instanceId: string,
        opts: { onMessage: (m: unknown) => Promise<void>; onProgress?: (count: number) => Promise<void> },
      ) => {
        for (const [index, externalId] of feed.messages.entries()) {
          await opts.onMessage({
            externalId,
            chatId: 'chat-ext-1',
            from: 'user-1',
            isFromMe: false,
            timestamp: new Date(),
            content: { type: 'text', text: externalId },
            rawPayload: {},
          });
          if (index === 0) feed.afterFirstItem?.();
        }
        if (feed.progressAfterFeed) await opts.onProgress?.(feed.messages.length);
      },
      fetchContacts: async (_instanceId: string, opts: { onContact: (c: unknown) => Promise<void> }) => {
        for (const [index, platformUserId] of feed.contacts.entries()) {
          await opts.onContact({
            platformUserId,
            name: `name-${platformUserId}`,
            isGroup: false,
          });
          if (index === 0) feed.afterFirstItem?.();
        }
      },
      fetchGroups: async (_instanceId: string, opts: { onGroup: (g: unknown) => Promise<void> }) => {
        for (const [index, externalId] of feed.groups.entries()) {
          await opts.onGroup({ externalId, name: `name-${externalId}` });
          if (index === 0) feed.afterFirstItem?.();
        }
      },
    })),
  } as never;

  const fire = async (metadata: Record<string, unknown>, type: SyncJobType = 'messages') => {
    if (!handler) throw new Error('sync.started handler not registered');
    await handler({
      payload: { jobId: 'job-1', instanceId: 'inst-1', type, config: {} },
      metadata: { correlationId: 'corr-1', instanceId: 'inst-1', ...metadata },
    });
  };

  return {
    bus,
    services,
    registry,
    authPlaneReads,
    progressUpdates,
    storedMessages,
    storedContacts,
    storedGroups,
    jobOutcomes,
    tenantState,
    feed,
    fire,
    db: fakeDb(storedGroups),
  };
}

/** The mid-flight flip: the tenant is revoked and the recheck cadence elapses. */
function revokeMidFlight(h: ReturnType<typeof harness>): void {
  h.tenantState.status = 'suspended';
  setSystemTime(new Date(Date.now() + PAST_RECHECK_MS));
}

describe('sync-worker in-flight revocation gate (G5, RELEASE_SLOS inflight ceiling)', () => {
  test('a revoked tenant’s job stores NOTHING and is failed, not completed', async () => {
    const h = harness('suspended');
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A });

    expect(h.storedMessages).toEqual([]);
    expect(h.authPlaneReads.count).toBeGreaterThan(0);
    expect(h.jobOutcomes.length).toBe(1);
    expect(h.jobOutcomes[0]).toMatch(/^fail:.*no longer admissible/);
  });

  test('a mid-flight revocation stops the message stream: later deliveries drop sticky, progress is suppressed, the job fails', async () => {
    const h = harness('active');
    h.feed.messages = ['m-1', 'm-2', 'm-3'];
    h.feed.afterFirstItem = () => revokeMidFlight(h);
    h.feed.progressAfterFeed = true; // the plugin reports progress AFTER the flip
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A });

    // m-1 landed before the flip; m-2 observes the revocation at the cadence
    // tick; m-3 is dropped by the sticky guard without a fresh auth-plane read.
    expect(h.storedMessages).toEqual(['m-1']);
    expect(h.authPlaneReads.count).toBe(2); // dequeue gate + the m-2 recheck
    // The post-flip onProgress and the final progress write are both
    // suppressed — no durable side effects after the flip.
    expect(h.progressUpdates.count).toBe(0);
    expect(h.jobOutcomes.length).toBe(1);
    expect(h.jobOutcomes[0]).toMatch(/^fail:.*no longer admissible/);
  });

  test('an unreachable auth plane refuses fail-closed: the job stores nothing and fails', async () => {
    const h = harness('active');
    h.tenantState.readError = new Error('auth plane unreachable');
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A });

    expect(h.storedMessages).toEqual([]);
    expect(h.authPlaneReads.count).toBeGreaterThan(0);
    expect(h.jobOutcomes.length).toBe(1);
    expect(h.jobOutcomes[0]).toMatch(/^fail:.*no longer admissible/);
  });

  test('contacts: a revoked tenant’s job ingests NOTHING and is failed, not completed', async () => {
    const h = harness('suspended');
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A }, 'contacts');

    expect(h.storedContacts).toEqual([]);
    expect(h.authPlaneReads.count).toBeGreaterThan(0);
    expect(h.jobOutcomes.length).toBe(1);
    expect(h.jobOutcomes[0]).toMatch(/^fail:.*no longer admissible/);
  });

  test('contacts: a mid-flight revocation drops later deliveries and fails the job', async () => {
    const h = harness('active');
    h.feed.contacts = ['c-1', 'c-2', 'c-3'];
    h.feed.afterFirstItem = () => revokeMidFlight(h);
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A }, 'contacts');

    expect(h.storedContacts).toEqual(['c-1']);
    expect(h.authPlaneReads.count).toBe(2); // dequeue gate + the c-2 recheck
    expect(h.jobOutcomes.length).toBe(1);
    expect(h.jobOutcomes[0]).toMatch(/^fail:.*no longer admissible/);
  });

  test('groups: a revoked tenant’s job upserts NOTHING and is failed, not completed', async () => {
    const h = harness('suspended');
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A }, 'groups');

    expect(h.storedGroups).toEqual([]);
    expect(h.authPlaneReads.count).toBeGreaterThan(0);
    expect(h.jobOutcomes.length).toBe(1);
    expect(h.jobOutcomes[0]).toMatch(/^fail:.*no longer admissible/);
  });

  test('groups: a mid-flight revocation drops later deliveries and fails the job', async () => {
    const h = harness('active');
    h.feed.groups = ['g-1', 'g-2', 'g-3'];
    h.feed.afterFirstItem = () => revokeMidFlight(h);
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A }, 'groups');

    expect(h.storedGroups).toEqual(['g-1']);
    expect(h.authPlaneReads.count).toBe(2); // dequeue gate + the g-2 recheck
    expect(h.jobOutcomes.length).toBe(1);
    expect(h.jobOutcomes[0]).toMatch(/^fail:.*no longer admissible/);
  });

  test('an active tenant’s job stores normally through the gate', async () => {
    const h = harness('active');
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({ envelopeVersion: 1, tenantId: TENANT_A });

    expect(h.storedMessages).toEqual(['m-1', 'm-2']);
    expect(h.jobOutcomes).toEqual(['complete']);
  });

  test('a legacy job never consults the auth plane — byte-identical', async () => {
    const h = harness('suspended'); // would refuse if ever consulted
    await setupSyncWorker(h.bus, h.services, h.registry, h.db);
    await h.fire({});

    expect(h.authPlaneReads.count).toBe(0);
    expect(h.storedMessages).toEqual(['m-1', 'm-2']);
    expect(h.jobOutcomes).toEqual(['complete']);
  });
});
