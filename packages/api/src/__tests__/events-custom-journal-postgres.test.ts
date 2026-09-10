/**
 * Custom-event journal row fidelity + type-glob list filtering, over real
 * PostgreSQL (#966).
 *
 * The `custom.>` subscriber (#957) journals every custom event, but the row
 * it wrote was lossy in ways that broke the CLI event surface:
 *  - eventType was truncated to a stale 50-char cap (the column is 255 since
 *    #958), silently breaking exact-match `--type` filters for longer
 *    `custom.webhook.{source}.{event}` types;
 *  - chatUuid/personId were never populated, so `--chat-id`/`--person-id`
 *    could never match a custom event.
 * And `--type 'custom.*'` matched nothing anywhere: EventService.list used
 * strict inArray equality only.
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
import { type Database, type EventType, chats, createDbHandle, instances, persons } from '@omni/db';
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
  let instanceId: string;
  let personId: string;
  let chatUuid: string;
  const chatExternalId = 'wait-966@s.whatsapp.net';

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    db = handle.db;
    closeDb = () => handle.close().catch(() => undefined);

    handler = await captureCustomHandler(db);
    service = new EventService(db);

    const [instance] = await db
      .insert(instances)
      .values({ name: 'events-966', channel: 'whatsapp-baileys' as const })
      .returning();
    if (!instance) throw new Error('instance insert returned nothing');
    instanceId = instance.id;

    const [person] = await db.insert(persons).values({ displayName: 'Wait 966' }).returning();
    if (!person) throw new Error('person insert returned nothing');
    personId = person.id;

    const [chat] = await db
      .insert(chats)
      .values({
        instanceId,
        externalId: chatExternalId,
        chatType: 'dm',
        channel: 'whatsapp-baileys',
        name: 'Wait 966 DM',
        visibility: 'visible',
        lastMessageAt: new Date(),
      })
      .returning();
    if (!chat) throw new Error('chat insert returned nothing');
    chatUuid = chat.id;
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

  describe('chatUuid/personId population', () => {
    test('metadata.personId maps onto the row when the person exists', async () => {
      const { row } = await journal('custom.identity-966.meta_person', {}, { personId });
      expect(row.personId).toBe(personId);
    });

    test('payload.personId maps when metadata carries none', async () => {
      const { row } = await journal('custom.identity-966.payload_person', { personId });
      expect(row.personId).toBe(personId);
    });

    test('a personId claim with no persons row is dropped, not fatal (FK safety)', async () => {
      const { row } = await journal('custom.identity-966.bogus_person', { personId: randomUUID() });
      expect(row.personId).toBeNull(); // the row itself still persisted
    });

    test('payload.chatId + metadata.instanceId resolve to the chats.id UUID', async () => {
      const { row } = await journal('custom.identity-966.chat_jid', { chatId: chatExternalId }, { instanceId });
      expect(row.chatUuid).toBe(chatUuid);
      expect(row.chatId).toBe(chatExternalId);
    });

    test('payload.chatUuid maps directly when it names an existing chat', async () => {
      const { row } = await journal('custom.identity-966.chat_uuid', { chatUuid });
      expect(row.chatUuid).toBe(chatUuid);
    });

    test('a chatUuid claim with no chats row is dropped, not fatal (FK safety)', async () => {
      const { row } = await journal('custom.identity-966.bogus_chat', { chatUuid: randomUUID() });
      expect(row.chatUuid).toBeNull();
    });
  });

  describe('trailing-* glob type filtering', () => {
    let alphaId: string;
    let betaId: string;
    let outsiderId: string;

    beforeAll(async () => {
      ({ id: alphaId } = await journal('custom.globtest-966.alpha', {}));
      ({ id: betaId } = await journal('custom.globtest-966.beta', {}));
      ({ id: outsiderId } = await journal('custom.other-966.gamma', {}));
    });

    test('`custom.globtest-966.*` matches the prefix and nothing else', async () => {
      const listed = await service.list({ eventType: ['custom.globtest-966.*' as EventType], limit: 50 });
      const ids = listed.items.map((e) => e.id);
      expect(ids).toContain(alphaId);
      expect(ids).toContain(betaId);
      expect(ids).not.toContain(outsiderId);
    });

    test('a mixed exact + glob list ORs the two', async () => {
      const listed = await service.list({
        eventType: ['custom.other-966.gamma' as EventType, 'custom.globtest-966.*' as EventType],
        limit: 50,
      });
      const ids = listed.items.map((e) => e.id);
      expect(ids).toEqual(expect.arrayContaining([alphaId, betaId, outsiderId]));
    });

    test('LIKE wildcards in the prefix are escaped, not interpreted', async () => {
      // `custom.glob_est-966.*` must NOT match custom.globtest-966.* rows —
      // `_` is a literal underscore in the glob contract, not any-one-char.
      const listed = await service.list({ eventType: ['custom.glob_est-966.*' as EventType], limit: 50 });
      expect(listed.items.map((e) => e.id)).not.toContain(alphaId);
    });

    test('an exact type filter still requires the full type', async () => {
      const listed = await service.list({ eventType: ['custom.globtest-966' as EventType], limit: 50 });
      expect(listed.items).toHaveLength(0);
    });

    test('excludeEventType drops matching globs; exclusion wins over inclusion (#1078)', async () => {
      const listed = await service.list({
        eventType: ['custom.globtest-966.*' as EventType],
        excludeEventType: ['custom.globtest-966.beta', 'custom.other-966.*'],
        limit: 50,
      });
      const ids = listed.items.map((e) => e.id);
      expect(ids).toContain(alphaId);
      expect(ids).not.toContain(betaId);
      expect(ids).not.toContain(outsiderId);

      const excludeOnly = await service.list({ excludeEventType: ['custom.globtest-966.*'], limit: 200 });
      const excludeOnlyIds = excludeOnly.items.map((e) => e.id);
      expect(excludeOnlyIds).not.toContain(alphaId);
      expect(excludeOnlyIds).not.toContain(betaId);
      expect(excludeOnlyIds).toContain(outsiderId);
    });
  });
});
