/**
 * #1064: cost/usage lands on the journal row of the event that woke the
 * agent, in `metadata.agentUsage`, alongside `agent_latency_ms` — so
 * cost-per-event is a plain aggregation over omni_events.
 */

import { afterAll, beforeAll, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { Database } from '@omni/db';
import { omniEvents } from '@omni/db';
import { eq, sql } from 'drizzle-orm';
import { stampAgentUsage } from '../services/agent-usage';
import { EventService } from '../services/events';
import { describeWithDb, getTestDb } from './db-helper';

const USAGE = { providerId: 'prov-1', runId: 'run-1', costUsd: 0.25, tokensIn: 10, tokensOut: 20, model: 'm' };

describeWithDb('stampAgentUsage', () => {
  let db: Database;
  const ids: string[] = [];

  const seed = async (metadata: Record<string, unknown> | null) => {
    const id = randomUUID();
    ids.push(id);
    await db.insert(omniEvents).values({
      id,
      externalId: `ext-usage-${id}`,
      channel: 'whatsapp-baileys',
      eventType: 'message.received',
      direction: 'inbound',
      chatId: 'chat-usage',
      status: 'received',
      receivedAt: new Date(),
      metadata,
    });
    return id;
  };

  const row = async (id: string) => (await db.select().from(omniEvents).where(eq(omniEvents.id, id)))[0];

  beforeAll(() => {
    db = getTestDb();
  });

  afterAll(async () => {
    await db.delete(omniEvents).where(sql`${omniEvents.externalId} LIKE 'ext-usage-%'`);
  });

  it('merges agentUsage into existing metadata and sets agent_latency_ms', async () => {
    const id = await seed({ correlationId: 'corr-1', from: 'someone' });

    await stampAgentUsage(db, id, { usage: USAGE, latencyMs: 1234.6 });

    const r = await row(id);
    expect(r?.metadata).toEqual({ correlationId: 'corr-1', from: 'someone', agentUsage: USAGE });
    expect(r?.agentLatencyMs).toBe(1235);
  });

  it('stamps a row whose metadata is null', async () => {
    const id = await seed(null);
    await stampAgentUsage(db, id, { usage: USAGE });
    expect((await row(id))?.metadata).toEqual({ agentUsage: USAGE });
  });

  it('is a no-op for a missing or malformed event id', async () => {
    await expect(stampAgentUsage(db, undefined, { usage: USAGE })).resolves.toBeUndefined();
    await expect(stampAgentUsage(db, 'not-a-uuid', { usage: USAGE })).resolves.toBeUndefined();
    await expect(stampAgentUsage(db, randomUUID(), { usage: USAGE })).resolves.toBeUndefined();
  });

  it('makes cost-per-event an analytics query', async () => {
    const a = await seed(null);
    const b = await seed(null);
    await stampAgentUsage(db, a, { usage: { ...USAGE, costUsd: 0.1 } });
    await stampAgentUsage(db, b, { usage: { ...USAGE, costUsd: 0.15 } });

    const [agg] = await db
      .select({ total: sql<number>`sum((${omniEvents.metadata}->'agentUsage'->>'costUsd')::numeric)::float` })
      .from(omniEvents)
      .where(sql`${omniEvents.id} in (${a}, ${b})`);
    expect(agg?.total).toBeCloseTo(0.25, 6);

    const analytics = await new EventService(db).getAnalytics({});
    expect(analytics.totalCostUsd).toBeGreaterThanOrEqual(0.25);
  });
});
