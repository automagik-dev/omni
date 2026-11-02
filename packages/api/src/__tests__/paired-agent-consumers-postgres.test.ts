/** C1 ownership over real HTTP/auth and a disposable, migrated runtime-role database. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  agents,
  apiKeys,
  applyTenancyRoles,
  createDbHandle,
  durableConsumers,
  instances,
  omniEvents,
  tenants,
} from '@omni/db';
import {
  assertPgTestRole,
  connectorIngressFunctionStatements,
  connectorIngressRoleStatements,
  contextFunctionStatements,
  pgRoleUrl,
  provisionMigratedDatabase,
} from '@omni/db/pg-migrated-template';
import { eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createApp } from '../app';
import { DEFAULT_DEVICE_KEY_SCOPES } from '../login/config';
import { authMiddleware } from '../middleware/auth';
import { errorHandler } from '../middleware/error';
import { eventConsumersRoutes } from '../routes/v2/event-consumers';
import { ApiKeyService, type CreateApiKeyResult } from '../services/api-keys';
import type { AppVariables } from '../types';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';
const pgDescribe = superUrl ? describe : describe.skip;
const view = z.object({ data: z.object({ agentId: z.string().nullable(), scoped: z.boolean(), name: z.string() }) });
const page = z.object({
  items: z.array(z.object({ id: z.string(), instanceId: z.string().nullable() })),
  cursor: z.number(),
});
const listing = z.object({ items: z.array(z.object({ name: z.string() })) });
const errorBody = z.object({ error: z.object({ message: z.string() }) });
const verbs = ['inspect', 'pull', 'ack', 'stream', 'delete'] as const;
type Verb = (typeof verbs)[number];

pgDescribe('paired-agent consumer ownership (C1, real PostgreSQL)', () => {
  const database = `pa_consumers_${randomUUID().replaceAll('-', '')}`;
  const A = randomUUID();
  const B = randomUUID();
  const inactive = randomUUID();
  const legacyAgent = randomUUID();
  const legacyInstance = randomUUID();
  const IA = randomUUID();
  const IB = randomUUID();
  const II = randomUUID();
  const unbound = randomUUID();
  const T = randomUUID();
  const otherT = randomUUID();
  const eventId = randomUUID();
  const sourcelessId = randomUUID();
  const closers: (() => Promise<void>)[] = [];
  const originalEnv = { ...process.env };
  let db: Database;
  let app: ReturnType<typeof createApp>['app'];
  let tenantApp: typeof app;
  let ownerApp: typeof app;
  const credentials = new Map<string, CreateApiKeyResult>();
  function credential(name: string): CreateApiKeyResult {
    const key = credentials.get(name);
    if (!key) throw new Error(`Missing fixture ${name}`);
    return key;
  }
  function open(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, database, role), maxConnections: 4 });
    closers.push(handle.close);
    return handle.db;
  }
  beforeAll(async () => {
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    const owner = open();
    await owner.insert(tenants).values(
      [T, otherT].map((id) => ({
        id,
        slug: id,
        displayName: id,
        maxKeyTtlSeconds: 86400,
        maxKeyRateLimit: 1000,
        maxKeyBudget: 1000,
      })),
    );
    await owner.insert(agents).values([
      { id: A, name: 'c1-a', provider: 'claude' },
      { id: B, name: 'c1-b', provider: 'claude' },
      { id: inactive, name: 'c1-inactive', provider: 'claude', isActive: false },
      { id: legacyAgent, name: 'c1-null', provider: 'claude' },
    ]);
    // Match the existing agent-key fixtures: insert ownership has no creator parent,
    // so apply the trusted additive-state backfill before creating tenant-root instances.
    await owner
      .update(agents)
      .set({ tenantId: T })
      .where(inArray(agents.id, [A, B, inactive]));
    await owner.insert(instances).values([
      { id: IA, name: 'c1-a', channel: 'whatsapp-baileys', agentId: A, tenantId: T },
      { id: IB, name: 'c1-b', channel: 'whatsapp-baileys', agentId: B, tenantId: T },
      { id: II, name: 'c1-inactive', channel: 'whatsapp-baileys', agentId: inactive, tenantId: T },
      { id: unbound, name: 'c1-unbound', channel: 'whatsapp-baileys', tenantId: T },
      { id: legacyInstance, name: 'c1-null', channel: 'whatsapp-baileys', agentId: legacyAgent },
    ]);
    const keys = new ApiKeyService(owner);
    async function key(label: string, scopes: string[], instanceIds?: string[], systemName?: string) {
      const result = await keys.create({
        name: systemName ?? label,
        scopes,
        instanceIds,
        createdBy: systemName ? 'system:auto-provision' : 'human',
      });
      credentials.set(label, result);
    }
    await key('null-agent', ['events:*'], [legacyInstance], 'agent:c1-null');
    await key('admin', ['*']);
    await key('device', [...DEFAULT_DEVICE_KEY_SCOPES]);
    await key('restricted-wildcard', ['*'], [IA]);
    await key('plain', ['events:*']);
    await key('a', ['events:*'], [IA], 'agent:c1-a');
    await key('a-second', ['events:*'], [IA], 'agent:c1-a');
    await key('b', ['events:*'], [IB], 'agent:c1-b');
    await key('inactive', ['*'], [II], 'agent:c1-inactive');
    await key('no-binding', ['events:*'], [unbound], 'agent:c1-missing');
    await key('mixed', ['events:*'], [IA, IB], 'agent:c1-mixed');
    // Persist widened shapes to prove the real auth edge refuses them, without using the key-management API.
    await key('widened-null', ['*'], undefined, 'agent:c1-widened-null');
    await key('widened-empty', ['*'], [], 'agent:c1-widened-empty');
    await key('handmade', ['events:*']);
    await owner
      .update(apiKeys)
      .set({ name: 'agent:handmade' })
      .where(eq(apiKeys.id, credential('handmade').key.id));
    await owner.insert(omniEvents).values([
      {
        id: eventId,
        eventType: 'custom.c1.instance',
        channel: 'internal',
        direction: 'internal',
        instanceId: IA,
        tenantId: T,
        status: 'completed',
        journalReady: true,
      },
      {
        id: sourcelessId,
        // This instance-less row derives tenant ownership from a persisted agent.
        agentId: B,
        eventType: 'custom.c1.sourceless',
        channel: 'internal',
        direction: 'internal',
        tenantId: T,
        status: 'completed',
        journalReady: true,
      },
    ]);
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
    const seededRows = await db.select({ tenantId: omniEvents.tenantId }).from(omniEvents);
    expect(seededRows).toHaveLength(2);
    expect(seededRows.every((row) => row.tenantId === T)).toBe(true);
    const application = createApp(db, null, null, null);
    app = application.app;
    // As in the pre-existing C15 route harness: the edge supplies a trusted tenant, never a caller hint.
    // Authentication is still the real legacy key middleware before this trusted projection.
    function forTenant(tenantId: string) {
      const scopedApp = new Hono<{ Variables: AppVariables }>();
      scopedApp.onError(errorHandler);
      scopedApp.use('*', async (c, next) => {
        c.set('services', application.services);
        await next();
      });
      scopedApp.use('*', authMiddleware);
      scopedApp.use('*', async (c, next) => {
        c.set('authContext', {
          credentialClass: 'tenant',
          requestId: randomUUID(),
          principalId: randomUUID(),
          credentialId: randomUUID(),
          tenantId,
          actorRole: 'tenant-owner',
          scopes: ['*'],
          membershipId: randomUUID(),
          resourceConstraints: {},
          expiresAt: null,
          rateLimit: null,
          budget: null,
          delegationDepth: 0,
          rootKeyId: randomUUID(),
          policyVersion: 1,
          revocationEpoch: 0,
          tenantKeyLineageId: randomUUID(),
        });
        await next();
      });
      scopedApp.route('/api/v2', eventConsumersRoutes);
      return scopedApp;
    }
    tenantApp = forTenant(otherT);
    ownerApp = forTenant(T);
  }, 180_000);
  beforeEach(() => {
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    process.env.EVENT_STREAM_MAX_LIFETIME_MS = '60';
  });
  afterEach(() => {
    for (const name of ['OMNI_PAIRED_AGENT_CONSUMERS', 'OMNI_MULTITENANCY_ENABLED', 'EVENT_STREAM_MAX_LIFETIME_MS']) {
      if (originalEnv[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = originalEnv[name];
    }
  });
  afterAll(async () => {
    for (const close of closers.reverse()) await close();
    const result = Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '--dbname',
        superUrl,
        '--set',
        'ON_ERROR_STOP=1',
        '-c',
        `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  });
  function name() {
    return `c1-${randomUUID()}`;
  }
  async function seed(agentId: string | null = A, scoped = true, owner = 'a') {
    const consumerName = name();
    await db.insert(durableConsumers).values({
      name: consumerName,
      eventType: 'custom.c1.*',
      agentId,
      tenantId: T,
      scoped,
      instanceIds: scoped ? [IA] : null,
      ownerKeyId: scoped ? credential(owner).key.id : null,
      cursor: 0,
    });
    return consumerName;
  }
  function request(
    label: string,
    path: string,
    method = 'GET',
    body?: unknown,
    otherTenant: boolean | 'owner' = false,
  ) {
    return (otherTenant === 'owner' ? ownerApp : otherTenant ? tenantApp : app).request(
      `/api/v2/events/consumers${path}`,
      {
        method,
        headers: { 'x-api-key': credential(label).plainTextKey, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
  }
  async function hit(label: string, consumer: string, verb: Verb, otherTenant = false) {
    const path = `/${consumer}`;
    if (verb === 'pull') return request(label, `${path}/pull`, 'POST', undefined, otherTenant);
    if (verb === 'ack') return request(label, `${path}/ack`, 'POST', { cursor: 0 }, otherTenant);
    if (verb === 'delete') return request(label, path, 'DELETE', undefined, otherTenant);
    return request(label, verb === 'stream' ? `${path}/stream` : path, 'GET', undefined, otherTenant);
  }
  async function streamText(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing SSE body');
    let result = '';
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return result;
        result += decoder.decode(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
  }
  const matrix = [
    { key: 'admin', status: 200 },
    { key: 'device', status: 404 },
    { key: 'restricted-wildcard', status: 404 },
    { key: 'plain', status: 404 },
    { key: 'a', status: 200 },
    { key: 'a-second', status: 200 },
    { key: 'b', status: 404 },
    { key: 'inactive', status: 404 },
    { key: 'no-binding', status: 404 },
    { key: 'mixed', status: 404 },
    { key: 'widened-null', status: 401 },
    { key: 'widened-empty', status: 401 },
    { key: 'admin', status: 404, otherTenant: true },
    { key: 'a', status: 404, otherTenant: true },
  ];
  async function assertOwnedVerb(entry: (typeof matrix)[number], consumer: string, verb: Verb) {
    const response = await hit(entry.key, consumer, verb, entry.otherTenant);
    expect(response.status).toBe(entry.status);
    if (response.status !== 200) return;
    if (verb === 'stream') {
      const text = await streamText(response);
      expect(text).toContain(eventId);
      expect(text).not.toContain(sourcelessId);
    }
    if (verb === 'pull') expect(page.parse(await response.json()).items.map((item) => item.id)).toEqual([eventId]);
  }
  for (const enabled of [true, false])
    for (const entry of matrix) {
      test(`${entry.key}${entry.otherTenant ? ' from another tenant' : ''}, flag ${enabled}: list and all five verbs enforce stored agent ownership`, async () => {
        if (!enabled) Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
        const consumer = await seed();
        const listResponse = await request(entry.key, '', 'GET', undefined, entry.otherTenant);
        expect(listResponse.status).toBe(entry.status === 401 ? 401 : 200);
        if (entry.status !== 401) {
          const names = listing.parse(await listResponse.json()).items.map((item) => item.name);
          expect(names.includes(consumer)).toBe(entry.status === 200);
        }
        for (const verb of verbs) await assertOwnedVerb(entry, consumer, verb);
      });
    }
  test('proven agent defaults ownership, explicit self works, other agent is 403, missing explicit agent is 400', async () => {
    for (const explicit of [false, true]) {
      const response = await request(
        'a',
        '',
        'POST',
        {
          name: name(),
          eventType: 'custom.*',
          ...(explicit ? { agentId: A } : {}),
        },
        'owner',
      );
      expect(response.status).toBe(201);
      expect(view.parse(await response.json()).data).toMatchObject({ agentId: A, scoped: true });
    }
    expect((await request('a', '', 'POST', { name: name(), eventType: 'custom.*', agentId: B })).status).toBe(403);
    expect((await request('plain', '', 'POST', { name: name(), eventType: 'custom.*', agentId: A })).status).toBe(403);
    expect(
      (await request('admin', '', 'POST', { name: name(), eventType: 'custom.*', agentId: randomUUID() })).status,
    ).toBe(400);
    const response = await request('admin', '', 'POST', { name: name(), eventType: 'custom.*', agentId: A }, 'owner');
    expect(response.status).toBe(201);
    expect(view.parse(await response.json()).data.agentId).toBe(A);
  });
  test('cross-tenant explicit and default ownership are indistinguishable from missing agents and write no row', async () => {
    const existing = await seed();
    const before = await db.select().from(durableConsumers).where(eq(durableConsumers.name, existing));
    const missing = await request(
      'admin',
      '',
      'POST',
      { name: name(), eventType: 'custom.*', agentId: randomUUID() },
      true,
    );
    expect(missing.status).toBe(400);
    const missingBody: unknown = await missing.json();
    for (const key of ['admin', 'a'])
      for (const explicit of [false, true]) {
        if (key === 'admin' && !explicit) continue;
        const consumerName = name();
        const response = await request(
          key,
          '',
          'POST',
          { name: consumerName, eventType: 'custom.*', ...(explicit ? { agentId: A } : {}) },
          true,
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(missingBody);
        expect(await db.select().from(durableConsumers).where(eq(durableConsumers.name, consumerName))).toHaveLength(0);
      }
    expect(await db.select().from(durableConsumers).where(eq(durableConsumers.name, existing))).toEqual(before);
  });
  test('NULL ownership scope matches only a NULL-tenant agent, for explicit and default owners', async () => {
    for (const agentId of [undefined, A]) {
      const consumerName = name();
      const response = await request('a', '', 'POST', { name: consumerName, eventType: 'custom.*', agentId });
      expect(response.status).toBe(400);
      expect(await db.select().from(durableConsumers).where(eq(durableConsumers.name, consumerName))).toHaveLength(0);
    }
    for (const agentId of [undefined, legacyAgent]) {
      const response = await request('null-agent', '', 'POST', { name: name(), eventType: 'custom.*', agentId });
      expect(response.status).toBe(201);
      expect(view.parse(await response.json()).data.agentId).toBe(legacyAgent);
    }
    const response = await request(
      'admin',
      '',
      'POST',
      { name: name(), eventType: 'custom.*', agentId: legacyAgent },
      'owner',
    );
    expect(response.status).toBe(400);
  });
  test('an agent naming its own UUID in uppercase creates with canonical ownership', async () => {
    const response = await request(
      'a',
      '',
      'POST',
      { name: name(), eventType: 'custom.*', agentId: A.toUpperCase() },
      'owner',
    );
    expect(response.status).toBe(201);
    expect(view.parse(await response.json()).data.agentId).toBe(A);
  });
  for (const key of ['inactive', 'no-binding', 'mixed', 'widened-null', 'widened-empty'])
    test(`${key}: create fails before any row is written, regardless of requested owner`, async () => {
      for (const agentId of [undefined, A, B]) {
        const consumerName = name();
        const response = await request(key, '', 'POST', { name: consumerName, eventType: 'custom.*', agentId });
        expect(response.status).toBe(key.startsWith('widened') ? 401 : 403);
        if (!key.startsWith('widened'))
          expect(errorBody.parse(await response.json()).error.message).toMatch(
            /unresolved agent key cannot create consumers/i,
          );
        expect(await db.select().from(durableConsumers).where(eq(durableConsumers.name, consumerName))).toHaveLength(0);
      }
    });
  test('a restricted proven agent cannot mutate an unscoped agent-owned consumer (fix 1 remains 403)', async () => {
    const consumer = await seed(A, false);
    expect((await hit('a', consumer, 'inspect')).status).toBe(200);
    for (const verb of ['pull', 'ack', 'stream', 'delete'] as const)
      expect((await hit('a', consumer, verb)).status).toBe(403);
  });
  test('admin unscoped agent-owned pull and stream exclude instance-less rows; legacy consumers retain them', async () => {
    const owned = await seed(A, false);
    const legacy = await seed(null, false);
    for (const consumer of [owned, legacy]) {
      const result = page.parse(await (await hit('admin', consumer, 'pull')).json());
      expect(result.items.map((item) => item.id)).toEqual(consumer === owned ? [eventId] : [eventId, sourcelessId]);
      const text = await streamText(await hit('admin', consumer, 'stream'));
      expect(text).toContain(eventId);
      expect(text.includes(sourcelessId)).toBe(consumer === legacy);
    }
  });
  for (const key of [
    'admin',
    'device',
    'restricted-wildcard',
    'plain',
    'a',
    'b',
    'inactive',
    'no-binding',
    'mixed',
    'handmade',
  ])
    test(`${key}: flag-off legacy create/list/inspect/pull/ack/stream/delete preserve instance scoping`, async () => {
      Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
      const response = await request(key, '', 'POST', {
        name: name(),
        eventType: 'custom.c1.*',
        startFrom: 'beginning',
      });
      expect(response.status).toBe(201);
      const consumer = view.parse(await response.json()).data;
      expect(consumer.agentId).toBeNull();
      expect(listing.parse(await (await request(key, '')).json()).items.map((item) => item.name)).toContain(
        consumer.name,
      );
      for (const verb of verbs) {
        const result = await hit(key, consumer.name, verb);
        expect(result.status).toBe(200);
        if (verb === 'stream') await streamText(result);
      }
    });
  test('a handmade agent name remains ordinary and creates an unowned consumer with the flag on', async () => {
    const response = await request('handmade', '', 'POST', { name: name(), eventType: 'custom.*' });
    expect(response.status).toBe(201);
    expect(view.parse(await response.json()).data.agentId).toBeNull();
  });
  test('flag-off explicit agentId is 400 naming the flag', async () => {
    Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    const response = await request('admin', '', 'POST', { name: name(), eventType: 'custom.*', agentId: A });
    expect(response.status).toBe(400);
    expect(errorBody.parse(await response.json()).error.message).toContain('OMNI_PAIRED_AGENT_CONSUMERS');
  });
  test('deleting an agent retains consumer ownership; every former agent verb is 404 and admin can drain it', async () => {
    const consumer = await seed();
    await db.delete(agents).where(eq(agents.id, A));
    for (const key of ['a', 'b', 'plain', 'inactive']) {
      expect(listing.parse(await (await request(key, '')).json()).items.map((item) => item.name)).not.toContain(
        consumer,
      );
      for (const verb of verbs) expect((await hit(key, consumer, verb)).status).toBe(404);
    }
    const inspected = await hit('admin', consumer, 'inspect');
    expect(view.parse(await inspected.json()).data.agentId).toBe(A);
    expect(listing.parse(await (await request('admin', '')).json()).items.map((item) => item.name)).toContain(consumer);
    expect((await hit('admin', consumer, 'pull')).status).toBe(200);
    expect((await hit('admin', consumer, 'ack')).status).toBe(200);
    await streamText(await hit('admin', consumer, 'stream'));
    expect((await hit('admin', consumer, 'delete')).status).toBe(200);
  });
});
