/** Agent activation transitions and boot/delete serialization on disposable PostgreSQL. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import {
  type Agent,
  DEFAULT_ROLE_NAMES,
  type Database,
  type Instance,
  agentRoutes,
  agents,
  apiKeys,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  chats,
  createDbHandle,
  instances,
  tenants,
} from '@omni/db';
import { assertPgTestRole, pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { CacheKeys, apiKeyCache } from '../../cache';
import { agentsRoutes } from '../../routes/v2/agents';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import type { AppVariables } from '../../types';
import { reconcileAgentKeys } from '../agent-key-reconciliation';
import { ApiKeyService } from '../api-keys';
import { type Services, createServices } from '../index';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('agent activation key lifecycle (real PostgreSQL)', () => {
  const dbName = `omni_key_activation_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let runtime: Database;
  let authPlane: Database;
  let runtimeRole: { name: string; password: string };
  let keys: ApiKeyService;

  function open(role?: { name: string; password: string }, maxConnections = 3) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName, role), maxConnections });
    closers.push(handle.close);
    return handle.db;
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    db = open();
    keys = new ApiKeyService(db);
    const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
    await applyTenantRlsEnforcement(db);
    await applyTenancyRoles(db, passwords, DEFAULT_ROLE_NAMES, dbName);
    runtimeRole = { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime };
    runtime = open(runtimeRole, 1);
    authPlane = open({ name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane });
    await assertPgTestRole(runtime, DEFAULT_ROLE_NAMES.runtime);
    await assertPgTestRole(authPlane, DEFAULT_ROLE_NAMES.authPlane);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    const result = Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '--set',
        'ON_ERROR_STOP=1',
        '--dbname',
        superUrl,
        '-c',
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  });

  async function owner(tenantId: string | null, name = `lifecycle-${crypto.randomUUID()}`): Promise<Agent> {
    if (tenantId)
      await db
        .insert(tenants)
        .values({
          id: tenantId,
          slug: tenantId,
          displayName: tenantId,
          maxKeyTtlSeconds: 86400,
          maxKeyRateLimit: 100,
          maxKeyBudget: 100,
        })
        .onConflictDoNothing();
    const [row] = await db
      .insert(agents)
      .values({ name, provider: 'claude', metadata: { omniScopes: ['messages:send', 'chats:read'] } })
      .returning();
    if (!row) throw new Error('agent fixture missing');
    if (tenantId) await db.update(agents).set({ tenantId }).where(eq(agents.id, row.id));
    return { ...row, tenantId };
  }

  async function instance(tenantId: string | null, agentId: string | null = null): Promise<Instance> {
    const [row] = await db
      .insert(instances)
      .values({ name: crypto.randomUUID(), channel: 'whatsapp-baileys', tenantId, agentId })
      .returning();
    if (!row) throw new Error('instance fixture missing');
    return row;
  }

  async function conversation(target: Instance) {
    const [row] = await db
      .insert(chats)
      .values({ instanceId: target.id, externalId: crypto.randomUUID(), channel: target.channel, chatType: 'dm' })
      .returning();
    if (!row?.instanceId) throw new Error('chat fixture missing');
    return { ...row, instanceId: row.instanceId };
  }

  async function storedRoute(target: Instance, agent: Agent) {
    const chat = await conversation(target);
    const [row] = await db
      .insert(agentRoutes)
      .values({ instanceId: target.id, agentId: agent.id, chatId: chat.id, scope: 'chat' })
      .returning();
    if (!row) throw new Error('route fixture missing');
    return row;
  }

  async function mint(services: Services, parentId: string, target: Instance) {
    const result = await services.apiKeys.mintChild(parentId, await conversation(target));
    if (!result.ok) throw new Error('child mint failed');
    return result.child;
  }

  function keyName(agent: Agent) {
    return agent.tenantId ? `agent:${agent.tenantId}:${agent.name}` : `agent:${agent.name}`;
  }

  function seed(agent: Agent, instanceIds: string[], createdBy = 'system:auto-provision') {
    return keys.create({ name: keyName(agent), instanceIds, scopes: ['messages:send', 'chats:read'], createdBy });
  }

  function context(enforced: boolean, tenantId: string | null) {
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const eventBus = {
      publish: async (type: string, payload: Record<string, unknown>) => {
        events.push({ type, payload });
        return { id: crypto.randomUUID() };
      },
      publishGeneric: async () => ({ id: crypto.randomUUID() }),
    } as unknown as EventBus;
    const pool = enforced ? runtime : open(undefined, 1);
    const services = createServices(pool, eventBus as Parameters<typeof createServices>[1]);
    const run = <T>(fn: () => Promise<T>): Promise<T> =>
      enforced ? runInWorkerTenantScope(pool, tenantId as string, fn) : fn();
    return { services, events, run, pool };
  }

  async function patch(ctx: ReturnType<typeof context>, id: string, isActive: boolean | undefined, name?: string) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('services', ctx.services);
      await next();
    });
    app.route('/agents', agentsRoutes);
    const response = await app.request(`/agents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive, name }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: Agent }).data;
  }

  async function waitForEvents(events: unknown[], count: number) {
    const deadline = Date.now() + 1000;
    while (events.length < count && Date.now() < deadline) await Bun.sleep(1);
    expect(events).toHaveLength(count);
  }

  function barrier() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  // Pause the real boot transaction after its ownership read and before the key insert.
  function pauseBootProvisioning(
    pool: Database,
    name: string,
    ready: ReturnType<typeof barrier>,
    release: ReturnType<typeof barrier>,
  ): Database {
    const wrap = (db: Database): Database =>
      new Proxy(db, {
        get(target, property) {
          if (property === 'transaction')
            return (fn: (tx: Database) => Promise<unknown>) =>
              target.transaction((tx) => fn(wrap(tx as unknown as Database)));
          if (property !== 'insert') return Reflect.get(target, property);
          return (table: Parameters<Database['insert']>[0]) => {
            const insert = target.insert(table);
            if (table !== apiKeys) return insert;
            return new Proxy(insert, {
              get(builder, field) {
                if (field !== 'values') return Reflect.get(builder, field);
                return (values: typeof apiKeys.$inferInsert) => {
                  const write = builder.values(values);
                  if (values.name !== name) return write;
                  return new Proxy(write, {
                    get(query, key) {
                      if (key !== 'returning') return Reflect.get(query, key);
                      return async () => {
                        ready.release();
                        await release.promise;
                        return query.returning();
                      };
                    },
                  });
                };
              },
            });
          };
        },
      });
    return wrap(pool);
  }

  async function waitForRowLock(pid: number, signal: AbortSignal) {
    const deadline = Date.now() + 5000;
    while (!signal.aborted && Date.now() < deadline) {
      const waiting = await db.execute(
        sql`SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event_type = 'Lock'`,
      );
      if (waiting.length) return;
      await Bun.sleep(10);
    }
    if (!signal.aborted) throw new Error('Agent deactivation did not wait for boot ownership locks');
  }

  for (const enforced of [false, true]) {
    test(`boot holds the agent ownership row until repair commits before soft deletion (${enforced ? 'RLS' : 'legacy'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      await instance(tenantId, agent.id);
      const ctx = context(enforced, tenantId);
      const bootPool = open(enforced ? runtimeRole : undefined, 1);
      if (enforced) await assertPgTestRole(bootPool, DEFAULT_ROLE_NAMES.runtime);
      const [writer] = await ctx.pool.execute(sql`SELECT pg_backend_pid() AS pid`);
      const abort = new AbortController();
      const ready = barrier();
      const release = barrier();
      const boot = reconcileAgentKeys(
        pauseBootProvisioning(bootPool, keyName(agent), ready, release),
        enforced ? authPlane : db,
        enforced ? 'enforced' : 'legacy',
      );
      let deletion: Promise<void> | undefined;
      try {
        await Promise.race([
          ready.promise,
          boot.then(() => {
            throw new Error('Boot finished before provisioning barrier');
          }),
        ]);
        deletion = ctx.run(() => ctx.services.agents.delete(agent.id));
        await Promise.race([
          waitForRowLock(Number(writer?.pid), abort.signal),
          deletion.then(() => {
            throw new Error('Soft deletion committed while boot still held its ownership snapshot');
          }),
        ]);
      } finally {
        abort.abort();
        release.release();
        await Promise.all([boot, deletion]);
      }
      expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0]?.isActive).toBe(false);
      expect(await keys.findAgentKeyByName(keyName(agent))).toBeNull();
    }, 15_000);
  }

  function registerRenameTests(enforced: boolean) {
    for (const activation of [undefined, true]) {
      test(`rename${activation ? ' with active save' : ' only'} replaces owned keys and preserves same-name siblings (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
        const tenantId = enforced ? crypto.randomUUID() : null;
        const agent = await owner(tenantId);
        const target = await instance(tenantId, agent.id);
        const routed = await instance(tenantId);
        await storedRoute(routed, agent);
        const parent = await seed(agent, [target.id, routed.id]);
        const sibling = await owner(tenantId, agent.name);
        const siblingTarget = await instance(tenantId, sibling.id);
        const siblingKey = await seed(sibling, [siblingTarget.id]);
        const manual = await seed(agent, [target.id], 'operator');
        const ctx = context(enforced, tenantId);
        const renamed = await ctx.run(() => patch(ctx, agent.id, activation, `${agent.name}-renamed`));
        expect(renamed.isActive).toBe(true);
        const fresh = await keys.findAgentKeysByNames([keyName(renamed)]);
        expect(fresh).toHaveLength(1);
        expect(fresh[0]?.id).not.toBe(parent.key.id);
        expect(new Set(fresh[0]?.instanceIds)).toEqual(new Set([target.id, routed.id]));
        expect((await keys.getById(parent.key.id))?.status).toBe('revoked');
        expect(await keys.validate(parent.plainTextKey)).toBeNull();
        expect(await keys.getById(siblingKey.key.id)).toEqual(siblingKey.key);
        expect(await keys.validate(siblingKey.plainTextKey)).not.toBeNull();
        expect(await keys.getById(manual.key.id)).toEqual(manual.key);
        expect((await keys.findAgentKeysByNames([keyName(agent)])).map((key) => key.id)).toEqual([siblingKey.key.id]);
      });
    }

    for (const remove of ['deactivate', 'delete'] as const) {
      test(`rename then ${remove} leaves no active system key under either name (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
        const tenantId = enforced ? crypto.randomUUID() : null;
        const agent = await owner(tenantId);
        const target = await instance(tenantId, agent.id);
        const parent = await seed(agent, [target.id]);
        const ctx = context(enforced, tenantId);
        const renamed = await ctx.run(() => patch(ctx, agent.id, undefined, `${agent.name}-renamed`));
        const fresh = await keys.findAgentKeyByName(keyName(renamed));
        expect(fresh).not.toBeNull();
        if (remove === 'delete') await ctx.run(() => ctx.services.agents.delete(agent.id));
        else await ctx.run(() => patch(ctx, agent.id, false));
        expect(await keys.findAgentKeysByNames([keyName(agent), keyName(renamed)])).toEqual([]);
        expect((await keys.getById(parent.key.id))?.status).toBe('revoked');
        expect((await keys.getById(fresh?.id as string))?.status).toBe('revoked');
        expect(await keys.validate(parent.plainTextKey)).toBeNull();
      });
    }

    test(`rename during reactivation provisions only the new name (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const target = await instance(tenantId, agent.id);
      const parent = await seed(agent, [target.id]);
      const ctx = context(enforced, tenantId);
      await ctx.run(() => patch(ctx, agent.id, false));
      const renamed = await ctx.run(() => patch(ctx, agent.id, true, `${agent.name}-renamed`));
      expect(await keys.findAgentKeyByName(keyName(agent))).toBeNull();
      expect((await keys.getById(parent.key.id))?.status).toBe('revoked');
      expect((await keys.findAgentKeyByName(keyName(renamed)))?.instanceIds).toEqual([target.id]);
    });

    test(`routine active save preserves credentials, including a stale key (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const target = await instance(tenantId, agent.id);
      const staleTarget = await instance(tenantId);
      const parent = await seed(agent, [target.id, staleTarget.id]);
      const ctx = context(enforced, tenantId);
      await ctx.run(() => patch(ctx, agent.id, true));
      expect(await keys.getById(parent.key.id)).toEqual(parent.key);
      expect((await keys.findAgentKeysByNames([keyName(agent)])).map((key) => key.id)).toEqual([parent.key.id]);
      expect(ctx.events).toEqual([]);
    });
  }

  for (const enforced of [false, true]) {
    registerRenameTests(enforced);

    test(`PATCH activation shares the binding writers' advisory lock (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const target = await instance(tenantId, agent.id);
      const parent = await seed(agent, [target.id]);
      const ctx = context(enforced, tenantId);
      const [writer] = await ctx.pool.execute(sql`SELECT pg_backend_pid() AS pid`);
      const ready = barrier();
      const release = barrier();
      const abort = new AbortController();
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`omni:agent-key:${agent.id}`}))`);
        ready.release();
        await release.promise;
      });
      await ready.promise;
      const update = ctx.run(() => patch(ctx, agent.id, false));
      try {
        await Promise.race([
          waitForRowLock(Number(writer?.pid), abort.signal),
          update.then(() => {
            throw new Error('PATCH bypassed the binding lock');
          }),
        ]);
      } finally {
        abort.abort();
        release.release();
        await Promise.all([holder, update]);
      }
      expect((await keys.getById(parent.key.id))?.status).toBe('revoked');
    }, 15_000);

    test(`failed key provisioning rolls back reactivation (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      await instance(tenantId, agent.id);
      await db.update(agents).set({ isActive: false }).where(eq(agents.id, agent.id));
      const ctx = context(enforced, tenantId);
      const original = ApiKeyService.prototype.create;
      const create = spyOn(ApiKeyService.prototype, 'create').mockImplementation(async function (
        this: ApiKeyService,
        options,
      ) {
        if (options.name === keyName(agent)) throw new Error('fixture key provisioning failure');
        return original.call(this, options);
      });
      try {
        await expect(ctx.run(() => ctx.services.agents.update(agent.id, { isActive: true }))).rejects.toThrow(
          'fixture key provisioning failure',
        );
      } finally {
        create.mockRestore();
      }
      expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0]?.isActive).toBe(false);
      expect(await keys.findAgentKeyByName(keyName(agent))).toBeNull();
    });

    test(`PATCH deactivation retires owned keys and settles events after commit (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const target = await instance(tenantId, agent.id);
      const routed = await instance(tenantId);
      await storedRoute(routed, agent);
      const parent = await seed(agent, [target.id, routed.id]);
      const manual = await seed(agent, [target.id], 'operator');
      const foreign = await owner(crypto.randomUUID(), agent.name);
      const other = await instance(foreign.tenantId, foreign.id);
      const foreignKey = await seed(foreign, [other.id]);
      const ctx = context(enforced, tenantId);
      const child = await mint(ctx.services, parent.key.id, target);
      const cacheKey = CacheKeys.apiKey(child.keyHash);
      await apiKeyCache.set(cacheKey, child);
      ctx.events.length = 0;
      await ctx.run(async () => {
        expect((await patch(ctx, agent.id, false, `${agent.name}-renamed`)).isActive).toBe(false);
        if (enforced) {
          expect(ctx.events).toEqual([]);
          expect(await apiKeyCache.get(cacheKey)).toEqual(child);
        }
      });
      await waitForEvents(ctx.events, 1);
      expect(ctx.events[0]).toEqual({
        type: 'access.key_revoked',
        payload: expect.objectContaining({ keyId: child.id }),
      });
      expect(await apiKeyCache.get(cacheKey)).toBeNull();
      expect((await keys.getById(parent.key.id))?.status).toBe('revoked');
      expect((await keys.getById(child.id))?.status).toBe('revoked');
      expect(await keys.validate(parent.plainTextKey)).toBeNull();
      expect(await keys.getById(manual.key.id)).toEqual(manual.key);
      expect(await keys.getById(foreignKey.key.id)).toEqual(foreignKey.key);
    });

    test(`reactivation provisions fresh keys for only current same-tenant default and route bindings (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
      const tenantId = crypto.randomUUID();
      const agent = await owner(tenantId);
      const previous = await instance(tenantId, agent.id);
      const parent = await seed(agent, [previous.id]);
      const ctx = context(enforced, tenantId);
      await ctx.run(() => patch(ctx, agent.id, false));
      await db.update(instances).set({ agentId: null }).where(eq(instances.id, previous.id));
      const current = await instance(tenantId, agent.id);
      const routed = await instance(tenantId);
      await storedRoute(routed, agent);
      const foreign = await owner(crypto.randomUUID(), agent.name);
      const other = await instance(foreign.tenantId, foreign.id);
      await expect(storedRoute(other, agent)).rejects.toThrow();
      const foreignKey = await seed(foreign, [other.id]);
      expect((await ctx.run(() => patch(ctx, agent.id, true))).isActive).toBe(true);
      const fresh = await keys.findAgentKeyByName(keyName(agent));
      expect(fresh).not.toBeNull();
      expect(fresh?.id).not.toBe(parent.key.id);
      expect(new Set(fresh?.instanceIds)).toEqual(new Set([current.id, routed.id]));
      expect((await keys.getById(parent.key.id))?.status).toBe('revoked');
      expect(await keys.validate(parent.plainTextKey)).toBeNull();
      expect(await keys.getById(foreignKey.key.id)).toEqual(foreignKey.key);
      // Repeating PATCH is idempotent and never creates an unrestricted key.
      await ctx.run(() => patch(ctx, agent.id, true));
      expect((await keys.findAgentKeysByNames([keyName(agent)])).map((row) => row.id)).toEqual([fresh?.id as string]);
    });

    test(`reactivation without bindings provisions no key (${enforced ? 'RLS' : 'legacy max=1'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      await db.update(agents).set({ isActive: false }).where(eq(agents.id, agent.id));
      const ctx = context(enforced, tenantId);
      await ctx.run(() => patch(ctx, agent.id, true));
      expect(await keys.findAgentKeyByName(keyName(agent))).toBeNull();
    });
  }

  test('rolled-back tenant deactivation retains keys, cache and event silence', async () => {
    const tenantId = crypto.randomUUID();
    const agent = await owner(tenantId);
    const target = await instance(tenantId, agent.id);
    const parent = await seed(agent, [target.id]);
    const ctx = context(true, tenantId);
    const child = await mint(ctx.services, parent.key.id, target);
    const cacheKey = CacheKeys.apiKey(child.keyHash);
    await apiKeyCache.set(cacheKey, child);
    ctx.events.length = 0;
    await expect(
      ctx.run(async () => {
        await patch(ctx, agent.id, false);
        expect(ctx.events).toEqual([]);
        throw new Error('rollback activation');
      }),
    ).rejects.toThrow('rollback activation');
    expect((await keys.getById(parent.key.id))?.status).toBe('active');
    expect((await keys.getById(child.id))?.status).toBe('active');
    expect(await apiKeyCache.get(cacheKey)).toEqual(child);
    expect(ctx.events).toEqual([]);
    expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0]?.isActive).toBe(true);
  });

  test('rolled-back tenant reactivation cannot leave a new usable key', async () => {
    const tenantId = crypto.randomUUID();
    const agent = await owner(tenantId);
    const target = await instance(tenantId, agent.id);
    const parent = await seed(agent, [target.id]);
    await keys.revoke(parent.key.id);
    await db.update(agents).set({ isActive: false }).where(eq(agents.id, agent.id));
    const ctx = context(true, tenantId);
    await expect(
      ctx.run(async () => {
        await patch(ctx, agent.id, true);
        throw new Error('rollback reactivation');
      }),
    ).rejects.toThrow('rollback reactivation');
    expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0]?.isActive).toBe(false);
    expect(await keys.findAgentKeyByName(keyName(agent))).toBeNull();
    expect((await keys.getById(parent.key.id))?.status).toBe('revoked');
  });

  test('a tenant cannot change another tenant agent activation or keys', async () => {
    const tenantId = crypto.randomUUID();
    await owner(tenantId);
    const foreign = await owner(crypto.randomUUID());
    const target = await instance(foreign.tenantId, foreign.id);
    const parent = await seed(foreign, [target.id]);
    const ctx = context(true, tenantId);
    for (const isActive of [false, true])
      await expect(ctx.run(() => ctx.services.agents.update(foreign.id, { isActive }))).rejects.toThrow('Agent');
    expect(await keys.getById(parent.key.id)).toEqual(parent.key);
  });
});
