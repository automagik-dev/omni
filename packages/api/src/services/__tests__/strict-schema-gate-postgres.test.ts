/**
 * Per-source strict schema validation over real PostgreSQL (issue #1000,
 * RFC #925 G1 tail — the deferred "deny-by-default" policy switch).
 *
 * Proves the acceptance criteria against a disposable database with every
 * migration applied (including 0060, which adds `webhook_sources.strict_schemas`):
 *
 *   * a STRICT source receiving a delivery whose event type has NO enabled
 *     registered schema → dead_letter_events row with the distinct reason
 *     `schema_not_registered` (manual-retry only), NOTHING published and
 *     NOTHING journaled;
 *   * strict + registered type + valid payload → publishes normally;
 *   * strict + registered type + invalid payload → the EXISTING
 *     `schema_validation_failed` path, unchanged;
 *   * a non-strict source keeps the opt-in pass-through for unregistered
 *     types (no global default flip);
 *   * the switch is flippable at runtime via `WebhookService.update`;
 *   * the `emit_event` gate honors the global `OMNI_STRICT_EMIT_EVENT_SCHEMAS`
 *     opt-in the same way (default off).
 *
 * Set `OMNI_G1_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBus } from '@omni/core';
import { executeAction } from '@omni/core';
import { type Database, type EventType, createDbHandle, deadLetterEvents, omniEvents } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { buildAutomationEngineDeps } from '../../plugins/automation-actions';
import { DeadLetterService } from '../dead-letters';
import { EventSchemaService } from '../event-schemas';
import type { Services } from '../index';
import { WebhookService } from '../webhooks';

const superUrl = process.env.OMNI_G1_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G1_PSQL_BIN ?? 'psql';

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-1000-strict-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** An EventBus fake that records publishes — the journal, for assertions. */
function recordingBus(events: PublishedEvent[]): EventBus {
  return {
    publishGeneric: async (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID(), ok: true };
    },
  } as unknown as EventBus;
}

/** The schema every custom.acme.order payload must satisfy in this suite. */
const ORDER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    orderId: { type: 'string' },
  },
  required: ['orderId'],
};

postgresDescribe('per-source strict schema validation (real PostgreSQL)', () => {
  const dbName = `omni_1000_strict_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let journal: PublishedEvent[];
  let eventSchemas: EventSchemaService;
  let deadLetters: DeadLetterService;
  let webhooks: WebhookService;
  let laxSourceId: string;

  function journalOf(type: string): PublishedEvent[] {
    return journal.filter((e) => e.type === type);
  }

  async function dlqRows() {
    return db.select().from(deadLetterEvents);
  }

  /** Rows the ingress idempotency claim would have journaled for a type. */
  async function journaledEvents(eventType: string) {
    return db
      .select()
      .from(omniEvents)
      .where(eq(omniEvents.eventType, eventType as EventType));
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const dbUrl = urlFor(superUrl, dbName);

    const handle = createDbHandle({ url: dbUrl, maxConnections: 3 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;

    journal = [];
    const bus = recordingBus(journal);
    eventSchemas = new EventSchemaService(db);
    deadLetters = new DeadLetterService(db, bus);
    webhooks = new WebhookService(db, bus, eventSchemas, deadLetters);

    await webhooks.create({
      name: 'acme',
      description: 'strict suite source',
      strictSchemas: true,
      eventTypeMapping: { source: 'header', header: 'X-Acme-Event' },
    });
    const lax = await webhooks.create({
      name: 'legacy',
      description: 'non-strict suite source',
      eventTypeMapping: { source: 'header', header: 'X-Legacy-Event' },
    });
    laxSourceId = lax.id;

    await eventSchemas.register({ eventType: 'custom.acme.order', schema: ORDER_SCHEMA });
  }, 180_000);

  afterAll(async () => {
    process.env.OMNI_STRICT_EMIT_EVENT_SCHEMAS = undefined;
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('a source is created non-strict by default (no global default flip)', async () => {
    const legacy = await webhooks.getByName('legacy');
    expect(legacy?.strictSchemas).toBe(false);
    const acme = await webhooks.getByName('acme');
    expect(acme?.strictSchemas).toBe(true);
  });

  test('strict + unregistered type → DLQ schema_not_registered, nothing published or journaled', async () => {
    await expect(webhooks.receive('acme', { anything: 'goes' }, { 'x-acme-event': 'mystery' })).rejects.toThrow(
      /schema_not_registered/,
    );

    const rows = await dlqRows();
    expect(rows.length).toBe(1);
    const entry = rows[0];
    expect(entry?.eventType).toBe('custom.acme.mystery');
    expect(entry?.error.startsWith('schema_not_registered')).toBe(true);
    // Redelivering an unregistered type can never succeed unchanged: manual only.
    expect(entry?.nextAutoRetryAt).toBeNull();
    // The refused payload is preserved as the DLQ row's record.
    expect(entry?.payload).toMatchObject({ source: 'acme', anything: 'goes' });

    // Neither the bus nor the journal (idempotency claim rows) saw the event.
    expect(journalOf('custom.acme.mystery')).toEqual([]);
    expect((await journaledEvents('custom.acme.mystery')).length).toBe(0);
    // The only bus traffic was the DLQ system announcement.
    expect(journalOf('system.dead_letter').length).toBe(1);
  });

  test('strict + registered type + valid payload → publishes normally', async () => {
    const result = await webhooks.receive('acme', { orderId: 'ord-1' }, { 'x-acme-event': 'order' });

    expect(result.eventType).toBe('custom.acme.order');
    expect(journalOf('custom.acme.order').length).toBe(1);
    expect((await dlqRows()).length).toBe(1); // unchanged since the refused delivery
  });

  test('strict + registered type + invalid payload → existing schema_validation_failed path', async () => {
    await expect(webhooks.receive('acme', { orderId: 42 }, { 'x-acme-event': 'order' })).rejects.toThrow(
      /schema_validation_failed/,
    );

    const rows = await dlqRows();
    expect(rows.length).toBe(2);
    const entry = rows.find((r) => r.error.startsWith('schema_validation_failed'));
    expect(entry).toBeDefined();
    expect(entry?.eventType).toBe('custom.acme.order');
    expect(entry?.nextAutoRetryAt).toBeNull();
    expect(journalOf('custom.acme.order').length).toBe(1); // unchanged
  });

  test('non-strict source: unregistered types keep flowing (opt-in pass-through)', async () => {
    const result = await webhooks.receive('legacy', { freeform: true }, { 'x-legacy-event': 'anything' });

    expect(result.eventType).toBe('custom.legacy.anything');
    expect(journalOf('custom.legacy.anything').length).toBe(1);
    expect((await dlqRows()).length).toBe(2); // unchanged
  });

  test('the switch is flippable at runtime via update()', async () => {
    const updated = await webhooks.update(laxSourceId, { strictSchemas: true });
    expect(updated.strictSchemas).toBe(true);

    await expect(webhooks.receive('legacy', { freeform: true }, { 'x-legacy-event': 'anything-else' })).rejects.toThrow(
      /schema_not_registered/,
    );

    const reverted = await webhooks.update(laxSourceId, { strictSchemas: false });
    expect(reverted.strictSchemas).toBe(false);
    const result = await webhooks.receive('legacy', { freeform: 2 }, { 'x-legacy-event': 'anything-else' });
    expect(result.eventType).toBe('custom.legacy.anything-else');
  });

  test('emit_event: unregistered type passes with the global switch off (default)', async () => {
    process.env.OMNI_STRICT_EMIT_EVENT_SCHEMAS = undefined;
    const engineDeps = buildAutomationEngineDeps({ eventSchemas, deadLetters } as unknown as Services, db);

    const result = await executeAction(
      { type: 'emit_event', config: { eventType: 'custom.internal.unregistered' } },
      { payload: { free: 'form' }, variables: {}, env: {} },
      { ...engineDeps, eventBus: recordingBus(journal) },
    );

    expect(result.status).toBe('success');
    expect(journalOf('custom.internal.unregistered').length).toBe(1);
  });

  test('emit_event: OMNI_STRICT_EMIT_EVENT_SCHEMAS=true refuses unregistered types with schema_not_registered', async () => {
    process.env.OMNI_STRICT_EMIT_EVENT_SCHEMAS = 'true';
    try {
      const engineDeps = buildAutomationEngineDeps({ eventSchemas, deadLetters } as unknown as Services, db);
      const dlqBefore = (await dlqRows()).length;
      const publishedBefore = journalOf('custom.internal.unregistered2').length;

      const result = await executeAction(
        { type: 'emit_event', config: { eventType: 'custom.internal.unregistered2' } },
        { payload: { free: 'form' }, variables: {}, env: {} },
        { ...engineDeps, eventBus: recordingBus(journal) },
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('schema_not_registered');
      expect(journalOf('custom.internal.unregistered2').length).toBe(publishedBefore);

      const rows = await dlqRows();
      expect(rows.length).toBe(dlqBefore + 1);
      const entry = rows.find((r) => r.eventType === 'custom.internal.unregistered2');
      expect(entry?.error.startsWith('schema_not_registered')).toBe(true);
      expect(entry?.nextAutoRetryAt).toBeNull();
    } finally {
      process.env.OMNI_STRICT_EMIT_EVENT_SCHEMAS = undefined;
    }
  });

  test('emit_event: the strict switch still publishes registered valid payloads', async () => {
    process.env.OMNI_STRICT_EMIT_EVENT_SCHEMAS = 'true';
    try {
      const engineDeps = buildAutomationEngineDeps({ eventSchemas, deadLetters } as unknown as Services, db);
      const publishedBefore = journalOf('custom.acme.order').length;

      const result = await executeAction(
        { type: 'emit_event', config: { eventType: 'custom.acme.order' } },
        { payload: { orderId: 'ord-2' }, variables: {}, env: {} },
        { ...engineDeps, eventBus: recordingBus(journal) },
      );

      expect(result.status).toBe('success');
      expect(journalOf('custom.acme.order').length).toBe(publishedBefore + 1);
    } finally {
      process.env.OMNI_STRICT_EMIT_EVENT_SCHEMAS = undefined;
    }
  });
});
