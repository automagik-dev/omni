/** Live binding, child events and inactive-agent keys against disposable PostgreSQL. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import {
  type Agent,
  type ApiKey,
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
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { CacheKeys, apiKeyCache } from '../../cache';
import { instancesRoutes } from '../../routes/v2/instances';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import type { AppVariables } from '../../types';
import { findAgentsWithoutKeys, reconcileAgentKeys } from '../agent-key-reconciliation';
import { ApiKeyService } from '../api-keys';
import { type Services, createServices } from '../index';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('agent key lifecycle authority (real PostgreSQL)', () => {
  const dbName = `omni_key_lifecycle_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let runtime: Database;
  let authPlane: Database;
  let keys: ApiKeyService;

  function open(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName, role), maxConnections: 3 });
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
    runtime = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
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
    const pool = enforced ? runtime : db;
    const services = createServices(pool, eventBus as Parameters<typeof createServices>[1]);
    const run = <T>(fn: () => Promise<T>): Promise<T> =>
      enforced ? runInWorkerTenantScope(pool, tenantId as string, fn) : fn();
    return { services, events, run, pool };
  }

  async function assign(services: Services, target: Instance, agentId: string) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('services', services);
      c.set('apiKey', { id: 'operator', name: 'operator', scopes: ['*'], instanceIds: null, expiresAt: null });
      await next();
    });
    app.route('/instances', instancesRoutes);
    const response = await app.request(`/instances/${target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    expect(response.status).toBe(200);
  }

  test('default bind retires a mixed bare legacy key before restoring every live binding', async () => {
    const agent = await owner(null);
    const bound = await instance(null, agent.id);
    const stale = await instance(null);
    const target = await instance(null);
    const mixed = await seed(agent, [bound.id, stale.id]);
    const ctx = context(false, null);
    await assign(ctx.services, target, agent.id);
    expect((await keys.getById(mixed.key.id))?.status).toBe('revoked');
    const fresh = await keys.findAgentKeyByName(keyName(agent));
    expect(fresh?.id).not.toBe(mixed.key.id);
    expect(new Set(fresh?.instanceIds)).toEqual(new Set([bound.id, target.id]));
  });

  async function cachedKeys(parent: ApiKey, child: ApiKey) {
    const entries = [parent, child].map((row) => ({ cacheKey: CacheKeys.apiKey(row.keyHash), row }));
    for (const { cacheKey, row } of entries) await apiKeyCache.set(cacheKey, row);
    return entries;
  }

  async function expectCached(entries: { cacheKey: string; row: ApiKey }[], retained = true) {
    for (const { cacheKey, row } of entries) expect(await apiKeyCache.get(cacheKey)).toEqual(retained ? row : null);
  }

  async function waitForEvents(events: unknown[], count: number) {
    const deadline = Date.now() + 1000;
    while (events.length < count && Date.now() < deadline) await Bun.sleep(1);
    expect(events).toHaveLength(count);
  }

  test('direct tenant-scoped key revocation drops events and evictions on rollback', async () => {
    const tenantId = crypto.randomUUID();
    const agent = await owner(tenantId);
    const target = await instance(tenantId, agent.id);
    const parent = await seed(agent, [target.id]);
    const ctx = context(true, tenantId);
    const child = await mint(ctx.services, parent.key.id, target);
    const entries = await cachedKeys(parent.key, child);
    ctx.events.length = 0;
    await expect(
      ctx.run(async () => {
        const scoped = new ApiKeyService(scopedHandle(runtime), { eventBus: ctx.services.eventBus });
        await scoped.revoke(parent.key.id);
        expect(ctx.events).toEqual([]);
        await expectCached(entries);
        throw new Error('rollback direct revoke');
      }),
    ).rejects.toThrow('rollback direct revoke');
    expect(ctx.events).toEqual([]);
    await expectCached(entries);
    expect((await keys.getById(parent.key.id))?.status).toBe('active');
    expect((await keys.getById(child.id))?.status).toBe('active');
  });

  for (const rollback of [false, true]) {
    test(`enforced route deletion settles child events and caches only after commit (rollback=${rollback})`, async () => {
      const tenantId = crypto.randomUUID();
      const agent = await owner(tenantId);
      const target = await instance(tenantId);
      const route = await storedRoute(target, agent);
      const parent = await seed(agent, [target.id]);
      const ctx = context(true, tenantId);
      const child = await mint(ctx.services, parent.key.id, target);
      const entries = await cachedKeys(parent.key, child);
      ctx.events.length = 0;
      const deletion = ctx.run(async () => {
        await ctx.services.routes.delete(route.id);
        expect(ctx.events).toEqual([]);
        await expectCached(entries);
        if (rollback) throw new Error('rollback route delete');
      });
      if (rollback) await expect(deletion).rejects.toThrow('rollback route delete');
      else await deletion;
      // Settlement is detached from the closed request; await its asynchronous event publication.
      if (!rollback) await waitForEvents(ctx.events, 1);
      expect(ctx.events).toEqual(
        rollback
          ? []
          : [
              {
                type: 'access.key_revoked',
                payload: expect.objectContaining({ keyId: child.id }),
              },
            ],
      );
      await expectCached(entries, rollback);
      expect((await keys.getById(child.id))?.status).toBe(rollback ? 'active' : 'revoked');
      expect((await keys.getById(parent.key.id))?.status).toBe(rollback ? 'active' : 'revoked');
      expect(await db.select().from(agentRoutes).where(eq(agentRoutes.id, route.id))).toHaveLength(rollback ? 1 : 0);
    });
  }

  for (const enforced of [false, true]) {
    test(`lock rollback preserves child events and parent/child caches (${enforced ? 'RLS' : 'legacy'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const target = await instance(tenantId, agent.id);
      const parent = await seed(agent, [target.id]);
      const ctx = context(enforced, tenantId);
      const child = await mint(ctx.services, parent.key.id, target);
      const entries = await cachedKeys(parent.key, child);
      ctx.events.length = 0;
      await expect(
        ctx.run(() =>
          ctx.services.apiKeys.withAgentKeyLock([agent.id], async (locked) => {
            await locked.revoke(parent.key.id);
            expect(ctx.events).toEqual([]);
            await expectCached(entries);
            throw new Error('rollback key lock');
          }),
        ),
      ).rejects.toThrow('rollback key lock');
      expect(ctx.events).toEqual([]);
      await expectCached(entries);
      expect((await keys.getById(parent.key.id))?.status).toBe('active');
      expect((await keys.getById(child.id))?.status).toBe('active');
    });

    test(`nested lock rollback drops its own effects before outer commit (${enforced ? 'RLS' : 'legacy'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const target = await instance(tenantId, agent.id);
      const parent = await seed(agent, [target.id]);
      const ctx = context(enforced, tenantId);
      const child = await mint(ctx.services, parent.key.id, target);
      const entries = await cachedKeys(parent.key, child);
      ctx.events.length = 0;
      await ctx.run(() =>
        ctx.services.apiKeys.withAgentKeyLock([agent.id], async (locked) => {
          await expect(
            locked.withAgentKeyLock([agent.id], async (nested) => {
              await nested.revoke(parent.key.id);
              throw new Error('rollback nested lock');
            }),
          ).rejects.toThrow('rollback nested lock');
        }),
      );
      expect(ctx.events).toEqual([]);
      await expectCached(entries);
      expect((await keys.getById(parent.key.id))?.status).toBe('active');
      expect((await keys.getById(child.id))?.status).toBe('active');
    });

    test(`default bind replaces stale grants while preserving manual and foreign keys (${enforced ? 'RLS' : 'legacy'})`, async () => {
      const tenantId = crypto.randomUUID();
      const agent = await owner(tenantId);
      const foreign = await owner(crypto.randomUUID(), agent.name);
      const bound = await instance(tenantId, agent.id);
      const routed = await instance(tenantId);
      await storedRoute(routed, agent);
      const stale = await instance(tenantId);
      const target = await instance(tenantId);
      const other = await instance(foreign.tenantId, foreign.id);
      const mixed = await seed(agent, [bound.id, routed.id, stale.id, other.id]);
      const manual = await seed(agent, [stale.id], 'operator');
      const otherKey = await seed(foreign, [other.id]);
      await keys.validate(mixed.plainTextKey);
      const ctx = context(enforced, tenantId);
      await ctx.run(() => assign(ctx.services, target, agent.id));
      expect((await keys.getById(mixed.key.id))?.status).toBe('revoked');
      expect(await keys.validate(mixed.plainTextKey)).toBeNull();
      const fresh = await keys.findAgentKeyByName(keyName(agent));
      expect(fresh?.id).not.toBe(mixed.key.id);
      expect(new Set(fresh?.instanceIds)).toEqual(new Set([bound.id, routed.id, target.id]));
      expect(await keys.getById(manual.key.id)).toEqual(manual.key);
      expect(await keys.getById(otherKey.key.id)).toEqual(otherKey.key);
    });

    test(`route narrowing emits revoked and clamped child events (${enforced ? 'RLS' : 'legacy'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const first = await instance(tenantId);
      const second = await instance(tenantId);
      const firstChat = await conversation(first);
      const secondChat = await conversation(second);
      const ctx = context(enforced, tenantId);
      const create = (target: Instance, chatId: string) =>
        ctx.run(() =>
          ctx.services.routes.create(target.id, {
            scope: 'chat',
            chatId,
            agentId: agent.id,
            priority: 0,
            isActive: true,
          }),
        );
      const route = await create(first, firstChat.id);
      const remainingRoute = await create(second, secondChat.id);
      const parent = await keys.findAgentKeyByName(keyName(agent));
      if (!parent) throw new Error('route failed to provision a parent key');
      const expiresAt = new Date(Date.now() + 60_000);
      await keys.update(parent.id, { expiresAt });
      const child = await ctx.services.apiKeys.mintChild(parent.id, firstChat);
      const retained = await ctx.services.apiKeys.mintChild(parent.id, secondChat);
      if (!child.ok || !retained.ok) throw new Error('child mint failed');
      // A persisted child whose TTL is stale must be clamped by the same
      // authority reconciliation that removes the deleted route's child.
      await db
        .update(apiKeys)
        .set({ expiresAt: new Date(expiresAt.getTime() + 60_000) })
        .where(eq(apiKeys.id, retained.child.id));
      ctx.events.length = 0;
      await ctx.run(() => ctx.services.routes.delete(route.id));
      await waitForEvents(ctx.events, 2);
      expect(ctx.events).toContainEqual({
        type: 'access.key_revoked',
        payload: expect.objectContaining({ keyId: child.child.id }),
      });
      expect(ctx.events).toContainEqual({
        type: 'access.key_updated',
        payload: expect.objectContaining({ keyId: retained.child.id }),
      });
      expect((await keys.getById(child.child.id))?.status).toBe('revoked');
      expect((await keys.getById(retained.child.id))?.expiresAt).toEqual(expiresAt);
      ctx.events.length = 0;
      await ctx.run(() => ctx.services.routes.delete(remainingRoute.id));
      await waitForEvents(ctx.events, 1);
      expect(ctx.events).toContainEqual({
        type: 'access.key_revoked',
        payload: expect.objectContaining({ keyId: retained.child.id }),
      });
    });

    test(`soft deletion revokes owned system keys and no live write or boot restores them (${enforced ? 'RLS' : 'legacy'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const foreign = await owner(crypto.randomUUID(), agent.name);
      const foreignInstance = await instance(foreign.tenantId, foreign.id);
      const foreignKey = await seed(foreign, [foreignInstance.id]);
      const bound = await instance(tenantId, agent.id);
      const routed = await instance(tenantId);
      await storedRoute(routed, agent);
      const key = await seed(agent, [bound.id, routed.id]);
      const manual = await seed(agent, [bound.id], 'operator');
      await keys.validate(key.plainTextKey);
      const ctx = context(enforced, tenantId);
      const child = await mint(ctx.services, key.key.id, bound);
      ctx.events.length = 0;
      if (enforced) await expect(ctx.run(() => ctx.services.agents.delete(foreign.id))).rejects.toThrow();
      await ctx.run(() => ctx.services.agents.delete(agent.id));
      await waitForEvents(ctx.events, 1);
      expect((await keys.getById(key.key.id))?.status).toBe('revoked');
      expect(await keys.validate(key.plainTextKey)).toBeNull();
      expect((await keys.getById(child.id))?.status).toBe('revoked');
      expect(ctx.events).toContainEqual({
        type: 'access.key_revoked',
        payload: expect.objectContaining({ keyId: child.id }),
      });
      const target = await instance(tenantId);
      await ctx.run(() => assign(ctx.services, target, agent.id));
      const chat = await conversation(target);
      await ctx.run(() =>
        ctx.services.routes.create(target.id, {
          scope: 'chat',
          chatId: chat.id,
          agentId: agent.id,
          priority: 0,
          isActive: true,
        }),
      );
      await reconcileAgentKeys(ctx.pool, enforced ? authPlane : db, enforced ? 'enforced' : 'legacy');
      expect(await keys.findAgentKeyByName(keyName(agent))).toBeNull();
      expect(await keys.getById(manual.key.id)).toEqual(manual.key);
      const missing = await findAgentsWithoutKeys(
        ctx.pool,
        enforced ? authPlane : db,
        enforced ? 'enforced' : 'legacy',
      );
      expect(missing.map((row) => row.id)).not.toContain(agent.id);
      expect(await keys.getById(foreignKey.key.id)).toEqual(foreignKey.key);
    });

    test(`boot retires keys left by older soft deletes (${enforced ? 'RLS' : 'legacy'})`, async () => {
      const tenantId = enforced ? crypto.randomUUID() : null;
      const agent = await owner(tenantId);
      const target = await instance(tenantId, agent.id);
      const key = await seed(agent, [target.id]);
      await db.update(agents).set({ isActive: false }).where(eq(agents.id, agent.id));
      const ctx = context(enforced, tenantId);
      await reconcileAgentKeys(ctx.pool, enforced ? authPlane : db, enforced ? 'enforced' : 'legacy');
      expect((await keys.getById(key.key.id))?.status).toBe('revoked');
      expect(await keys.findAgentKeyByName(keyName(agent))).toBeNull();
    });
  }
});
