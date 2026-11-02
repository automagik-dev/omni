/** Public source ownership and scheduled DLQ cleanup, without external traffic. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { ConnectorEventPublisher, EventBus } from '@omni/core';
import { setTenantSecretMasterKey } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  assertEnforcedRuntimeIdentity,
  createDbHandle,
  deadLetterEvents,
  omniEvents,
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
import { createApp } from '../app';
import { cleanupDeadLettersForTenants } from '../services/dead-letter-maintenance';
import { WebhookService } from '../services/webhooks';
import { sealCredentialField } from '../tenancy/sealed-credentials';
import { currentTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const maybe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SECRET = 'synthetic-source-secret';

for (const mode of ['legacy', 'tenant', 'enforced'] as const) {
  maybe(`webhook ingress and cleanup (${mode}, real PostgreSQL)`, () => {
    const database = `omni_webhook_scope_${crypto.randomUUID().replaceAll('-', '')}`;
    const saved = Object.fromEntries(
      ['OMNI_MULTITENANCY_ENABLED', 'OMNI_DB_ENFORCEMENT', 'OMNI_DB_AUTH_PLANE_URL', 'OMNI_LOGIN_ENABLED'].map(
        (key) => [key, process.env[key]],
      ),
    );
    const closers: Array<() => Promise<void>> = [];
    const published: Array<{ type: string; tenant: string | null }> = [];
    let db: Database;
    let admin: Database;
    let app: ReturnType<typeof createApp>['app'];
    let services: ReturnType<typeof createApp>['services'];
    const receiveStatus = mode === 'enforced' ? 500 : 200;
    const scoped = <T>(tenant: string, fn: () => Promise<T>) =>
      mode === 'legacy' ? fn() : runInWorkerTenantScope(db, tenant, fn);

    beforeAll(async () => {
      process.env.OMNI_MULTITENANCY_ENABLED = mode === 'legacy' ? 'false' : 'true';
      process.env.OMNI_DB_ENFORCEMENT = mode === 'enforced' ? 'on' : 'false';
      process.env.OMNI_LOGIN_ENABLED = 'false';
      Reflect.deleteProperty(process.env, 'OMNI_DB_AUTH_PLANE_URL');
      provisionMigratedDatabase({ superUrl, psqlBin }, database);
      const owner = createDbHandle({ url: pgRoleUrl(superUrl, database), maxConnections: 3 });
      closers.push(owner.close);
      admin = db = owner.db;
      await admin.execute(`INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${A}', 'ingress-a', 'Ingress A', 86400, 1000, 1000), ('${B}', 'ingress-b', 'Ingress B', 86400, 1000, 1000)`);
      // G6 replaces preserved global uniques with tenant uniques. Exercise that shape too.
      await admin.execute('ALTER TABLE webhook_sources DROP CONSTRAINT webhook_sources_name_unique');
      await admin.execute('DROP INDEX webhook_sources_name_idx');
      await admin.execute('CREATE UNIQUE INDEX webhook_sources_tenant_name_test ON webhook_sources (tenant_id, name)');
      const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
      if (mode === 'enforced') await applyTenantRlsEnforcement(admin);
      else {
        // Prerequisite helpers only: no policies/FORCE in the legacy worlds.
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
        maxConnections: 3,
      });
      closers.push(runtime.close);
      db = runtime.db;
      await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
      if (mode === 'enforced')
        expect((await assertEnforcedRuntimeIdentity(db)).currentUser).toBe(DEFAULT_ROLE_NAMES.runtime);
      const authUrl = pgRoleUrl(superUrl, database, {
        name: DEFAULT_ROLE_NAMES.authPlane,
        password: passwords.authPlane,
      });
      if (mode === 'enforced') process.env.OMNI_DB_AUTH_PLANE_URL = authUrl;
      const bus = {
        publishGeneric: async (type: string, _payload: unknown, metadata?: { publishEventId?: string }) => {
          published.push({ type, tenant: currentTenantScope()?.tenantId ?? null });
          return { id: metadata?.publishEventId ?? crypto.randomUUID(), sequence: 0, stream: 'memory' };
        },
        isConnected: () => true,
      } as unknown as EventBus & ConnectorEventPublisher;
      const result = createApp(db, bus, null, null);
      app = result.app;
      services = result.services;
      if (mode === 'tenant') {
        const auth = createDbHandle({ url: authUrl, maxConnections: 2 });
        services.authPlane = { db: auth.db, source: 'dedicated-auth-plane-role', close: auth.close };
        services.webhooks = new WebhookService(db, bus, services.eventSchemas, services.deadLetters, auth.db);
      }
      closers.push(() => services.authPlane.close());
      if (mode !== 'legacy') await assertPgTestRole(services.authPlane.db, DEFAULT_ROLE_NAMES.authPlane);
      setTenantSecretMasterKey(Buffer.alloc(32, 7));
    }, 180000);

    afterAll(async () => {
      setTenantSecretMasterKey(null);
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
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    });

    async function source(name: string, tenant = A, enabled = true) {
      // 0041 keeps new sources unowned; this is setup for an already G6-assigned source.
      const [created] = await admin
        .insert(webhookSources)
        .values({
          name,
          enabled,
          signatureConfig: { algorithm: 'hmac-sha256', header: 'x-signature' },
          signatureSecret: sealCredentialField(mode === 'legacy' ? null : tenant, SECRET),
        })
        .returning();
      if (!created) throw new Error('Source fixture missing');
      if (mode !== 'legacy')
        await admin.update(webhookSources).set({ tenantId: tenant }).where(eq(webhookSources.id, created.id));
      return created;
    }
    async function deliver(name: string, valid = true) {
      const body = JSON.stringify({ value: crypto.randomUUID(), tenantId: B });
      return app.request(`/api/v2/webhooks/ingress/${name}`, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-signature': valid ? createHmac('sha256', SECRET).update(body).digest('hex') : 'bad',
        },
      });
    }

    test('signed sources use their stored owner; enforced journal inserts fail closed until ownership derivation', async () => {
      for (const [name, tenant] of [
        ['signed-a', A],
        ['signed-b', B],
      ] as const) {
        await source(name, tenant);
        const result = await deliver(name);
        expect(result.status).toBe(receiveStatus);
        if (mode === 'enforced') {
          const rawBody = JSON.stringify({ value: 'synthetic' });
          let failure: unknown;
          try {
            await services.webhooks.receivePublic(
              name,
              JSON.parse(rawBody),
              {
                'x-signature': createHmac('sha256', SECRET).update(rawBody).digest('hex'),
              },
              { rawBody },
            );
          } catch (error) {
            failure = error;
          }
          expect((failure as { cause?: { code?: string } })?.cause?.code).toBe('42501');
          expect(published).toHaveLength(0);
          expect(await scoped(tenant, () => scopedHandle(db).select().from(omniEvents))).toHaveLength(0);
          continue;
        }
        const body = (await result.json()) as { eventId: string };
        const [event] = await scoped(tenant, () =>
          scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, body.eventId)),
        );
        // Generic webhook events have no ownership parent yet (0092 trigger).
        expect(event?.tenantId).toBeNull();
        expect(published.at(-1)?.tenant).toBe(mode === 'legacy' ? null : tenant);
      }
    });

    test('unknown, disabled and bad signatures have the same rejection and publish nothing', async () => {
      await source('disabled', A, false);
      const before = published.length;
      const bodies: unknown[] = [];
      for (const [name, valid] of [
        ['missing', true],
        ['disabled', true],
        ['signed-a', false],
      ] as const) {
        const response = await deliver(name, valid);
        expect(response.status).toBe(401);
        bodies.push(await response.json());
      }
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      expect(published.length).toBe(before);
    });

    if (mode !== 'legacy') {
      test('duplicate names across tenants are refused with the same public response', async () => {
        await source('ambiguous', A);
        await source('ambiguous', B);
        const before = published.length;
        const duplicate = await deliver('ambiguous');
        const unknown = await deliver('unknown-duplicate-control');
        expect(duplicate.status).toBe(401);
        expect(await duplicate.json()).toEqual(await unknown.json());
        expect(published.length).toBe(before);
      });

      test('positive and negative cached hits do not enumerate tenants again', async () => {
        await source('cached');
        const select = spyOn(services.authPlane.db, 'select');
        const transactions = spyOn(db, 'transaction');
        try {
          expect((await deliver('cached')).status).toBe(receiveStatus);
          const first = select.mock.calls.length;
          const firstPasses = transactions.mock.calls.length;
          expect(firstPasses).toBe(3); // two tenant lookups + the selected owner's receive
          expect(first).toBeGreaterThan(0);
          expect((await deliver('cached')).status).toBe(receiveStatus);
          expect(select.mock.calls.length).toBe(first);
          expect(transactions.mock.calls.length).toBe(firstPasses + 1); // owner receive only
          expect((await deliver('negative-cached')).status).toBe(401);
          const negative = select.mock.calls.length;
          const negativePasses = transactions.mock.calls.length;
          expect(negative).toBeGreaterThan(first);
          expect((await deliver('negative-cached')).status).toBe(401);
          expect(select.mock.calls.length).toBe(negative);
          expect(transactions.mock.calls.length).toBe(negativePasses);
        } finally {
          transactions.mockRestore();
          select.mockRestore();
        }
      });

      test('rename and delete invalidate positive and negative cached ownership after commit', async () => {
        const created = await source('later-created');
        expect((await deliver('later-created')).status).toBe(receiveStatus);
        expect((await deliver('renamed')).status).toBe(401);
        await scoped(A, () => services.webhooks.update(created.id, { name: 'renamed' }));
        expect((await deliver('later-created')).status).toBe(401);
        expect((await deliver('renamed')).status).toBe(receiveStatus);
        await scoped(A, () => services.webhooks.delete(created.id));
        expect((await deliver('renamed')).status).toBe(401);
      });

      test('a cached source is still checked for disablement on every delivery', async () => {
        const created = await source('cached-disabled');
        expect((await deliver(created.name)).status).toBe(receiveStatus);
        await scoped(A, () => services.webhooks.update(created.id, { enabled: false }));
        const before = published.length;
        expect((await deliver(created.name)).status).toBe(401);
        expect(published.length).toBe(before);
      });

      test('a rolled-back rename leaves the committed ownership cache intact', async () => {
        const created = await source('rollback-source');
        expect((await deliver(created.name)).status).toBe(receiveStatus);
        await expect(
          scoped(A, async () => {
            await services.webhooks.update(created.id, { name: 'rollback-new' });
            throw new Error('rollback fixture');
          }),
        ).rejects.toThrow('rollback fixture');
        const select = spyOn(services.authPlane.db, 'select');
        try {
          expect((await deliver(created.name)).status).toBe(receiveStatus);
          expect(select.mock.calls).toHaveLength(0);
        } finally {
          select.mockRestore();
        }
      });

      test('cache expires after thirty seconds and lookup errors do not publish', async () => {
        await source('expiry');
        expect((await deliver('expiry')).status).toBe(receiveStatus);
        const select = spyOn(services.authPlane.db, 'select');
        const now = Date.now();
        const clock = spyOn(Date, 'now').mockReturnValue(now + 31000);
        try {
          expect((await deliver('expiry')).status).toBe(receiveStatus);
          expect(select.mock.calls.length).toBeGreaterThan(0);
        } finally {
          clock.mockRestore();
          select.mockRestore();
        }
        const broken = spyOn(services.authPlane.db, 'select').mockImplementation(() => {
          throw new Error('discovery unavailable');
        });
        const before = published.length;
        try {
          expect((await deliver('uncached-error')).status).toBe(500);
        } finally {
          broken.mockRestore();
        }
        expect(published.length).toBe(before);
      });
    }

    if (mode === 'enforced')
      test('unowned sources remain unreachable under enforcement', async () => {
        await admin.execute(
          `INSERT INTO webhook_sources (name, signature_config, signature_secret) VALUES ('unowned-source', '{"algorithm":"hmac-sha256","header":"x-signature"}', '${SECRET}')`,
        );
        // Runtime creation also fails closed: 0041 clears the requested owner.
        let failure: unknown;
        try {
          await scoped(A, () => services.webhooks.create({ name: 'runtime-unowned' }));
        } catch (error) {
          failure = error;
        }
        expect((failure as { cause?: { code?: string } })?.cause?.code).toBe('42501');
        for (const tenant of [A, B])
          expect(
            await scoped(tenant, () =>
              scopedHandle(db).select().from(webhookSources).where(eq(webhookSources.name, 'unowned-source')),
            ),
          ).toHaveLength(0);
        const before = published.length;
        const response = await deliver('unowned-source');
        expect(response.status).toBe(401);
        expect(published.length).toBe(before);
      });

    test('cleanup runs once per tenant and keeps pending and unowned rows under enforcement', async () => {
      const rows: Array<{ id: string; tenant: string | null }> = [];
      for (const tenant of [A, B]) {
        const [row] = await scoped(tenant, () =>
          scopedHandle(db)
            .insert(deadLetterEvents)
            .values({
              eventId: crypto.randomUUID(),
              eventType: 'custom.cleanup',
              subject: 'test',
              payload: {},
              error: 'handler failure',
              status: 'resolved',
              createdAt: new Date(Date.now() - 40 * 86400000),
            })
            .returning(),
        );
        if (row) rows.push({ id: row.id, tenant: row.tenantId });
      }
      await admin
        .insert(deadLetterEvents)
        .values({
          eventId: crypto.randomUUID(),
          eventType: 'custom.cleanup',
          subject: 'test',
          payload: {},
          error: 'unowned',
          status: 'resolved',
          createdAt: new Date(Date.now() - 40 * 86400000),
        })
        .returning();
      const [pending] = await scoped(A, () =>
        scopedHandle(db)
          .insert(deadLetterEvents)
          .values({
            eventId: crypto.randomUUID(),
            eventType: 'custom.cleanup',
            subject: 'test',
            payload: {},
            error: 'pending',
            status: 'pending',
            createdAt: new Date(Date.now() - 40 * 86400000),
          })
          .returning(),
      );
      const deleted = await cleanupDeadLettersForTenants(db, services.authPlane.db, services.deadLetters);
      expect(deleted).toBe(mode === 'enforced' ? 2 : 3);
      for (const row of rows)
        expect(
          await scoped(row.tenant ?? A, () =>
            scopedHandle(db).select().from(deadLetterEvents).where(eq(deadLetterEvents.id, row.id)),
          ),
        ).toHaveLength(0);
      expect(pending).toBeDefined();
      expect(
        await scoped(A, () =>
          scopedHandle(db).select().from(deadLetterEvents).where(eq(deadLetterEvents.id, pending!.id)),
        ),
      ).toHaveLength(1);
    });

    if (mode === 'enforced')
      test('cleanup inside a tenant request never fans out to its sibling', async () => {
        const make = (tenant: string) =>
          scoped(tenant, () =>
            scopedHandle(db)
              .insert(deadLetterEvents)
              .values({
                eventId: crypto.randomUUID(),
                eventType: 'custom.request-cleanup',
                subject: 'test',
                payload: {},
                error: 'failure',
                status: 'resolved',
                createdAt: new Date(Date.now() - 40 * 86400000),
              })
              .returning(),
          );
        const [a] = await make(A);
        const [b] = await make(B);
        expect(
          await scoped(A, () => cleanupDeadLettersForTenants(db, services.authPlane.db, services.deadLetters)),
        ).toBe(1);
        if (a)
          expect(
            await scoped(A, () =>
              scopedHandle(db).select().from(deadLetterEvents).where(eq(deadLetterEvents.id, a.id)),
            ),
          ).toHaveLength(0);
        if (b)
          expect(
            await scoped(B, () =>
              scopedHandle(db).select().from(deadLetterEvents).where(eq(deadLetterEvents.id, b.id)),
            ),
          ).toHaveLength(1);
      });
  });
}
