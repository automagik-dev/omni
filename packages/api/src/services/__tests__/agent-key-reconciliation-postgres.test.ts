/** Startup upgrade repair against a disposable PostgreSQL database only. */
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { configureLogging, getLogConfig } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  agents,
  apiKeys,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
  instances,
  tenants,
} from '@omni/db';
import { assertPgTestRole, pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getAgentKeyRepairHealth, runStartupAgentKeyRepair } from '../../agent-key-repair-state';
import { CacheKeys, apiKeyCache } from '../../cache';
import { DEFAULT_TURN_SCOPES } from '../../constants/scopes';
import { authMiddleware } from '../../middleware/auth';
import { __test__ as dispatcher } from '../../plugins/agent-dispatcher';
import type { AppVariables } from '../../types';
import { findAgentsWithoutKeys, reconcileAgentKeys } from '../agent-key-reconciliation';
import { ApiKeyService } from '../api-keys';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('agent key startup reconciliation (real PostgreSQL)', () => {
  const dbName = `omni_agent_reconcile_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let keys: ApiKeyService;

  function openDb(role?: { name: string; password: string }): Database {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName, role), maxConnections: 3 });
    closers.push(handle.close);
    return handle.db;
  }

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    db = openDb();
    keys = new ApiKeyService(db);
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

  async function instanceFor(agentId: string, tenantId: string | null) {
    const [row] = await db
      .insert(instances)
      .values({
        name: `instance-${crypto.randomUUID()}`,
        channel: 'whatsapp-baileys',
        agentId,
        tenantId,
      })
      .returning();
    if (!row) throw new Error('instance fixture missing');
    return row;
  }

  async function binding(tenantId: string | null = null, name = `agent-${crypto.randomUUID()}`) {
    if (tenantId) {
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
    }
    const [agent] = await db
      .insert(agents)
      .values({ name, provider: 'claude', metadata: { omniScopes: ['messages:read'] } })
      .returning();
    if (!agent) throw new Error('agent fixture missing');
    // Match post-backfill tenant ownership; the INSERT derivation trigger
    // leaves ownerless test agents NULL until the fixture stamps the owner.
    if (tenantId) await db.update(agents).set({ tenantId }).where(eq(agents.id, agent.id));
    const instance = await instanceFor(agent.id, tenantId);
    return { agent, instance };
  }

  function seed(name: string, instanceIds?: string[], createdBy = 'system:auto-provision') {
    return keys.create({ name, instanceIds, scopes: [...DEFAULT_TURN_SCOPES], createdBy });
  }

  function authenticate(secret: string) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('services', { apiKeys: keys } as AppVariables['services']);
      await next();
    });
    app.use('*', authMiddleware);
    app.get('/probe', (c) => c.json({ keyId: c.get('apiKey')?.id }));
    return app.request('/probe', { headers: { 'x-api-key': secret } });
  }

  for (const instanceIds of [undefined, []]) {
    test(`a ${JSON.stringify(instanceIds) ?? 'NULL'}-list auto agent key cannot authenticate, including cached entries`, async () => {
      const result = await seed(`agent:auth-${crypto.randomUUID()}`, instanceIds);
      expect(result.key.status).toBe('active');
      expect((await authenticate(result.plainTextKey)).status).toBe(401);
      const cacheKey = CacheKeys.apiKey(result.key.keyHash);
      // Exercise both current provenance-bearing entries and pre-upgrade cache entries.
      for (const provenance of [{ createdBy: 'system:auto-provision' }, {}]) {
        await apiKeyCache.set(cacheKey, {
          id: result.key.id,
          name: result.key.name,
          status: result.key.status,
          scopes: result.key.scopes,
          instanceIds: result.key.instanceIds,
          expiresAt: result.key.expiresAt,
          ...provenance,
        });
        expect((await authenticate(result.plainTextKey)).status).toBe(401);
        expect(await apiKeyCache.get(cacheKey)).toBeNull();
      }
      expect((await keys.getById(result.key.id))?.status).toBe('active');
    });
  }

  test('a narrow auto agent key authenticates on both database and cached paths', async () => {
    const { instance } = await binding();
    const result = await seed(`agent:auth-${crypto.randomUUID()}`, [instance.id]);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await authenticate(result.plainTextKey);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ keyId: result.key.id });
    }
  });

  test('unrestricted operator/admin keys and non-agent system keys keep authenticating', async () => {
    for (const instanceIds of [undefined, []]) {
      for (const scopes of [['messages:send'], ['*']]) {
        const result = await keys.create({
          name: `agent:operator-${crypto.randomUUID()}`,
          createdBy: 'operator',
          scopes,
          instanceIds,
        });
        for (let attempt = 0; attempt < 2; attempt++) {
          expect((await authenticate(result.plainTextKey)).status).toBe(200);
        }
        await apiKeyCache.set(CacheKeys.apiKey(result.key.keyHash), { ...result.key, createdBy: undefined });
        expect((await authenticate(result.plainTextKey)).status).toBe(200);
      }
    }
    const unrelated = await seed('unrelated-system-key');
    expect((await authenticate(unrelated.plainTextKey)).status).toBe(200);
  });

  async function dispatch(instance: Awaited<ReturnType<typeof instanceFor>>) {
    const open = mock(async (_options: { apiKeyId: string }) => ({ id: 'turn' }));
    const trigger = mock(async () => undefined);
    const success = await dispatcher.dispatchViaTurnBasedProvider(
      { apiKeys: keys, turns: { open }, chats: { findByExternalIdSmart: async () => null } } as never,
      instance,
      { id: 'provider', schema: 'genie', trigger } as never,
      { content: { text: 'hello' }, sessionId: 'session' } as never,
      [{ payload: { externalId: 'message' }, metadata: {} }] as never,
      'chat',
      'trace',
      db,
    );
    return { success, open, trigger };
  }

  test('legacy pre-POST instance dispatches after repair, and repeated boots change nothing', async () => {
    const { agent, instance: first } = await binding();
    const second = await instanceFor(agent.id, null);
    const key = await seed(`agent:${agent.name}`, [first.id]);
    expect(key.key.instanceIds).not.toContain(second.id);
    // No-tenant dispatch retains its legacy name lookup even before repair.
    expect((await dispatch(second)).success).toBe(true);
    await keys.validate(key.plainTextKey); // cache must also reflect the repaired scope
    await reconcileAgentKeys(db, db, 'legacy');
    const repaired = await keys.getById(key.key.id);
    expect(new Set(repaired?.instanceIds)).toEqual(new Set([first.id, second.id]));
    expect((await keys.validate(key.plainTextKey))?.instanceIds).toContain(second.id);
    expect((await dispatch(second)).success).toBe(true);
    // Dispatch writes context; compare state only after that legitimate write.
    const snapshot = await keys.getById(key.key.id);
    await reconcileAgentKeys(db, db, 'legacy');
    expect(await keys.getById(key.key.id)).toEqual(snapshot);
    expect(await keys.findAgentKeysByNames([key.key.name])).toHaveLength(1);
  });

  test('missing system keys are provisioned for all bound instances using declared scopes', async () => {
    const { agent, instance: first } = await binding();
    const second = await instanceFor(agent.id, null);
    const name = `agent:${agent.name}`;
    const user = await seed(name, [first.id], 'operator');
    await Promise.all([reconcileAgentKeys(db, db, 'legacy'), reconcileAgentKeys(db, db, 'legacy')]);
    const key = await keys.findAgentKeyByName(name);
    expect(key?.id).not.toBe(user.key.id);
    expect(new Set(key?.instanceIds)).toEqual(new Set([first.id, second.id]));
    expect(key?.scopes).toEqual(['messages:read']);
    await reconcileAgentKeys(db, db, 'legacy');
    expect(await keys.findAgentKeysByNames([name])).toHaveLength(1);
    expect(await keys.getById(user.key.id)).toEqual(user.key);
  });

  for (const instanceIds of [undefined, []]) {
    test(`a widened ${JSON.stringify(instanceIds) ?? 'NULL'} key is revoked once and its bound instance dispatches with a fresh narrow key`, async () => {
      const { agent, instance } = await binding(crypto.randomUUID());
      const widened = await seed(`agent:${instance.tenantId}:${agent.name}`, instanceIds);
      await keys.validate(widened.plainTextKey);
      await reconcileAgentKeys(db, db, 'legacy');
      expect((await keys.getById(widened.key.id))?.status).toBe('revoked');
      expect(await keys.validate(widened.plainTextKey)).toBeNull();
      const replacement = await keys.findAgentKeyByName(widened.key.name);
      expect(replacement?.id).not.toBe(widened.key.id);
      expect(replacement?.instanceIds).toEqual([instance.id]);
      const attempt = await dispatch(instance);
      expect(attempt.success).toBe(true);
      expect(attempt.open.mock.calls[0]?.[0]).toMatchObject({ apiKeyId: replacement?.id });
      const snapshot = await keys.list();
      await reconcileAgentKeys(db, db, 'legacy');
      expect(await keys.list()).toEqual(snapshot);
    });
  }

  test('route-only widened keys warn once per revoked key; operator and non-agent keys stay unchanged', async () => {
    const name = `agent:route-only-${crypto.randomUUID()}`;
    const widened = await seed(name);
    const empty = await seed(name, []);
    const operator = await seed(name, undefined, 'operator');
    const other = await seed('unrelated-system-key');
    const config = getLogConfig();
    const output: string[] = [];
    const writer = spyOn(process.stdout, 'write').mockImplementation((data) => {
      output.push(String(data));
      return true;
    });
    try {
      configureLogging({ level: 'warn', format: 'json', modules: 'agent-key-reconciliation' });
      await reconcileAgentKeys(db, db, 'legacy');
      const warnings = output.map((line) => JSON.parse(line));
      expect(warnings).toHaveLength(2);
      expect(new Set(warnings.map((entry) => entry.keyId))).toEqual(new Set([widened.key.id, empty.key.id]));
      for (const warning of warnings) {
        expect(warning.agent).toBe(name.slice('agent:'.length));
        expect(warning.msg).toContain('bind the agent to an instance');
      }
      const snapshot = await keys.list();
      await reconcileAgentKeys(db, db, 'legacy');
      expect(output).toHaveLength(2);
      expect(await keys.list()).toEqual(snapshot);
    } finally {
      configureLogging(config);
      writer.mockRestore();
    }
    expect((await keys.getById(widened.key.id))?.status).toBe('revoked');
    expect((await keys.getById(empty.key.id))?.status).toBe('revoked');
    expect(await keys.findAgentKeysByNames([name])).toHaveLength(0);
    expect(await keys.getById(operator.key.id)).toEqual(operator.key);
    expect(await keys.getById(other.key.id)).toEqual(other.key);
  });

  test("tenant B's support binding never gets appended to tenant A's bare support key", async () => {
    const a = await binding(crypto.randomUUID(), 'support');
    const b = await binding(crypto.randomUUID(), 'support');
    const bare = await seed('agent:support', [a.instance.id]);
    await reconcileAgentKeys(db, db, 'legacy');
    expect(await keys.getById(bare.key.id)).toEqual(bare.key);
    const bName = `agent:${b.instance.tenantId}:support`;
    expect((await keys.findAgentKeyByName(bName))?.instanceIds).toEqual([b.instance.id]);
    await reconcileAgentKeys(db, db, 'legacy');
    expect(await keys.findAgentKeysByNames([bName])).toHaveLength(1);
  });

  test('agent lookup selects the newest active system key and deterministically breaks timestamp ties', async () => {
    const name = `agent:duplicate-${crypto.randomUUID()}`;
    const first = await seed(name, [crypto.randomUUID()]);
    const second = await seed(name, [crypto.randomUUID()]);
    await db
      .update(apiKeys)
      .set({ createdAt: new Date('2025-01-01') })
      .where(eq(apiKeys.id, first.key.id));
    await db
      .update(apiKeys)
      .set({ createdAt: new Date('2025-01-02') })
      .where(eq(apiKeys.id, second.key.id));
    expect((await keys.findAgentKeyByName(name))?.id).toBe(second.key.id);
    await db
      .update(apiKeys)
      .set({ createdAt: new Date('2025-01-02') })
      .where(eq(apiKeys.id, first.key.id));
    const ordered = [first.key.id, second.key.id].sort().reverse();
    expect((await keys.findAgentKeyByName(name))?.id).toBe(ordered[0]);
    expect((await keys.findAgentKeysByNames([name])).map((key) => key.id)).toEqual(ordered);
    const operator = await seed(name, [crypto.randomUUID()], 'operator');
    const revoked = await seed(name, [crypto.randomUUID()]);
    await keys.revoke(revoked.key.id);
    expect((await keys.findAgentKeyByName(name))?.id).not.toBe(operator.key.id);
    expect((await keys.findAgentKeyByName(name))?.id).toBe(ordered[0]);
  });

  test('a mixed bare key is not considered healthy even when it already grants the bound instance', async () => {
    const own = await binding();
    const foreign = await binding(crypto.randomUUID());
    const stale = await seed(`agent:${own.agent.name}`, [own.instance.id, foreign.instance.id]);
    await reconcileAgentKeys(db, db, 'legacy');
    const replacement = await keys.findAgentKeyByName(stale.key.name);
    expect(replacement?.id).not.toBe(stale.key.id);
    expect(replacement?.instanceIds).toEqual([own.instance.id]);
    expect(await keys.getById(stale.key.id)).toEqual(stale.key);
    const snapshot = await keys.list();
    await reconcileAgentKeys(db, db, 'legacy');
    expect(await keys.list()).toEqual(snapshot);
  });

  test('repair batches key reads; healthy startup takes no repair transaction or per-binding key reads', async () => {
    const { agent, instance } = await binding();
    const bound = [instance.id];
    for (let i = 0; i < 8; i++) bound.push((await instanceFor(agent.id, null)).id);
    const reads = spyOn(ApiKeyService.prototype, 'findAgentKeysByNames');
    try {
      await reconcileAgentKeys(db, db, 'legacy');
      expect(reads).toHaveBeenCalledTimes(1);
      const repaired = await keys.findAgentKeyByName(`agent:${agent.name}`);
      expect(new Set(repaired?.instanceIds)).toEqual(new Set(bound));
      reads.mockClear();
      const transaction = spyOn(db, 'transaction');
      try {
        await reconcileAgentKeys(db, db, 'legacy');
        expect(transaction).not.toHaveBeenCalled();
        expect(reads).not.toHaveBeenCalled();
      } finally {
        transaction.mockRestore();
      }
    } finally {
      reads.mockRestore();
    }
  });

  test('failure after widened-key revocation commits keeps boot open and counts agents left without a key', async () => {
    const baseline = await findAgentsWithoutKeys(db, db, 'legacy');
    const { agent, instance } = await binding();
    const secondInstance = await instanceFor(agent.id, null);
    const [routeOnly] = await db
      .insert(agents)
      .values({ name: `route-only-${crypto.randomUUID()}`, provider: 'claude' })
      .returning();
    if (!routeOnly) throw new Error('route-only fixture missing');
    const routeKey = await seed(`agent:${routeOnly.name}`);
    const name = `agent:${agent.name}`;
    const widened = await seed(name);
    const originalCreate = ApiKeyService.prototype.create;
    const failure = Object.assign(new Error('replacement denied'), { code: '42501' });
    const create = spyOn(ApiKeyService.prototype, 'create').mockImplementation(async function (
      this: ApiKeyService,
      options,
    ) {
      if (options.name === name) throw failure;
      return originalCreate.call(this, options);
    });
    const reported = mock((_error: unknown, _missing: unknown) => {});
    try {
      await runStartupAgentKeyRepair(() => reconcileAgentKeys(db, db, 'legacy'), {
        inspectMissingAgents: () => findAgentsWithoutKeys(db, db, 'legacy'),
        reportFailure: reported,
      });
      expect((await keys.getById(widened.key.id))?.status).toBe('revoked');
      expect(await keys.findAgentKeyByName(name)).toBeNull();
      expect((await keys.getById(routeKey.key.id))?.status).toBe('revoked');
      expect((await dispatch(instance)).success).toBe(false);
      expect((await dispatch(secondInstance)).success).toBe(false);
      expect(getAgentKeyRepairHealth()).toMatchObject({
        status: 'error',
        details: { agentsWithoutKey: baseline.length + 2 },
      });
      expect(JSON.stringify(getAgentKeyRepairHealth())).not.toContain(agent.name);
      expect(reported).toHaveBeenCalledTimes(1);
      expect(reported.mock.calls[0]?.[1]).toContainEqual({ id: agent.id, name: agent.name });
      expect(reported.mock.calls[0]?.[1]).toContainEqual({ id: routeOnly.id, name: routeOnly.name });
    } finally {
      create.mockRestore();
      await runStartupAgentKeyRepair(() => reconcileAgentKeys(db, db, 'legacy'));
    }
    expect((await dispatch(instance)).success).toBe(true);
    expect((await dispatch(secondInstance)).success).toBe(true);
  });

  test('enforced startup enumerates tenants on the auth plane and repairs under runtime RLS scopes', async () => {
    const { agent, instance: first } = await binding(crypto.randomUUID());
    const second = await instanceFor(agent.id, first.tenantId);
    const key = await seed(`agent:${first.tenantId}:${agent.name}`, [first.id]);
    const widened = await seed(`agent:${first.tenantId}:${agent.name}`);
    const passwords = {
      ddl: crypto.randomUUID().replaceAll('-', ''),
      runtime: crypto.randomUUID().replaceAll('-', ''),
      authPlane: crypto.randomUUID().replaceAll('-', ''),
    };
    await applyTenantRlsEnforcement(db);
    await applyTenancyRoles(db, passwords, DEFAULT_ROLE_NAMES, dbName);
    const runtime = openDb({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
    await assertPgTestRole(runtime, DEFAULT_ROLE_NAMES.runtime);
    const authPlane = openDb({ name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane });
    const [identity] = await runtime.execute(sql`
      SELECT current_user AS name, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    expect(identity).toMatchObject({ name: DEFAULT_ROLE_NAMES.runtime, rolsuper: false, rolbypassrls: false });
    await reconcileAgentKeys(runtime, authPlane, 'enforced');
    expect((await keys.getById(widened.key.id))?.status).toBe('revoked');
    expect(new Set((await keys.getById(key.key.id))?.instanceIds)).toEqual(new Set([first.id, second.id]));
    expect((await findAgentsWithoutKeys(runtime, authPlane, 'enforced')).map((row) => row.id)).not.toContain(agent.id);
    const snapshot = await keys.getById(key.key.id);
    await reconcileAgentKeys(runtime, authPlane, 'enforced');
    expect(await keys.getById(key.key.id)).toEqual(snapshot);
  }, 15_000);
});
