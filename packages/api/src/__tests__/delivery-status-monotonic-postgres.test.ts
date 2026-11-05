/**
 * Delivery receipts never move a message backwards (N1/N2 of the #1287 review).
 *
 * Drives the REAL receipt consumers (message-persistence and event-persistence,
 * through a capture bus) under the runtime role, in legacy mode and with
 * enforced RLS, against a disposable PostgreSQL:
 *
 *   - messages.delivery_status only moves forward: pending < sent < delivered < read;
 *     the failed rules stay as they were (#1277);
 *   - omni_events: delivered_at / read_at are set once, a delivered receipt
 *     never flips a failed or read row, and a receipt only reaches rows of its
 *     own instance;
 *   - every receipt costs the same statements as before the guard, including
 *     the receipts the guard turns into no-ops.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CURRENT_ENVELOPE_VERSION, type EventBus } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  type DeliveryStatus,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  assertEnforcedRuntimeIdentity,
  createDbHandle,
  instances,
  messages,
  omniEvents,
} from '@omni/db';
import {
  assertPgTestRole,
  connectorIngressFunctionStatements,
  connectorIngressRoleStatements,
  contextFunctionStatements,
  pgRoleUrl,
  provisionMigratedDatabase,
} from '@omni/db/pg-migrated-template';
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { and, eq } from 'drizzle-orm';
import { setupEventPersistence } from '../plugins/event-persistence';
import { setupMessagePersistence } from '../plugins/message-persistence';
import { type Services, createServices } from '../services';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const maybe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaada1';
const JID = '5511988887777@s.whatsapp.net';
const T1 = Date.parse('2026-11-03T10:00:00.000Z');
const T2 = Date.parse('2026-11-03T10:05:00.000Z');
const T3 = Date.parse('2026-11-03T10:10:00.000Z');

/**
 * Statements one receipt costs, measured on the base commit (before the guard).
 * A guarded receipt that changes nothing must cost exactly the same.
 */
const STATEMENTS = {
  legacy: { messageReceipt: 3, eventReceipt: 1 },
  enforced: { messageReceipt: 6, eventReceipt: 4 },
} as const;

type Handler = (event: unknown) => Promise<void>;

function captureBus() {
  const handlers = new Map<string, Handler>();
  const bus = {
    subscribe: async (type: string, handler: Handler) => {
      handlers.set(type, handler);
    },
    subscribePattern: async () => undefined,
    publish: async () => undefined,
  } as unknown as EventBus;
  const fire = (type: string, event: unknown): Promise<void> => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no handler for ${type}`);
    return handler(event);
  };
  return { bus, fire };
}

for (const mode of ['legacy', 'enforced'] as const) {
  maybe(`delivery status is monotonic (${mode}, real PostgreSQL)`, () => {
    const database = `omni_delivery_monotonic_${crypto.randomUUID().replaceAll('-', '')}`;
    const envKeys = ['OMNI_MULTITENANCY_ENABLED', 'OMNI_DB_ENFORCEMENT', 'OMNI_PAIRED_AGENT_CONSUMERS'] as const;
    const previous = envKeys.map((key) => [key, process.env[key]] as const);
    const tenantMode = mode === 'enforced';
    const closers: Array<() => Promise<void>> = [];
    const queries: string[] = [];
    const messageBus = captureBus();
    const eventBus = captureBus();
    let db: Database;
    let services: Services;
    let instanceA: string;
    let instanceB: string;

    const scope = <T>(fn: () => Promise<T>) => (tenantMode ? runInWorkerTenantScope(db, TENANT, fn) : fn());

    beforeAll(async () => {
      process.env.OMNI_MULTITENANCY_ENABLED = String(tenantMode);
      process.env.OMNI_DB_ENFORCEMENT = tenantMode ? 'on' : 'false';
      process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'false';
      provisionMigratedDatabase({ superUrl, psqlBin }, database);
      const owner = createDbHandle({ url: pgRoleUrl(superUrl, database) });
      closers.push(owner.close);
      const admin = owner.db;
      await admin.execute(`INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget)
        VALUES ('${TENANT}', 'delivery-monotonic', 'Delivery Monotonic', 86400, 1000, 1000)`);
      // Two instances of ONE tenant: RLS cannot separate them, only the receipt's instance can.
      const [a, b] = await admin
        .insert(instances)
        .values([
          { name: 'delivery-a', channel: 'whatsapp-baileys', ...(tenantMode ? { tenantId: TENANT } : {}) },
          { name: 'delivery-b', channel: 'whatsapp-baileys', ...(tenantMode ? { tenantId: TENANT } : {}) },
        ])
        .returning();
      if (!a || !b) throw new Error('missing instance fixtures');
      instanceA = a.id;
      instanceB = b.id;

      const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
      if (tenantMode) await applyTenantRlsEnforcement(admin);
      else {
        for (const statement of [
          ...connectorIngressRoleStatements(),
          ...contextFunctionStatements(),
          ...connectorIngressFunctionStatements(),
        ])
          await admin.execute(statement);
      }
      await applyTenancyRoles(admin, passwords, DEFAULT_ROLE_NAMES, database);
      const runtime = createDbHandle({
        url: pgRoleUrl(superUrl, database, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
        maxConnections: 2,
      });
      closers.push(runtime.close);
      db = runtime.db;
      db.$client.options.debug = (_connection, query) => {
        queries.push(query);
      };
      await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
      if (tenantMode) expect((await assertEnforcedRuntimeIdentity(db)).currentUser).toBe(DEFAULT_ROLE_NAMES.runtime);

      services = createServices(db, null);
      await setupMessagePersistence(messageBus.bus, services);
      await setupEventPersistence(eventBus.bus, db);
    }, 180_000);

    afterAll(async () => {
      for (const close of closers.reverse()) await close();
      dropDatabaseOrThrow({ superUrl, psqlBin }, database);
      for (const [key, value] of previous) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    });

    function receipt(
      type: 'message.delivered' | 'message.read' | 'message.failed',
      externalId: string,
      at: number,
      instanceId = instanceA,
    ): unknown {
      const id = crypto.randomUUID();
      const payload =
        type === 'message.failed'
          ? { externalId, chatId: JID, error: 'Delivery failed', errorCode: 'TEST', retryable: false }
          : type === 'message.delivered'
            ? { externalId, chatId: JID, deliveredAt: at }
            : { externalId, chatId: JID, readAt: at };
      return {
        id,
        type,
        timestamp: at,
        payload,
        metadata: {
          correlationId: id,
          instanceId,
          channelType: 'whatsapp-baileys',
          ...(tenantMode ? { tenantId: TENANT, envelopeVersion: CURRENT_ENVELOPE_VERSION } : {}),
        },
      };
    }

    /** Fire one receipt at one consumer and return the statements it sent. */
    async function fire(
      bus: 'messages' | 'events',
      type: Parameters<typeof receipt>[0],
      externalId: string,
      at: number,
      instanceId = instanceA,
    ) {
      queries.length = 0;
      await (bus === 'messages' ? messageBus : eventBus).fire(type, receipt(type, externalId, at, instanceId));
      return [...queries];
    }

    async function outboundMessage(externalId: string) {
      return scope(async () => {
        const { chat } = await services.chats.findOrCreate(instanceA, JID, {
          chatType: 'dm',
          channel: 'whatsapp-baileys',
        });
        return services.messages.create({
          chatId: chat.id,
          externalId,
          source: 'realtime',
          messageType: 'text',
          textContent: 'Will it arrive?',
          platformTimestamp: new Date(T1),
          isFromMe: true,
        });
      });
    }

    const messageRow = async (id: string) => {
      const [row] = await scope(() => scopedHandle(db).select().from(messages).where(eq(messages.id, id)));
      if (!row) throw new Error(`message ${id} not visible`);
      return row;
    };

    async function sentEvent(externalId: string, instanceId = instanceA) {
      await scope(() =>
        scopedHandle(db).insert(omniEvents).values({
          externalId,
          channel: 'whatsapp-baileys',
          instanceId,
          eventType: 'message.sent',
          direction: 'outbound',
          chatId: JID,
          status: 'completed',
        }),
      );
    }

    const eventRows = (externalId: string, instanceId = instanceA) =>
      scope(() =>
        scopedHandle(db)
          .select()
          .from(omniEvents)
          .where(and(eq(omniEvents.instanceId, instanceId), eq(omniEvents.externalId, externalId))),
      );

    const messageUpdates = (sent: string[]) => sent.filter((query) => query.startsWith('update "messages"'));

    describe('messages.delivery_status', () => {
      test('a forward receipt still costs one guarded UPDATE and the same statements as before', async () => {
        const message = await outboundMessage(`mono-${mode}-forward`);
        const delivered = await fire('messages', 'message.delivered', message.externalId, T1);
        expect((await messageRow(message.id)).deliveryStatus).toBe('delivered');
        expect(messageUpdates(delivered)).toHaveLength(1);
        expect(delivered).toHaveLength(STATEMENTS[mode].messageReceipt);

        const read = await fire('messages', 'message.read', message.externalId, T2);
        expect((await messageRow(message.id)).deliveryStatus).toBe('read');
        expect(messageUpdates(read)).toHaveLength(1);
        expect(read).toHaveLength(STATEMENTS[mode].messageReceipt);
      });

      test('read then a late delivered stays read, with no extra statement', async () => {
        const message = await outboundMessage(`mono-${mode}-read-delivered`);
        await fire('messages', 'message.read', message.externalId, T2);
        const before = await messageRow(message.id);
        expect(before.deliveryStatus).toBe('read');

        const late = await fire('messages', 'message.delivered', message.externalId, T1);
        const after = await messageRow(message.id);
        expect(after.deliveryStatus).toBe('read');
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(messageUpdates(late)).toHaveLength(1);
        expect(late).toHaveLength(STATEMENTS[mode].messageReceipt);
      });

      test('a redelivered delivered receipt writes nothing', async () => {
        const message = await outboundMessage(`mono-${mode}-delivered-twice`);
        await fire('messages', 'message.delivered', message.externalId, T1);
        const before = await messageRow(message.id);

        const again = await fire('messages', 'message.delivered', message.externalId, T2);
        const after = await messageRow(message.id);
        expect(after.deliveryStatus).toBe('delivered');
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(again).toHaveLength(STATEMENTS[mode].messageReceipt);
      });

      test('sent after delivered stays delivered (PATCH path returns the unchanged row)', async () => {
        const message = await outboundMessage(`mono-${mode}-sent-after`);
        await fire('messages', 'message.delivered', message.externalId, T1);

        const returned = await scope(() => services.messages.updateDeliveryStatus(message.id, 'sent'));
        expect(returned.id).toBe(message.id);
        expect(returned.deliveryStatus).toBe('delivered');
        expect((await messageRow(message.id)).deliveryStatus).toBe('delivered');

        const lower: DeliveryStatus[] = ['pending', 'sent', 'delivered'];
        for (const status of lower) {
          expect(await scope(() => services.messages.advanceDeliveryStatus(message.id, status))).toBeNull();
        }
      });

      test('failed rules are unchanged: failed after read keeps read, failed after sent fails', async () => {
        const read = await outboundMessage(`mono-${mode}-failed-after-read`);
        await fire('messages', 'message.read', read.externalId, T1);
        await fire('messages', 'message.failed', read.externalId, T2);
        expect((await messageRow(read.id)).deliveryStatus).toBe('read');

        const sent = await outboundMessage(`mono-${mode}-failed-after-sent`);
        await fire('messages', 'message.failed', sent.externalId, T1);
        expect((await messageRow(sent.id)).deliveryStatus).toBe('failed');
      });
    });

    describe('omni_events receipts', () => {
      test('a forward receipt still costs the same statements as before', async () => {
        const externalId = `mono-${mode}-ev-forward`;
        await sentEvent(externalId);
        const delivered = await fire('events', 'message.delivered', externalId, T1);
        expect(delivered.filter((query) => query.startsWith('update "omni_events"'))).toHaveLength(1);
        expect(delivered).toHaveLength(STATEMENTS[mode].eventReceipt);
        const read = await fire('events', 'message.read', externalId, T2);
        expect(read.filter((query) => query.startsWith('update "omni_events"'))).toHaveLength(1);
        expect(read).toHaveLength(STATEMENTS[mode].eventReceipt);

        const [row] = await eventRows(externalId);
        expect(row?.status).toBe('completed');
        expect(row?.deliveredAt?.getTime()).toBe(T1);
        expect(row?.readAt?.getTime()).toBe(T2);
      });

      test('delivered_at and read_at are set once; a redelivered receipt does not move them', async () => {
        const externalId = `mono-${mode}-ev-twice`;
        await sentEvent(externalId);
        await fire('events', 'message.delivered', externalId, T1);
        await fire('events', 'message.read', externalId, T2);
        const delivered = await fire('events', 'message.delivered', externalId, T3);
        const read = await fire('events', 'message.read', externalId, T3);
        expect(delivered).toHaveLength(STATEMENTS[mode].eventReceipt);
        expect(read).toHaveLength(STATEMENTS[mode].eventReceipt);

        const rows = await eventRows(externalId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.deliveredAt?.getTime()).toBe(T1);
        expect(rows[0]?.readAt?.getTime()).toBe(T2);
      });

      test('read then a late delivered keeps read_at and the status', async () => {
        const externalId = `mono-${mode}-ev-read-delivered`;
        await scope(() =>
          scopedHandle(db).insert(omniEvents).values({
            externalId,
            channel: 'whatsapp-baileys',
            instanceId: instanceA,
            eventType: 'message.sent',
            direction: 'outbound',
            chatId: JID,
            status: 'received',
          }),
        );
        await fire('events', 'message.read', externalId, T2);
        await fire('events', 'message.delivered', externalId, T1);

        const rows = await eventRows(externalId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.readAt?.getTime()).toBe(T2);
        expect(rows[0]?.status).toBe('received');
      });

      test('delivered after failed keeps failed and inserts no extra row', async () => {
        const externalId = `mono-${mode}-ev-failed-delivered`;
        await sentEvent(externalId);
        await fire('events', 'message.failed', externalId, T1);
        const late = await fire('events', 'message.delivered', externalId, T2);
        expect(late).toHaveLength(STATEMENTS[mode].eventReceipt);

        const rows = await eventRows(externalId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe('failed');
        expect(rows[0]?.errorMessage).toBe('Delivery failed');
      });

      test("a receipt for instance B never touches instance A's row; B still gets its own row", async () => {
        const externalId = `mono-${mode}-ev-instance`;
        await sentEvent(externalId, instanceA);
        await fire('events', 'message.delivered', externalId, T1, instanceB);
        await fire('events', 'message.read', externalId, T2, instanceB);

        const [rowA] = await eventRows(externalId, instanceA);
        expect(rowA?.status).toBe('completed');
        expect(rowA?.deliveredAt).toBeNull();
        expect(rowA?.readAt).toBeNull();

        // Insert-on-no-match is unchanged: B's receipts journal under B.
        const rowsB = await eventRows(externalId, instanceB);
        expect(rowsB.map((row) => row.eventType)).toEqual(['message.delivered']);
        expect(rowsB[0]?.deliveredAt?.getTime()).toBe(T1);
        expect(rowsB[0]?.readAt?.getTime()).toBe(T2);
      });
    });
  });
}
