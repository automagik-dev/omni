/**
 * #1064: cost/usage lands on the journal row of the event that woke the
 * agent, in `metadata.agentUsage`, alongside `agent_latency_ms` — so
 * cost-per-event is a plain aggregation over omni_events.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { type Database, createDbHandle } from '@omni/db';
import { instances, omniEvents, triggerLogs } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { recordAutomationTriggerLog, stampAgentUsage } from '../services/agent-usage';
import { EventService } from '../services/events';

const USAGE = { providerId: 'prov-1', runId: 'run-1', costUsd: 0.25, tokensIn: 10, tokensOut: 20, model: 'm' };

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('stampAgentUsage', () => {
  let db: Database;
  const dbName = `omni_l1_${crypto.randomUUID().replaceAll('-', '')}`;
  let close: (() => Promise<void>) | undefined;
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

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName), maxConnections: 4 });
    close = handle.close;
    db = handle.db;
  });

  async function cleanupRows() {
    if (!db) return;
    await db.delete(omniEvents).where(sql`${omniEvents.externalId} LIKE 'ext-usage-%'`);
  }

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await cleanupRows();
    } catch (error) {
      errors.push(error);
    }
    try {
      await close?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      const result = Bun.spawnSync({
        cmd: [
          psqlBin,
          '-X',
          '--no-psqlrc',
          '--set',
          'ON_ERROR_STOP=1',
          '--dbname',
          pgRoleUrl(superUrl, 'postgres'),
          '-c',
          `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (result.exitCode !== 0) errors.push(new Error(`Failed to drop legacy test database: ${result.stderr}`));
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Legacy database teardown failed');
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
    // #1183: broken down by event type
    expect(analytics.costByEventType['message.received']).toBeGreaterThanOrEqual(0.25);
  });

  it('writes a trigger_logs row with tokens and cost (#1183)', async () => {
    const [inst] = await db
      .insert(instances)
      .values({ name: `test-usage-${Date.now()}`, channel: 'whatsapp-baileys' as const })
      .returning();
    if (!inst) throw new Error('no instance');
    try {
      await recordAutomationTriggerLog(db, {
        instanceId: inst.id,
        eventId: 'evt-x',
        eventType: 'message.received',
        chatId: 'chat-usage',
        durationMs: 6212,
        usage: USAGE,
      });
      const [log] = await db.select().from(triggerLogs).where(eq(triggerLogs.instanceId, inst.id));
      expect(log).toMatchObject({ inputTokens: 10, outputTokens: 20, triggerType: 'automation', durationMs: 6212 });
      expect(Number(log?.costUsd)).toBeCloseTo(0.25, 6);
    } finally {
      await db.delete(instances).where(eq(instances.id, inst.id));
    }
  });
});
