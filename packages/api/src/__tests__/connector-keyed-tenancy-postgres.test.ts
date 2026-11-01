/** G2: migrate existing bindings, then exercise the real constrained ingress roles. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';
import { CURRENT_ENVELOPE_VERSION, setTenantSecretMasterKey } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  connectorEventSubscriptions,
  connectors,
  createDbHandle,
  omniEvents,
} from '@omni/db';
import {
  assertPgTestRole,
  createDatabaseFromTemplate,
  driverRejection,
  ensureSqlTemplate,
  pgRoleUrl,
  sqlTemplateName,
} from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ConnectorService } from '../services/connectors';
import { resolveConnectorIngressTenant, resolveConnectorTenantByConnectorId } from '../tenancy/connector-ingress';
import { isSealedCredentialField, openCredentialField, sealCredentialField } from '../tenancy/sealed-credentials';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const postgresDescribe = superUrl ? describe : describe.skip;
const drizzleDir = join(import.meta.dir, '../../../db/drizzle');
const migration = join(drizzleDir, '0092_connector_ingress.sql');
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const connectorA = crypto.randomUUID();
const connectorB = crypto.randomUUID();
const subscriptionId = crypto.randomUUID();
const typedSubscriptionId = crypto.randomUUID();
const automationId = crypto.randomUUID();
const SECRET = 'existing-clickup-secret';
const TYPE = 'connector.gitlab.merge_request.merged';

function urlFor(database: string, user?: { name: string; password: string }): string {
  return pgRoleUrl(superUrl, database, user);
}

// Raw SQL fixtures exercise the database contract before G4 widens EventType.
async function insertTypedJournal(
  db: Database,
  metadata: Record<string, unknown>,
  idempotencyKey: string = crypto.randomUUID(),
) {
  const rows = z.array(z.object({ tenant_id: z.string().nullable() })).parse(
    await db.execute(sql`
    INSERT INTO omni_events (channel, direction, event_type, idempotency_key, tenant_id, metadata, raw_payload)
    VALUES ('internal', 'internal', ${TYPE}, ${idempotencyKey}, ${TENANT_B}, ${JSON.stringify(metadata)}::jsonb,
      ${JSON.stringify({ connectorId: connectorA, subscriptionIds: [typedSubscriptionId], targetAutomationIds: [] })}::jsonb)
    RETURNING tenant_id
  `),
  );
  return rows[0]?.tenant_id;
}

postgresDescribe('connector-keyed ingress schema and tenancy', () => {
  const dbName = `omni_connector_keyed_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const handles: ReturnType<typeof createDbHandle>[] = [];
  let owner: ReturnType<typeof createDbHandle>['db'];
  let runtime: ReturnType<typeof createDbHandle>['db'];
  let authPlane: ReturnType<typeof createDbHandle>['db'];

  function open(url: string) {
    const handle = createDbHandle({ url, maxConnections: 2 });
    handles.push(handle);
    return handle.db;
  }

  function applyMigration(file: string = migration) {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', urlFor(dbName), '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  }

  beforeAll(async () => {
    const access = { superUrl, psqlBin };
    const prefix = readdirSync(drizzleDir)
      .filter((name) => name.endsWith('.sql') && name < '0092_')
      .sort()
      .map((name) => readFileSync(join(drizzleDir, name), 'utf8'))
      .join('\n');
    const template = sqlTemplateName('omni_connector_g2_prefix', prefix);
    ensureSqlTemplate(access, template, prefix);
    createDatabaseFromTemplate(access, dbName, template);
    owner = open(urlFor(dbName));
    await owner.execute(sql`
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        (${TENANT_A}, 'connector-keyed-a', 'Connector A', 86400, 1000, 1000),
        (${TENANT_B}, 'connector-keyed-b', 'Connector B', 86400, 1000, 1000)
    `);
    await owner.execute(sql`
      INSERT INTO connectors (id, provider, name, credentials, status, tenant_id) VALUES
        (${connectorA}, 'clickup', 'Existing ClickUp', '{}', 'connected', ${TENANT_A}),
        (${connectorB}, 'gitlab', 'Foreign GitLab', '{}', 'connected', ${TENANT_B})
    `);
    await owner.execute(sql`
      INSERT INTO automations (id, name, trigger_event_type, actions)
      VALUES (${automationId}, 'Existing ClickUp automation', 'connector.event', '[]'::jsonb)
    `);
    await owner.execute(sql`UPDATE automations SET tenant_id = ${TENANT_A} WHERE id = ${automationId}`);
    // This is a real PRE-0092 row: no ingress column or nullable fields yet.
    await owner.execute(sql`
      INSERT INTO connector_event_subscriptions
        (id, connector_id, provider_event_key, target_automation_id, verification_secret, tenant_id)
      VALUES (${subscriptionId}, ${connectorA}, 'taskStatusUpdated', ${automationId}, ${SECRET}, ${TENANT_A})
    `);
    applyMigration();
    applyMigration();
    // Keep the pre-0092 upgrade proof above, then bring its ORM fixture to the
    // current schema (select/returning includes later additive columns).
    for (const name of readdirSync(drizzleDir)
      .filter((name) => name.endsWith('.sql') && name > '0092_connector_ingress.sql')
      .sort()) {
      applyMigration(join(drizzleDir, name));
    }
    await owner.insert(connectorEventSubscriptions).values({
      id: typedSubscriptionId,
      connectorId: connectorA,
      providerEventKey: TYPE,
      ingress: 'connector',
      tenantId: TENANT_A,
    });
    await applyTenantRlsEnforcement(owner);
    const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
    await applyTenancyRoles(owner, passwords, DEFAULT_ROLE_NAMES, dbName);
    runtime = open(urlFor(dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }));
    await assertPgTestRole(runtime, DEFAULT_ROLE_NAMES.runtime);
    authPlane = open(urlFor(dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }));
  }, 180_000);

  afterAll(async () => {
    setTenantSecretMasterKey(null);
    for (const handle of handles) await handle.close();
    Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '--dbname',
        urlFor('postgres'),
        '-c',
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
      ],
      stdout: 'ignore',
      stderr: 'ignore',
    });
  });

  test('migration reruns preserve an existing ClickUp binding and default its route', async () => {
    const [row] = await owner
      .select()
      .from(connectorEventSubscriptions)
      .where(eq(connectorEventSubscriptions.id, subscriptionId));
    expect(row).toMatchObject({
      ingress: 'subscription',
      targetAutomationId: automationId,
      verificationSecret: SECRET,
      providerEventKey: 'taskStatusUpdated',
    });
    const [connector] = await owner.select().from(connectors).where(eq(connectors.id, connectorA));
    expect(connector).toMatchObject({
      hookSecret: null,
      totalUnmatched: 0,
      lastUnmatchedAt: null,
      lastUnmatchedEventType: null,
    });
  });

  test('CHECK refuses both wrong secret shapes and invalid ingress values', async () => {
    for (const values of [
      { ingress: 'connector', verificationSecret: SECRET },
      { ingress: 'subscription', verificationSecret: null },
      { ingress: 'unknown', verificationSecret: null },
    ]) {
      await expect(
        driverRejection(
          owner.execute(sql`
        INSERT INTO connector_event_subscriptions
          (connector_id, provider_event_key, ingress, verification_secret, tenant_id)
        VALUES (${connectorA}, ${crypto.randomUUID()}, ${values.ingress}, ${values.verificationSecret}, ${TENANT_A})
      `),
        ),
      ).rejects.toThrow(/connector_event_subscriptions_ingress_secret_check/);
    }
  });

  test('NULL targets remain unique while the existing targeted uniqueness stays', async () => {
    await expect(
      driverRejection(
        owner.insert(connectorEventSubscriptions).values({
          connectorId: connectorA,
          providerEventKey: TYPE,
          ingress: 'connector',
          tenantId: TENANT_A,
        }),
      ),
    ).rejects.toThrow(/connector_event_subscriptions_untargeted_uq/);
    await expect(
      driverRejection(
        owner.insert(connectorEventSubscriptions).values({
          connectorId: connectorA,
          providerEventKey: 'taskStatusUpdated',
          targetAutomationId: automationId,
          verificationSecret: SECRET,
          tenantId: TENANT_A,
        }),
      ),
    ).rejects.toThrow(/connector_event_subscriptions_binding_uq/);
    const rows = await owner
      .insert(connectorEventSubscriptions)
      .values({
        connectorId: connectorA,
        providerEventKey: TYPE,
        ingress: 'connector',
        targetAutomationId: automationId,
        tenantId: TENANT_A,
      })
      .returning();
    expect(rows).toHaveLength(1);
  });

  test('runtime resolves persisted owners and rejects wrong-route, foreign and unknown ids', async () => {
    expect(await resolveConnectorIngressTenant(runtime, subscriptionId)).toBe(TENANT_A);
    expect(await resolveConnectorIngressTenant(runtime, typedSubscriptionId)).toBeNull();
    expect(await resolveConnectorTenantByConnectorId(runtime, connectorA)).toBe(TENANT_A);
    expect(await resolveConnectorTenantByConnectorId(runtime, connectorB)).toBe(TENANT_B);
    expect(await resolveConnectorTenantByConnectorId(runtime, crypto.randomUUID())).toBeNull();
    expect(await resolveConnectorTenantByConnectorId(runtime, 'invalid')).toBeNull();
    await runTenantWorkDb(runtime, TENANT_A, async () => {
      expect(await resolveConnectorTenantByConnectorId(scopedHandle(runtime), connectorA)).toBe(TENANT_A);
      expect(await resolveConnectorTenantByConnectorId(scopedHandle(runtime), connectorB)).toBeNull();
    });
  });

  test('wrong-route and NULL-target subscriptions return the uniform 401 without journaling', async () => {
    const [incomplete] = await owner
      .insert(connectorEventSubscriptions)
      .values({
        connectorId: connectorA,
        providerEventKey: 'taskCreated',
        verificationSecret: SECRET,
        tenantId: TENANT_A,
      })
      .returning();
    if (!incomplete) throw new Error('missing subscription fixture');
    expect(await resolveConnectorIngressTenant(runtime, incomplete.id)).toBeNull();
    const service = new ConnectorService(runtime, null, new ConnectorRegistry([clickupManifest]));
    const before = await owner.select({ id: omniEvents.id }).from(omniEvents);
    for (const id of [typedSubscriptionId, incomplete.id]) {
      const result = await service.receive(id, '{}', {});
      expect(result).toEqual({
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'Connector verification failed' } },
      });
    }
    expect(await owner.select({ id: omniEvents.id }).from(omniEvents)).toEqual(before);
  });

  test('lookup owner is constrained, PUBLIC and auth-plane cannot execute, runtime gains no membership', async () => {
    const rows = z
      .array(
        z.object({
          rolcanlogin: z.boolean(),
          rolbypassrls: z.boolean(),
          rolsuper: z.boolean(),
          runtime_member: z.boolean(),
          runtime_execute: z.boolean(),
          public_execute: z.boolean(),
          can_select: z.boolean(),
          can_update: z.boolean(),
        }),
      )
      .parse(
        await owner.execute(sql`
      SELECT r.rolcanlogin, r.rolbypassrls, r.rolsuper,
        pg_has_role('omni_runtime', r.oid, 'USAGE') AS runtime_member,
        has_function_privilege('omni_runtime', p.oid, 'EXECUTE') AS runtime_execute,
        EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
        has_table_privilege(r.oid, 'public.connectors', 'SELECT') AS can_select,
        has_table_privilege(r.oid, 'public.connectors', 'UPDATE') AS can_update
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.oid = 'public.omni_connector_ingress_tenant_by_connector(uuid)'::regprocedure
    `),
      );
    expect(rows).toEqual([
      {
        rolcanlogin: false,
        rolbypassrls: false,
        rolsuper: false,
        runtime_member: false,
        runtime_execute: true,
        public_execute: false,
        can_select: true,
        can_update: false,
      },
    ]);
    await expect(
      driverRejection(
        authPlane.execute(sql`
      SELECT public.omni_connector_ingress_tenant_by_connector(${connectorA}::uuid)
    `),
      ),
    ).rejects.toThrow(/permission denied/);
    // Even manually setting either lookup GUC cannot turn runtime into the owner.
    await expect(
      driverRejection(
        runtime.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.connector_ingress_connector_id', ${connectorA}, true)`);
          await tx.execute(sql`SELECT set_config('app.connector_ingress_subscription_id', ${subscriptionId}, true)`);
          return tx.select().from(connectors);
        }),
      ),
    ).rejects.toThrow(/app.tenant_id|row-level security/);
  });

  test('typed journal ownership is derived from the connector under enforced RLS', async () => {
    await runTenantWorkDb(runtime, TENANT_A, async () => {
      const tenant = await insertTypedJournal(
        scopedHandle(runtime),
        {
          source: 'connector',
          connectorId: connectorA,
          subscriptionIds: [typedSubscriptionId],
          fullEventType: TYPE,
          correlationId: crypto.randomUUID(),
          provider: 'clickup',
          tenantId: TENANT_A,
          envelopeVersion: CURRENT_ENVELOPE_VERSION,
        },
        `connector:${connectorA}:typed-proof`,
      );
      expect(tenant).toBe(TENANT_A);
    });
    await runTenantWorkDb(runtime, TENANT_B, async () => {
      const foreign = await scopedHandle(runtime)
        .select()
        .from(omniEvents)
        .where(eq(omniEvents.idempotencyKey, `connector:${connectorA}:typed-proof`));
      expect(foreign).toHaveLength(0);
    });
  });

  test('foreign, malformed and incomplete typed metadata cannot claim a tenant', async () => {
    for (const metadata of [
      { source: 'connector', connectorId: connectorB, subscriptionIds: [typedSubscriptionId] },
      { source: 'connector', connectorId: 'invalid', subscriptionIds: [typedSubscriptionId] },
      { source: 'connector', connectorId: connectorA },
      { source: 'other', connectorId: connectorA, subscriptionIds: [typedSubscriptionId] },
    ]) {
      await expect(
        driverRejection(runTenantWorkDb(runtime, TENANT_A, () => insertTypedJournal(scopedHandle(runtime), metadata))),
      ).rejects.toThrow(/row-level security/);
    }
  });

  test('legacy subscription derivation survives and conflicting owning metadata is refused', async () => {
    await runTenantWorkDb(runtime, TENANT_A, async () => {
      const [row] = await scopedHandle(runtime)
        .insert(omniEvents)
        .values({
          channel: 'internal',
          direction: 'internal',
          eventType: 'connector.event',
          metadata: { source: 'connector', subscriptionId },
        })
        .returning();
      expect(row?.tenantId).toBe(TENANT_A);
    });
    await expect(
      driverRejection(
        insertTypedJournal(owner, {
          source: 'connector',
          subscriptionId,
          connectorId: connectorB,
          subscriptionIds: [typedSubscriptionId],
        }),
      ),
    ).rejects.toThrow(/owning parents disagree/);
  });

  test('hook-secret-only credentials store sealed {} and the column stays NOT NULL', async () => {
    setTenantSecretMasterKey(new Uint8Array(32).fill(7));
    try {
      const sealed = sealCredentialField(TENANT_A, '{}');
      const [row] = await runTenantWorkDb(runtime, TENANT_A, () =>
        scopedHandle(runtime)
          .insert(connectors)
          .values({
            provider: 'gitlab',
            name: 'Hook secret only',
            credentials: sealed,
            hookSecret: sealCredentialField(TENANT_A, 'hook-secret-only-fixture'),
            status: 'connected',
            tenantId: TENANT_A,
          })
          .returning(),
      );
      expect(row?.credentials).toBe(sealed);
      expect(isSealedCredentialField(row?.credentials)).toBe(true);
      expect(openCredentialField(TENANT_A, row?.credentials)).toBe('{}');
      expect(openCredentialField(TENANT_B, row?.credentials)).toBeNull();
      await expect(
        driverRejection(
          owner.execute(sql`
        INSERT INTO connectors (provider, name, credentials, status) VALUES ('gitlab', 'Invalid NULL credentials', NULL, 'connected')
      `),
        ),
      ).rejects.toThrow(/not-null constraint/);
    } finally {
      setTenantSecretMasterKey(null);
    }
  });
});
