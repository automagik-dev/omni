/** Startup upgrade repair against a disposable PostgreSQL database only. */
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { configureLogging, getLogConfig } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  agents,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
  instances,
  tenants,
} from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_TURN_SCOPES } from '../../constants/scopes';
import { __test__ as dispatcher } from '../../plugins/agent-dispatcher';
import { reconcileAgentKeys } from '../agent-key-reconciliation';
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
    const url = new URL(superUrl);
    url.pathname = `/${dbName}`;
    const previousUser = process.env.PGUSER;
    const previousPassword = process.env.PGPASSWORD;
    // A hostless URL cannot carry URL.username. postgres.js captures these
    // options synchronously; restore the process environment before returning.
    let handle: ReturnType<typeof createDbHandle>;
    try {
      if (role && url.hostname) {
        url.username = role.name;
        url.password = role.password;
      } else if (role) {
        process.env.PGUSER = role.name;
        process.env.PGPASSWORD = role.password;
      }
      handle = createDbHandle({ url: url.toString(), maxConnections: 3 });
    } finally {
      if (previousUser === undefined) Reflect.deleteProperty(process.env, 'PGUSER');
      else process.env.PGUSER = previousUser;
      if (previousPassword === undefined) Reflect.deleteProperty(process.env, 'PGPASSWORD');
      else process.env.PGPASSWORD = previousPassword;
    }
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
    const authPlane = openDb({ name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane });
    const [identity] = await runtime.execute(sql`SELECT current_user AS name`);
    expect(identity?.name).toBe(DEFAULT_ROLE_NAMES.runtime);
    await reconcileAgentKeys(runtime, authPlane, 'enforced');
    expect((await keys.getById(widened.key.id))?.status).toBe('revoked');
    expect(new Set((await keys.getById(key.key.id))?.instanceIds)).toEqual(new Set([first.id, second.id]));
    const snapshot = await keys.getById(key.key.id);
    await reconcileAgentKeys(runtime, authPlane, 'enforced');
    expect(await keys.getById(key.key.id)).toEqual(snapshot);
  }, 15_000);
});
