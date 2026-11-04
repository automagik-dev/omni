/** Claimed ingress rows survive the real journal subscriber under the runtime role. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  CURRENT_ENVELOPE_VERSION,
  type EventBus,
  type GenericEventHandler,
  type LogEntry,
  configureLogging,
  getLogBuffer,
  getLogConfig,
} from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  assertEnforcedRuntimeIdentity,
  connectorEventSubscriptions,
  connectors,
  createDbHandle,
  instances,
  omniEvents,
  unwrapDbError,
  webhookSources,
} from '@omni/db';
import {
  assertPgTestRole,
  connectorIngressFunctionStatements,
  connectorIngressRoleStatements,
  contextFunctionStatements,
  pgRoleUrl,
  provisionMigratedDatabase,
} from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { setupEventPersistence } from '../plugins/event-persistence';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const maybe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
type JournalEvent = Parameters<GenericEventHandler>[0];

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

for (const mode of ['legacy', 'paired', 'tenant', 'enforced'] as const) {
  maybe(`journal claimed source (${mode}, real PostgreSQL)`, () => {
    const database = `omni_journal_source_${crypto.randomUUID().replaceAll('-', '')}`;
    const envKeys = ['OMNI_MULTITENANCY_ENABLED', 'OMNI_DB_ENFORCEMENT', 'OMNI_PAIRED_AGENT_CONSUMERS'] as const;
    const previous = envKeys.map((key) => [key, process.env[key]] as const);
    const tenantMode = mode === 'tenant' || mode === 'enforced';
    const closers: Array<() => Promise<void>> = [];
    const handlers = new Map<string, GenericEventHandler>();
    const queries: string[] = [];
    let db: Database;
    let sourceId: string;
    let connectorId: string;
    let subscriptionId: string;
    let instanceId: string;
    const scope = <T>(tenant: string, fn: () => Promise<T>) =>
      tenantMode ? runInWorkerTenantScope(db, tenant, fn) : fn();

    beforeAll(async () => {
      process.env.OMNI_MULTITENANCY_ENABLED = String(tenantMode);
      process.env.OMNI_DB_ENFORCEMENT = mode === 'enforced' ? 'on' : 'false';
      process.env.OMNI_PAIRED_AGENT_CONSUMERS = mode === 'paired' ? 'true' : 'false';
      provisionMigratedDatabase({ superUrl, psqlBin }, database);
      const owner = createDbHandle({ url: pgRoleUrl(superUrl, database) });
      closers.push(owner.close);
      const admin = owner.db;
      await admin.execute(`INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${A}', 'journal-source-a', 'Source A', 86400, 1000, 1000),
        ('${B}', 'journal-source-b', 'Source B', 86400, 1000, 1000)`);
      const [source] = await admin.insert(webhookSources).values({ name: 'journal-source' }).returning();
      const [connector] = await admin
        .insert(connectors)
        .values({
          provider: 'test',
          name: 'journal-connector',
          credentials: '{}',
          status: 'connected',
        })
        .returning();
      const [instance] = await admin
        .insert(instances)
        .values({
          name: 'journal-instance',
          channel: 'whatsapp-baileys',
        })
        .returning();
      if (!source || !connector || !instance) throw new Error('missing source fixtures');
      sourceId = source.id;
      connectorId = connector.id;
      instanceId = instance.id;
      // Admin assigns source ownership as fixture setup only; assertions use runtime below.
      if (tenantMode) {
        await admin.update(webhookSources).set({ tenantId: A }).where(eq(webhookSources.id, sourceId));
        await admin.update(connectors).set({ tenantId: A }).where(eq(connectors.id, connectorId));
        await admin.update(instances).set({ tenantId: A }).where(eq(instances.id, instanceId));
      }
      const [subscription] = await admin
        .insert(connectorEventSubscriptions)
        .values({
          connectorId,
          providerEventKey: 'test',
          verificationSecret: 'synthetic-secret',
        })
        .returning();
      if (!subscription) throw new Error('missing subscription fixture');
      subscriptionId = subscription.id;
      if (tenantMode)
        await admin
          .update(connectorEventSubscriptions)
          .set({ tenantId: A })
          .where(eq(connectorEventSubscriptions.id, subscriptionId));
      const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
      if (mode === 'enforced') await applyTenantRlsEnforcement(admin);
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
        url: pgRoleUrl(superUrl, database, {
          name: DEFAULT_ROLE_NAMES.runtime,
          password: passwords.runtime,
        }),
        maxConnections: 2,
      });
      closers.push(runtime.close);
      db = runtime.db;
      db.$client.options.debug = (_connection, query) => {
        queries.push(query);
      };
      await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
      if (mode === 'enforced')
        expect((await assertEnforcedRuntimeIdentity(db)).currentUser).toBe(DEFAULT_ROLE_NAMES.runtime);
      await setupEventPersistence(
        {
          subscribe: async () => {},
          subscribePattern: async (pattern: string, handler: GenericEventHandler) => {
            handlers.set(pattern, handler);
          },
        } as unknown as EventBus,
        db,
      );
    }, 180000);

    afterAll(async () => {
      for (const close of closers.reverse()) await close();
      const drop = Bun.spawnSync({
        cmd: [
          psqlBin,
          '-X',
          '--set',
          'ON_ERROR_STOP=1',
          '--dbname',
          superUrl,
          '-c',
          `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (drop.exitCode) throw new Error(drop.stderr.toString());
      for (const [key, value] of previous) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    });

    function envelope(id: string, type: JournalEvent['type'], source: string, tenant = A): JournalEvent {
      return {
        id,
        type,
        payload: { value: 'retained payload' },
        timestamp: Date.now(),
        metadata: {
          correlationId: id,
          source,
          ...(tenantMode ? { tenantId: tenant, envelopeVersion: CURRENT_ENVELOPE_VERSION } : {}),
        },
      };
    }

    async function deliver(event: JournalEvent): Promise<LogEntry[]> {
      const handler = handlers.get(event.type.startsWith('connector.') ? 'connector.>' : 'custom.>');
      if (!handler) throw new Error('missing journal subscriber');
      const config = getLogConfig();
      const errors: LogEntry[] = [];
      // The PG gate mutes logs; explicitly enable and observe the real error path.
      configureLogging({ level: 'error', modules: 'event-persistence' });
      const stop = getLogBuffer().subscribe(
        (entry) => {
          if (entry.eventId === event.id) errors.push(entry);
        },
        { level: 'error', modules: ['event-persistence'] },
      );
      try {
        await handler(event);
      } finally {
        stop();
        configureLogging(config);
      }
      return errors;
    }

    const sources = [
      ['webhook', 'custom.journal.source', () => ({ source: 'webhook', webhookSourceId: sourceId })],
      ['subscription', 'connector.event', () => ({ source: 'connector', subscriptionId })],
      [
        'connector',
        'connector.test.source',
        () => ({ source: 'connector', connectorId, subscriptionIds: [subscriptionId] }),
      ],
    ] as const;
    for (const [kind, type, metadataFor] of sources) {
      test(`${kind} claimed delivery retains exactly one owned row without an error`, async () => {
        const id = crypto.randomUUID();
        const metadata = metadataFor();
        await scope(A, () =>
          scopedHandle(db)
            .insert(omniEvents)
            .values({
              id,
              channel: 'internal',
              eventType: type,
              direction: 'inbound',
              status: 'received',
              metadata,
              rawPayload: { original: kind },
            }),
        );
        // Source identifiers belong to the claim, not the bus's minimal consumer metadata.
        const event = envelope(id, type, metadata.source);
        queries.length = 0;
        expect(await deliver(event)).toEqual([]);
        expect(queries.filter((query) => query.startsWith('select "id" from "omni_events"'))).toHaveLength(
          mode === 'legacy' ? 0 : 1,
        );
        expect(queries.filter((query) => query.startsWith('insert into "omni_events"'))).toHaveLength(
          mode === 'legacy' ? 1 : 0,
        );
        if (mode === 'legacy') expect(queries).toHaveLength(1);
        const rows = await scope(A, () => scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, id)));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.tenantId).toBe(tenantMode ? A : null);
        expect(rows[0]?.rawPayload).toEqual({ original: kind });
        expect(rows[0]?.metadata).toEqual(metadata);
      });
    }

    test('unclaimed events still insert; legacy keeps its one-write query count', async () => {
      const id = crypto.randomUUID();
      const event = envelope(id, 'custom.journal.unclaimed', 'ordinary');
      event.metadata.instanceId = instanceId;
      queries.length = 0;
      expect(await deliver(event)).toEqual([]);
      const lookups = queries.filter((query) => query.startsWith('select "id" from "omni_events"'));
      expect(lookups).toHaveLength(mode === 'legacy' ? 0 : 1);
      if (mode === 'legacy') expect(queries).toHaveLength(1);
      expect(queries.filter((query) => query.startsWith('insert into "omni_events"'))).toHaveLength(1);
      const [row] = await scope(A, () => scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, id)));
      expect(row?.tenantId).toBe(tenantMode ? A : null);
    });

    if (mode === 'enforced') {
      test('ON CONFLICT cannot replace the source ownership check', async () => {
        const id = crypto.randomUUID();
        await scope(A, () =>
          scopedHandle(db)
            .insert(omniEvents)
            .values({
              id,
              channel: 'internal',
              eventType: 'custom.journal.control',
              metadata: { source: 'webhook', webhookSourceId: sourceId },
            }),
        );
        let failure: unknown;
        try {
          await scope(A, () =>
            scopedHandle(db)
              .insert(omniEvents)
              .values({
                id,
                channel: 'internal',
                eventType: 'custom.journal.control',
                metadata: { source: 'webhook' },
              })
              .onConflictDoNothing({ target: omniEvents.id }),
          );
        } catch (error) {
          failure = error;
        }
        expect(unwrapDbError(failure)).toMatchObject({ code: '42501' });
      });

      test('a foreign claim remains hidden and cannot bypass the scoped insert check', async () => {
        const id = crypto.randomUUID();
        await scope(A, () =>
          scopedHandle(db)
            .insert(omniEvents)
            .values({
              id,
              channel: 'internal',
              eventType: 'custom.journal.foreign',
              metadata: { source: 'webhook', webhookSourceId: sourceId },
            }),
        );
        expect(await deliver(envelope(id, 'custom.journal.foreign', 'webhook', B))).toHaveLength(1);
        expect(
          await scope(B, () => scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, id))),
        ).toHaveLength(0);
        expect(
          await scope(A, () => scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, id))),
        ).toHaveLength(1);
      });
    }
  });
}
