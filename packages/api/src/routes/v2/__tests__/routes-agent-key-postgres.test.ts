/** Route writes must keep turn-dispatch keys aligned with default/route bindings. */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import {
  type Agent,
  DEFAULT_ROLE_NAMES,
  type Database,
  type Instance,
  agents,
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
import { __test__ as dispatcher } from '../../../plugins/agent-dispatcher';
import { syncRouteAgentKeys } from '../../../services/agent-key-bindings';
import { AgentService } from '../../../services/agents';
import { ApiKeyService } from '../../../services/api-keys';
import { InstanceService } from '../../../services/instances';
import { RouteResolver } from '../../../services/route-resolver';
import { RouteService } from '../../../services/routes';
import { runInWorkerTenantScope } from '../../../tenancy/worker-tenant-context';
import type { AppVariables } from '../../../types';
import { routesRoutes } from '../agent-routes';
import { instancesRoutes } from '../instances';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('routed agent key lifecycle (real PostgreSQL)', () => {
  const dbName = `omni_route_keys_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let keys: ApiKeyService;
  let resolver: RouteResolver;
  let routes: RouteService;
  let app: Hono<{ Variables: AppVariables }>;
  let runtimeRole: { name: string; password: string } | undefined;

  function openDb(role?: { name: string; password: string }, maxConnections = 3) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName, role), maxConnections });
    closers.push(handle.close);
    return handle.db;
  }

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    db = openDb();
    keys = new ApiKeyService(db);
    resolver = new RouteResolver(db);
    routes = new RouteService(db, resolver);
    app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('apiKey', { id: 'operator', name: 'operator', scopes: ['*'], instanceIds: null, expiresAt: null });
      c.set('services', {
        routes,
        apiKeys: keys,
        agents: new AgentService(db, null),
        instances: new InstanceService(db, null),
      } as never);
      await next();
    });
    app.route('/', routesRoutes);
    app.route('/instances', instancesRoutes);
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

  async function agent(tenantId: string | null = null, name = `route-agent-${crypto.randomUUID()}`): Promise<Agent> {
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
      .values({ name, provider: 'claude', metadata: { omniScopes: ['messages:read'] } })
      .returning();
    if (!row) throw new Error('agent fixture missing');
    if (tenantId) await db.update(agents).set({ tenantId }).where(eq(agents.id, row.id));
    return { ...row, tenantId };
  }

  async function instance(tenantId: string | null = null, agentId: string | null = null): Promise<Instance> {
    const [row] = await db
      .insert(instances)
      .values({ name: `route-instance-${crypto.randomUUID()}`, channel: 'whatsapp-baileys', agentId, tenantId })
      .returning();
    if (!row) throw new Error('instance fixture missing');
    return row;
  }

  async function chat(instanceId: string) {
    const [row] = await db
      .insert(chats)
      .values({ instanceId, externalId: crypto.randomUUID(), channel: 'whatsapp-baileys', chatType: 'dm' })
      .returning();
    if (!row) throw new Error('chat fixture missing');
    return row;
  }

  function keyName(owner: Agent) {
    return owner.tenantId ? `agent:${owner.tenantId}:${owner.name}` : `agent:${owner.name}`;
  }

  async function createRoute(target: Instance, owner: Agent) {
    const conversation = await chat(target.id);
    const response = await app.request(`/instances/${target.id}/routes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'chat', chatId: conversation.id, agentId: owner.id }),
    });
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { id: string } };
    return { id: data.id, chatId: conversation.id, path: `/instances/${target.id}/routes/${data.id}` };
  }

  async function patch(path: string, body: unknown) {
    const response = await app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
  }

  async function dispatch(target: Instance, chatId: string) {
    const route = await resolver.resolve(target.id, chatId);
    expect(route?.agentId).toBeTruthy();
    const open = mock(async (_options: { apiKeyId: string }) => ({ id: 'turn' }));
    const trigger = mock(async () => undefined);
    const success = await dispatcher.dispatchViaTurnBasedProvider(
      { apiKeys: keys, turns: { open }, chats: { findByExternalIdSmart: async () => null } } as never,
      { ...target, agentId: route?.agentId ?? null },
      { id: 'provider', schema: 'genie', trigger } as never,
      { content: { text: 'hello' }, sessionId: 'session' } as never,
      [{ payload: { externalId: 'message' }, metadata: {} }] as never,
      'chat',
      'trace',
      db,
    );
    expect(success).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
    return open.mock.calls[0]?.[0].apiKeyId;
  }

  for (const tenantId of [null, crypto.randomUUID()]) {
    test(`route-only agent dispatches after create and its key extends/narrows (${tenantId ?? 'legacy'})`, async () => {
      const owner = await agent(tenantId);
      const first = await instance(tenantId);
      const second = await instance(tenantId);
      expect(await keys.findAgentKeyByName(keyName(owner))).toBeNull();
      const route = await createRoute(first, owner);
      const original = await keys.findAgentKeyByName(keyName(owner));
      expect(original?.instanceIds).toEqual([first.id]);
      expect(original?.scopes).toEqual(['messages:read']);
      expect(await dispatch(first, route.chatId)).toBe(original?.id);
      await createRoute(second, owner);
      expect(new Set((await keys.findAgentKeyByName(keyName(owner)))?.instanceIds)).toEqual(
        new Set([first.id, second.id]),
      );
      expect((await app.request(route.path, { method: 'DELETE' })).status).toBe(200);
      expect((await keys.getById(original?.id ?? ''))?.instanceIds).toEqual([second.id]);
    });
  }

  for (const tenantId of [null, crypto.randomUUID()]) {
    test(`replacing a mixed key on a route write restores all of its live bindings (${tenantId ?? 'legacy'})`, async () => {
      const owner = await agent(tenantId);
      const bound = await instance(tenantId, owner.id);
      const stale = await instance(tenantId);
      const routed = await instance(tenantId);
      const mixed = await keys.create({
        name: keyName(owner),
        instanceIds: [bound.id, stale.id],
        scopes: ['messages:send'],
        createdBy: 'system:auto-provision',
      });
      await keys.validate(mixed.plainTextKey);
      const route = await createRoute(routed, owner);
      expect((await keys.getById(mixed.key.id))?.status).toBe('revoked');
      expect(await keys.validate(mixed.plainTextKey)).toBeNull();
      const fresh = await keys.findAgentKeyByName(keyName(owner));
      expect(new Set(fresh?.instanceIds)).toEqual(new Set([bound.id, routed.id]));
      expect(await dispatch(routed, route.chatId)).toBe(fresh?.id);
    });
  }

  test('retarget and clear revoke emptied keys; rebind provisions a fresh key', async () => {
    const first = await agent();
    const second = await agent();
    const target = await instance();
    const route = await createRoute(target, first);
    const old = await keys.findAgentKeyByName(keyName(first));
    await patch(route.path, { agentId: second.id });
    expect((await keys.getById(old?.id ?? ''))?.status).toBe('revoked');
    const replacement = await keys.findAgentKeyByName(keyName(second));
    expect(replacement?.instanceIds).toEqual([target.id]);
    await patch(route.path, { agentId: null });
    expect((await keys.getById(replacement?.id ?? ''))?.status).toBe('revoked');
    await patch(route.path, { agentId: first.id });
    const fresh = await keys.findAgentKeyByName(keyName(first));
    expect(fresh?.id).not.toBe(old?.id);
    expect(fresh?.instanceIds).toEqual([target.id]);
    expect(await dispatch(target, route.chatId)).toBe(fresh?.id);
  });

  for (const tenantId of [null, crypto.randomUUID()]) {
    test(`a second route alone retains the grant until the final route is deleted (${tenantId ?? 'legacy'})`, async () => {
      const owner = await agent(tenantId);
      const target = await instance(tenantId);
      const first = await createRoute(target, owner);
      const second = await createRoute(target, owner);
      const key = await keys.findAgentKeyByName(keyName(owner));
      expect((await app.request(first.path, { method: 'DELETE' })).status).toBe(200);
      expect((await keys.getById(key?.id ?? ''))?.status).toBe('active');
      expect((await keys.getById(key?.id ?? ''))?.instanceIds).toEqual([target.id]);
      expect((await app.request(second.path, { method: 'DELETE' })).status).toBe(200);
      expect((await keys.getById(key?.id ?? ''))?.status).toBe('revoked');
    });
  }

  test('another route or the default binding retains the grant until the final removal', async () => {
    const owner = await agent();
    const target = await instance(null, owner.id);
    const first = await createRoute(target, owner);
    const second = await createRoute(target, owner);
    const original = await keys.findAgentKeyByName(keyName(owner));
    expect((await app.request(first.path, { method: 'DELETE' })).status).toBe(200);
    expect((await keys.getById(original?.id ?? ''))?.status).toBe('active');
    expect((await app.request(second.path, { method: 'DELETE' })).status).toBe(200);
    expect((await keys.getById(original?.id ?? ''))?.instanceIds).toEqual([target.id]);
    const remaining = await createRoute(target, owner);
    await patch(`/instances/${target.id}`, { agentId: null });
    expect((await keys.getById(original?.id ?? ''))?.instanceIds).toEqual([target.id]);
    expect((await keys.getById(original?.id ?? ''))?.status).toBe('active');
    expect((await app.request(remaining.path, { method: 'DELETE' })).status).toBe(200);
    expect((await keys.getById(original?.id ?? ''))?.status).toBe('revoked');
  });

  test('reassignment preserves the old routed agent and provisions the new default agent', async () => {
    const routed = await agent();
    const next = await agent();
    const target = await instance(null, routed.id);
    const route = await createRoute(target, routed);
    const key = await keys.findAgentKeyByName(keyName(routed));
    await patch(`/instances/${target.id}`, { agentId: next.id });
    expect((await keys.getById(key?.id ?? ''))?.instanceIds).toEqual([target.id]);
    expect((await keys.findAgentKeyByName(keyName(next)))?.instanceIds).toEqual([target.id]);
    expect(await dispatch(target, route.chatId)).toBe(key?.id);
    expect((await app.request(route.path, { method: 'DELETE' })).status).toBe(200);
    expect((await keys.getById(key?.id ?? ''))?.status).toBe('revoked');
    expect((await keys.findAgentKeyByName(keyName(next)))?.instanceIds).toEqual([target.id]);
  });

  test('a later default binding extends the proven legacy key of a route-only agent', async () => {
    const owner = await agent();
    const routed = await instance();
    const target = await instance();
    await createRoute(routed, owner);
    const key = await keys.findAgentKeyByName(keyName(owner));
    await patch(`/instances/${target.id}`, { agentId: owner.id });
    expect(new Set((await keys.getById(key?.id ?? ''))?.instanceIds)).toEqual(new Set([routed.id, target.id]));
    expect(await keys.findAgentKeysByNames([keyName(owner)])).toHaveLength(1);
  });

  test('legacy default bind and reassignment complete on a one-connection pool', async () => {
    const first = await agent();
    const second = await agent();
    const routed = await instance();
    const target = await instance();
    // Extending a route-only bare key exercises every ownership lookup inside
    // the lock: agent, route and instance, including the route's agent owner.
    await createRoute(routed, first);
    const original = await keys.findAgentKeyByName(keyName(first));
    const pool = openDb(undefined, 1);
    const singleResolver = new RouteResolver(pool);
    const limitedApp = new Hono<{ Variables: AppVariables }>();
    limitedApp.use('*', async (c, next) => {
      c.set('apiKey', { id: 'operator', name: 'operator', scopes: ['*'], instanceIds: null, expiresAt: null });
      c.set('services', {
        apiKeys: new ApiKeyService(pool),
        agents: new AgentService(pool, null),
        instances: new InstanceService(pool, null),
        routes: new RouteService(pool, singleResolver),
      } as never);
      await next();
    });
    limitedApp.route('/instances', instancesRoutes);
    async function assign(agentId: string) {
      const response = await limitedApp.request(`/instances/${target.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      expect(response.status).toBe(200);
    }
    await assign(first.id);
    expect(new Set((await keys.getById(original?.id ?? ''))?.instanceIds)).toEqual(new Set([routed.id, target.id]));
    await assign(second.id);
    expect((await keys.getById(original?.id ?? ''))?.instanceIds).toEqual([routed.id]);
    expect((await keys.findAgentKeyByName(keyName(second)))?.instanceIds).toEqual([target.id]);
  }, 10_000);

  test('a foreign agent never receives a grant even without enforced RLS', async () => {
    const local = await agent(crypto.randomUUID());
    const foreign = await agent(crypto.randomUUID());
    const target = await instance(local.tenantId);
    const before = await keys.list();
    await syncRouteAgentKeys(db, target.id, [foreign.id]);
    expect(await keys.list()).toEqual(before);
    const conversation = await chat(target.id);
    await expect(
      routes.create(target.id, {
        scope: 'chat',
        chatId: conversation.id,
        agentId: foreign.id,
        priority: 0,
        isActive: true,
      }),
    ).rejects.toThrow();
    expect(await keys.list()).toEqual(before);
  });

  test('runtime RLS route writes isolate same-name agents and cannot extend a foreign bare key', async () => {
    const localTenant = crypto.randomUUID();
    const foreignTenant = crypto.randomUUID();
    const local = await agent(localTenant, 'support');
    const foreign = await agent(foreignTenant, 'support');
    const target = await instance(local.tenantId);
    const other = await instance(foreign.tenantId, foreign.id);
    const foreignKey = await keys.create({
      name: `agent:${foreign.name}`,
      scopes: ['messages:send'],
      instanceIds: [other.id],
      createdBy: 'system:auto-provision',
    });
    const conversation = await chat(target.id);
    const runtime = openDb(await enforcedRole());
    await assertPgTestRole(runtime, DEFAULT_ROLE_NAMES.runtime);
    const scopedRoutes = new RouteService(runtime, new RouteResolver(runtime));
    const route = await runInWorkerTenantScope(runtime, localTenant, () =>
      scopedRoutes.create(target.id, {
        scope: 'chat',
        chatId: conversation.id,
        agentId: local.id,
        priority: 0,
        isActive: true,
      }),
    );
    expect((await keys.findAgentKeyByName(keyName(local)))?.instanceIds).toEqual([target.id]);
    expect(await keys.getById(foreignKey.key.id)).toEqual(foreignKey.key);
    await expect(
      runInWorkerTenantScope(runtime, foreignTenant, () => scopedRoutes.getById(route.id)),
    ).rejects.toThrow();
    await runInWorkerTenantScope(runtime, localTenant, () => syncRouteAgentKeys(runtime, target.id, [foreign.id]));
    expect(await keys.getById(foreignKey.key.id)).toEqual(foreignKey.key);
  }, 15_000);

  async function enforcedRole() {
    if (!runtimeRole) {
      const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
      await applyTenantRlsEnforcement(db);
      await applyTenancyRoles(db, passwords, DEFAULT_ROLE_NAMES, dbName);
      runtimeRole = { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime };
    }
    return runtimeRole;
  }

  function barrier() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  async function waitForAdvisoryWait(agentId: string) {
    // Observe the real server lock, not a timing assumption or a mocked query.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const waiting = await db.execute(sql`
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND objid = (hashtext(${`omni:agent-key:${agentId}`})::bigint & 4294967295)::oid
      `);
      if (waiting.length > 0) return;
      await Bun.sleep(10);
    }
    throw new Error('Second route writer never waited for the per-agent advisory lock');
  }

  for (const oldFirst of [false, true]) {
    test(`route retarget locks the sorted pair before syncing either agent (old first: ${oldFirst})`, async () => {
      const tenantId = crypto.randomUUID();
      const owners = [await agent(tenantId), await agent(tenantId)].sort((a, b) => a.id.localeCompare(b.id));
      const low = owners[0] as Agent;
      const high = owners[1] as Agent;
      const previous = oldFirst ? low : high;
      const next = oldFirst ? high : low;
      const target = await instance(tenantId);
      const route = await createRoute(target, previous);
      const pool = openDb(await enforcedRole(), 1);
      await assertPgTestRole(pool, DEFAULT_ROLE_NAMES.runtime);
      const service = new RouteService(pool, new RouteResolver(pool));
      const locked = barrier();
      const release = barrier();
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`omni:agent-key:${low.id}`}))`);
        locked.release();
        await release.promise;
      });
      await locked.promise;
      const retarget = runInWorkerTenantScope(pool, tenantId, () => service.update(route.id, { agentId: next.id }));
      try {
        await waitForAdvisoryWait(low.id);
        const highLocks = await db.execute(sql`
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
            AND objid = (hashtext(${`omni:agent-key:${high.id}`})::bigint & 4294967295)::oid
        `);
        expect(highLocks).toHaveLength(0);
      } finally {
        release.release();
        await Promise.all([holder, retarget]);
      }
      expect(await keys.findAgentKeyByName(keyName(previous))).toBeNull();
      expect((await keys.findAgentKeyByName(keyName(next)))?.instanceIds).toEqual([target.id]);
    }, 15_000);
  }

  // Pause AFTER the real xact lock and BEFORE the graph read. This proves
  // legacy locking is transactional rather than released by autocommit.
  function pauseLegacyTransaction(
    firstPool: Database,
    firstLocked: ReturnType<typeof barrier>,
    releaseFirst: ReturnType<typeof barrier>,
  ): Database {
    return new Proxy(firstPool, {
      get(target, property) {
        if (property !== 'transaction') return Reflect.get(target, property);
        return (fn: (tx: unknown) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            const pausedTx = new Proxy(tx, {
              get(handle, key) {
                if (key !== 'execute') return Reflect.get(handle, key);
                return async (...args: Parameters<typeof tx.execute>) => {
                  const result = await tx.execute(...args);
                  firstLocked.release();
                  await releaseFirst.promise;
                  return result;
                };
              },
            });
            return fn(pausedTx);
          });
      },
    });
  }

  async function concurrentRouteWrites(enforced: boolean, firstMutation: 'delete' | 'create') {
    const tenantId = enforced ? crypto.randomUUID() : null;
    const owner = await agent(tenantId);
    const removed = await instance(tenantId);
    const added = await instance(tenantId);
    const retained = await instance(tenantId);
    const removedRoute = await createRoute(removed, owner);
    await createRoute(retained, owner);
    const conversation = await chat(added.id);
    const role = enforced ? await enforcedRole() : undefined;
    const firstPool = openDb(role);
    const secondPool = openDb(role);
    if (enforced) {
      await assertPgTestRole(firstPool, DEFAULT_ROLE_NAMES.runtime);
      await assertPgTestRole(secondPool, DEFAULT_ROLE_NAMES.runtime);
    }
    const firstLocked = barrier();
    const releaseFirst = barrier();
    const mutate = async (pool: Database, kind: 'delete' | 'create'): Promise<void> => {
      const service = new RouteService(pool, new RouteResolver(pool));
      await (kind === 'delete'
        ? service.delete(removedRoute.id)
        : service.create(added.id, {
            scope: 'chat',
            chatId: conversation.id,
            agentId: owner.id,
            priority: 0,
            isActive: true,
          }));
    };
    const first = enforced
      ? runInWorkerTenantScope(firstPool, tenantId as string, async () => {
          await mutate(firstPool, firstMutation);
          firstLocked.release();
          await releaseFirst.promise;
        })
      : mutate(pauseLegacyTransaction(firstPool, firstLocked, releaseFirst), firstMutation);
    let second: Promise<unknown> | undefined;
    try {
      await Promise.race([
        firstLocked.promise,
        first.then(() => {
          throw new Error('First writer finished without holding its lock');
        }),
      ]);
      const secondMutation = firstMutation === 'delete' ? 'create' : 'delete';
      second = enforced
        ? runInWorkerTenantScope(secondPool, tenantId as string, () => mutate(secondPool, secondMutation))
        : mutate(secondPool, secondMutation);
      await waitForAdvisoryWait(owner.id);
    } finally {
      releaseFirst.release();
      await Promise.all([first, second]);
    }
    const active = await keys.findAgentKeysByNames([keyName(owner)]);
    expect(active).toHaveLength(1);
    expect(new Set(active[0]?.instanceIds)).toEqual(new Set([retained.id, added.id]));
  }

  for (const enforced of [false, true]) {
    for (const firstMutation of ['delete', 'create'] as const) {
      test(
        `concurrent route ${firstMutation} first keeps exact grants (${enforced ? 'enforced RLS' : 'legacy autocommit'})`,
        () => concurrentRouteWrites(enforced, firstMutation),
        15_000,
      );
    }
  }
});
