/** Persisted webhook-source ownership, through the non-owning runtime role. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type EventBus, setTenantSecretMasterKey } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  assertEnforcedRuntimeIdentity,
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
import { WebhookService } from '../services/webhooks';
import { sealCredentialField } from '../tenancy/sealed-credentials';
import { currentTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const maybe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SECRET = 'synthetic-webhook-ownership-secret';

for (const mode of ['legacy', 'tenant', 'enforced'] as const) {
  maybe(`webhook event ownership (${mode}, real PostgreSQL)`, () => {
    const database = `omni_webhook_owner_${crypto.randomUUID().replaceAll('-', '')}`;
    const previous = {
      multitenancy: process.env.OMNI_MULTITENANCY_ENABLED,
      enforcement: process.env.OMNI_DB_ENFORCEMENT,
    };
    const closers: Array<() => Promise<void>> = [];
    const published: Array<{ id: string; tenant: string | null }> = [];
    let db: Database;
    let service: WebhookService;
    let sourceA: string;
    let sourceB: string;
    let unowned: string;
    let instanceA: string;
    const scope = <T>(tenant: string, fn: () => Promise<T>) =>
      mode === 'legacy' ? fn() : runInWorkerTenantScope(db, tenant, fn);

    beforeAll(async () => {
      process.env.OMNI_MULTITENANCY_ENABLED = mode === 'legacy' ? 'false' : 'true';
      process.env.OMNI_DB_ENFORCEMENT = mode === 'enforced' ? 'on' : 'false';
      provisionMigratedDatabase({ superUrl, psqlBin }, database);
      const owner = createDbHandle({ url: pgRoleUrl(superUrl, database) });
      closers.push(owner.close);
      const admin = owner.db;
      // Replay the new migration twice: CREATE OR REPLACE must remain idempotent.
      const migration = readFileSync(
        new URL('../../../db/drizzle/0095_webhook_event_ownership.sql', import.meta.url),
        'utf8',
      );
      await admin.execute(migration);
      await admin.execute(migration);
      await admin.execute(`INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${A}', 'webhook-owner-a', 'Webhook A', 86400, 1000, 1000),
        ('${B}', 'webhook-owner-b', 'Webhook B', 86400, 1000, 1000)`);
      setTenantSecretMasterKey(Buffer.alloc(32, 7));
      // Admin is fixture setup only: source ownership is still assigned by G6.
      sourceA = await seedSource(admin, 'owned-a', A);
      sourceB = await seedSource(admin, 'owned-b', B);
      unowned = await seedSource(admin, 'unowned', null);
      const [instance] = await admin
        .insert(instances)
        .values({ name: 'webhook-parent', channel: 'whatsapp-baileys' })
        .returning();
      if (!instance) throw new Error('instance fixture missing');
      instanceA = instance.id;
      if (mode !== 'legacy') await admin.update(instances).set({ tenantId: A }).where(eq(instances.id, instanceA));
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
        url: pgRoleUrl(superUrl, database, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
        maxConnections: 2,
      });
      closers.push(runtime.close);
      db = runtime.db;
      await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
      if (mode === 'enforced')
        expect((await assertEnforcedRuntimeIdentity(db)).currentUser).toBe(DEFAULT_ROLE_NAMES.runtime);
      const bus = {
        publishGeneric: async (_type: string, _payload: unknown, metadata: { publishEventId: string }) => {
          published.push({ id: metadata.publishEventId, tenant: currentTenantScope()?.tenantId ?? null });
          return { id: metadata.publishEventId, sequence: 0, stream: 'memory' };
        },
      } as unknown as EventBus;
      service = new WebhookService(db, bus);
    }, 180000);

    afterAll(async () => {
      setTenantSecretMasterKey(null);
      for (const close of closers.reverse()) await close();
      const result = Bun.spawnSync({
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
      if (result.exitCode) throw new Error(result.stderr.toString());
      for (const [key, value] of [
        ['OMNI_MULTITENANCY_ENABLED', previous.multitenancy],
        ['OMNI_DB_ENFORCEMENT', previous.enforcement],
      ] as const) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    });

    async function seedSource(admin: Database, name: string, tenant: string | null): Promise<string> {
      const tenantId = mode === 'legacy' ? null : tenant;
      const [row] = await admin
        .insert(webhookSources)
        .values({
          name,
          signatureConfig: { algorithm: 'hmac-sha256', header: 'x-signature' },
          signatureSecret: sealCredentialField(tenantId, SECRET),
        })
        .returning();
      if (!row) throw new Error('source fixture missing');
      if (tenantId) await admin.update(webhookSources).set({ tenantId }).where(eq(webhookSources.id, row.id));
      return row.id;
    }

    async function receive(name: string, tenant: string) {
      const payload = { tenantId: B, webhookSourceId: sourceB, metadata: { webhookSourceId: sourceB } };
      const rawBody = JSON.stringify(payload);
      return scope(tenant, () =>
        service.receive(
          name,
          payload,
          {
            'x-signature': createHmac('sha256', SECRET).update(rawBody).digest('hex'),
          },
          { rawBody, autoCreate: false, requireSignature: true },
        ),
      );
    }

    async function insert(metadata: Record<string, unknown>, tenant = A, parent?: string) {
      return scope(tenant, () =>
        scopedHandle(db)
          .insert(omniEvents)
          .values({
            channel: 'internal',
            eventType: 'custom.webhook.test',
            tenantId: B,
            metadata,
            ...(parent ? { instanceId: parent } : {}),
          })
          .returning(),
      );
    }

    test('signed receive journals the persisted source owner, ignoring payload claims', async () => {
      for (const [name, tenant, sourceId] of [
        ['owned-a', A, sourceA],
        ['owned-b', B, sourceB],
      ] as const) {
        const result = await receive(name, tenant);
        expect(result.received).toBe(true);
        const [event] = await scope(tenant, () =>
          scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, result.eventId)),
        );
        expect(event?.tenantId).toBe(mode === 'legacy' ? null : tenant);
        expect(event?.metadata?.webhookSourceId).toBe(sourceId);
        expect(published.at(-1)?.tenant).toBe(mode === 'legacy' ? null : tenant);
      }
    });

    test('the persisted source wins over explicit tenant claims on the journal insert', async () => {
      const [event] = await insert({ source: 'webhook', webhookSourceId: sourceA, tenantId: B });
      expect(event?.tenantId).toBe(mode === 'legacy' ? null : A);
    });

    test('the pre-existing instance-parent derivation is preserved', async () => {
      const [event] = await insert({ source: 'ordinary' }, A, instanceA);
      expect(event?.tenantId).toBe(mode === 'legacy' ? null : A);
    });

    test('renaming a source keeps ownership tied to its stable id', async () => {
      await scope(A, () => service.update(sourceA, { name: 'renamed-a' }));
      const result = await receive('renamed-a', A);
      const [event] = await scope(A, () =>
        scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, result.eventId)),
      );
      expect(event?.tenantId).toBe(mode === 'legacy' ? null : A);
      expect(event?.metadata?.webhookSourceId).toBe(sourceA);
    });

    const refusals: Array<[string, () => Record<string, unknown>]> = [
      ['missing-id', () => ({ source: 'webhook' })],
      ['malformed-id', () => ({ source: 'webhook', webhookSourceId: 'not-a-uuid' })],
      ['missing-row', () => ({ source: 'webhook', webhookSourceId: crypto.randomUUID() })],
      ['unowned', () => ({ source: 'webhook', webhookSourceId: unowned })],
      ['wrong-source', () => ({ source: 'other', webhookSourceId: sourceA })],
    ];
    for (const [kind, metadataFor] of refusals)
      test(`${kind} cannot establish webhook event ownership`, async () => {
        const metadata = { ...metadataFor(), tenantId: B };
        if (mode === 'enforced') {
          let failure: unknown;
          try {
            await insert(metadata);
          } catch (error) {
            failure = error;
          }
          expect(unwrapDbError(failure)).toMatchObject({ code: '42501' });
        } else {
          const [row] = await insert(metadata);
          expect(row?.tenantId).toBeNull();
        }
      });

    if (mode !== 'legacy') {
      for (const [kind, metadataFor] of refusals.filter(([kind]) =>
        ['malformed-id', 'missing-row', 'unowned'].includes(kind),
      ))
        test(`${kind} cannot borrow ownership from an instance parent`, async () => {
          if (mode === 'enforced') {
            let failure: unknown;
            try {
              await insert(metadataFor(), A, instanceA);
            } catch (error) {
              failure = error;
            }
            expect(unwrapDbError(failure)).toMatchObject({ code: '42501' });
          } else {
            const [event] = await insert(metadataFor(), A, instanceA);
            expect(event?.tenantId).toBeNull();
          }
        });

      test('a source owned by another tenant cannot override an instance parent', async () => {
        let failure: unknown;
        try {
          await insert({ source: 'webhook', webhookSourceId: sourceB }, A, instanceA);
        } catch (error) {
          failure = error;
        }
        expect(unwrapDbError(failure)).toMatchObject({ code: mode === 'enforced' ? '42501' : '23514' });
      });
    }

    if (mode === 'enforced') {
      test('tenant B cannot read or journal against tenant A source', async () => {
        expect(
          await scope(B, () => scopedHandle(db).select().from(webhookSources).where(eq(webhookSources.id, sourceA))),
        ).toHaveLength(0);
        expect(
          await scope(B, () => scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.tenantId, A))),
        ).toHaveLength(0);
        let failure: unknown;
        try {
          await insert({ source: 'webhook', webhookSourceId: sourceA }, B);
        } catch (error) {
          failure = error;
        }
        expect(unwrapDbError(failure)).toMatchObject({ code: '42501' });
      });
    }
  });
}
