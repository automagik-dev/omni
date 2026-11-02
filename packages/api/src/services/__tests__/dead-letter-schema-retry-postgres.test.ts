/** Refusal recovery uses current persisted schemas in legacy and enforced RLS. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { ConnectorEventPublisher, EventBus } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  assertEnforcedRuntimeIdentity,
  createDbHandle,
  deadLetterEvents,
  eventSchemas,
} from '@omni/db';
import { assertPgTestRole, pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runTenantWorkDb } from '../../tenancy/worker-tenant-context';
import { DeadLetterService } from '../dead-letters';
import { EventSchemaService } from '../event-schemas';
import { WebhookService } from '../webhooks';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const schema = { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] };

for (const enforced of [false, true]) {
  postgresDescribe(`dead-letter schema retry (${enforced ? 'enforced RLS' : 'legacy'}, real PostgreSQL)`, () => {
    const dbName = `omni_dlq_retry_${crypto.randomUUID().replaceAll('-', '')}`;
    const closers: (() => Promise<void>)[] = [];
    const previousFlags = {
      multitenancy: process.env.OMNI_MULTITENANCY_ENABLED,
      enforcement: process.env.OMNI_DB_ENFORCEMENT,
    };
    let db: Database;
    let admin: Database;
    let service: DeadLetterService;
    let schemas: EventSchemaService;
    let bus: EventBus & ConnectorEventPublisher;
    let authDb: Database;
    let failPublish = false;
    const published: Array<{ type: string; payload: Record<string, unknown>; tenantId?: unknown }> = [];
    const inWorld = <T>(fn: () => Promise<T>, tenantId = TENANT_A): Promise<T> =>
      enforced ? runTenantWorkDb(db, tenantId, fn) : fn();
    const read = (id: string) => inWorld(() => service.getById(id));
    const type = () => `custom.retry.${crypto.randomUUID()}`;

    async function refusal(
      eventType: string,
      reason = 'schema_validation_failed',
      payload: Record<string, unknown> = { orderId: 'order-1' },
    ) {
      return inWorld(() =>
        service.createSchemaValidationFailure({
          eventType,
          subject: eventType,
          payload,
          errors: ['original refusal'],
          reason,
        }),
      );
    }

    async function register(eventType: string, enabled = true) {
      await inWorld(() => schemas.register({ eventType, schema, enabled }));
    }

    async function assertPending(id: string, originalError: string) {
      const row = await read(id);
      expect(row.status).toBe('pending');
      expect(row.resolvedAt).toBeNull();
      expect(row.nextAutoRetryAt).toBeNull();
      expect(row.error.startsWith(originalError)).toBe(true);
      return row;
    }

    beforeAll(async () => {
      process.env.OMNI_MULTITENANCY_ENABLED = enforced ? 'true' : 'false';
      process.env.OMNI_DB_ENFORCEMENT = enforced ? 'on' : 'false';
      provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
      const adminHandle = createDbHandle({ url: pgRoleUrl(superUrl, dbName), maxConnections: 3 });
      closers.push(() => adminHandle.close());
      admin = adminHandle.db;
      db = admin;
      if (enforced) {
        await admin.execute(`INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
          ('${TENANT_A}', 'retry-a', 'Retry A', 86400, 1000, 1000), ('${TENANT_B}', 'retry-b', 'Retry B', 86400, 1000, 1000)`);
        const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
        await applyTenantRlsEnforcement(admin);
        await applyTenancyRoles(admin, passwords, DEFAULT_ROLE_NAMES, dbName);
        const runtimeHandle = createDbHandle({
          url: pgRoleUrl(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
          maxConnections: 3,
        });
        closers.push(() => runtimeHandle.close());
        db = runtimeHandle.db;
        expect((await assertEnforcedRuntimeIdentity(db)).currentUser).toBe(DEFAULT_ROLE_NAMES.runtime);
        await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
        const authHandle = createDbHandle({
          url: pgRoleUrl(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }),
          maxConnections: 2,
        });
        closers.push(() => authHandle.close());
        authDb = authHandle.db;
      }
      bus = {
        connect: async () => {},
        close: async () => {},
        isConnected: () => true,
        publish: async () => {
          throw new Error('unexpected core publish');
        },
        subscribe: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
        subscribePattern: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
        subscribeMany: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
        subscribeAll: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
        publishGeneric: async (eventType, payload, metadata) => {
          if (metadata?.source?.startsWith('dead-letter-')) {
            if (failPublish) throw new Error('test bus unavailable');
            published.push({ type: eventType, payload, tenantId: metadata.tenantId });
          }
          return { id: crypto.randomUUID(), sequence: 0, stream: 'memory' };
        },
        publishConnector: async () => {
          throw new Error('unexpected connector publish');
        },
      };
      service = new DeadLetterService(db, bus);
      if (enforced) service.setAuthPlane(authDb);
      schemas = new EventSchemaService(db);
    }, 180_000);

    afterAll(async () => {
      for (const close of closers.reverse()) await close();
      Bun.spawnSync({
        cmd: [
          psqlBin,
          '-X',
          '--no-psqlrc',
          '--dbname',
          pgRoleUrl(superUrl, 'postgres'),
          '-c',
          `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      for (const [key, value] of Object.entries({
        OMNI_MULTITENANCY_ENABLED: previousFlags.multitenancy,
        OMNI_DB_ENFORCEMENT: previousFlags.enforcement,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    test('invalid ingress refusal stays pending, with history and no duplicate row or publication', async () => {
      const eventType = type();
      await register(eventType);
      const webhooks = new WebhookService(db, bus, schemas, service);
      await inWorld(async () => {
        await expect(webhooks.trigger(eventType as `custom.${string}`, { orderId: 7 })).rejects.toThrow(
          'schema_validation_failed',
        );
      });
      const rowsBefore = await inWorld(() => scopedHandle(db).select().from(deadLetterEvents));
      const row = rowsBefore.find((row) => row.eventType === eventType);
      if (!row) throw new Error('ingress did not file refusal');
      const countBefore = published.length;
      expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
      const after = await assertPending(row.id, row.error);
      expect(after.error).toContain('[Manual-retry]');
      expect(after.manualRetryCount).toBe(1);
      expect(published.length).toBe(countBefore);
      expect(await inWorld(() => scopedHandle(db).select().from(deadLetterEvents))).toHaveLength(rowsBefore.length);
      expect((await inWorld(() => service.processAutoRetries())).processed).toBe(0);
    });

    for (const reason of ['schema_validation_failed', 'schema_not_registered']) {
      test(`${reason} needs a registered, enabled schema; valid recovery publishes once`, async () => {
        const eventType = type();
        const row = await refusal(eventType, reason);
        const countBefore = published.length;
        expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
        await assertPending(row.id, row.error);
        await register(eventType, false);
        expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
        await assertPending(row.id, row.error);
        expect(published.length).toBe(countBefore);
        // The cached ingress verdict must not let a disabled/currently enabled
        // schema be treated as its previous state during explicit recovery.
        await inWorld(() => schemas.validate(eventType, row.payload));
        await inWorld(() =>
          scopedHandle(db).update(eventSchemas).set({ enabled: true }).where(eq(eventSchemas.eventType, eventType)),
        );
        expect((await inWorld(() => service.retry(row.id))).success).toBe(true);
        expect(published.slice(countBefore)).toEqual([
          { type: eventType, payload: row.payload, tenantId: enforced ? TENANT_A : undefined },
        ]);
        const after = await read(row.id);
        expect(after.status).toBe('resolved');
        expect(after.resolvedBy).toBe('manual-retry');
        expect(after.manualRetryCount).toBe(3);
        expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
        expect(published.length).toBe(countBefore + 1);
      });
    }

    test('a currently disabled schema refuses even if a gate cached it as enabled', async () => {
      const eventType = type();
      await register(eventType);
      await inWorld(() => schemas.validate(eventType, { orderId: 'valid' }));
      const row = await refusal(eventType);
      await inWorld(() =>
        scopedHandle(db).update(eventSchemas).set({ enabled: false }).where(eq(eventSchemas.eventType, eventType)),
      );
      const countBefore = published.length;
      expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
      await assertPending(row.id, row.error);
      expect(published.length).toBe(countBefore);
    });

    test('publish-not-declared stays blocked despite valid schema and claimed actor fields', async () => {
      const eventType = type();
      await register(eventType);
      const row = await refusal(eventType, 'publish_not_declared', {
        orderId: 'valid',
        agentId: 'claimed-agent',
        source: 'claimed-source',
      });
      const countBefore = published.length;
      expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
      await assertPending(row.id, row.error);
      expect(published.length).toBe(countBefore);
    });

    for (const reason of ['schema_validation_failed', 'schema_not_registered', 'publish_not_declared']) {
      test(`scheduled ${reason} is checked by auto retry and becomes manual-only`, async () => {
        const eventType = type();
        await register(eventType);
        const row = await refusal(eventType, reason, { orderId: 7 });
        await inWorld(() =>
          scopedHandle(db)
            .update(deadLetterEvents)
            .set({ nextAutoRetryAt: new Date(0), autoRetryCount: 1 })
            .where(eq(deadLetterEvents.id, row.id)),
        );
        const countBefore = published.length;
        expect(await service.processAutoRetries()).toEqual({ processed: 1, succeeded: 0, failed: 0 });
        const after = await assertPending(row.id, row.error);
        expect(after.autoRetryCount).toBe(1);
        expect(after.error).toContain('[Auto-retry skipped]');
        expect(published.length).toBe(countBefore);
      });
    }

    test('valid scheduled schema recovery publishes once in the row tenant', async () => {
      const eventType = type();
      await register(eventType);
      const row = await refusal(eventType, 'schema_not_registered');
      await inWorld(() =>
        scopedHandle(db)
          .update(deadLetterEvents)
          .set({ nextAutoRetryAt: new Date(0) })
          .where(eq(deadLetterEvents.id, row.id)),
      );
      const countBefore = published.length;
      expect(await service.processAutoRetries()).toEqual({ processed: 1, succeeded: 1, failed: 0 });
      expect((await read(row.id)).status).toBe('resolved');
      expect(published.slice(countBefore)).toEqual([
        { type: eventType, payload: row.payload, tenantId: enforced ? TENANT_A : undefined },
      ]);
    });

    test('schema read errors fail closed without scheduling a manual refusal', async () => {
      const row = await refusal(type());
      const countBefore = published.length;
      const lookup = spyOn(EventSchemaService.prototype, 'validatePayload').mockRejectedValue(
        new Error('schema read unavailable'),
      );
      try {
        expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
      } finally {
        lookup.mockRestore();
      }
      expect((await assertPending(row.id, row.error)).error).toContain('schema read unavailable');
      expect(published.length).toBe(countBefore);
    });

    test('a bus failure never schedules a schema refusal in manual or auto retry', async () => {
      const eventType = type();
      await register(eventType);
      const row = await refusal(eventType);
      failPublish = true;
      try {
        expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
        await assertPending(row.id, row.error);
        await inWorld(() =>
          scopedHandle(db)
            .update(deadLetterEvents)
            .set({ nextAutoRetryAt: new Date(0) })
            .where(eq(deadLetterEvents.id, row.id)),
        );
        await inWorld(() => service.processAutoRetries());
        await assertPending(row.id, row.error);
      } finally {
        failPublish = false;
      }
    });

    test('no event bus leaves refusals pending and manual-only in both retry paths', async () => {
      const row = await refusal(type());
      const offline = new DeadLetterService(db, null);
      if (enforced) offline.setAuthPlane(authDb);
      const countBefore = published.length;
      expect((await inWorld(() => offline.retry(row.id))).success).toBe(false);
      await assertPending(row.id, row.error);
      await inWorld(() =>
        scopedHandle(db)
          .update(deadLetterEvents)
          .set({ nextAutoRetryAt: new Date(0) })
          .where(eq(deadLetterEvents.id, row.id)),
      );
      expect(await offline.processAutoRetries()).toEqual({ processed: 1, succeeded: 0, failed: 0 });
      await assertPending(row.id, row.error);
      expect(published.length).toBe(countBefore);
    });

    test('ordinary delivery retries retain their envelope and do not require a persisted schema', async () => {
      const eventType = type();
      const event = {
        id: crypto.randomUUID(),
        type: eventType as `custom.${string}`,
        timestamp: Date.now(),
        payload: { orderId: 7 },
        metadata: { correlationId: crypto.randomUUID() },
      };
      const row = await inWorld(() =>
        service.create({ event, subject: eventType, error: new Error('delivery failed'), retryCount: 0 }),
      );
      const countBefore = published.length;
      expect((await inWorld(() => service.retry(row.id))).success).toBe(true);
      expect(published.slice(countBefore)).toEqual([
        { type: eventType, payload: row.payload, tenantId: enforced ? TENANT_A : undefined },
      ]);
    });

    if (enforced) {
      test('tenant B cannot list, inspect, or retry A refusal; A can recover it', async () => {
        const eventType = type();
        await register(eventType);
        const row = await refusal(eventType);
        const countBefore = published.length;
        await inWorld(async () => {
          expect((await service.list()).items.some((entry) => entry.id === row.id)).toBe(false);
          await expect(service.getById(row.id)).rejects.toThrow();
          await expect(service.retry(row.id)).rejects.toThrow();
          expect((await service.processAutoRetries()).processed).toBe(0);
        }, TENANT_B);
        expect(published.length).toBe(countBefore);
        expect((await read(row.id)).manualRetryCount).toBe(0);
        expect((await inWorld(() => service.retry(row.id))).success).toBe(true);
        expect(published.at(-1)?.tenantId).toBe(TENANT_A);
      });
    }
  });
}
