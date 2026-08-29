/**
 * Scheduled-message DELIVERY safety (integration, real Postgres).
 *
 * Two verified delivery bugs are proven here against a real database because
 * neither is expressible against the in-memory Drizzle stand-in used by the
 * unit tests:
 *
 *   #1 double-send — the sweep transaction wrapped ONLY the `SELECT … FOR
 *      UPDATE SKIP LOCKED` and committed (releasing the row locks) before the
 *      delivery loop, while the row stayed `status='pending'` until the
 *      post-send UPDATE. Two overlapping sweeps (prod runs replicaCount:2 with
 *      no leader election) therefore both select the same due row and both
 *      send it. Proving this needs genuine row locks + transaction isolation.
 *
 *   #2 tenant rows never fire — the scheduler built the sweeper without
 *      wiring `setAuthPlane`, so under multitenancy `authPlaneDb` was undefined
 *      and every tenant-scoped sweep was skipped. Proving this needs the real
 *      `tenants`/`instances` enumeration path.
 *
 * Skipped cleanly when ENABLE_DB_TESTS is unset (see db-helper).
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { ChannelPlugin, ChannelRegistry } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { instances, scheduledMessages, tenants } from '@omni/db';
import { eq } from 'drizzle-orm';
import { createScheduledMessageSweeper } from '../scheduler';
import type { Services } from '../services';
import { ScheduledMessageService } from '../services/scheduled-messages';
import { MULTITENANCY_FLAG_ENV } from '../tenancy/feature-flag';
import { describeWithDb, getTestDb } from './db-helper';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop } as never;
const TEXT = { type: 'text', text: 'oi' };
const IN_THE_PAST = () => new Date(Date.now() - 60_000);

/** A plugin whose sendMessage is fully controllable, counting every call. */
function countingPlugin(onSend?: (n: number) => Promise<void>): { plugin: ChannelPlugin; count: () => number } {
  let sends = 0;
  const plugin = {
    id: 'wa',
    capabilities: {},
    sendMessage: async () => {
      const n = ++sends;
      if (onSend) await onSend(n);
      return { success: true, messageId: `m-${n}` };
    },
  } as unknown as ChannelPlugin;
  return { plugin, count: () => sends };
}

describeWithDb('scheduled-message delivery safety (integration)', () => {
  let db: Database;
  const createdInstanceIds: string[] = [];

  beforeAll(() => {
    db = getTestDb();
  });

  afterAll(async () => {
    // Scheduled rows cascade from their instance. Tenants are intentionally
    // left behind: a DB trigger forbids tenant hard-deletes, and a leftover
    // active tenant with no due rows is harmless to future sweeps.
    for (const id of createdInstanceIds) {
      await db.delete(instances).where(eq(instances.id, id));
    }
  });

  async function seedInstance(tenantId?: string): Promise<string> {
    const [inst] = await db
      .insert(instances)
      .values({ name: `sched-del-${crypto.randomUUID()}`, channel: 'whatsapp-baileys' as const, tenantId })
      .returning();
    if (!inst) throw new Error('failed to seed instance');
    createdInstanceIds.push(inst.id);
    return inst.id;
  }

  async function seedDueRow(instanceId: string, chatExternalId: string): Promise<string> {
    const [row] = await db
      .insert(scheduledMessages)
      .values({
        instanceId,
        chatExternalId,
        isThreadBroadcast: false,
        content: TEXT,
        sendAt: IN_THE_PAST(),
        deliveryMode: 'local' as const,
        status: 'pending' as const,
      })
      .returning();
    if (!row) throw new Error('failed to seed scheduled row');
    return row.id;
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const [row] = await db
      .select({ status: scheduledMessages.status })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, id));
    return row?.status;
  }

  test('#1 two concurrent sweeps send the same due row exactly once', async () => {
    const instanceId = await seedInstance();
    const rowId = await seedDueRow(instanceId, `C-${crypto.randomUUID()}`);

    // The FIRST delivery parks inside sendMessage until we release it, so the
    // second sweep runs entirely while the first sweep is mid-delivery — the
    // exact window that reproduces the cross-process double-send.
    let firstEntered!: () => void;
    const firstSendStarted = new Promise<void>((r) => {
      firstEntered = r;
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const { plugin, count } = countingPlugin(async (n) => {
      if (n === 1) {
        firstEntered();
        await firstGate;
      }
    });

    const svc = new ScheduledMessageService(db, async () => plugin, noopLogger);

    const sweepA = svc.sweep(); // selects/claims the row, then blocks in send #1
    await firstSendStarted; // A's select transaction has committed; A is mid-send
    const statsB = await svc.sweep(); // a second scheduler process sweeps concurrently
    releaseFirst();
    const statsA = await sweepA;

    // The core guarantee: the message goes out to the channel exactly once.
    expect(count()).toBe(1);
    // The second sweep must have claimed nothing.
    expect(statsB.sent).toBe(0);
    expect(statsA.sent).toBe(1);
    expect(await statusOf(rowId)).toBe('sent');
  });

  test('#2 a tenant-scoped due row IS delivered by the sweeper (auth-plane wired)', async () => {
    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    try {
      const [tenant] = await db
        .insert(tenants)
        .values({
          slug: `sched-t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          displayName: 'Sched Delivery Tenant',
          maxKeyTtlSeconds: 3600,
          maxKeyRateLimit: 10,
          maxKeyBudget: 100,
        })
        .returning();
      if (!tenant) throw new Error('failed to seed tenant');

      const instanceId = await seedInstance(tenant.id);
      const rowId = await seedDueRow(instanceId, `C-${crypto.randomUUID()}`);

      const { plugin, count } = countingPlugin();
      const registry = { get: () => plugin } as unknown as ChannelRegistry;
      const services = { db, authPlane: { db } } as unknown as Services;

      // Built exactly as scheduler.ts builds it in production.
      const sweeper = createScheduledMessageSweeper(services, registry);
      await sweeper.sweep();

      expect(await statusOf(rowId)).toBe('sent');
      expect(count()).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env[MULTITENANCY_FLAG_ENV];
    }
  });
});
