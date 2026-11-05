/** Stable generic DLQ retries reach a PostgreSQL-backed consumer at most once. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ConnectorEventPublisher, EventBus, OmniEvent } from '@omni/core';
import { type Database, createDbHandle, deadLetterEvents, processedEvents } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { eq } from 'drizzle-orm';
import { withIdempotency } from '../../lib/idempotency';
import { DeadLetterService } from '../dead-letters';

// API unit tests can mock @omni/core process-wide in the single-process sweep.
// @ts-expect-error Bun supports query-suffixed imports; TypeScript does not resolve them.
const realFactory = await import('../../../../core/src/events/factory.ts?real-dlq-retry-id-test');
const createOmniEvent: typeof import('@omni/core')['createOmniEvent'] = realFactory.createOmniEvent;
const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

// processed_events enforcement is gated on G6; this consumer proof uses legacy mode.
postgresDescribe('dead-letter retry identity (legacy, real PostgreSQL)', () => {
  const dbName = `omni_dlq_id_${crypto.randomUUID().replaceAll('-', '')}`;
  const previous = {
    OMNI_MULTITENANCY_ENABLED: process.env.OMNI_MULTITENANCY_ENABLED,
    OMNI_DB_ENFORCEMENT: process.env.OMNI_DB_ENFORCEMENT,
  };
  const closers: Array<() => Promise<void>> = [];
  const deliveries: OmniEvent[] = [];
  let db: Database;
  let service: DeadLetterService;
  let failBeforePublish = false;
  let losePublishAck = false;

  beforeAll(async () => {
    process.env.OMNI_MULTITENANCY_ENABLED = 'false';
    process.env.OMNI_DB_ENFORCEMENT = 'false';
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const admin = createDbHandle({ url: pgRoleUrl(superUrl, dbName) });
    closers.push(() => admin.close());
    db = admin.db;
    const subscribe = async () => ({ id: 'test', pattern: '', unsubscribe: async () => {} });
    const bus: EventBus & ConnectorEventPublisher = {
      connect: async () => {},
      close: async () => {},
      isConnected: () => true,
      subscribe,
      subscribePattern: subscribe,
      subscribeMany: subscribe,
      subscribeAll: subscribe,
      publish: async () => {
        throw new Error('unexpected core publish');
      },
      publishConnector: async () => {
        throw new Error('unexpected connector publish');
      },
      publishGeneric: async (type, payload, metadata) => {
        if (type === 'system.dead_letter') return { id: crypto.randomUUID(), sequence: 0, stream: 'test' };
        if (failBeforePublish) throw new Error('publish failed before delivery');
        // The same factory used by NatsEventBus. Consumption is separate from
        // publication: a broker ACK does not depend on a handler succeeding.
        const event = createOmniEvent(type, payload, metadata, 'dlq-retry-id-test');
        deliveries.push(event);
        if (losePublishAck) throw new Error('publish ACK lost after delivery');
        return { id: event.id, sequence: deliveries.length, stream: 'test' };
      },
    };
    service = new DeadLetterService(db, bus);
  }, 180_000);

  afterAll(async () => {
    try {
      for (const close of closers.reverse()) await close();
      dropDatabaseOrThrow({ superUrl, psqlBin }, dbName);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  async function fixture() {
    const original = createOmniEvent('custom.dlq.retry-id', { value: 'test' }, undefined, 'original');
    const handler = `retry-test:${crypto.randomUUID()}`;
    // withIdempotency deliberately retains the original failed handler's
    // claim, so reusing the original event ID would suppress the first retry.
    await expect(
      withIdempotency(db, original.id, handler, async () => {
        throw new Error('original consumer failed');
      }),
    ).rejects.toThrow('original consumer failed');
    const [claim] = await db.select().from(processedEvents).where(eq(processedEvents.eventId, original.id));
    expect(claim?.handler).toBe(handler);
    const row = await service.create({
      event: original,
      subject: original.type,
      error: new Error('consumer failed'),
      retryCount: 3,
    });
    return { original, handler, row };
  }

  async function retry(mode: 'manual' | 'auto', id: string) {
    if (mode === 'manual') return (await service.retry(id)).success;
    await db
      .update(deadLetterEvents)
      .set({ nextAutoRetryAt: new Date(0) })
      .where(eq(deadLetterEvents.id, id));
    return (await service.processAutoRetries()).succeeded === 1;
  }

  async function assertResolved(id: string, count: number) {
    expect((await service.getById(id)).status).toBe('resolved');
    expect((await service.retry(id)).success).toBe(false);
    await db
      .update(deadLetterEvents)
      .set({ nextAutoRetryAt: new Date(0) })
      .where(eq(deadLetterEvents.id, id));
    expect(await service.processAutoRetries()).toEqual({ processed: 0, succeeded: 0, failed: 0 });
    expect(deliveries.length).toBe(count);
  }

  function consume(event: OmniEvent, handler: string, effect: () => Promise<void>) {
    return withIdempotency(db, event.id, handler, effect);
  }

  for (const mode of ['manual', 'auto'] as const) {
    test(`${mode}: publish failure claims no consumer; a later retry acts once`, async () => {
      const { original, handler, row } = await fixture();
      const before = deliveries.length;
      failBeforePublish = true;
      try {
        expect(await retry(mode, row.id)).toBe(false);
      } finally {
        failBeforePublish = false;
      }
      expect(deliveries.length).toBe(before);
      expect(await db.select().from(processedEvents).where(eq(processedEvents.eventId, row.id))).toHaveLength(0);
      expect(await retry(mode, row.id)).toBe(true);
      const event = deliveries[before];
      if (!event) throw new Error('missing delivery');
      expect(event.id).toBe(row.id);
      expect(event.id).not.toBe(original.id);
      let actions = 0;
      const effect = async () => {
        actions++;
      };
      expect(await consume(event, handler, effect)).toEqual({ executed: true });
      expect(await consume(event, handler, effect)).toEqual({ executed: false });
      expect(actions).toBe(1);
      await assertResolved(row.id, before + 1);
    });

    test(`${mode}: uncertain success can deliver twice but the consumer acts once`, async () => {
      const { original, handler, row } = await fixture();
      const before = deliveries.length;
      losePublishAck = true;
      try {
        expect(await retry(mode, row.id)).toBe(false);
      } finally {
        losePublishAck = false;
      }
      const first = deliveries[before];
      if (!first) throw new Error('missing first delivery');
      let actions = 0;
      const effect = async () => {
        actions++;
      };
      expect(await consume(first, handler, effect)).toEqual({ executed: true });
      expect(await retry(mode, row.id)).toBe(true);
      const second = deliveries[before + 1];
      if (!second) throw new Error('missing repeated delivery');
      await consume(second, handler, effect);
      expect(actions).toBe(1);
      expect(first.id).toBe(row.id);
      expect(second.id).toBe(first.id);
      expect(second.id).not.toBe(original.id);
      await assertResolved(row.id, before + 2);
    });

    test(`${mode}: consumer failure after publish success does not reopen the resolved row`, async () => {
      const { handler, row } = await fixture();
      const before = deliveries.length;
      expect(await retry(mode, row.id)).toBe(true);
      const event = deliveries[before];
      if (!event) throw new Error('missing delivery');
      let calls = 0;
      const effect = async () => {
        calls++;
        throw new Error('retry consumer failed after ACK');
      };
      await expect(consume(event, handler, effect)).rejects.toThrow('retry consumer failed after ACK');
      expect(await consume(event, handler, effect)).toEqual({ executed: false });
      expect(calls).toBe(1);
      await assertResolved(row.id, before + 1);
    });
  }
});
