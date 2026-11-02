/** Rollback uses real HTTP/auth and real journal claims on a disposable runtime-role database. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  agentSourceGrants,
  agents,
  applyTenancyRoles,
  createDbHandle,
  durableConsumers,
  instances,
  omniEvents,
} from '@omni/db';
import {
  assertPgTestRole,
  connectorIngressFunctionStatements,
  connectorIngressRoleStatements,
  contextFunctionStatements,
  pgRoleUrl,
  provisionMigratedDatabase,
} from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../app';
import { ApiKeyService, type CreateApiKeyResult } from '../services/api-keys';
import { connectorHookBus } from './fixtures/events-only-connector';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const pgDescribe = superUrl ? describe : describe.skip;
const page = z.object({ items: z.array(z.object({ id: z.string() })), cursor: z.number() });
const eventId = z.object({ eventId: z.string().uuid() });

pgDescribe('paired-agent rollback and forward-only grant delivery (real PostgreSQL)', () => {
  const database = `pa_rollback_${randomUUID().replaceAll('-', '')}`;
  const A = randomUUID();
  const B = randomUUID();
  const IA = randomUUID();
  const IB = randomUUID();
  const previous = { ...process.env };
  const closers: (() => Promise<void>)[] = [];
  const { bus } = connectorHookBus();
  let db: Database;
  let app: ReturnType<typeof createApp>['app'];
  let a: CreateApiKeyResult;
  let b: CreateApiKeyResult;
  let plain: CreateApiKeyResult;
  let sourceId: string;
  function open(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, database, role), maxConnections: 4 });
    closers.push(handle.close);
    return handle.db;
  }
  beforeAll(async () => {
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    const owner = open();
    await owner.insert(agents).values([
      { id: A, name: 'rollback-a', provider: 'claude' },
      { id: B, name: 'rollback-b', provider: 'claude' },
    ]);
    await owner.insert(instances).values([
      { id: IA, name: 'rollback-a', channel: 'whatsapp-baileys', agentId: A },
      { id: IB, name: 'rollback-b', channel: 'whatsapp-baileys', agentId: B },
    ]);
    const keys = new ApiKeyService(owner);
    a = await keys.create({
      name: 'agent:rollback-a',
      scopes: ['events:*'],
      instanceIds: [IA],
      createdBy: 'system:auto-provision',
    });
    b = await keys.create({
      name: 'agent:rollback-b',
      scopes: ['events:*'],
      instanceIds: [IB],
      createdBy: 'system:auto-provision',
    });
    plain = await keys.create({ name: 'rollback-plain', scopes: ['*'] });
    // Plain reader must never receive admin-tier consumer access.
    const reader = await keys.create({ name: 'rollback-reader', scopes: ['events:*'] });
    readerKey = reader;
    for (const statement of [
      ...connectorIngressRoleStatements(),
      ...contextFunctionStatements(),
      ...connectorIngressFunctionStatements(),
    ])
      await owner.execute(sql.raw(statement));
    const passwords = { ddl: randomUUID(), runtime: randomUUID(), authPlane: randomUUID() };
    await applyTenancyRoles(owner, passwords, DEFAULT_ROLE_NAMES, database);
    db = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
    await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
    const application = createApp(db, bus, null, null);
    app = application.app;
    sourceId = (await application.services.webhooks.create({ name: 'rollback-source' })).id;
  }, 180_000);
  let readerKey: CreateApiKeyResult;
  beforeEach(async () => {
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    await db.delete(durableConsumers);
    await db.delete(agentSourceGrants);
    await db.delete(omniEvents);
    await db.insert(agentSourceGrants).values([
      { agentId: A, sourceKind: 'webhook_source', sourceId, approvedByKeyId: plain.key.id },
      { agentId: A, sourceKind: 'agent', sourceId: A, approvedByKeyId: plain.key.id },
    ]);
  });
  afterEach(() => {
    for (const name of ['OMNI_PAIRED_AGENT_CONSUMERS', 'OMNI_MULTITENANCY_ENABLED']) {
      if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = previous[name];
    }
  });
  afterAll(async () => {
    await bus.close();
    for (const close of closers.reverse()) await close();
    const result = Bun.spawnSync([
      psqlBin,
      '-X',
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--dbname',
      superUrl,
      '-c',
      `DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`,
    ]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  });
  function request(key: CreateApiKeyResult, path: string, method = 'GET', body?: unknown) {
    return app.request(`/api/v2${path}`, {
      method,
      headers: { 'x-api-key': key.plainTextKey, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function create(key: CreateApiKeyResult) {
    const name = `rollback-${randomUUID()}`;
    const response = await request(key, '/events/consumers', 'POST', { name, eventType: '*', startFrom: 'beginning' });
    expect(response.status).toBe(201);
    return name;
  }
  async function pull(key: CreateApiKeyResult, name: string) {
    const response = await request(key, `/events/consumers/${name}/pull`, 'POST');
    expect(response.status).toBe(200);
    return page.parse(await response.json()).items.map((item) => item.id);
  }
  async function claimed(path: string, key = a) {
    const response = await request(
      key,
      path,
      'POST',
      path.startsWith('/events')
        ? { eventType: 'custom.rollback.trigger', payload: {}, idempotencyKey: randomUUID() }
        : { id: randomUUID() },
    );
    expect(response.status).toBe(path.startsWith('/events') ? 201 : 200);
    const id = eventId.parse(await response.json()).eventId;
    const [row] = await db.select().from(omniEvents).where(eq(omniEvents.id, id));
    if (!row) throw new Error('Missing real journal claim');
    return row;
  }
  for (const off of ['unset', 'multitenancy'] as const) {
    test(`${off}: rollback preserves ownership, blocks grants and new ownership; re-enable resumes stamped rows but never backfills the OFF gap`, async () => {
      await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
      const owned = await create(a);
      const legacy = await create(readerKey);
      const hookOn = await claimed('/webhooks/rollback-source', plain);
      expect([hookOn.sourceKind, hookOn.sourceId]).toEqual(['webhook_source', sourceId]);
      const agentOn = await claimed('/events/trigger');
      expect([agentOn.producingKeyId, agentOn.agentId]).toEqual([a.key.id, A]);
      const [instanceRow] = await db
        .insert(omniEvents)
        .values({ channel: 'internal', eventType: 'custom.rollback.instance', instanceId: IA })
        .returning();
      if (!instanceRow) throw new Error('Missing instance fixture');
      const before = [hookOn.id, agentOn.id, instanceRow.id];
      expect(await pull(a, owned)).toEqual(before);
      expect(await pull(readerKey, legacy)).toEqual(before);
      if (off === 'unset') Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
      else process.env.OMNI_MULTITENANCY_ENABLED = 'true';
      for (const key of [b, readerKey]) {
        expect((await request(key, `/events/consumers/${owned}`)).status).toBe(404);
        expect((await request(key, `/events/consumers/${owned}/pull`, 'POST')).status).toBe(404);
      }
      const rejected = await request(plain, '/events/consumers', 'POST', {
        name: `refused-${randomUUID()}`,
        eventType: '*',
        agentId: A,
      });
      expect(rejected.status).toBe(400);
      expect(await pull(a, owned)).toEqual([instanceRow.id]);
      const hookOff = await claimed('/webhooks/rollback-source', plain);
      const agentOff = await claimed('/events/trigger');
      for (const row of [hookOff, agentOff]) {
        expect([row.producingKeyId, row.agentId, row.sourceKind, row.sourceId]).toEqual([null, null, null, null]);
      }
      const all = [...before, hookOff.id, agentOff.id];
      expect(await pull(readerKey, legacy)).toEqual(all);
      // No ack: the old stamped rows remain unread and must resume after re-enable.
      if (off === 'unset') process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
      else Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
      const hookAgain = await claimed('/webhooks/rollback-source', plain);
      expect(await pull(a, owned)).toEqual([...before, hookAgain.id]);
      expect(await pull(readerKey, legacy)).toEqual([...all, hookAgain.id]);
      for (const key of [b, readerKey])
        expect((await request(key, `/events/consumers/${owned}/pull`, 'POST')).status).toBe(404);
    });
  }
});
