import type { ConnectorEventPublisher, EventBus } from '@omni/core';
/**
 * Event schema registry gates over real PostgreSQL (issue #959, RFC #925 G1).
 *
 * Proves the acceptance criteria against a disposable database with every
 * migration applied (including 0056, which creates `event_schemas`):
 *
 *   * registering a schema then sending a violating payload through the
 *     generic ingress → dead_letter_events row with reason
 *     `schema_validation_failed` (manual-retry only) and NOTHING published to
 *     the journal;
 *   * the same for an automation `emit_event` with a registered type;
 *   * a webhook_source configured with header-based type mapping emits
 *     `custom.github.push`, not `custom.webhook.github`;
 *   * unregistered custom types still flow (opt-in registry, pass-through);
 *   * the evolution rule at register time: additive-optional revisions bump
 *     the version, incompatible replacements are refused with 409.
 *
 * Set `OMNI_G1_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { executeAction } from '@omni/core';
import { type Database, createDbHandle, deadLetterEvents, instances, omniEvents, tenants } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error';
import { scopeEnforcerMiddleware } from '../../middleware/scope-enforcer';
import { tenancyMiddleware } from '../../middleware/tenancy';
import { buildAutomationEngineDeps } from '../../plugins/automation-actions';
import { webhooksRoutes } from '../../routes/v2/webhooks';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import type { AppVariables } from '../../types';
import { DeadLetterService } from '../dead-letters';
import { EventSchemaService } from '../event-schemas';
import { type Services, createServices } from '../index';
import { WebhookService } from '../webhooks';

const superUrl = process.env.OMNI_G1_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G1_PSQL_BIN ?? 'psql';

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** An EventBus fake that records publishes — the journal, for assertions. */
function recordingBus(events: PublishedEvent[]): EventBus & ConnectorEventPublisher {
  return {
    connect: async () => {},
    close: async () => {},
    isConnected: () => true,
    publish: async () => {
      throw new Error('unexpected core publish');
    },
    publishConnector: async () => {
      throw new Error('unexpected connector publish');
    },
    subscribe: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
    subscribePattern: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
    subscribeMany: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
    subscribeAll: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),

    publishGeneric: async (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID(), sequence: 0, stream: 'memory' };
    },
  };
}

/** The schema every custom.github.push payload must satisfy in this suite. */
const PUSH_SCHEMA_V1: Record<string, unknown> = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    ref: { type: 'string' },
    commits: { type: 'array' },
  },
  required: ['ref', 'commits'],
};

postgresDescribe('event schema registry gates (real PostgreSQL)', () => {
  const dbName = `omni_959_registry_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let journal: PublishedEvent[];
  let eventSchemas: EventSchemaService;
  let deadLetters: DeadLetterService;
  let webhooks: WebhookService;

  /** Everything published to the bus whose type is NOT the DLQ system announcement. */
  function journalOf(type: string): PublishedEvent[] {
    return journal.filter((e) => e.type === type);
  }

  async function dlqRows() {
    return db.select().from(deadLetterEvents);
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const dbUrl = pgRoleUrl(superUrl, dbName);

    const handle = createDbHandle({ url: dbUrl, maxConnections: 3 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;

    journal = [];
    const bus = recordingBus(journal);
    eventSchemas = new EventSchemaService(db);
    deadLetters = new DeadLetterService(db, bus);
    webhooks = new WebhookService(db, bus, eventSchemas, deadLetters);

    await webhooks.create({
      name: 'github',
      description: 'suite source',
      eventTypeMapping: { source: 'header', header: 'X-GitHub-Event' },
    });
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    dropDatabaseOrThrow({ superUrl, psqlBin }, dbName);
  });

  test('registering a schema inserts at version 1', async () => {
    const row = await eventSchemas.register({ eventType: 'custom.github.push', schema: PUSH_SCHEMA_V1 });
    expect(row.version).toBe(1);
    expect(row.enabled).toBe(true);
    expect(row.schema).toEqual(PUSH_SCHEMA_V1);
  });

  test('ingress: violating payload → DLQ with schema_validation_failed, nothing in the journal', async () => {
    await expect(webhooks.receive('github', { ref: 'refs/heads/main' }, { 'x-github-event': 'push' })).rejects.toThrow(
      /schema_validation_failed/,
    );

    const rows = await dlqRows();
    expect(rows.length).toBe(1);
    const entry = rows[0];
    expect(entry?.eventType).toBe('custom.github.push');
    expect(entry?.error.startsWith('schema_validation_failed')).toBe(true);
    // Retrying an unchanged invalid payload can never succeed: manual only.
    expect(entry?.nextAutoRetryAt).toBeNull();
    // The refused payload is preserved as the DLQ row's record.
    expect(entry?.payload).toMatchObject({ source: 'github', ref: 'refs/heads/main' });

    // The journal saw the DLQ system announcement and NOT the refused event.
    expect(journalOf('custom.github.push')).toEqual([]);
    expect(journalOf('system.dead_letter').length).toBe(1);
  });

  test('ingress: mapped valid delivery emits custom.github.push, not custom.webhook.github', async () => {
    const result = await webhooks.receive(
      'github',
      { ref: 'refs/heads/main', commits: [] },
      { 'x-github-event': 'push' },
    );

    expect(result.eventType).toBe('custom.github.push');
    const published = journalOf('custom.github.push');
    expect(published.length).toBe(1);
    expect(published[0]?.payload).toMatchObject({ source: 'github', ref: 'refs/heads/main' });
    expect(journalOf('custom.webhook.github')).toEqual([]);
  });

  test('ingress: a delivery the mapping cannot resolve falls back to the collapsed type', async () => {
    const result = await webhooks.receive('github', { anything: true }, {});
    expect(result.eventType).toBe('custom.webhook.github');
    expect(journalOf('custom.webhook.github').length).toBe(1);
  });

  test('ingress: unregistered custom types still flow (opt-in registry, pass-through)', async () => {
    const result = await webhooks.receive(
      'github',
      { totally: 'freeform', nested: { ok: true } },
      { 'x-github-event': 'deployment_status' },
    );

    expect(result.eventType).toBe('custom.github.deployment_status');
    expect(journalOf('custom.github.deployment_status').length).toBe(1);
    expect((await dlqRows()).length).toBe(1); // unchanged since the violating delivery
  });

  test('emit_event: invalid payload for a registered type fails the action, DLQs, publishes nothing', async () => {
    const engineDeps = buildAutomationEngineDeps({ eventSchemas, deadLetters } as unknown as Services, db);
    const bus = recordingBus(journal);
    const publishedBefore = journalOf('custom.github.push').length;

    const result = await executeAction(
      { type: 'emit_event', config: { eventType: 'custom.github.push' } },
      { payload: { ref: 42 }, variables: {}, env: {} },
      { ...engineDeps, eventBus: bus },
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('schema_validation_failed');
    expect(journalOf('custom.github.push').length).toBe(publishedBefore);

    const rows = await dlqRows();
    expect(rows.length).toBe(2);
    const entry = rows.find(
      (r) => r.error.startsWith('schema_validation_failed') && 'ref' in r.payload && r.payload.ref === 42,
    );
    expect(entry).toBeDefined();
    expect(entry?.eventType).toBe('custom.github.push');
    expect(entry?.nextAutoRetryAt).toBeNull();
  });

  test('emit_event: valid payload for a registered type publishes', async () => {
    const engineDeps = buildAutomationEngineDeps({ eventSchemas, deadLetters } as unknown as Services, db);
    const bus = recordingBus(journal);
    const publishedBefore = journalOf('custom.github.push').length;

    const result = await executeAction(
      { type: 'emit_event', config: { eventType: 'custom.github.push' } },
      { payload: { ref: 'refs/heads/main', commits: [] }, variables: {}, env: {} },
      { ...engineDeps, eventBus: bus },
    );

    expect(result.status).toBe('success');
    expect(journalOf('custom.github.push').length).toBe(publishedBefore + 1);
  });

  test('manual trigger shares the ingress gate', async () => {
    await expect(webhooks.trigger('custom.github.push', { ref: 7 })).rejects.toThrow(/schema_validation_failed/);
    expect((await dlqRows()).length).toBe(3);
  });

  test('dry run (#1076): same errors as the gate, no DLQ row, nothing published', async () => {
    const dlqBefore = (await dlqRows()).length;
    const journalBefore = journal.length;

    const bad = await eventSchemas.validatePayload('custom.github.push', { ref: 7 });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.version).toBe(1);

    const good = await eventSchemas.validatePayload('custom.github.push', { ref: 'refs/heads/main', commits: [] });
    expect(good.valid).toBe(true);
    expect(good.errors).toEqual([]);

    await expect(eventSchemas.validatePayload('custom.not.registered', {})).rejects.toThrow(/not found/i);

    expect((await dlqRows()).length).toBe(dlqBefore);
    expect(journal.length).toBe(journalBefore);
  });

  test('evolution: an additive-optional revision is accepted and bumps the version', async () => {
    const v2 = {
      ...PUSH_SCHEMA_V1,
      properties: { ...(PUSH_SCHEMA_V1.properties as Record<string, unknown>), pusher: { type: 'string' } },
    };
    const row = await eventSchemas.register({ eventType: 'custom.github.push', schema: v2 });
    expect(row.version).toBe(2);
  });

  test('evolution: re-registering the identical schema is idempotent', async () => {
    const v2 = {
      ...PUSH_SCHEMA_V1,
      properties: { ...(PUSH_SCHEMA_V1.properties as Record<string, unknown>), pusher: { type: 'string' } },
    };
    const row = await eventSchemas.register({ eventType: 'custom.github.push', schema: v2 });
    expect(row.version).toBe(2);
  });

  test('evolution: an incompatible replacement is refused (new versioned event_type instead)', async () => {
    const breaking = {
      ...PUSH_SCHEMA_V1,
      required: ['ref', 'commits', 'pusher'],
    };
    await expect(eventSchemas.register({ eventType: 'custom.github.push', schema: breaking })).rejects.toThrow(
      /incompatible schema change/,
    );
    const row = await eventSchemas.getByTypeOrThrow('custom.github.push');
    expect(row.version).toBe(2);
  });

  test('register refuses an artifact that is not a valid JSON Schema', async () => {
    await expect(
      eventSchemas.register({ eventType: 'custom.broken.type', schema: { type: 'string', pattern: '[' } }),
    ).rejects.toThrow(/not a valid JSON Schema/);
  });

  test.each(['correlationId', 'causationId'] as const)(
    'legacy-key schema refusal keeps an independent unowned event ID with %s',
    async (field) => {
      const previousFlag = process.env[MULTITENANCY_FLAG_ENV];
      process.env[MULTITENANCY_FLAG_ENV] = 'true';
      try {
        const services = createServices(db, recordingBus(journal));
        const { plainTextKey } = await services.apiKeys.create({ name: `refusal-${field}`, scopes: ['*'] });
        const [tenant] = await db
          .insert(tenants)
          .values({
            slug: `refusal-${field.toLowerCase()}`,
            displayName: 'Foreign owner',
            maxKeyTtlSeconds: 3600,
            maxKeyRateLimit: 100,
            maxKeyBudget: 100,
          })
          .returning();
        if (!tenant) throw new Error('missing foreign tenant');
        const [instance] = await db
          .insert(instances)
          .values({ name: `refusal-${field}`, channel: 'internal', tenantId: tenant.id })
          .returning();
        if (!instance) throw new Error('missing foreign instance');
        const foreignId = crypto.randomUUID();
        await db.insert(omniEvents).values({
          id: foreignId,
          instanceId: instance.id,
          channel: 'internal',
          direction: 'internal',
          eventType: 'custom.foreign-parent',
          metadata: { correlationId: foreignId },
        });
        const [foreign] = await db.select().from(omniEvents).where(eq(omniEvents.id, foreignId));
        expect(foreign?.tenantId).toBe(tenant.id);
        // Runtime callers may still carry an extra source ID; the service must ignore it.
        const refusalInput = {
          eventId: foreignId,
          eventType: `custom.refusal-service-${field.toLowerCase()}`,
          subject: 'schema-refusal',
          payload: {},
          errors: ['invalid schema'],
        };
        const directRefusal = await services.deadLetters.createSchemaValidationFailure(refusalInput);
        expect(directRefusal.eventId).not.toBe(foreignId);
        expect(directRefusal.tenantId).toBeNull();
        expect(directRefusal.nextAutoRetryAt).toBeNull();
        const [storedRefusal] = await db
          .select()
          .from(deadLetterEvents)
          .where(eq(deadLetterEvents.id, directRefusal.id));
        expect(storedRefusal?.eventId).toBe(directRefusal.eventId);
        expect(storedRefusal?.tenantId).toBeNull();
        const eventType = `custom.refusal-${field.toLowerCase()}` as const;
        await services.eventSchemas.register({ eventType, schema: { type: 'object', required: ['requiredValue'] } });
        const app = new Hono<{ Variables: AppVariables }>();
        app.onError(errorHandler);
        app.use('*', async (c, next) => {
          c.set('db', db);
          c.set('services', services);
          await next();
        });
        app.use('*', tenancyMiddleware);
        app.use('*', authMiddleware);
        app.use('*', scopeEnforcerMiddleware);
        app.route('/api/v2', webhooksRoutes);
        const response = await app.request('/api/v2/events/trigger', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': plainTextKey },
          body: JSON.stringify({ eventType, payload: {}, [field]: foreignId }),
        });
        expect(response.status).toBe(400);
        const rows = await db.select().from(deadLetterEvents).where(eq(deadLetterEvents.eventType, eventType));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.eventId).not.toBe(foreignId);
        expect(rows[0]?.tenantId).toBeNull();
        expect(journalOf(eventType)).toEqual([]);
      } finally {
        if (previousFlag === undefined) Reflect.deleteProperty(process.env, MULTITENANCY_FLAG_ENV);
        else process.env[MULTITENANCY_FLAG_ENV] = previousFlag;
      }
    },
  );
});
