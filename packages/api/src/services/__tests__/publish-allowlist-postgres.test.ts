/**
 * Agent publish-allowlist enforcement over real PostgreSQL (issue #987,
 * RFC #925 G4c — "Emission outside the manifest → refused + DLQ").
 *
 * Drives the REAL emit path — `executeAction('emit_event')` over
 * `buildAutomationEngineDeps` — against a disposable database with every
 * migration applied, proving the acceptance criteria:
 *
 *   * declared type + valid payload → publishes normally (journal claim row
 *     under the #958 provenance, event on the bus);
 *   * undeclared type → action fails `publish_not_declared`, a
 *     dead_letter_events row with that reason (manual-retry only), NOTHING
 *     published and ZERO journal rows;
 *   * declared type + invalid payload → the EXISTING
 *     `schema_validation_failed` path, unchanged;
 *   * check ORDER: an undeclared type with an invalid payload refuses as
 *     `publish_not_declared` (allowlist first, schema second);
 *   * `publishes: []` → deny-all (an empty allowlist is an allowlist);
 *   * manifest-less agent, missing agent row, and automations with no
 *     managing agent → ungoverned, today's behavior unchanged.
 *
 * Set `OMNI_G1_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AgentEventManifest, EventBus, TemplateContext } from '@omni/core';
import { executeAction } from '@omni/core';
import { type Database, type EventType, createDbHandle, deadLetterEvents, omniEvents } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { buildAutomationEngineDeps } from '../../plugins/automation-actions';
import { AgentService } from '../agents';
import { DeadLetterService } from '../dead-letters';
import { EventSchemaService } from '../event-schemas';
import type { Services } from '../index';

const superUrl = process.env.OMNI_G1_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G1_PSQL_BIN ?? 'psql';

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** An EventBus fake that records publishes — the bus side of the journal. */
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
    orderId: { type: 'string' },
  },
  required: ['orderId'],
};

const GOVERNED_MANIFEST: AgentEventManifest = {
  accepts: [{ event: 'custom.clickup.task.status_changed' }],
  publishes: [{ event: 'custom.acme.order' }],
};

postgresDescribe('agent publish-allowlist enforcement (real PostgreSQL)', () => {
  const dbName = `omni_987_publishes_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let journal: PublishedEvent[];
  let deps: ReturnType<typeof buildAutomationEngineDeps>;
  let governedAgentId: string;
  let denyAllAgentId: string;
  let manifestlessAgentId: string;

  function journalOf(type: string): PublishedEvent[] {
    return journal.filter((e) => e.type === type);
  }

  async function dlqRows() {
    return db.select().from(deadLetterEvents);
  }

  /** Journal claim rows the #958 idempotency path inserted for a type. */
  async function journaledEvents(eventType: string) {
    return db
      .select()
      .from(omniEvents)
      .where(eq(omniEvents.eventType, eventType as EventType));
  }

  /** Run one emit_event on the real engine deps, attributed to an agent. */
  async function emitAs(agentId: string | null, eventType: string, payload: Record<string, unknown>) {
    const context: TemplateContext = {
      payload,
      variables: {},
      env: {},
      automation: { id: 'auto-987', ...(agentId === null ? {} : { managedByAgentId: agentId }) },
    };
    return executeAction(
      { type: 'emit_event', config: { eventType } },
      context,
      { ...deps, eventBus: recordingBus(journal) },
      null,
      0,
      // parentEventId lands in the claim row's uuid causation_id column.
      { parentEventId: crypto.randomUUID(), automationId: 'auto-987' },
    );
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;

    journal = [];
    const bus = recordingBus(journal);
    const eventSchemas = new EventSchemaService(db);
    const deadLetters = new DeadLetterService(db, bus);
    const agents = new AgentService(db, bus);
    deps = buildAutomationEngineDeps({ eventSchemas, deadLetters } as unknown as Services, db);

    await eventSchemas.register({ eventType: 'custom.acme.order', schema: ORDER_SCHEMA });

    const governed = await agents.create({ name: 'governed-agent', provider: 'claude' });
    governedAgentId = governed.id;
    await agents.updateManifest(governedAgentId, GOVERNED_MANIFEST);

    const denyAll = await agents.create({ name: 'deny-all-agent', provider: 'claude' });
    denyAllAgentId = denyAll.id;
    await agents.updateManifest(denyAllAgentId, { accepts: [], publishes: [] });

    const manifestless = await agents.create({ name: 'manifestless-agent', provider: 'claude' });
    manifestlessAgentId = manifestless.id;

    journal.length = 0;
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
  });

  test('declared type + valid payload → publishes normally with a journal claim row', async () => {
    const result = await emitAs(governedAgentId, 'custom.acme.order', { orderId: 'ord-1' });

    expect(result.status).toBe('success');
    expect(journalOf('custom.acme.order').length).toBe(1);
    expect((await journaledEvents('custom.acme.order')).length).toBe(1);
    expect((await dlqRows()).length).toBe(0);
  });

  test('undeclared type → refused publish_not_declared, DLQ row, nothing published or journaled', async () => {
    const result = await emitAs(governedAgentId, 'custom.acme.refund', { refundId: 'ref-1' });

    expect(result.status).toBe('failed');
    expect(result.error?.startsWith('publish_not_declared')).toBe(true);
    expect(result.error).toContain(governedAgentId);

    const rows = await dlqRows();
    expect(rows.length).toBe(1);
    const entry = rows[0];
    expect(entry?.eventType).toBe('custom.acme.refund');
    expect(entry?.error.startsWith('publish_not_declared')).toBe(true);
    // Redeclaring the type is the fix; retrying unchanged can never succeed.
    expect(entry?.nextAutoRetryAt).toBeNull();
    expect(entry?.payload).toMatchObject({ refundId: 'ref-1' });

    // Neither the bus nor the journal (idempotency claim rows) saw the event.
    expect(journalOf('custom.acme.refund')).toEqual([]);
    expect((await journaledEvents('custom.acme.refund')).length).toBe(0);
    // The only bus traffic for the refusal was the DLQ system announcement.
    expect(journalOf('system.dead_letter').length).toBe(1);
  });

  test('declared type + invalid payload → the existing schema_validation_failed path', async () => {
    const result = await emitAs(governedAgentId, 'custom.acme.order', { orderId: 42 });

    expect(result.status).toBe('failed');
    expect(result.error?.startsWith('schema_validation_failed')).toBe(true);

    const rows = await dlqRows();
    expect(rows.length).toBe(2);
    const entry = rows.find((r) => r.error.startsWith('schema_validation_failed'));
    expect(entry?.eventType).toBe('custom.acme.order');
    expect(entry?.nextAutoRetryAt).toBeNull();
    expect(journalOf('custom.acme.order').length).toBe(1); // unchanged
  });

  test('check order: undeclared type with an invalid payload refuses as publish_not_declared', async () => {
    // custom.acme.order's schema would also reject this payload — but the
    // allowlist is checked FIRST, so an undeclared type never reaches it.
    const result = await emitAs(governedAgentId, 'custom.acme.audit', { orderId: 42 });

    expect(result.status).toBe('failed');
    expect(result.error?.startsWith('publish_not_declared')).toBe(true);
    const entry = (await dlqRows()).find((r) => r.eventType === 'custom.acme.audit');
    expect(entry?.error.startsWith('publish_not_declared')).toBe(true);
  });

  test('publishes: [] → deny-all (the agent declared "publishes nothing")', async () => {
    const result = await emitAs(denyAllAgentId, 'custom.acme.order', { orderId: 'ord-2' });

    expect(result.status).toBe('failed');
    expect(result.error?.startsWith('publish_not_declared')).toBe(true);
    expect((await journaledEvents('custom.acme.order')).length).toBe(1); // unchanged
  });

  test('manifest-less agent → ungoverned, emission unaffected', async () => {
    const result = await emitAs(manifestlessAgentId, 'custom.freeform.anything', { anything: 'goes' });

    expect(result.status).toBe('success');
    expect(journalOf('custom.freeform.anything').length).toBe(1);
  });

  test('missing agent row → ungoverned (fail-open, the managing agent was deleted)', async () => {
    const result = await emitAs('00000000-0000-4000-8000-000000000000', 'custom.freeform.orphaned', { ok: true });

    expect(result.status).toBe('success');
    expect(journalOf('custom.freeform.orphaned').length).toBe(1);
  });

  test('automation with no managing agent → gate inert, today behavior unchanged', async () => {
    const dlqBefore = (await dlqRows()).length;
    const result = await emitAs(null, 'custom.freeform.unmanaged', { ok: true });

    expect(result.status).toBe('success');
    expect(journalOf('custom.freeform.unmanaged').length).toBe(1);
    expect((await dlqRows()).length).toBe(dlqBefore);
  });
});
