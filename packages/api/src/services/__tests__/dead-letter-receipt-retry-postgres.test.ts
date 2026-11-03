/**
 * A retried generic dead letter republishes the ORIGINAL event: its payload
 * (not the stored envelope) and its instance metadata, so event-persistence
 * matches the original instance's row instead of filing a NULL-instance one.
 * The tenant always comes from the dead-letter row, never the stored envelope.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  type ConnectorEventPublisher,
  type EventBus,
  type EventType,
  type OmniEvent,
  setEnvelopeInstanceTenantResolver,
} from '@omni/core';
import {
  type Database,
  type NewOmniEvent,
  createDbHandle,
  deadLetterEvents,
  instances,
  omniEvents,
  tenants,
} from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { setupEventPersistence } from '../../plugins/event-persistence';
import {
  __resetInstanceOwnerRegistry,
  installInstanceOwnerResolver,
  rememberInstanceOwners,
} from '../../tenancy/instance-owner-registry';
import { DeadLetterService } from '../dead-letters';

// API unit tests can mock @omni/core process-wide in the single-process sweep.
// @ts-expect-error Bun supports query-suffixed imports; TypeScript does not resolve them.
const realFactory = await import('../../../../core/src/events/factory.ts?real-dlq-receipt-retry-test');
const createOmniEvent: typeof import('@omni/core')['createOmniEvent'] = realFactory.createOmniEvent;
const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

type Handler = (event: OmniEvent) => Promise<void>;

postgresDescribe('dead-letter retry restores the original event (legacy, real PostgreSQL)', () => {
  const dbName = `omni_dlq_receipt_${crypto.randomUUID().replaceAll('-', '')}`;
  const previous = {
    OMNI_MULTITENANCY_ENABLED: process.env.OMNI_MULTITENANCY_ENABLED,
    OMNI_DB_ENFORCEMENT: process.env.OMNI_DB_ENFORCEMENT,
  };
  const closers: Array<() => Promise<void>> = [];
  const handlers = new Map<string, Handler[]>();
  const deliveries: OmniEvent[] = [];
  let db: Database;
  let service: DeadLetterService;
  let instanceA: string;
  let instanceB: string;

  beforeAll(async () => {
    process.env.OMNI_MULTITENANCY_ENABLED = 'false';
    process.env.OMNI_DB_ENFORCEMENT = 'false';
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const admin = createDbHandle({ url: pgRoleUrl(superUrl, dbName) });
    closers.push(() => admin.close());
    db = admin.db;
    const register = async (pattern: string, handler: Handler) => {
      handlers.set(pattern, [...(handlers.get(pattern) ?? []), handler]);
      return { id: pattern, pattern, unsubscribe: async () => {} };
    };
    const bus = {
      connect: async () => {},
      close: async () => {},
      isConnected: () => true,
      subscribe: register,
      subscribePattern: register,
      subscribeMany: async () => ({ id: 'many', pattern: '', unsubscribe: async () => {} }),
      subscribeAll: async () => ({ id: 'all', pattern: '', unsubscribe: async () => {} }),
      publish: async () => {
        throw new Error('unexpected core publish');
      },
      publishConnector: async () => {
        throw new Error('unexpected connector publish');
      },
      // The NatsEventBus factory, then every exact-type durable, the way
      // JetStream fans one publish out to each consumer.
      publishGeneric: async (type: EventType, payload: unknown, metadata?: Partial<OmniEvent['metadata']>) => {
        if (type === 'system.dead_letter') return { id: crypto.randomUUID(), sequence: 0, stream: 'test' };
        const event = createOmniEvent(type, payload, metadata, 'dlq-receipt-retry-test');
        deliveries.push(event);
        for (const handler of handlers.get(type) ?? []) await handler(event);
        return { id: event.id, sequence: deliveries.length, stream: 'test' };
      },
    } as unknown as EventBus & ConnectorEventPublisher;
    await setupEventPersistence(bus, db);
    service = new DeadLetterService(db, bus);
    const [a, b] = await db
      .insert(instances)
      .values([
        { name: `dlq-receipt-a-${crypto.randomUUID()}`, channel: 'whatsapp-baileys' },
        { name: `dlq-receipt-b-${crypto.randomUUID()}`, channel: 'whatsapp-baileys' },
      ])
      .returning();
    if (!a || !b) throw new Error('missing test instances');
    instanceA = a.id;
    instanceB = b.id;
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

  beforeEach(() => {
    deliveries.length = 0;
  });

  /** The outbound message.sent row of each instance, sharing one provider message ID. */
  async function seedSentRows(externalId: string) {
    const rows = await db
      .insert(omniEvents)
      .values(
        [instanceA, instanceB].map(
          (instanceId): NewOmniEvent => ({
            externalId,
            channel: 'whatsapp-baileys',
            instanceId,
            eventType: 'message.sent',
            direction: 'outbound',
            chatId: 'chat-1',
            status: 'completed',
            receivedAt: new Date(),
          }),
        ),
      )
      .returning();
    const byInstance = new Map(rows.map((row) => [row.instanceId, row.id]));
    return { rowA: byInstance.get(instanceA) ?? '', rowB: byInstance.get(instanceB) ?? '' };
  }

  async function fileDeadLetter(
    type: EventType,
    payload: Record<string, unknown>,
    metadata: Partial<OmniEvent['metadata']>,
  ) {
    const original = createOmniEvent(type, payload, metadata, 'original-producer');
    const row = await service.create({
      event: original,
      subject: type,
      error: new Error('webhook failed'),
      retryCount: 3,
    });
    return { original, row };
  }

  async function retry(mode: 'manual' | 'auto', id: string) {
    if (mode === 'manual') return (await service.retry(id)).success;
    await db
      .update(deadLetterEvents)
      .set({ nextAutoRetryAt: new Date(0) })
      .where(eq(deadLetterEvents.id, id));
    return (await service.processAutoRetries()).succeeded === 1;
  }

  async function rowsFor(externalId: string) {
    return db.select().from(omniEvents).where(eq(omniEvents.externalId, externalId));
  }

  async function nullInstanceReceipts() {
    return db
      .select()
      .from(omniEvents)
      .where(and(isNull(omniEvents.instanceId), inArray(omniEvents.eventType, ['message.delivered', 'message.read'])));
  }

  const receipts = [
    { type: 'message.delivered', mode: 'manual', at: 'deliveredAt', column: 'deliveredAt' },
    { type: 'message.read', mode: 'auto', at: 'readAt', column: 'readAt' },
  ] as const;

  for (const receipt of receipts) {
    test(`${receipt.mode} retry of a ${receipt.type} dead letter updates only the original instance's row`, async () => {
      const externalId = `wamid-${crypto.randomUUID()}`;
      const { rowA, rowB } = await seedSentRows(externalId);
      const at = Date.now();
      const { original, row } = await fileDeadLetter(
        receipt.type,
        { externalId, chatId: 'chat-1', [receipt.at]: at },
        { instanceId: instanceA, channelType: 'whatsapp-baileys', correlationId: 'corr-receipt' },
      );

      expect(await retry(receipt.mode, row.id)).toBe(true);

      // The journal first: instance A's row is stamped, B's is not, no stray row.
      const rows = await rowsFor(externalId);
      expect(rows.find((r) => r.id === rowA)?.[receipt.column]?.getTime()).toBe(at);
      expect(rows.find((r) => r.id === rowB)?.[receipt.column]).toBeNull();
      expect(rows).toHaveLength(2);
      expect(await nullInstanceReceipts()).toHaveLength(0);
      const [retried] = deliveries;
      expect(retried?.id).toBe(row.id);
      expect(retried?.payload).toEqual(original.payload);
      expect(retried?.metadata).toMatchObject({
        instanceId: instanceA,
        channelType: 'whatsapp-baileys',
        correlationId: 'corr-receipt',
      });
    });
  }

  test('a retried receipt whose dead letter recorded no instance files no NULL-instance row', async () => {
    const externalId = `wamid-${crypto.randomUUID()}`;
    await seedSentRows(externalId);
    const { row } = await fileDeadLetter(
      'message.delivered',
      { externalId, chatId: 'chat-1', deliveredAt: Date.now() },
      { channelType: 'whatsapp-baileys' },
    );

    expect(await retry('manual', row.id)).toBe(true);

    expect(deliveries).toHaveLength(1);
    const rows = await rowsFor(externalId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.deliveredAt === null)).toBe(true);
    expect(await nullInstanceReceipts()).toHaveLength(0);
  });

  test('a row whose stored payload is the bare inner payload republishes it unchanged', async () => {
    const externalId = `wamid-${crypto.randomUUID()}`;
    await seedSentRows(externalId);
    // An older row shape: the event's own payload, no envelope around it. Keys
    // that look like an envelope but do not name this row are payload too.
    const shapes = [
      { type: 'custom.dlq-bare' as EventType, payload: { value: 'bare', id: 'not-this-row', type: 'custom.dlq-bare' } },
      { type: 'message.delivered' as EventType, payload: { externalId, chatId: 'chat-1', deliveredAt: Date.now() } },
    ];
    for (const shape of shapes) {
      const [row] = await db
        .insert(deadLetterEvents)
        .values({
          eventId: crypto.randomUUID(),
          eventType: shape.type,
          subject: shape.type,
          payload: shape.payload,
          error: 'webhook failed',
          autoRetryCount: 0,
          nextAutoRetryAt: null,
          status: 'pending',
        })
        .returning();
      if (!row) throw new Error('missing bare dead letter');
      expect(await retry('manual', row.id)).toBe(true);
      expect(deliveries.at(-1)?.payload).toEqual(shape.payload);
      expect(deliveries.at(-1)?.metadata.instanceId).toBeUndefined();
    }
    // The bare receipt names no instance: it stamps no row and files none.
    const rows = await rowsFor(externalId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.deliveredAt === null)).toBe(true);
    expect(await nullInstanceReceipts()).toHaveLength(0);
  });

  test('a retried non-receipt (message.sent) keeps its payload and instance scoping', async () => {
    const externalId = `wamid-${crypto.randomUUID()}`;
    const { original, row } = await fileDeadLetter(
      'message.sent',
      { externalId, chatId: 'chat-1', to: 'chat-1', content: { type: 'text', text: 'hello' } },
      { instanceId: instanceB, channelType: 'whatsapp-baileys', correlationId: 'corr-sent' },
    );

    expect(await retry('auto', row.id)).toBe(true);

    expect((deliveries[0]?.payload as { externalId?: string } | undefined)?.externalId).toBe(externalId);
    expect(deliveries[0]?.payload).toEqual(original.payload);
    expect(deliveries[0]?.metadata).toMatchObject({ instanceId: instanceB, correlationId: 'corr-sent' });
    const rows = await rowsFor(externalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: row.id,
      instanceId: instanceB,
      textContent: 'hello',
      eventType: 'message.sent',
    });
  });

  test('multitenancy without enforcement: a NULL-owned row naming an owned instance stays tenantless (#1566)', async () => {
    // Enforced RLS never retries a NULL-owned row; with enforcement off the
    // scheduler and manual retry still do, so this is where the rule bites.
    const owner = crypto.randomUUID();
    installInstanceOwnerResolver();
    rememberInstanceOwners([{ id: instanceA, tenantId: owner }]);
    process.env.OMNI_MULTITENANCY_ENABLED = 'true';
    try {
      const { row } = await fileDeadLetter(
        'custom.dlq-unowned-instance' as EventType,
        { value: 'unowned' },
        { instanceId: instanceA, correlationId: 'corr-unowned' },
      );
      expect(row.tenantId).toBeNull();
      expect(await retry('manual', row.id)).toBe(true);
      expect(deliveries.at(-1)?.id).toBe(row.id);
      expect(deliveries.at(-1)?.metadata.tenantId).toBeUndefined();
      expect(deliveries.at(-1)?.metadata.instanceId).toBeUndefined();
      expect(deliveries.at(-1)?.metadata.correlationId).toBe('corr-unowned');
    } finally {
      process.env.OMNI_MULTITENANCY_ENABLED = 'false';
      setEnvelopeInstanceTenantResolver(null);
      __resetInstanceOwnerRegistry();
    }
  });

  test('the retried event runs under the dead-letter row tenant, never the stored envelope tenant', async () => {
    const [owner, forged] = await db
      .insert(tenants)
      .values(
        ['dlq-owner', 'dlq-forged'].map((slug) => ({
          slug: `${slug}-${crypto.randomUUID().slice(0, 8)}`,
          displayName: slug,
          maxKeyTtlSeconds: 3600,
          maxKeyRateLimit: 100,
          maxKeyBudget: 100,
        })),
      )
      .returning();
    if (!owner || !forged) throw new Error('missing tenants');
    const type = 'custom.dlq-tenant' as EventType;
    const metadata = { correlationId: 'corr-tenant', tenantId: forged.id, envelopeVersion: 1 };

    // Legacy row: no persisted owner, so the retry carries no tenant at all.
    const unowned = await fileDeadLetter(type, { value: 'legacy' }, metadata);
    expect(unowned.row.tenantId).toBeNull();
    expect(unowned.original.metadata.tenantId).toBe(forged.id);
    expect(await retry('manual', unowned.row.id)).toBe(true);
    expect(deliveries.at(-1)?.payload).toEqual({ value: 'legacy' });
    expect(deliveries.at(-1)?.metadata.tenantId).toBeUndefined();

    // Owned row: the persisted tenant_id wins over the stored envelope's claim.
    const owned = await fileDeadLetter(type, { value: 'owned' }, metadata);
    await db.update(deadLetterEvents).set({ tenantId: owner.id }).where(eq(deadLetterEvents.id, owned.row.id));
    expect(await retry('manual', owned.row.id)).toBe(true);
    expect(deliveries.at(-1)?.payload).toEqual({ value: 'owned' });
    expect(deliveries.at(-1)?.metadata.tenantId).toBe(owner.id);
  });
});
