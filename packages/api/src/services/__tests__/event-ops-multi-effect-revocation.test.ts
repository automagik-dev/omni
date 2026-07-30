/**
 * Multi-effect work revalidates the revocation state between side effects,
 * proven with a SYNTHETIC epoch (wish: omni-full-multitenancy, Group G5,
 * deliverable (c); ADR-0006; RELEASE_SLOS
 * `revocation.multi_effect_work_check: current_revocation_epoch_between_every_side_effect`
 * and `queued_retry_delayed_dlq_check`).
 *
 * The event-replay executor is the repository's canonical multi-effect work
 * item: one replay session republishes MANY events (durable side effects on
 * the bus), batch after batch. The contract proven here — pinning the
 * behavior the leg-E conversion introduced, so no later edit can quietly drop
 * it:
 *
 *   1. DEQUEUE-TIME: a replay whose tenant is already inadmissible when the
 *      detached executor starts performs ZERO side effects;
 *   2. BETWEEN-EFFECT: a tenant suspended after the first batch's publishes
 *      is observed at the next batch boundary — the remaining batches never
 *      publish, and the session fails rather than completes;
 *   3. LEGACY: a null-tenant replay never consults the auth plane and
 *      publishes as before — byte-identical.
 *
 * The "epoch" is the tenant's `status` row on the auth plane
 * (`isTenantWorkAdmissible` — the same trusted, non-caller-controlled read
 * every revocation-sensitive executor uses), injected as a scripted sequence
 * of answers: the flip is a STEP in the test, never a wall-clock wait.
 */

import { describe, expect, test } from 'bun:test';
import type { ReplayOptions } from '@omni/core';
import type { Database } from '@omni/db';
import type { DeadLetterService } from '../dead-letters';
import { EventOpsService } from '../event-ops';
import type { PayloadStoreService } from '../payload-store';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

/** One synthetic stored event per publish the batch would perform. */
function batchEvent(id: string): Record<string, unknown> {
  return {
    id,
    eventType: 'message.received',
    instanceId: 'inst-1',
    channel: 'whatsapp-baileys',
    textContent: `event ${id}`,
    status: 'pending',
    receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

/**
 * A pool serving the two SELECT shapes the replay walks: the count query
 * (awaited straight off `where()`) and the batch query
 * (`orderBy().limit().offset()`), yielding the scripted batches in order.
 */
function fakePool(batches: Record<string, unknown>[][]): Database {
  let nextBatch = 0;
  const where = () => {
    const chain = {
      orderBy: () => ({
        limit: () => ({
          offset: async () => batches[nextBatch++] ?? [],
        }),
      }),
      // biome-ignore lint/suspicious/noThenProperty: the count query awaits the drizzle chain directly; the fake must be thenable
      then: (resolve: (rows: unknown[]) => void) => {
        resolve([{ count: batches.flat().length }]);
      },
    };
    return chain;
  };
  const select = () => ({ from: () => ({ where }) });
  const tx = { execute: async () => [], select };
  return {
    select,
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
}

/** An auth plane answering the scripted admissibility sequence, then its last value. */
function fakeAuthPlane(statuses: ('active' | 'suspended')[]): { db: Database; reads: { count: number } } {
  const reads = { count: 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const status = statuses[Math.min(reads.count, statuses.length - 1)];
            reads.count++;
            return [{ status }];
          },
        }),
      }),
    }),
  } as unknown as Database;
  return { db, reads };
}

function harness(batches: Record<string, unknown>[][], statuses: ('active' | 'suspended')[]) {
  const published: string[] = [];
  const eventBus = {
    publishGeneric: async (_type: string, payload: Record<string, unknown>) => {
      // Count only the REPLAYED events (the durable side effects under test);
      // the session lifecycle notifications the service also publishes are not
      // per-event side effects.
      if (payload._replay === true) published.push(String(payload._originalEventId));
      return { id: 'pub-1', timestamp: Date.now() };
    },
  } as never;
  const service = new EventOpsService(
    fakePool(batches),
    eventBus,
    {} as unknown as DeadLetterService,
    {} as unknown as PayloadStoreService,
  );
  const authPlane = fakeAuthPlane(statuses);
  service.setAuthPlane(authPlane.db);
  return { service, published, authPlaneReads: authPlane.reads };
}

const OPTIONS: ReplayOptions = { since: new Date('2026-01-01T00:00:00.000Z') };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('event-replay multi-effect revocation (G5, RELEASE_SLOS multi_effect_work_check)', () => {
  test('dequeue-time: an already-inadmissible tenant performs ZERO side effects', async () => {
    const h = harness([[batchEvent('e1'), batchEvent('e2')]], ['suspended']);
    const session = await h.service.startReplay(OPTIONS, TENANT_A);
    await settle();

    expect(h.published).toEqual([]);
    const after = h.service.getReplaySession(session.id);
    expect(after?.status).toBe('failed');
    expect(after?.error ?? '').toContain('admissible');
  });

  test('between effects: a mid-replay suspension halts at the NEXT batch boundary', async () => {
    // Two batches of durable side effects. Admissibility answers, in read
    // order: dequeue-check OK, batch-1 boundary OK, batch-2 boundary REFUSED.
    const h = harness(
      [
        [batchEvent('e1'), batchEvent('e2')],
        [batchEvent('e3'), batchEvent('e4')],
      ],
      ['active', 'active', 'suspended'],
    );
    const session = await h.service.startReplay(OPTIONS, TENANT_A);
    await settle();

    // Batch 1 published; batch 2 never did — the flip was observed BETWEEN the
    // two groups of side effects, exactly the ceiling's shape.
    expect(h.published).toEqual(['e1', 'e2']);
    expect(h.authPlaneReads.count).toBeGreaterThanOrEqual(3);
    const after = h.service.getReplaySession(session.id);
    expect(after?.status).toBe('failed');
    expect(after?.error ?? '').toContain('inadmissible');
  });

  test('legacy: a null-tenant replay never consults the auth plane — byte-identical', async () => {
    const h = harness([[batchEvent('e1'), batchEvent('e2')]], ['suspended']);
    const session = await h.service.startReplay(OPTIONS, null);
    await settle();

    expect(h.authPlaneReads.count).toBe(0);
    expect(h.published).toEqual(['e1', 'e2']);
    const after = h.service.getReplaySession(session.id);
    expect(after?.status).toBe('completed');
  });
});
