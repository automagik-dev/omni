/** Refusal recovery uses current persisted schemas in legacy and enforced RLS. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { ConnectorEventPublisher, EventBus, EventMetadata } from '@omni/core';
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
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { eq, sql } from 'drizzle-orm';
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
const retryOutcomes = [
  ['manual', false],
  ['manual', true],
  ['auto', false],
  ['auto', true],
] as const;
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
    let onRetryPublish: (() => Promise<void>) | undefined;
    const workers: Array<{ db: Database; service: DeadLetterService }> = [];
    const published: Array<{ type: string; payload: Record<string, unknown>; tenantId?: unknown }> = [];
    const retryMetadata: Array<Partial<EventMetadata> | undefined> = [];
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
      let retryUrl = pgRoleUrl(superUrl, dbName);
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
        retryUrl = pgRoleUrl(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
        expect((await assertEnforcedRuntimeIdentity(db)).currentUser).toBe(DEFAULT_ROLE_NAMES.runtime);
        await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
        const authHandle = createDbHandle({
          url: pgRoleUrl(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }),
          maxConnections: 2,
        });
        closers.push(() => authHandle.close());
        authDb = authHandle.db;
        // Instance ownership as the bus derives it: every instance here belongs to tenant A,
        // the tenant each row is written in, so a retry may restore its instanceId (#1566).
        (await import('@omni/core')).setEnvelopeInstanceTenantResolver(() => TENANT_A);
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
            if (metadata.source !== 'dead-letter-service') await onRetryPublish?.();
            if (failPublish) throw new Error('test bus unavailable');
            published.push({ type: eventType, payload, tenantId: metadata.tenantId });
            retryMetadata.push(metadata);
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
      // Independent single-connection pools make the competing SQL sessions observable.
      for (let i = 0; i < 2; i++) {
        const handle = createDbHandle({ url: retryUrl, maxConnections: 1 });
        closers.push(() => handle.close());
        if (enforced) await assertPgTestRole(handle.db, DEFAULT_ROLE_NAMES.runtime);
        const retryService = new DeadLetterService(handle.db, bus);
        if (enforced) retryService.setAuthPlane(authDb);
        workers.push({ db: handle.db, service: retryService });
      }
    }, 180_000);

    afterAll(async () => {
      try {
        for (const close of closers.reverse()) await close();
        dropDatabaseOrThrow({ superUrl, psqlBin }, dbName);
      } finally {
        (await import('@omni/core')).setEnvelopeInstanceTenantResolver(null);
        for (const [key, value] of Object.entries({
          OMNI_MULTITENANCY_ENABLED: previousFlags.multitenancy,
          OMNI_DB_ENFORCEMENT: previousFlags.enforcement,
        })) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
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
        payload: { orderId: 7, externalId: `ext-${crypto.randomUUID()}` },
        // A forged tenant claim in the stored envelope; the row's scope decides.
        metadata: { correlationId: crypto.randomUUID(), instanceId: crypto.randomUUID(), tenantId: TENANT_B },
      };
      const row = await inWorld(() =>
        service.create({ event, subject: eventType, error: new Error('delivery failed'), retryCount: 0 }),
      );
      const countBefore = published.length;
      expect((await inWorld(() => service.retry(row.id))).success).toBe(true);
      expect(published.slice(countBefore)).toEqual([
        { type: eventType, payload: event.payload, tenantId: enforced ? TENANT_A : undefined },
      ]);
      // The envelope is retained as the event's own identity: flow and instance
      // metadata come back, the tenant never does.
      const metadata = retryMetadata.at(-1);
      expect(metadata).toMatchObject({
        correlationId: event.metadata.correlationId,
        instanceId: event.metadata.instanceId,
      });
      expect((published.at(-1)?.payload as { externalId?: string }).externalId).toBe(event.payload.externalId);
      expect(metadata?.tenantId).not.toBe(TENANT_B);
    });

    function barrier() {
      let release = () => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    }

    async function waitForClaim(pid: number) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waiting = await admin.execute(sql`
          SELECT 1 FROM pg_stat_activity
          WHERE pid = ${pid} AND wait_event_type = 'Lock'
            AND query ILIKE '%update "dead_letter_events"%'
        `);
        if (waiting.length) return;
        await Bun.sleep(10);
      }
      throw new Error('Retry did not reach its pending-row claim');
    }

    function callRetry(worker: (typeof workers)[number], mode: 'manual' | 'auto', id: string) {
      if (mode === 'auto') return worker.service.processAutoRetries();
      return enforced ? runTenantWorkDb(worker.db, TENANT_A, () => worker.service.retry(id)) : worker.service.retry(id);
    }

    function expectClaimResult(result: Awaited<ReturnType<typeof callRetry>>, won: boolean) {
      if ('success' in result) {
        expect(result.success).toBe(won);
        if (!won) expect(result.error).toBe('Dead letter is no longer pending');
      } else {
        expect(result).toEqual(
          won ? { processed: 1, succeeded: 1, failed: 0 } : { processed: 0, succeeded: 0, failed: 0 },
        );
      }
    }

    for (const [firstMode, secondMode] of [
      ['manual', 'auto'],
      ['auto', 'manual'],
      ['manual', 'manual'],
      ['auto', 'auto'],
    ] as const) {
      test(`concurrent ${firstMode} then ${secondMode} retries have one claim winner`, async () => {
        const eventType = type();
        await register(eventType);
        const row = await refusal(eventType);
        await inWorld(() =>
          scopedHandle(db)
            .update(deadLetterEvents)
            .set({
              nextAutoRetryAt: new Date(0),
              autoRetryCount: 2,
              manualRetryCount: 4,
            })
            .where(eq(deadLetterEvents.id, row.id)),
        );
        const countBefore = published.length;
        const [firstWorker, secondWorker] = workers;
        if (!firstWorker || !secondWorker) throw new Error('Missing retry sessions');
        const pid = async (worker: typeof firstWorker) => {
          const [result] = await worker.db.execute(sql`SELECT pg_backend_pid() AS pid`);
          return Number(result?.pid);
        };
        const firstPid = await pid(firstWorker);
        const secondPid = await pid(secondWorker);
        expect(firstPid).not.toBe(secondPid);
        const locked = barrier();
        const release = barrier();
        const blocker = admin.transaction(async (tx) => {
          await tx.execute(sql`SELECT id FROM dead_letter_events WHERE id = ${row.id}::uuid FOR UPDATE`);
          locked.release();
          await release.promise;
        });
        const attempts: Array<ReturnType<typeof callRetry>> = [];
        try {
          await Promise.race([
            locked.promise,
            blocker.then(() => {
              throw new Error('Row lock was not held');
            }),
          ]);
          attempts.push(callRetry(firstWorker, firstMode, row.id));
          await waitForClaim(firstPid);
          attempts.push(callRetry(secondWorker, secondMode, row.id));
          await waitForClaim(secondPid);
          // Both callers selected pending before they reached their real SQL UPDATE.
          // PostgreSQL queues the claims in this order behind the fixture row lock.
          release.release();
          await blocker;
          const results = await Promise.all(attempts);
          for (const [index, result] of results.entries()) expectClaimResult(result, index === 0);
          expect(published.slice(countBefore)).toEqual([
            { type: eventType, payload: row.payload, tenantId: enforced ? TENANT_A : undefined },
          ]);
          const after = await read(row.id);
          expect(after.status).toBe('resolved');
          expect(after.resolvedBy).toBe(firstMode === 'manual' ? 'manual-retry' : 'auto-retry-3');
          expect(after.manualRetryCount).toBe(firstMode === 'manual' ? 5 : 4);
          expect(after.autoRetryCount).toBe(2);
          expect(after.error).toBe(row.error);
        } finally {
          release.release();
          await Promise.allSettled([blocker, ...attempts]);
        }
      });
    }

    test('a stale automatic selection cannot claim a row made manual-only', async () => {
      const eventType = type();
      await register(eventType);
      const row = await refusal(eventType);
      await inWorld(() =>
        scopedHandle(db)
          .update(deadLetterEvents)
          .set({ nextAutoRetryAt: new Date(0) })
          .where(eq(deadLetterEvents.id, row.id)),
      );
      const countBefore = published.length;
      const worker = workers[0];
      if (!worker) throw new Error('Missing retry session');
      const [session] = await worker.db.execute(sql`SELECT pg_backend_pid() AS pid`);
      const locked = barrier();
      const release = barrier();
      const blocker = admin.transaction(async (tx) => {
        await tx.update(deadLetterEvents).set({ nextAutoRetryAt: null }).where(eq(deadLetterEvents.id, row.id));
        locked.release();
        await release.promise;
      });
      let attempt: ReturnType<DeadLetterService['processAutoRetries']> | undefined;
      try {
        await Promise.race([
          locked.promise,
          blocker.then(() => {
            throw new Error('Row lock was not held');
          }),
        ]);
        attempt = worker.service.processAutoRetries();
        await waitForClaim(Number(session?.pid));
        release.release();
        await blocker;
        expect(await attempt).toEqual({ processed: 0, succeeded: 0, failed: 0 });
        const after = await assertPending(row.id, row.error);
        expect(after.lastRetryAt).toBeNull();
        expect(after.manualRetryCount).toBe(0);
        expect(after.autoRetryCount).toBe(0);
        expect(after.error).toBe(row.error);
        expect(published.length).toBe(countBefore);
      } finally {
        release.release();
        await Promise.allSettled([blocker, ...(attempt ? [attempt] : [])]);
      }
    });

    test('abandoned rows cannot be claimed by manual retry', async () => {
      const row = await refusal(type());
      await inWorld(() => service.abandon(row.id));
      const countBefore = published.length;
      expect(await inWorld(() => service.retry(row.id))).toEqual({
        success: false,
        deadLetterId: row.id,
        error: 'Dead letter is no longer pending',
      });
      const after = await read(row.id);
      expect(after.status).toBe('abandoned');
      expect(after.manualRetryCount).toBe(0);
      expect(after.lastRetryAt).toBeNull();
      expect(published.length).toBe(countBefore);
    });

    async function delivery(overrides: Partial<typeof deadLetterEvents.$inferInsert> = {}) {
      const eventType = type();
      const [row] = await inWorld(() =>
        scopedHandle(db)
          .insert(deadLetterEvents)
          .values({
            eventId: crypto.randomUUID(),
            eventType,
            subject: eventType,
            payload: { orderId: 'retry-hardening' },
            error: 'delivery failed',
            nextAutoRetryAt: new Date(0),
            ...overrides,
          })
          .returning(),
      );
      if (!row) throw new Error('Missing delivery fixture');
      return row;
    }

    for (const [mode, publishFails] of retryOutcomes) {
      for (const action of ['resolve', 'abandon'] as const) {
        test(`${mode} retry cannot overwrite operator ${action} after publish ${publishFails ? 'failure' : 'success'}`, async () => {
          const row = await delivery();
          const countBefore = published.length;
          // Auto publication runs outside the claim transaction, so the
          // operator commits separately. Manual requests retain their lock
          // and exercise the same ordering on their active transaction.
          const operatorDecision = async () => {
            if (action === 'resolve') await service.resolve(row.id, 'operator decision');
            else await service.abandon(row.id);
          };
          onRetryPublish = mode === 'auto' ? () => inWorld(operatorDecision) : operatorDecision;
          failPublish = publishFails;
          try {
            if (mode === 'manual') {
              expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
            } else {
              expect(await service.processAutoRetries()).toEqual({
                processed: 1,
                succeeded: 0,
                failed: 0,
              });
            }
          } finally {
            onRetryPublish = undefined;
            failPublish = false;
          }
          const after = await read(row.id);
          expect(after.status).toBe(action === 'resolve' ? 'resolved' : 'abandoned');
          expect(after.resolvedBy).toBe(action === 'resolve' ? 'operator decision' : null);
          expect(after.error).toBe(row.error);
          expect(after.autoRetryCount).toBe(0);
          expect(after.manualRetryCount).toBe(0);
          expect(after.nextAutoRetryAt).toBeNull();
          expect(published.length).toBe(countBefore + (publishFails ? 0 : 1));
        });
      }
    }

    for (const mode of ['manual', 'auto'] as const) {
      test(`${mode} published retry keeps its lease when resolved bookkeeping fails`, async () => {
        const row = await delivery();
        const countBefore = published.length;
        // A real SQL error after publication, rather than a mocked service.
        const worker = workers[0];
        if (!worker) throw new Error('Missing retry worker');
        // A trigger aborts ONLY the final write. Auto work commits its claim
        // before publish; enforced manual finalization uses a savepoint.
        await admin.execute(
          sql.raw(`
          CREATE OR REPLACE FUNCTION fail_retry_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.id = '${row.id}'::uuid AND NEW.status = 'resolved' THEN
              RAISE EXCEPTION 'injected resolved update failure';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER fail_retry_resolution BEFORE UPDATE ON dead_letter_events
            FOR EACH ROW EXECUTE FUNCTION fail_retry_resolution();
        `),
        );
        try {
          if (mode === 'manual') {
            await inWorld(async () => {
              const result = await service.retry(row.id);
              expect(result.success).toBe(false);
            });
          } else {
            expect(await worker.service.processAutoRetries()).toEqual({ processed: 1, succeeded: 0, failed: 1 });
          }
          expect((await read(row.id)).status).toBe('retrying');
          expect((await read(row.id)).error).toBe(row.error);
          expect((await read(row.id)).autoRetryCount).toBe(0);
          expect(await worker.service.processAutoRetries()).toEqual({ processed: 0, succeeded: 0, failed: 0 });
          expect(published.length).toBe(countBefore + 1);

          await admin.execute(
            'DROP TRIGGER fail_retry_resolution ON dead_letter_events; DROP FUNCTION fail_retry_resolution()',
          );
          // Crash recovery cannot know the first publication succeeded. Expire
          // this lease deterministically, then make its backoff due: delivery
          // is at-least-once and may duplicate that successful publication.
          await inWorld(() =>
            scopedHandle(db)
              .update(deadLetterEvents)
              .set({
                lastRetryAt: new Date(Date.now() - 16 * 60_000),
              })
              .where(eq(deadLetterEvents.id, row.id)),
          );
          expect(await worker.service.processAutoRetries()).toEqual({ processed: 0, succeeded: 0, failed: 0 });
          const recovered = await read(row.id);
          expect(recovered.status).toBe('pending');
          expect(recovered.autoRetryCount).toBe(1);
          expect(recovered.nextAutoRetryAt?.getTime()).toBeGreaterThan(Date.now());
          expect(published.length).toBe(countBefore + 1);
          await inWorld(() =>
            scopedHandle(db)
              .update(deadLetterEvents)
              .set({
                nextAutoRetryAt: new Date(0),
              })
              .where(eq(deadLetterEvents.id, row.id)),
          );
          expect(await worker.service.processAutoRetries()).toEqual({ processed: 1, succeeded: 1, failed: 0 });
          expect((await read(row.id)).status).toBe('resolved');
          expect(published.slice(countBefore)).toEqual([
            { type: row.eventType, payload: row.payload, tenantId: enforced ? TENANT_A : undefined },
            { type: row.eventType, payload: row.payload, tenantId: enforced ? TENANT_A : undefined },
          ]);
        } finally {
          onRetryPublish = undefined;
          await admin.execute(
            'DROP TRIGGER IF EXISTS fail_retry_resolution ON dead_letter_events; DROP FUNCTION IF EXISTS fail_retry_resolution()',
          );
          if ((await read(row.id)).status !== 'resolved') await inWorld(() => service.abandon(row.id));
        }
      });
    }

    test('stale retry leases consume one attempt, back off, and recover only once across workers', async () => {
      const staleAt = new Date(Date.now() - 16 * 60_000);
      const row = await delivery({ status: 'retrying', lastRetryAt: staleAt });
      const fresh = await delivery({ status: 'retrying', lastRetryAt: new Date() });
      const countBefore = published.length;
      const before = Date.now();
      const pids = await Promise.all(
        workers.map(async (worker) => {
          const [session] = await worker.db.execute(sql`SELECT pg_backend_pid() AS pid`);
          return Number(session?.pid);
        }),
      );
      const locked = barrier();
      const release = barrier();
      const blocker = admin.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM dead_letter_events WHERE id = ${row.id}::uuid FOR UPDATE`);
        locked.release();
        await release.promise;
      });
      const attempts: Array<ReturnType<DeadLetterService['processAutoRetries']>> = [];
      try {
        await locked.promise;
        for (const worker of workers) attempts.push(worker.service.processAutoRetries());
        // Both workers selected the same expired lease before either can reset it.
        await Promise.all(pids.map(waitForClaim));
        release.release();
        await Promise.all([blocker, ...attempts]);
      } finally {
        release.release();
        await Promise.allSettled([blocker, ...attempts]);
      }
      const after = await read(row.id);
      expect(after.status).toBe('pending');
      expect(after.autoRetryCount).toBe(1);
      expect(after.manualRetryCount).toBe(0);
      expect(after.lastRetryAt?.getTime()).toBe(staleAt.getTime());
      expect(after.error).toContain('[Retry lease expired]');
      expect(after.nextAutoRetryAt?.getTime()).toBeGreaterThanOrEqual(before + 6 * 60 * 60_000);
      expect((await read(fresh.id)).status).toBe('retrying');
      await service.processAutoRetries();
      expect(await read(row.id)).toEqual(after);
      expect(published.length).toBe(countBefore);
      await inWorld(() => service.abandon(row.id));
      await inWorld(() => service.abandon(fresh.id));
    });

    test('stale manual-only, governance, and exhausted leases do not gain an automatic schedule', async () => {
      const countBefore = published.length;
      const rows = await Promise.all([
        delivery({ nextAutoRetryAt: null }),
        delivery({ error: 'schema_validation_failed: invalid' }),
        delivery({ autoRetryCount: 2 }),
      ]);
      for (const row of rows) {
        await inWorld(() =>
          scopedHandle(db)
            .update(deadLetterEvents)
            .set({
              status: 'retrying',
              lastRetryAt: new Date(Date.now() - 16 * 60_000),
            })
            .where(eq(deadLetterEvents.id, row.id)),
        );
      }
      await service.processAutoRetries();
      for (const row of rows) {
        const after = await read(row.id);
        expect(after.status).toBe('pending');
        expect(after.autoRetryCount).toBe(row.autoRetryCount + 1);
        expect(after.nextAutoRetryAt).toBeNull();
        expect(after.error.startsWith(row.error)).toBe(true);
        await inWorld(() => service.abandon(row.id));
      }
      expect(published.length).toBe(countBefore);
    });

    for (const [mode, publishFails] of retryOutcomes) {
      test(`a late ${mode} retry cannot finalize a newer lease after publish ${publishFails ? 'failure' : 'success'}`, async () => {
        const row = await delivery();
        const renewedAt = new Date(Date.now() + 60_000);
        const renewLease = async () => {
          await scopedHandle(db)
            .update(deadLetterEvents)
            .set({
              status: 'retrying',
              lastRetryAt: renewedAt,
              autoRetryCount: 1,
            })
            .where(eq(deadLetterEvents.id, row.id));
        };
        onRetryPublish = mode === 'auto' ? () => inWorld(renewLease) : renewLease;
        failPublish = publishFails;
        try {
          if (mode === 'manual') {
            expect((await inWorld(() => service.retry(row.id))).success).toBe(false);
          } else {
            expect(await service.processAutoRetries()).toEqual({ processed: 1, succeeded: 0, failed: 0 });
          }
        } finally {
          onRetryPublish = undefined;
          failPublish = false;
        }
        const after = await read(row.id);
        expect(after.status).toBe('retrying');
        expect(after.lastRetryAt?.getTime()).toBe(renewedAt.getTime());
        expect(after.autoRetryCount).toBe(1);
        expect(after.manualRetryCount).toBe(0);
        expect(after.error).toBe(row.error);
        await inWorld(() => service.abandon(row.id));
      });
    }

    if (enforced) {
      test('tenant B cannot recover tenant A stale retry lease', async () => {
        const row = await delivery({ status: 'retrying', lastRetryAt: new Date(Date.now() - 16 * 60_000) });
        await inWorld(() => service.processAutoRetries(), TENANT_B);
        expect((await read(row.id)).status).toBe('retrying');
        expect((await read(row.id)).autoRetryCount).toBe(0);
        await inWorld(() => service.processAutoRetries());
        expect((await read(row.id)).status).toBe('pending');
        expect((await read(row.id)).autoRetryCount).toBe(1);
        await inWorld(() => service.abandon(row.id));
      });

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
