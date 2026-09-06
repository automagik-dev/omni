/**
 * Ingress idempotency over real PostgreSQL (#958, RFC #925 G2).
 *
 * The unique index on `omni_events.idempotency_key` — not application logic —
 * is the dedup authority. This suite proves, against a disposable database:
 *
 *   * the same webhook delivered twice (same derived key) journals ONE event,
 *     publishes ONE bus event (→ one automation firing), and the second
 *     delivery is acked as a duplicate with the source's dup counter bumped;
 *   * a provider-identity template (`{headers.*}`) dedupes redeliveries even
 *     when the body differs, while distinct delivery ids create distinct
 *     events — redelivery dedup, NOT semantic dedup;
 *   * re-running an automation's emit_event over the same parent event
 *     collides on the derived key `derived:{event}:{automation}:{index}` and
 *     does not duplicate the emission;
 *   * a claim released after a failed publish lets the retry through.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventBus } from '@omni/core';
import { executeActions } from '@omni/core';
import { type Database, createDbHandle, omniEvents, webhookSources } from '@omni/db';
import { eq } from 'drizzle-orm';
import { buildAutomationEngineDeps } from '../../plugins/automation-actions';
import type { Services } from '../../services';
import { WebhookService } from '../webhooks';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-958-idempotency-${crypto.randomUUID()}.sql`);
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
function recordingBus(events: PublishedEvent[], failNext?: { count: number }): EventBus {
  return {
    publishGeneric: async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      if (failNext && failNext.count > 0) {
        failNext.count--;
        throw new Error('simulated publish failure');
      }
      events.push({ type, payload });
      return { id: crypto.randomUUID(), type, timestamp: Date.now(), payload, metadata };
    },
  } as unknown as EventBus;
}

postgresDescribe('webhook ingress idempotency (real PostgreSQL)', () => {
  const dbName = `omni_958_idempotency_${crypto.randomUUID().replaceAll('-', '')}`;
  let dbUrl = '';
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);
    dbUrl = urlFor(superUrl, dbName);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    const migrated = runSqlOn(dbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const handle = createDbHandle({ url: dbUrl, maxConnections: 3 });
    db = handle.db;
    close = handle.close;
  }, 180_000);

  afterAll(async () => {
    await close?.().catch(() => undefined);
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  async function eventCount(): Promise<number> {
    return (await db.select({ id: omniEvents.id }).from(omniEvents)).length;
  }

  test('same webhook delivered twice → one journal event, one publish, dup counter bumped', async () => {
    const published: PublishedEvent[] = [];
    const service = new WebhookService(db, recordingBus(published));
    await service.create({ name: 'gh-body', description: 'default body-hash template' });

    const rawBody = JSON.stringify({ action: 'push', id: 42 });
    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    const first = await service.receive('gh-body', payload, {}, { rawBody });
    const second = await service.receive('gh-body', payload, {}, { rawBody });

    expect(first.duplicate).toBeUndefined();
    expect(second.received).toBe(true); // acked — the emitter stops redelivering
    expect(second.duplicate).toBe(true);
    expect(second.eventId).toBe(first.eventId); // the ORIGINAL event's id

    // One journal row, one bus publish (→ one automation firing).
    const rows = await db.select().from(omniEvents).where(eq(omniEvents.id, first.eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toStartWith('gh-body:');
    expect(rows[0]?.eventType).toBe('custom.webhook.gh-body');
    expect(published).toHaveLength(1);

    const [sourceRow] = await db.select().from(webhookSources).where(eq(webhookSources.name, 'gh-body'));
    expect(sourceRow?.totalReceived).toBe(1);
    expect(sourceRow?.totalDuplicates).toBe(1);
  });

  test('provider-identity template dedupes redelivery but keeps distinct deliveries distinct', async () => {
    const published: PublishedEvent[] = [];
    const service = new WebhookService(db, recordingBus(published));
    await service.create({
      name: 'gh-delivery',
      idempotencyKeyTemplate: 'gh-delivery:{headers.x-github-delivery}',
    });

    // Redelivery: same delivery id, different body bytes → still ONE event.
    const a1 = await service.receive(
      'gh-delivery',
      { try: 1 },
      { 'x-github-delivery': 'd-1' },
      { rawBody: '{"try":1}' },
    );
    const a2 = await service.receive(
      'gh-delivery',
      { try: 2 },
      { 'x-github-delivery': 'd-1' },
      { rawBody: '{"try":2}' },
    );
    // Distinct delivery → its own event. Redelivery dedup, NOT semantic dedup:
    // a semantically identical payload under a new delivery id is a new event
    // by design (see lib/ingress-idempotency.ts).
    const b = await service.receive(
      'gh-delivery',
      { try: 1 },
      { 'x-github-delivery': 'd-2' },
      { rawBody: '{"try":1}' },
    );

    expect(a2.duplicate).toBe(true);
    expect(a2.eventId).toBe(a1.eventId);
    expect(b.duplicate).toBeUndefined();
    expect(published).toHaveLength(2);
  });

  test('a failed publish releases the claim so the provider retry creates the event', async () => {
    const failNext = { count: 1 };
    const published: PublishedEvent[] = [];
    const service = new WebhookService(db, recordingBus(published, failNext));
    await service.create({ name: 'gh-flaky' });

    const rawBody = JSON.stringify({ id: 'retry-me' });
    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    await expect(service.receive('gh-flaky', payload, {}, { rawBody })).rejects.toThrow('simulated publish failure');
    // The retry must be a FIRST delivery, not a duplicate of a ghost event.
    const retry = await service.receive('gh-flaky', payload, {}, { rawBody });
    expect(retry.duplicate).toBeUndefined();
    expect(published).toHaveLength(1);
  });

  test('re-running an automation over the same event → no duplicate emission (derived key)', async () => {
    const before = await eventCount();
    const published: PublishedEvent[] = [];
    // Only the #958 claim callbacks touch the DB; the rest of Services is
    // never dereferenced by them.
    const engineDeps = buildAutomationEngineDeps({} as Services, db);
    const actionDeps = {
      eventBus: recordingBus(published),
      claimEmittedEvent: engineDeps.claimEmittedEvent,
      releaseEmittedEventClaim: engineDeps.releaseEmittedEventClaim,
    };
    const context = { payload: { hello: 'world' }, variables: {}, env: {} };
    const actions = [{ type: 'emit_event', config: { eventType: 'custom.derived.channel-sync' } }] as Parameters<
      typeof executeActions
    >[0];
    const provenance = { parentEventId: crypto.randomUUID(), automationId: crypto.randomUUID() };

    const first = await executeActions(actions, context, actionDeps, null, provenance);
    const second = await executeActions(actions, context, actionDeps, null, provenance);

    expect(first[0]?.status).toBe('success');
    expect(second[0]?.status).toBe('success');
    expect((second[0]?.result as { duplicate?: boolean }).duplicate).toBe(true);
    expect(published).toHaveLength(1);

    // Exactly one journal row was created, carrying the derived key.
    expect(await eventCount()).toBe(before + 1);
    const derivedKey = `derived:${provenance.parentEventId}:${provenance.automationId}:0`;
    const rows = await db.select().from(omniEvents).where(eq(omniEvents.idempotencyKey, derivedKey));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('custom.derived.channel-sync');
  });

  test('a released emission claim (failed publish) lets the retry emit', async () => {
    const failNext = { count: 1 };
    const published: PublishedEvent[] = [];
    const engineDeps = buildAutomationEngineDeps({} as Services, db);
    const actionDeps = {
      eventBus: recordingBus(published, failNext),
      claimEmittedEvent: engineDeps.claimEmittedEvent,
      releaseEmittedEventClaim: engineDeps.releaseEmittedEventClaim,
    };
    const context = { payload: {}, variables: {}, env: {} };
    const actions = [{ type: 'emit_event', config: { eventType: 'custom.derived.retry' } }] as Parameters<
      typeof executeActions
    >[0];
    const provenance = { parentEventId: crypto.randomUUID(), automationId: crypto.randomUUID() };

    const first = await executeActions(actions, context, actionDeps, null, provenance);
    const second = await executeActions(actions, context, actionDeps, null, provenance);

    expect(first[0]?.status).toBe('failed');
    expect(second[0]?.status).toBe('success');
    expect((second[0]?.result as { duplicate?: boolean }).duplicate).toBeUndefined();
    expect(published).toHaveLength(1);
  });
});
