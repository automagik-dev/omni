/**
 * Custom-event journal row fidelity, over real PostgreSQL (#966).
 *
 * The `custom.>` subscriber (#957) truncated eventType to a stale 50-char cap
 * (the column is 255 since #958), silently breaking exact-match `--type`
 * filters for longer `custom.webhook.{source}.{event}` types.
 *
 * These suites drive the REAL subscriber handler (a mock bus captures it —
 * events-trace.test.ts precedent) against a migrated disposable database.
 *
 * Set `OMNI_G3_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { EventBus } from '@omni/core';
import { type Database, type EventType, createDbHandle } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { setupEventPersistence } from '../plugins/event-persistence';
import { EventService } from '../services/events';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

type CustomEventHandler = (event: {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  metadata: Record<string, unknown>;
}) => Promise<void>;

/** Capture the real `custom.>` subscriber handler via a mock bus. */
async function captureCustomHandler(db: Database): Promise<CustomEventHandler> {
  const subscriptions = new Map<string, CustomEventHandler>();
  const mockBus = {
    subscribe: async () => {},
    subscribePattern: async (pattern: string, handler: CustomEventHandler) => {
      subscriptions.set(pattern, handler);
    },
  } as unknown as EventBus;

  await setupEventPersistence(mockBus, db);
  const handler = subscriptions.get('custom.>');
  if (!handler) throw new Error('custom.> subscriber was not registered');
  return handler;
}

postgresDescribe('custom event journal fidelity (#966, real PostgreSQL)', () => {
  const dbName = `omni_events_journal_${randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let closeDb: () => Promise<void>;
  let handler: CustomEventHandler;
  let service: EventService;

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    db = handle.db;
    closeDb = () => handle.close().catch(() => undefined);

    handler = await captureCustomHandler(db);
    service = new EventService(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  /** Journal one custom event through the real handler and read the row back. */
  async function journal(
    type: string,
    payload: Record<string, unknown>,
    metadata: Record<string, unknown> = {},
  ): Promise<{ id: string; row: Awaited<ReturnType<EventService['getById']>> }> {
    const id = randomUUID();
    await handler({
      id,
      type,
      payload,
      timestamp: Date.now(),
      metadata: { correlationId: randomUUID(), ...metadata },
    });
    return { id, row: await service.getById(id) };
  }

  describe('eventType truncation regression', () => {
    test('a type longer than the old 50-char cap round-trips exactly and stays filterable', async () => {
      const longType = `custom.webhook.truncation-966.push_review_comment_thread_resolved.${randomUUID().slice(0, 4)}`;
      expect(longType.length).toBeGreaterThan(50);
      expect(longType.length).toBeLessThanOrEqual(255);

      const { id, row } = await journal(longType, { probe: 'truncation-966' }, { source: 'webhook' });
      expect(row.eventType).toBe(longType as EventType);

      // Exact-match type filter finds it (the inArray path the API list uses).
      const listed = await service.list({ eventType: [longType as EventType], limit: 10 });
      expect(listed.items.map((e) => e.id)).toContain(id);
    });

    test('a type longer than the column caps at 255 instead of failing the insert', async () => {
      const overlongType = `custom.overlong-966.${'x'.repeat(300)}`;
      const { row } = await journal(overlongType, {});
      expect(row.eventType).toBe(overlongType.slice(0, 255) as EventType);
      // The untruncated type is preserved in the metadata jsonb for forensics.
      expect((row.metadata as { fullEventType?: string })?.fullEventType).toBe(overlongType);
    });
  });
});
