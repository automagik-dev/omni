/** Paired-agents follow-up 1: the sanctioned grant writer stamps the SOURCE's tenant.
 * Legacy mode runs as the runtime role with tenant enforcement off; enforced mode
 * applies FORCE RLS and writes inside a worker tenant scope, as the slice-6 writer will.
 * Superuser use is limited to fixture seeding, read-back and teardown.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { AgentSourceGrantInput } from '@omni/core';
import {
  type AgentGrantSourceKind,
  DEFAULT_ROLE_NAMES,
  type Database,
  RLS_TENANT_TABLES,
  agentGrantSourceKinds,
  agentSourceGrants,
  agents,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  connectorEventSubscriptions,
  connectors,
  createDbHandle,
  insertAgentSourceGrant,
  tenants,
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
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const pgDescribe = superUrl ? describe : describe.skip;
const SOURCE_TABLES: Record<AgentGrantSourceKind, string> = {
  connector: 'connectors',
  connector_subscription: 'connector_event_subscriptions',
  webhook_source: 'webhook_sources',
  agent: 'agents',
};

for (const mode of ['legacy', 'enforced'] as const) {
  pgDescribe(`insertAgentSourceGrant stamps the source tenant (${mode})`, () => {
    const database = `agent_grant_writer_${mode}_${randomUUID().replaceAll('-', '')}`;
    const [T, U, A] = [randomUUID(), randomUUID(), randomUUID()];
    const closers: (() => Promise<void>)[] = [];
    const previous = { ...process.env };
    let owner: Database;
    let runtime: Database;
    function open(role?: { name: string; password: string }) {
      const handle = createDbHandle({ url: pgRoleUrl(superUrl, database, role), maxConnections: 4 });
      closers.push(handle.close);
      return handle.db;
    }
    beforeAll(async () => {
      provisionMigratedDatabase({ superUrl, psqlBin }, database);
      owner = open();
      for (const id of [T, U])
        await owner.insert(tenants).values({
          id,
          slug: id,
          displayName: id,
          maxKeyTtlSeconds: 86400,
          maxKeyRateLimit: 1000,
          maxKeyBudget: 1000,
        });
      await owner.insert(agents).values({ id: A, name: `grantee-${A}`, provider: 'claude' });
      if (mode === 'enforced') await applyTenantRlsEnforcement(owner);
      // Legacy: no policies, only the functions the tenancy roles are granted (as the grants suite does).
      else
        for (const statement of [
          ...connectorIngressRoleStatements(),
          ...contextFunctionStatements(),
          ...connectorIngressFunctionStatements(),
        ])
          await owner.execute(sql.raw(statement));
      const passwords = { ddl: randomUUID(), runtime: randomUUID(), authPlane: randomUUID() };
      await applyTenancyRoles(owner, passwords, DEFAULT_ROLE_NAMES, database);
      runtime = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
      await assertPgTestRole(runtime, DEFAULT_ROLE_NAMES.runtime);
    }, 180_000);
    beforeEach(() => {
      if (mode === 'enforced') process.env.OMNI_MULTITENANCY_ENABLED = 'true';
      else Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    });
    afterEach(() => {
      if (previous.OMNI_MULTITENANCY_ENABLED === undefined)
        Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
      else process.env.OMNI_MULTITENANCY_ENABLED = previous.OMNI_MULTITENANCY_ENABLED;
    });
    afterAll(async () => {
      for (const close of closers.reverse()) await close();
      dropDatabaseOrThrow({ superUrl, psqlBin }, database);
    });

    /** Seed a source as the superuser, then pin its stored tenant (INSERT triggers may derive NULL). */
    async function seedSource(kind: AgentGrantSourceKind, tenantId: string | null): Promise<string> {
      const id = randomUUID();
      const stored = await {
        connector: async () => {
          await owner
            .insert(connectors)
            .values({ id, name: id, provider: 'gitlab', status: 'connected', tenantId, credentials: '{}' });
          return owner.update(connectors).set({ tenantId }).where(eq(connectors.id, id)).returning();
        },
        connector_subscription: async () => {
          const parent = await seedSource('connector', tenantId);
          await owner
            .insert(connectorEventSubscriptions)
            .values({ id, connectorId: parent, providerEventKey: `k-${id}`, ingress: 'connector', tenantId });
          return owner
            .update(connectorEventSubscriptions)
            .set({ tenantId })
            .where(eq(connectorEventSubscriptions.id, id))
            .returning();
        },
        webhook_source: async () => {
          await owner.insert(webhookSources).values({ id, name: `w-${id}` });
          return owner.update(webhookSources).set({ tenantId }).where(eq(webhookSources.id, id)).returning();
        },
        agent: async () => {
          await owner.insert(agents).values({ id, name: `producer-${id}`, provider: 'claude' });
          return owner.update(agents).set({ tenantId }).where(eq(agents.id, id)).returning();
        },
      }[kind]();
      expect(stored[0]?.tenantId ?? null).toBe(tenantId);
      return id;
    }
    function input(sourceKind: AgentGrantSourceKind, sourceId: string): AgentSourceGrantInput {
      return { agentId: A, sourceKind, sourceId, approvedByKeyId: randomUUID() };
    }
    /** Read back as the superuser, so RLS cannot hide a row that was written. */
    async function stored(sourceIds: string[]) {
      return owner.select().from(agentSourceGrants).where(inArray(agentSourceGrants.sourceId, sourceIds));
    }
    /** The slice-6 writer's shape: inside the tenant's worker scope, on the scoped handle. */
    function write(tenantId: string, grant: AgentSourceGrantInput) {
      return runInWorkerTenantScope(runtime, tenantId, () => insertAgentSourceGrant(scopedHandle(runtime), grant));
    }

    if (mode === 'legacy') {
      for (const kind of agentGrantSourceKinds) {
        test(`${kind}: a T source stamps T and a NULL source stamps NULL`, async () => {
          const [tenanted, untenanted] = [await seedSource(kind, T), await seedSource(kind, null)];
          expect((await insertAgentSourceGrant(runtime, input(kind, tenanted))).tenantId).toBe(T);
          expect((await insertAgentSourceGrant(runtime, input(kind, untenanted))).tenantId).toBeNull();
          const rows = await stored([tenanted, untenanted]);
          expect(Object.fromEntries(rows.map((row) => [row.sourceId, row.tenantId]))).toEqual({
            [tenanted]: T,
            [untenanted]: null,
          });
          expect(rows.every((row) => row.agentId === A && row.sourceKind === kind && row.revokedAt === null)).toBe(
            true,
          );
        });
      }
      test('a missing source throws NOT_FOUND and writes nothing', async () => {
        const missing = randomUUID();
        for (const kind of agentGrantSourceKinds)
          await expect(insertAgentSourceGrant(runtime, input(kind, missing))).rejects.toMatchObject({
            code: 'NOT_FOUND',
          });
        expect(await stored([missing])).toEqual([]);
      });
      test('a caller-supplied tenantId is rejected, never stored', async () => {
        const source = await seedSource('connector', T);
        const forged = { ...input('connector', source), tenantId: U } as AgentSourceGrantInput;
        await expect(insertAgentSourceGrant(runtime, forged)).rejects.toMatchObject({ name: 'ZodError' });
        expect(await stored([source])).toEqual([]);
      });
    } else {
      test('enforcement state: every source table is FORCE RLS exactly when it is a tenant table', async () => {
        const states = await runtime.execute(
          sql`select relname, relforcerowsecurity from pg_class where relname in ${Object.values(SOURCE_TABLES)}`,
        );
        const forced = Object.fromEntries(states.map((row) => [row.relname, row.relforcerowsecurity]));
        for (const table of Object.values(SOURCE_TABLES)) expect(forced[table]).toBe(RLS_TENANT_TABLES.includes(table));
      });
      for (const kind of agentGrantSourceKinds) {
        test(`${kind}: inside T's worker scope a T source stamps T`, async () => {
          const source = await seedSource(kind, T);
          expect((await write(T, input(kind, source))).tenantId).toBe(T);
          expect((await stored([source])).map((row) => row.tenantId)).toEqual([T]);
        });
        if (RLS_TENANT_TABLES.includes(SOURCE_TABLES[kind]))
          test(`${kind}: U's source is invisible from T's scope; NOT_FOUND, nothing written`, async () => {
            const source = await seedSource(kind, U);
            await expect(write(T, input(kind, source))).rejects.toMatchObject({ code: 'NOT_FOUND' });
            expect(await stored([source])).toEqual([]);
          });
      }
    }
  });
}
