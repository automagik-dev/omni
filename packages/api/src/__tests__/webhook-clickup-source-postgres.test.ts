/**
 * The ClickUp source recipe, end-to-end over the REAL HTTP ingress and real
 * PostgreSQL (issue #984, RFC #925 Phase 3 — source 2 of 2).
 *
 * This suite tests the RFC's stronger claim for the SECOND source: "pure
 * configuration, zero new ingress code". The honest verdict is config-only
 * WITH two recorded generic enablers (see the runbook), because ClickUp is a
 * body-first provider: the event name lives in the body's `event` field
 * (body-sourced eventTypeMapping) and the stable delivery identity lives at
 * `history_items[0].id` (numeric array segments in the payload-path
 * grammar). The source row and the four schema artifacts below are EXACTLY
 * what docs/runbooks/clickup-webhook-source.md tells an operator to
 * configure — the schemas are loaded from the shipped artifacts in
 * docs/examples/event-schemas/clickup/, so registering them here also proves
 * they compile. Faked ClickUp deliveries then go through the public ingress
 * route (POST /api/v2/webhooks/ingress/clickup):
 *
 *   * a correctly signed delivery (HMAC-SHA256 over the raw body,
 *     X-Signature, bare lowercase hex — NO prefix, unlike GitHub) is
 *     accepted; a bad signature gets the uniform 401 and journals NOTHING;
 *   * the body's `event` field maps deliveries to the semantic types
 *     custom.clickup.taskstatusupdated / .taskcreated / .taskupdated /
 *     .taskdeleted (#959/#984);
 *   * a RETRY (same history_items[0].id — ClickUp's per-event history id is
 *     stable across retries) responds 200 BOTH times but creates exactly ONE
 *     journal event and ONE bus publish (→ at most one automation firing),
 *     with the source's duplicate counter bumped (#958);
 *   * taskDeleted carries NO history_items, so its key falls back to the
 *     body hash — byte-identical retries still dedup;
 *   * a signed delivery violating its registered schema is refused with 400
 *     and dead-lettered, never journaled (#959);
 *   * declaring the cadence armed liveness supervision on create (#961).
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBus } from '@omni/core';
import { type Database, createDbHandle, deadLetterEvents, omniEvents, webhookSources } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { EventSchemaService } from '../services/event-schemas';
import { WebhookService } from '../services/webhooks';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

/** ClickUp GENERATES the secret at webhook creation (runbook step 1). */
const SECRET = 'clickup-generated-secret-984';
const WEBHOOK_ID = '7fa3ec74-69a8-4530-a251-8a13730bd204';
const ARTIFACTS_DIR = join(import.meta.dir, '../../../../docs/examples/event-schemas/clickup');
const CLICKUP_EVENT_TYPES = [
  'custom.clickup.taskstatusupdated',
  'custom.clickup.taskcreated',
  'custom.clickup.taskupdated',
  'custom.clickup.taskdeleted',
] as const;

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-984-clickup-${crypto.randomUUID()}.sql`);
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

/** An EventBus fake that records generic publishes (all this path uses). */
function recordingBus(events: PublishedEvent[]): EventBus {
  return {
    publishGeneric: async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID(), type, timestamp: Date.now(), payload, metadata };
    },
  } as unknown as EventBus;
}

/** Sign a raw body exactly the way ClickUp does: bare hex digest, no prefix. */
function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Unique, ClickUp-shaped numeric history ids (stable per event). */
let historyIdCounter = 0;
function nextHistoryId(): string {
  historyIdCounter += 1;
  return `28007631367171408${String(historyIdCounter).padStart(3, '0')}`;
}

interface ReceiveResponse {
  received?: boolean;
  eventId?: string;
  eventType?: string;
  duplicate?: boolean;
  error?: { code: string; message: string };
}

const USER = { id: 183, username: 'cezar', email: 'cezar@namastex.ai' };

/** Realistic-but-minimal ClickUp webhook payloads (the runbook's four types). */
function taskStatusUpdatedPayload(historyId: string): Record<string, unknown> {
  return {
    event: 'taskStatusUpdated',
    history_items: [
      {
        id: historyId,
        type: 1,
        date: '1757300000000',
        field: 'status',
        parent_id: '900211139021',
        data: { status_type: 'custom' },
        source: null,
        user: USER,
        before: { status: 'in progress', color: '#5f55ee', type: 'custom', orderindex: 1 },
        after: { status: 'done', color: '#008844', type: 'done', orderindex: 2 },
      },
    ],
    task_id: '86dtxyz12',
    webhook_id: WEBHOOK_ID,
  };
}

function taskCreatedPayload(historyId: string): Record<string, unknown> {
  return {
    event: 'taskCreated',
    history_items: [{ id: historyId, type: 1, date: '1757300000001', field: 'status', user: USER }],
    task_id: '86dtxyz13',
    webhook_id: WEBHOOK_ID,
  };
}

function taskUpdatedPayload(historyId: string): Record<string, unknown> {
  return {
    event: 'taskUpdated',
    history_items: [{ id: historyId, type: 1, date: '1757300000002', field: 'name', user: USER }],
    task_id: '86dtxyz14',
    webhook_id: WEBHOOK_ID,
  };
}

/** taskDeleted really carries NO history_items — just these three fields. */
function taskDeletedPayload(taskId = '86dtxyz15'): Record<string, unknown> {
  return { event: 'taskDeleted', task_id: taskId, webhook_id: WEBHOOK_ID };
}

postgresDescribe('ClickUp source recipe end-to-end (#984, real PostgreSQL)', () => {
  const dbName = `omni_984_clickup_${crypto.randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>['app'];
  const published: PublishedEvent[] = [];

  /** POST a fake ClickUp delivery through the real public ingress route. */
  async function deliver(
    payload: Record<string, unknown>,
    options: { signature?: string } = {},
  ): Promise<{ status: number; json: ReceiveResponse; body: string }> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // ClickUp sends ONLY the bare hex digest — no sha256= prefix, and no
      // delivery-id or event-name headers (everything else is in the body).
      'X-Signature': options.signature ?? sign(body),
    };
    const res = await app.request('/api/v2/webhooks/ingress/clickup', { method: 'POST', body, headers });
    return { status: res.status, json: (await res.json()) as ReceiveResponse, body };
  }

  async function journalRowsForKey(key: string) {
    return db.select().from(omniEvents).where(eq(omniEvents.idempotencyKey, key));
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    db = handle.db;
    close = handle.close;

    // The runbook's step 2: one webhook_sources row declaring the whole
    // contract. Created through the same service the API route uses.
    await new WebhookService(db, null).create({
      name: 'clickup',
      description: 'ClickUp workspace webhooks (#984 recipe)',
      signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Signature' },
      signatureSecret: SECRET,
      idempotencyKeyTemplate: 'clickup:{payload.history_items.0.id}',
      eventTypeMapping: { source: 'body', path: 'event' },
      expectedIntervalSeconds: 86_400,
    });

    // The runbook's step 3: register the SHIPPED JSON Schema artifacts —
    // loading them from docs/ proves the artifacts themselves compile.
    const schemaService = new EventSchemaService(db);
    for (const eventType of CLICKUP_EVENT_TYPES) {
      const artifact = JSON.parse(readFileSync(join(ARTIFACTS_DIR, `${eventType}.json`), 'utf-8')) as Record<
        string,
        unknown
      >;
      await schemaService.register({ eventType, schema: artifact, description: `${eventType} (#984)` });
    }

    // The real HTTP app over the real database — nothing stubbed.
    ({ app } = createApp(db, recordingBus(published)));
  }, 180_000);

  afterAll(async () => {
    await close?.().catch(() => undefined);
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('declaring the cadence armed liveness supervision on create (#961)', async () => {
    const [source] = await db.select().from(webhookSources).where(eq(webhookSources.name, 'clickup'));
    expect(source?.expectedIntervalSeconds).toBe(86_400);
    expect(source?.livenessStatus).toBe('healthy');
    expect(source?.livenessArmedAt).not.toBeNull();
  });

  test('a correctly signed status change lands as custom.clickup.taskstatusupdated under the history-id key', async () => {
    const historyId = nextHistoryId();

    const { status, json } = await deliver(taskStatusUpdatedPayload(historyId));

    expect(status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.eventType).toBe('custom.clickup.taskstatusupdated');
    expect(json.duplicate).toBeUndefined();

    // The journal row exists under the runbook's exact key shape and shares
    // the response's event id (#956/#958: one identity for row + event).
    const rows = await journalRowsForKey(`clickup:${historyId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(json.eventId as string);
    expect(rows[0]?.eventType).toBe('custom.clickup.taskstatusupdated');

    // One bus publish → at most one automation firing.
    expect(published.filter((e) => e.type === 'custom.clickup.taskstatusupdated')).toHaveLength(1);
  });

  test('a bad signature gets the uniform 401 and journals nothing', async () => {
    const historyId = nextHistoryId();

    const { status, json } = await deliver(taskStatusUpdatedPayload(historyId), { signature: 'deadbeef' });

    expect(status).toBe(401);
    expect(json.error?.message).toBe('Webhook verification failed');
    expect(await journalRowsForKey(`clickup:${historyId}`)).toHaveLength(0);
  });

  test('a signature over DIFFERENT body bytes is rejected (raw-body HMAC, not re-serialization)', async () => {
    const historyId = nextHistoryId();
    const payload = taskStatusUpdatedPayload(historyId);

    const { status } = await deliver(payload, {
      signature: sign(JSON.stringify({ ...payload, task_id: 'tampered' })),
    });

    expect(status).toBe(401);
    expect(await journalRowsForKey(`clickup:${historyId}`)).toHaveLength(0);
  });

  test.each([
    ['taskCreated', 'custom.clickup.taskcreated', () => taskCreatedPayload(nextHistoryId())],
    ['taskUpdated', 'custom.clickup.taskupdated', () => taskUpdatedPayload(nextHistoryId())],
    ['taskDeleted', 'custom.clickup.taskdeleted', () => taskDeletedPayload()],
  ])('body event %s maps to %s (#959/#984)', async (_clickupEvent, expectedType, makePayload) => {
    const { status, json } = await deliver(makePayload());

    expect(status).toBe(200);
    expect(json.eventType).toBe(expectedType);
  });

  test('a delivery without a usable event field falls back to the collapsed legacy type', async () => {
    // ClickUp always sends `event`; the fallback is the ingress contract for
    // a mapped source when the body path cannot resolve (#959/#984).
    const { status, json } = await deliver({ task_id: '86dtxyz99', webhook_id: WEBHOOK_ID });

    expect(status).toBe(200);
    expect(json.eventType).toBe('custom.webhook.clickup');
  });

  test('CRITICAL: a retry (same history_items[0].id) is 200 both times but journals exactly ONE event', async () => {
    const historyId = nextHistoryId();
    const payload = taskStatusUpdatedPayload(historyId);
    const publishedBefore = published.length;
    const [sourceBefore] = await db.select().from(webhookSources).where(eq(webhookSources.name, 'clickup'));

    const first = await deliver(payload);
    const second = await deliver(payload);

    // ClickUp must see success both times so it stops retrying (and never
    // marks the webhook as failing).
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.json.duplicate).toBeUndefined();
    expect(second.json.duplicate).toBe(true);
    // The duplicate ack points at the ORIGINAL event.
    expect(second.json.eventId).toBe(first.json.eventId);

    // Exactly one journal event and one bus publish for the delivery.
    expect(await journalRowsForKey(`clickup:${historyId}`)).toHaveLength(1);
    expect(published.length).toBe(publishedBefore + 1);

    // The retry is visible on the source's counters.
    const [sourceAfter] = await db.select().from(webhookSources).where(eq(webhookSources.name, 'clickup'));
    expect(sourceAfter?.totalDuplicates).toBe((sourceBefore?.totalDuplicates ?? 0) + 1);
  });

  test('taskDeleted (no history_items) falls back to the body-hash key and STILL dedups retries', async () => {
    const payload = taskDeletedPayload('86dtxyz42');
    const publishedBefore = published.length;

    const first = await deliver(payload);
    const second = await deliver(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);

    // The unresolved {payload.history_items.0.id} placeholder falls back to
    // the documented body-hash default — correct because ClickUp retries
    // resend the same bytes.
    const rows = await journalRowsForKey(`clickup:${sha256Hex(first.body)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('custom.clickup.taskdeleted');
    expect(published.length).toBe(publishedBefore + 1);
  });

  test('a signed delivery violating its registered schema is 400 + dead-lettered, never journaled (#959)', async () => {
    const historyId = nextHistoryId();
    // `task_id` and `webhook_id` are required by the shipped artifact.
    const invalid = {
      event: 'taskStatusUpdated',
      history_items: [{ id: historyId }],
    };

    const { status, json } = await deliver(invalid);

    expect(status).toBe(400);
    expect(json.error?.message).toContain('schema_validation_failed');
    expect(await journalRowsForKey(`clickup:${historyId}`)).toHaveLength(0);

    const dlq = await db
      .select()
      .from(deadLetterEvents)
      .where(eq(deadLetterEvents.eventType, 'custom.clickup.taskstatusupdated'))
      .limit(5);
    expect(dlq.length).toBeGreaterThanOrEqual(1);
    expect(dlq[0]?.error).toContain('schema_validation_failed');
  });
});
