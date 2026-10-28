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
import { CONNECTOR_EVENT_TYPE, type EventBus, type OmniEvent } from '@omni/core';
import { type Database, automations, chats, createDbHandle, instances, messages, omniEvents } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { buildAutomationEngineDeps } from '../plugins/automation-actions';
import { createServices } from '../services';
import { ConnectorService } from '../services/connectors';

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
  bus: EventBus;
  handlers: Array<{ pattern: string; handler: (event: OmniEvent) => Promise<void> }>;
} {
  const handlers: Array<{ pattern: string; handler: (event: OmniEvent) => Promise<void> }> = [];
  const bus = {
    async connect() {},
    async publish() {
      return { id: '', sequence: 0, stream: '' };
    },
    async publishGeneric(type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) {
      const id = (metadata?.publishEventId as string | undefined) ?? randomUUID();
      const event = {
        id,
        type,
        payload,
        metadata: { correlationId: id, ...metadata },
        timestamp: Date.now(),
      } as unknown as OmniEvent;
      for (const { pattern, handler } of handlers) {
        if (pattern.endsWith('.>') ? type.startsWith(pattern.slice(0, -1)) : pattern === type) {
          await handler(event);
        }
      }
      return { id, sequence: 0, stream: '' };
    },
    async subscribe() {
      return { id: randomUUID(), pattern: '', unsubscribe: async () => {} };
    },
    async subscribePattern(pattern: string, handler: (event: OmniEvent) => Promise<void>) {
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
  } as unknown as EventBus;
  return { bus, handlers };
}

postgresDescribe('ClickUp connector acceptance loop (real PostgreSQL)', () => {
  const dbName = `omni_connector_slice_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let handle: ReturnType<typeof createDbHandle> | null = null;
  let db: Database;
  const commentRequests: CommentRequest[] = [];
  let bus: EventBus;
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
    await bus.publishGeneric('connector.event', row.rawPayload as Record<string, unknown>, {
      publishEventId: randomUUID(),
      source: 'replay',
    });
    expect(commentRequests).toHaveLength(2);
  });
});
