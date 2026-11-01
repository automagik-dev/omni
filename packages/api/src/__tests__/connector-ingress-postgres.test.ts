/**
 * ClickUp connector acceptance loop over REAL PostgreSQL (design §10).
 *
 * This is the proof the fake-DB unit suite cannot give: the
 * `omni_events.idempotency_key` unique index is the dedupe authority, one
 * signed delivery produces exactly one internal `connector.event`, the target
 * automation runs through the real automation engine, and the injected ClickUp
 * transport receives exactly one `POST /task/{id}/comment`. A provider
 * redelivery is a duplicate with no second run; an operator replay deliberately
 * runs it again. No `instances`, `chats` or `messages` row is created.
 *
 * Requires a DISPOSABLE superuser URL (`OMNI_G4_POSTGRES_URL`); the pg-gate
 * provisions one. Skipped otherwise, like every `*-postgres.test.ts` here.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';
import {
  CONNECTOR_EVENT_TYPE,
  CURRENT_ENVELOPE_VERSION,
  type ConnectorEventPublisher,
  type EventBus,
  type GenericEventHandler,
  type OmniEvent,
  createAutomationEngine,
  createTemplateContext,
  executeAction,
  isConnectorEventType,
} from '@omni/core';
import {
  type Database,
  automations,
  chats,
  createDbHandle,
  deadLetterEvents,
  instances,
  messages,
  omniEvents,
  tenants,
} from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { buildAutomationEngineDeps } from '../plugins/automation-actions';
import { createServices } from '../services';
import { ConnectorService } from '../services/connectors';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const SECRET = 'clickup-connector-acceptance-secret';
const TOKEN = 'pk_connector_acceptance_token';
const BODY = JSON.stringify({
  event: 'taskStatusUpdated',
  task_id: 'task-1',
  history_items: [{ id: 'history-acceptance-1', date: 1_780_000_000_000, field: 'status', after: 'done' }],
});

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

interface CommentRequest {
  url: string;
  body: string;
}

/** Minimal in-memory pub/sub: publish awaits every matching subscriber, like NATS ack-after-handle. */
function inMemoryBus(): {
  bus: EventBus & ConnectorEventPublisher;
  handlers: Array<{ pattern: string; handler: GenericEventHandler }>;
  journal: OmniEvent[];
} {
  const journal: OmniEvent[] = [];
  const handlers: Array<{ pattern: string; handler: GenericEventHandler }> = [];
  const publishInternal: EventBus['publishGeneric'] = async (type, payload, metadata) => {
    const id = (metadata?.publishEventId as string | undefined) ?? randomUUID();
    const event = { id, type, payload, metadata: { correlationId: id, ...metadata }, timestamp: Date.now() };
    journal.push(event);
    for (const { pattern, handler } of handlers) {
      const matches = pattern.endsWith('.>')
        ? type === pattern.slice(0, -2) || type.startsWith(`${pattern.slice(0, -2)}.`)
        : pattern === type;
      if (matches) await handler(event);
    }
    return { id, sequence: 0, stream: '' };
  };
  const bus: EventBus & ConnectorEventPublisher = {
    async connect() {},
    async publish() {
      return { id: '', sequence: 0, stream: '' };
    },
    async publishGeneric(type, payload, metadata) {
      if (isConnectorEventType(type)) throw new Error('Connector events require publishConnector');
      return publishInternal(type, payload, metadata);
    },
    async publishConnector(
      type: `connector.${string}`,
      payload: Record<string, unknown>,
      metadata: { publishEventId: string },
    ) {
      return publishInternal(type, payload, metadata);
    },
    async subscribe() {
      return { id: randomUUID(), pattern: '', unsubscribe: async () => {} };
    },
    async subscribePattern(pattern: string, handler: GenericEventHandler) {
      handlers.push({ pattern, handler });
      return { id: randomUUID(), pattern, unsubscribe: async () => {} };
    },
    async subscribeMany() {
      return { id: randomUUID(), pattern: '', unsubscribe: async () => {} };
    },
    async subscribeAll() {
      return { id: randomUUID(), pattern: '', unsubscribe: async () => {} };
    },
    async close() {},
    isConnected: () => true,
  };
  return { bus, handlers, journal };
}

async function assertForeignTenantRetryRefused(
  db: Database,
  deadLetters: ReturnType<typeof createServices>['deadLetters'],
  eventId: string,
  tenantIds: string[],
): Promise<void> {
  // Both INSERT triggers clear caller ownership. Seed persisted DLQ ownership
  // by UPDATE, as the enforced-RLS fixtures do, leaving the journal unchanged.
  for (const tenantId of tenantIds) {
    const [dead] = await db
      .insert(deadLetterEvents)
      .values({
        eventId,
        eventType: 'connector.event',
        tenantId,
        subject: 'connector.event',
        payload: {},
        error: 'legacy tenant mismatch',
      })
      .returning();
    if (!dead) throw new Error('missing tenant-mismatched DLQ row');
    const [owned] = await db
      .update(deadLetterEvents)
      .set({ tenantId })
      .where(eq(deadLetterEvents.id, dead.id))
      .returning();
    expect(owned?.tenantId).toBe(tenantId);
    expect((await deadLetters.retry(dead.id)).success).toBe(false);
  }
}

postgresDescribe('ClickUp connector acceptance loop (real PostgreSQL)', () => {
  const dbName = `omni_connector_slice_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let handle: ReturnType<typeof createDbHandle> | null = null;
  let db: Database;
  const commentRequests: CommentRequest[] = [];
  let bus: EventBus & ConnectorEventPublisher;
  let stopEngine: (() => Promise<void>) | null = null;

  const fakeClickUpFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/team')) {
      return new Response(JSON.stringify({ teams: [{ id: '123', name: 'Acme' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/task/') && url.endsWith('/comment')) {
      commentRequests.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      return new Response(JSON.stringify({ id: 'comment-1', text: 'Done' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ err: 'unexpected URL' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 4 });
    db = handle.db;
    const inMemory = inMemoryBus();
    bus = inMemory.bus;

    const services = createServices(db, bus);
    // Inject the fake ClickUp transport into the real service.
    (services as unknown as { connectors: ConnectorService }).connectors = new ConnectorService(
      db,
      bus,
      new ConnectorRegistry([clickupManifest]),
      { fetch: fakeClickUpFetch },
    );

    const connector = await services.connectors.create(
      { provider: 'clickup', name: 'ClickUp acceptance', credentials: { token: TOKEN }, config: {} },
      'acceptance-test',
    );
    expect(connector.status).toBe('connected');

    const [automation] = await db
      .insert(automations)
      .values({
        name: 'Comment on done tasks',
        triggerEventType: CONNECTOR_EVENT_TYPE,
        actions: [
          {
            type: 'connector.call',
            config: {
              connectorId: connector.id,
              action: 'add_comment',
              input: { taskId: '{{payload.task_id}}', comment: 'Done' },
            },
          },
        ],
        enabled: true,
      } as never)
      .returning();
    if (!automation) throw new Error('automation insert returned nothing');

    const subscription = await services.connectors.createSubscription(connector.id, {
      eventKey: 'taskStatusUpdated',
      targetAutomationId: automation.id,
      verificationSecret: SECRET,
    });

    await services.automations.startEngine(buildAutomationEngineDeps(services, db));
    stopEngine = async () => {
      await services.automations.stopEngine();
    };

    // Stash the ids for the tests through module-level variables.
    ids = { connectorId: connector.id, subscriptionId: subscription.id, automationId: automation.id };
  }, 180_000);

  afterAll(async () => {
    await stopEngine?.().catch(() => undefined);
    await handle?.close().catch(() => undefined);
    const dbUrl = urlFor(superUrl, 'postgres');
    // Drop through the same psql binary the provisioner used.
    const { spawnSync } = await import('node:child_process');
    spawnSync(psqlBin, ['-X', '--no-psqlrc', '-c', `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`, dbUrl], {
      stdio: 'ignore',
    });
  });

  let ids: { connectorId: string; subscriptionId: string; automationId: string };

  async function deliver(): Promise<{ status: number; body: Record<string, unknown> }> {
    const services = createServices(db, bus);
    (services as unknown as { connectors: ConnectorService }).connectors = new ConnectorService(
      db,
      bus,
      new ConnectorRegistry([clickupManifest]),
      { fetch: fakeClickUpFetch },
    );
    return services.connectors.receive(ids.subscriptionId, BODY, { 'x-signature': sign(BODY) });
  }

  test('one signed delivery journals one connector.event and posts one comment', async () => {
    const result = await deliver();
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ received: true });

    const rows = await db
      .select()
      .from(omniEvents)
      .where(eq(omniEvents.idempotencyKey, `connector:${ids.subscriptionId}:history-acceptance-1`));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel).toBe('internal');
    expect(rows[0]?.eventType).toBe('connector.event');
    expect(rows[0]?.chatId).toBeNull();
    expect(rows[0]?.personId).toBeNull();

    expect(commentRequests).toHaveLength(1);
    expect(commentRequests[0]?.url).toContain('/task/task-1/comment');
    expect(JSON.parse(commentRequests[0]?.body ?? '{}')).toMatchObject({ comment_text: 'Done' });

    expect(await db.select().from(instances)).toHaveLength(0);
    expect(await db.select().from(chats)).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  test('a provider redelivery is a duplicate and does not run again', async () => {
    const result = await deliver();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ received: true, duplicate: true });
    expect(commentRequests).toHaveLength(1);
    const rows = await db
      .select()
      .from(omniEvents)
      .where(eq(omniEvents.idempotencyKey, `connector:${ids.subscriptionId}:history-acceptance-1`));
    expect(rows).toHaveLength(1);
  });

  test('an operator replay deliberately runs the automation again', async () => {
    const [row] = await db
      .select()
      .from(omniEvents)
      .where(eq(omniEvents.idempotencyKey, `connector:${ids.subscriptionId}:history-acceptance-1`));
    if (!row) throw new Error('missing journal row');
    await bus.publishConnector('connector.event', row.rawPayload as Record<string, unknown>, {
      publishEventId: randomUUID(),
      source: 'replay',
    });
    expect(commentRequests).toHaveLength(2);
  });

  test('connector dead letters and replay require journal provenance, never stored target claims', async () => {
    const [row] = await db
      .select()
      .from(omniEvents)
      .where(eq(omniEvents.idempotencyKey, `connector:${ids.subscriptionId}:history-acceptance-1`));
    if (!row?.rawPayload) throw new Error('missing real ClickUp ingress row');
    const tenantRows = await db
      .insert(tenants)
      .values(
        ['retry-a', 'retry-b'].map((slug) => ({
          slug,
          displayName: slug,
          maxKeyTtlSeconds: 3600,
          maxKeyRateLimit: 100,
          maxKeyBudget: 100,
        })),
      )
      .returning();
    const { bus: retryBus, journal } = inMemoryBus();
    const services = createServices(db, retryBus);
    const engine = createAutomationEngine({ reconcileIntervalMs: 0 });
    const fired: string[] = [];
    const targetA = ids.automationId;
    const targetB = randomUUID();
    const targets = [targetA, targetB].map((id, index) => ({
      id,
      name: id,
      tenantId: tenantRows[index]?.id,
      description: null,
      triggerEventType: 'connector.event',
      triggerConditions: [],
      conditionLogic: 'and' as const,
      enabled: true,
      priority: 0,
      debounce: null,
      actions: [{ type: 'log' as const, config: { message: id, level: 'info' as const } }],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    engine.setLogger(async (entry) => {
      fired.push(entry.automationId);
    });
    await engine.start(retryBus, targets, {});
    try {
      for (const tenant of tenantRows) {
        const [forged] = await db
          .insert(deadLetterEvents)
          .values({
            eventId: randomUUID(),
            eventType: 'connector.event',
            tenantId: tenant.id,
            subject: 'connector.event',
            payload: { targetAutomationId: targetB, targetAutomationIds: [targetA, targetB] },
            error: 'publish_not_declared: legacy stored emission',
            nextAutoRetryAt: new Date(0),
          })
          .returning();
        if (!forged) throw new Error('missing forged DLQ row');
        const [owned] = await db
          .update(deadLetterEvents)
          .set({ tenantId: tenant.id })
          .where(eq(deadLetterEvents.id, forged.id))
          .returning();
        expect(owned?.tenantId).toBe(tenant.id);
        const manual = await services.deadLetters.retry(forged.id);
        expect(manual.success).toBe(false);
        expect(manual.error).toContain('ingress-written journal provenance');
        expect((await services.deadLetters.getById(forged.id)).error).toContain('[Manual-retry]');
        expect((await services.deadLetters.getById(forged.id)).nextAutoRetryAt).toBeNull();
        await db
          .update(deadLetterEvents)
          .set({ nextAutoRetryAt: new Date(0) })
          .where(eq(deadLetterEvents.id, forged.id));
        const auto = await services.deadLetters.processAutoRetries();
        expect(auto.succeeded).toBe(0);
        expect(auto.failed).toBe(0);
        expect((await services.deadLetters.getById(forged.id)).error).toContain('[Auto-retry');
        expect((await services.deadLetters.getById(forged.id)).nextAutoRetryAt).toBeNull();
      }
      expect(fired).toEqual([]);
      expect(journal.filter((event) => event.type.startsWith('connector.'))).toEqual([]);

      // Even complete-looking metadata cannot bless a non-ingress row or another tenant.
      for (const mutation of [
        { idempotencyKey: 'emit:forged' },
        { idempotencyKey: 'connector:' },
        { idempotencyKey: 'connector::delivery' },
        { idempotencyKey: 'connector:subscription:' },
        { eventType: 'custom.forged' as const },
        { metadata: { ...row.metadata, source: 'automation' } },
        { metadata: { ...row.metadata, fullEventType: 'connector.other' } },
        { metadata: { ...row.metadata, subscriptionId: undefined } },
      ]) {
        const eventId = randomUUID();
        await db.insert(omniEvents).values({
          id: eventId,
          channel: 'internal',
          eventType: 'connector.event',
          idempotencyKey: `connector:${eventId}:forged`,
          rawPayload: row.rawPayload,
          metadata: row.metadata,
          ...mutation,
        });
        const dead = await services.deadLetters.createSchemaValidationFailure({
          eventId,
          eventType: 'connector.event',
          subject: 'connector.event',
          payload: { targetAutomationId: targetB },
          errors: ['legacy'],
        });
        expect((await services.deadLetters.retry(dead.id)).success).toBe(false);
      }
      await assertForeignTenantRetryRefused(
        db,
        services.deadLetters,
        row.id,
        tenantRows.map((tenant) => tenant.id),
      );
      expect(fired).toEqual([]);

      // A real ingress row overrides the stored payload, including nested envelopes.
      const realDead = await services.deadLetters.create({
        event: {
          id: row.id,
          type: 'connector.event',
          payload: { targetAutomationId: targetB },
          metadata: { correlationId: row.id },
          timestamp: Date.now(),
        },
        subject: 'connector.event',
        error: new Error('consumer failed'),
        retryCount: 0,
      });
      expect((await services.deadLetters.retry(realDead.id)).success).toBe(true);
      expect(fired).toEqual([targetA]);
      const retried = journal.find((event) => event.id === row.id);
      expect(retried?.payload).toEqual(row.rawPayload);
      expect(retried?.id).toBe(row.id);

      const autoDead = await services.deadLetters.create({
        event: {
          id: row.id,
          type: 'connector.event',
          payload: { targetAutomationId: targetB },
          metadata: { correlationId: row.id },
          timestamp: Date.now(),
        },
        subject: 'connector.event',
        error: new Error('consumer failed again'),
        retryCount: 0,
      });
      await db
        .update(deadLetterEvents)
        .set({ nextAutoRetryAt: new Date(0) })
        .where(eq(deadLetterEvents.id, autoDead.id));
      expect((await services.deadLetters.processAutoRetries()).succeeded).toBe(1);
      expect(fired).toEqual([targetA, targetA]);

      const session = await services.eventOps.startReplay({
        since: new Date(0),
        eventTypes: ['connector.event'],
        speedMultiplier: 0,
      });
      const deadline = Date.now() + 10000;
      while (session.status === 'running' && Date.now() < deadline) await Bun.sleep(10);
      expect(session.status).toBe('completed');
      expect(session.progress.processed).toBe(1);
      expect(session.progress.skipped).toBeGreaterThan(0);
      const replayed = journal.filter(
        (event) => event.metadata.source === 'replay' && event.type === 'connector.event',
      );
      expect(replayed).toHaveLength(1);
      expect(replayed[0]?.id).toBe(row.id);
      expect(replayed[0]?.payload).toMatchObject({ targetAutomationId: targetA, subscriptionId: ids.subscriptionId });
      expect(fired).toEqual([targetA, targetA, targetA]);

      // Future typed ingress uses the same provenance path and array membership.
      const typedId = randomUUID();
      const typedName = 'connector.gitlab.merge_request.merged';
      const typedPayload = {
        connectorId: ids.connectorId,
        subscriptionIds: [ids.subscriptionId],
        targetAutomationIds: [targetA],
        providerField: 'once',
      };
      await db.insert(omniEvents).values({
        id: typedId,
        channel: 'internal',
        eventType: sql`${typedName}`,
        idempotencyKey: `connector:${ids.connectorId}:typed-proof`,
        rawPayload: typedPayload,
        metadata: {
          source: 'connector',
          connectorId: ids.connectorId,
          provider: 'gitlab',
          fullEventType: typedName,
          subscriptionIds: [ids.subscriptionId],
        },
      });
      const typedDead = await services.deadLetters.createSchemaValidationFailure({
        eventId: typedId,
        eventType: typedName,
        subject: typedName,
        payload: { subscriptionIds: ['forged-subscription'], targetAutomationIds: [targetB] },
        errors: ['legacy'],
      });
      expect((await services.deadLetters.retry(typedDead.id)).success).toBe(true);
      expect(journal.find((event) => event.id === typedId)?.payload).toEqual(typedPayload);
      const typedSession = await services.eventOps.startReplay({
        since: new Date(0),
        eventTypes: [typedName],
        speedMultiplier: 0,
      });
      const typedDeadline = Date.now() + 10000;
      while (typedSession.status === 'running' && Date.now() < typedDeadline) await Bun.sleep(10);
      expect(typedSession.status).toBe('completed');
      expect(typedSession.progress.processed).toBe(1);
      expect(journal.filter((event) => event.id === typedId && event.metadata.source === 'replay')).toHaveLength(1);

      // The emission refusal precedes the real API gates that would create a DLQ.
      for (const type of ['connector.event', 'connector.gitlab.merge_request.merged']) {
        const before = await db.select().from(deadLetterEvents);
        const result = await executeAction(
          {
            type: 'emit_event',
            config: {
              eventType: type,
              payloadTemplate: { targetAutomationId: targetB, targetAutomationIds: [targetB] },
            },
          },
          createTemplateContext({}),
          { ...buildAutomationEngineDeps(services, db), eventBus: retryBus },
        );
        expect(result.status).toBe('failed');
        expect(await db.select().from(deadLetterEvents)).toEqual(before);
      }
    } finally {
      await engine.stop();
    }
  }, 30000);

  test('a real NULL-tenant dead letter retries tenant-owned ingress; a different tenant is refused', async () => {
    const [owner, other] = await db
      .insert(tenants)
      .values(
        ['retry-owner', 'retry-other'].map((slug) => ({
          slug,
          displayName: slug,
          maxKeyTtlSeconds: 3600,
          maxKeyRateLimit: 100,
          maxKeyBudget: 100,
        })),
      )
      .returning();
    if (!owner || !other) throw new Error('missing retry tenants');
    const [automation] = await db
      .insert(automations)
      .values({ name: 'Tenant retry target', triggerEventType: CONNECTOR_EVENT_TYPE, actions: [], enabled: true })
      .returning();
    if (!automation) throw new Error('missing retry target');
    await db.update(automations).set({ tenantId: owner.id }).where(eq(automations.id, automation.id));
    const { bus: retryBus, journal } = inMemoryBus();
    const ingress = new ConnectorService(db, retryBus, new ConnectorRegistry([clickupManifest]), {
      fetch: fakeClickUpFetch,
    });
    const subscription = await runTenantWorkDb(db, owner.id, async () => {
      const connector = await ingress.create({
        provider: 'clickup',
        name: 'Tenant retry connector',
        credentials: { token: TOKEN },
        config: {},
      });
      return ingress.createSubscription(connector.id, {
        eventKey: 'taskStatusUpdated',
        targetAutomationId: automation.id,
        verificationSecret: SECRET,
      });
    });
    expect((await ingress.receive(subscription.id, BODY, { 'x-signature': sign(BODY) })).status).toBe(202);
    const [row] = await db
      .select()
      .from(omniEvents)
      .where(eq(omniEvents.idempotencyKey, `connector:${subscription.id}:history-acceptance-1`));
    if (!row) throw new Error('missing tenant-owned ingress journal');
    expect(row.tenantId).toBe(owner.id);
    const services = createServices(db, retryBus);
    const createRealDeadLetter = () =>
      services.deadLetters.create({
        event: {
          id: row.id,
          type: CONNECTOR_EVENT_TYPE,
          payload: { targetAutomationId: 'forged-target' },
          metadata: { correlationId: row.id, tenantId: owner.id, envelopeVersion: CURRENT_ENVELOPE_VERSION },
          timestamp: Date.now(),
        },
        subject: CONNECTOR_EVENT_TYPE,
        error: new Error('consumer failed'),
        retryCount: 0,
      });
    const manual = await createRealDeadLetter();
    const [stored] = await db.select().from(deadLetterEvents).where(eq(deadLetterEvents.id, manual.id));
    expect(stored?.tenantId).toBeNull();
    expect((await services.deadLetters.retry(manual.id)).success).toBe(true);
    expect(journal.at(-1)).toMatchObject({
      id: row.id,
      payload: row.rawPayload,
      metadata: { tenantId: owner.id },
    });
    const auto = await createRealDeadLetter();
    await db
      .update(deadLetterEvents)
      .set({ nextAutoRetryAt: new Date(0) })
      .where(eq(deadLetterEvents.id, auto.id));
    expect((await services.deadLetters.processAutoRetries()).succeeded).toBe(1);
    expect(journal.at(-1)).toMatchObject({ id: row.id, payload: row.rawPayload, metadata: { tenantId: owner.id } });
    const before = journal.filter((event) => event.type.startsWith('connector.')).length;
    await assertForeignTenantRetryRefused(db, services.deadLetters, row.id, [other.id]);
    expect(journal.filter((event) => event.type.startsWith('connector.'))).toHaveLength(before);
  }, 30000);
});
