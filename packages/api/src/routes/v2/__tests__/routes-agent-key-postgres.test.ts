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
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { __test__ as dispatcher } from '../../../plugins/agent-dispatcher';
import { syncRouteAgentKey } from '../../../services/agent-key-bindings';
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

  function openDb(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName, role), maxConnections: 3 });
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

  test('a foreign agent never receives a grant even without enforced RLS', async () => {
    const local = await agent(crypto.randomUUID());
    const foreign = await agent(crypto.randomUUID());
    const target = await instance(local.tenantId);
    const before = await keys.list();
    await syncRouteAgentKey(db, target.id, foreign.id);
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
    const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
    await applyTenantRlsEnforcement(db);
    await applyTenancyRoles(db, passwords, DEFAULT_ROLE_NAMES, dbName);
    const runtime = openDb({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
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
    await runInWorkerTenantScope(runtime, localTenant, () => syncRouteAgentKey(runtime, target.id, foreign.id));
    expect(await keys.getById(foreignKey.key.id)).toEqual(foreignKey.key);
  }, 15_000);
});
