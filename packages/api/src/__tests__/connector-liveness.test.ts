/**
 * Connector liveness integration test (#961) — real PostgreSQL, short windows.
 *
 * Proves the acceptance flow end to end on the actual service + schema:
 *   declare a 1s cadence → go silent → sweep marks the source stalled, emits
 *   `system.connector.stalled` ONCE, files a manual-resolution DLQ entry →
 *   further sweeps stay silent → a heartbeat resets the window → the next
 *   sweep emits `system.connector.recovered` once and auto-resolves the DLQ
 *   entry.
 *
 * Uses the `describeWithDb` harness (follow-up sweeper precedent): skips
 * cleanly unless ENABLE_DB_TESTS=true and the test database is reachable.
 * Migration 0056 is additive + idempotent, so `beforeAll` applies it from the
 * committed file — the suite never depends on the API having booted since the
 * columns landed.
 */

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventBus } from '@omni/core';
import type { Database, WebhookSource } from '@omni/db';
import { deadLetterEvents, webhookSources } from '@omni/db';
import { eq, sql } from 'drizzle-orm';
import { DeadLetterService } from '../services/dead-letters';
import { WebhookService } from '../services/webhooks';
import { describeWithDb, getTestDb } from './db-helper';

const SOURCE_NAME = `liveness-it-${crypto.randomUUID().slice(0, 8)}`;

function createCapturingBus() {
  const published: Array<{ type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> }> = [];
  const bus = {
    publishGeneric: mock(async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      published.push({ type, payload, metadata });
      return { id: `evt-${published.length}`, sequence: published.length, stream: 'SYSTEM' };
    }),
  };
  return { published, bus: bus as unknown as EventBus };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeWithDb('Connector liveness (integration, short windows)', () => {
  let db: Database;
  let service: WebhookService;
  let deadLetters: DeadLetterService;
  let published: ReturnType<typeof createCapturingBus>['published'];
  let source: WebhookSource;

  const oursStalled = () =>
    published.filter((e) => e.type === 'system.connector.stalled' && e.payload.sourceName === SOURCE_NAME);
  const oursRecovered = () =>
    published.filter((e) => e.type === 'system.connector.recovered' && e.payload.sourceName === SOURCE_NAME);
  const ourDlqEntries = async () => {
    const { items } = await deadLetters.list({ eventType: ['system.connector.stalled'], limit: 100 });
    return items.filter(
      (entry) => (entry.payload as { payload?: { sourceId?: unknown } }).payload?.sourceId === source.id,
    );
  };

  beforeAll(async () => {
    db = getTestDb();
    // Additive + idempotent — brings a pre-0056 test database up to date.
    const migration = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'db', 'drizzle', '0056_connector_lifecycle_contract.sql'),
      'utf-8',
    );
    for (const statement of migration
      .split('\n')
      .filter((line) => !line.startsWith('--') && line.trim().length > 0)
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      await db.execute(sql.raw(statement));
    }

    const capturing = createCapturingBus();
    published = capturing.published;
    service = new WebhookService(db, capturing.bus);
    deadLetters = new DeadLetterService(db, null);
  });

  afterAll(async () => {
    if (!db) return;
    await db
      .delete(deadLetterEvents)
      .where(
        sql`${deadLetterEvents.eventType} = 'system.connector.stalled' AND ${deadLetterEvents.payload}->'payload'->>'sourceName' = ${SOURCE_NAME}`,
      );
    await db.delete(webhookSources).where(eq(webhookSources.name, SOURCE_NAME));
  });

  test('declaring a cadence arms supervision healthy', async () => {
    source = await service.create({
      name: SOURCE_NAME,
      description: 'liveness integration fixture',
      expectedIntervalSeconds: 1,
      windowSemantics: 'future_only',
      mutationPolicy: 'same_id',
    });

    expect(source.livenessStatus).toBe('healthy');
    expect(source.livenessArmedAt).toBeInstanceOf(Date);
    expect(source.windowSemantics).toBe('future_only');
    expect(source.mutationPolicy).toBe('same_id');
  });

  test('a sweep within the window changes nothing', async () => {
    await service.sweepLiveness({ deadLetters });
    expect(oursStalled()).toHaveLength(0);
    expect((await service.getById(source.id)).livenessStatus).toBe('healthy');
  });

  test('silence beyond the window stalls once: event + unhealthy state + DLQ entry', async () => {
    await sleep(1300);

    await service.sweepLiveness({ deadLetters });

    expect(oursStalled()).toHaveLength(1);
    const payload = oursStalled()[0]?.payload as { silentForSeconds: number; expectedIntervalSeconds: number };
    expect(payload.expectedIntervalSeconds).toBe(1);
    expect(payload.silentForSeconds).toBeGreaterThanOrEqual(1);

    const row = await service.getById(source.id);
    expect(row.livenessStatus).toBe('stalled');
    expect(row.stalledAt).toBeInstanceOf(Date);

    // Zero-emission dead-letter: pending, manual-resolution only.
    const entries = await ourDlqEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('pending');
    expect(entries[0]?.nextAutoRetryAt).toBeNull();
    expect(entries[0]?.error).toContain(SOURCE_NAME);
  });

  test('further sweeps while still silent do not re-announce', async () => {
    await service.sweepLiveness({ deadLetters });
    await service.sweepLiveness({ deadLetters });

    expect(oursStalled()).toHaveLength(1);
    expect(await ourDlqEntries()).toHaveLength(1);
  });

  test('a heartbeat resets the window without publishing anything', async () => {
    const before = published.length;
    const result = await service.heartbeat(SOURCE_NAME);

    expect(result.ok).toBe(true);
    expect(result.livenessStatus).toBe('stalled'); // status before — transition is the sweeper's
    expect(published.length).toBe(before);

    const row = await service.getById(source.id);
    expect(row.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(row.heartbeatCount).toBe(1);
  });

  test('the next sweep recovers once and auto-resolves the DLQ entry', async () => {
    await service.sweepLiveness({ deadLetters });

    expect(oursRecovered()).toHaveLength(1);
    const payload = oursRecovered()[0]?.payload as { recoveredBy: string };
    expect(payload.recoveredBy).toBe('heartbeat');

    const row = await service.getById(source.id);
    expect(row.livenessStatus).toBe('healthy');
    expect(row.stalledAt).toBeNull();

    const entries = await ourDlqEntries();
    expect(entries[0]?.status).toBe('resolved');

    // Recovered is emitted once too.
    await service.sweepLiveness({ deadLetters });
    expect(oursRecovered()).toHaveLength(1);
  });
});
