/** C15: application ownership remains mandatory where FORCE RLS deliberately does not apply. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
  durableConsumers,
  instances,
  omniEvents,
  tenants,
} from '@omni/db';
import { assertPgTestRole, pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { errorHandler } from '../middleware/error';
import { eventConsumersRoutes } from '../routes/v2/event-consumers';
import { EventConsumerService } from '../services/event-consumers';
import { buildWorkerTenantContext, runInWorkerTenantScope } from '../tenancy/worker-tenant-context';
import type { AppVariables } from '../types';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';
const pgDescribe = superUrl ? describe : describe.skip;
const listed = z.object({ items: z.array(z.object({ name: z.string() })) });
const pulled = z.object({ items: z.array(z.object({ id: z.string() })), cursor: z.number() });

pgDescribe('consumer C15 six-verb isolation under FORCE RLS and tenant credentials', () => {
  const database = `consumer_c15_${randomUUID().replaceAll('-', '')}`;
  const fixture = [0, 1].map(() => ({
    tenantId: randomUUID(),
    instanceId: randomUUID(),
    keyId: randomUUID(),
    name: `c15-${randomUUID()}`,
    eventId: randomUUID(),
  }));
  const closers: (() => Promise<void>)[] = [];
  const previous = { ...process.env };
  let runtime: Database;
  let owner: Database;
  function open(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, database, role), maxConnections: 4 });
    closers.push(handle.close);
    return handle.db;
  }
  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    owner = open();
    for (const f of fixture) {
      await owner.insert(tenants).values({
        id: f.tenantId,
        slug: f.tenantId,
        displayName: f.tenantId,
        maxKeyTtlSeconds: 86400,
        maxKeyRateLimit: 1000,
        maxKeyBudget: 1000,
      });
      await owner
        .insert(instances)
        .values({ id: f.instanceId, tenantId: f.tenantId, name: f.name, channel: 'whatsapp-baileys' });
      await owner.insert(durableConsumers).values({
        name: f.name,
        tenantId: f.tenantId,
        eventType: 'custom.c15.*',
        scoped: true,
        ownerKeyId: f.keyId,
        instanceIds: [f.instanceId],
        cursor: 0,
      });
      await owner.insert(omniEvents).values({
        id: f.eventId,
        channel: 'internal',
        eventType: 'custom.c15.proof',
        instanceId: f.instanceId,
        journalReady: true,
      });
    }
    await applyTenantRlsEnforcement(owner);
    const passwords = { ddl: randomUUID(), runtime: randomUUID(), authPlane: randomUUID() };
    await applyTenancyRoles(owner, passwords, DEFAULT_ROLE_NAMES, database);
    runtime = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
    // Before ANY runtime reads, including the enforcement-state assertion.
    await assertPgTestRole(runtime, DEFAULT_ROLE_NAMES.runtime);
  }, 180_000);
  beforeEach(async () => {
    process.env.OMNI_MULTITENANCY_ENABLED = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    process.env.EVENT_STREAM_MAX_LIFETIME_MS = '40';
    await owner.delete(durableConsumers);
    for (const f of fixture)
      await owner.insert(durableConsumers).values({
        name: f.name,
        tenantId: f.tenantId,
        eventType: 'custom.c15.*',
        scoped: true,
        ownerKeyId: f.keyId,
        instanceIds: [f.instanceId],
        cursor: 0,
      });
  });
  afterEach(() => {
    for (const name of ['OMNI_MULTITENANCY_ENABLED', 'OMNI_PAIRED_AGENT_CONSUMERS', 'EVENT_STREAM_MAX_LIFETIME_MS']) {
      if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = previous[name];
    }
  });
  afterAll(async () => {
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
  function tenantApp(f: (typeof fixture)[number], credential?: { scopes: string[]; instanceIds: string[] | null }) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.onError(errorHandler);
    app.use('*', async (c, next) => {
      // Trusted tenant-credential projection, like the existing C15 harness: no legacy auth/401 shortcut.
      c.set('authContext', buildWorkerTenantContext(f.tenantId));
      c.set('apiKey', {
        id: f.keyId,
        name: f.name,
        scopes: credential?.scopes ?? ['events:*'],
        instanceIds: credential ? credential.instanceIds : [f.instanceId],
        expiresAt: null,
      });
      c.set('services', { db: runtime, eventConsumers: new EventConsumerService(runtime) } as AppVariables['services']);
      await runInWorkerTenantScope(runtime, f.tenantId, next);
    });
    app.route('/', eventConsumersRoutes);
    return app;
  }
  test('enforcement state is explicit; a superuser is rejected by the runtime-role guard', async () => {
    const states = await runtime.execute(
      sql`select relname, relforcerowsecurity from pg_class where relname in ('omni_events', 'instances', 'durable_consumers', 'agent_source_grants')`,
    );
    expect(Object.fromEntries(states.map((row) => [row.relname, row.relforcerowsecurity]))).toEqual({
      omni_events: true,
      instances: true,
      durable_consumers: false,
      agent_source_grants: false,
    });
    await expect(assertPgTestRole(owner, DEFAULT_ROLE_NAMES.runtime)).rejects.toThrow();
  });
  for (const scopes of [['events:*'], ['*']]) {
    for (const [verb, suffix, method, body] of [
      ['list', '', 'GET', undefined],
      ['inspect', '', 'GET', undefined],
      ['pull', '/pull', 'POST', undefined],
      ['ack', '/ack', 'POST', { cursor: 999999 }],
      ['stream', '/stream', 'GET', undefined],
      ['delete', '', 'DELETE', undefined],
    ] as const) {
      test(`tenant A unrestricted ${scopes[0]} credential: foreign ${verb} is hidden without mutation`, async () => {
        const [f, other] = fixture;
        if (!f || !other) throw new Error('Missing tenants');
        const app = tenantApp(f, { scopes, instanceIds: null });
        const before = await owner.select().from(durableConsumers).where(eq(durableConsumers.name, other.name));
        const response = await app.request(`/events/consumers${verb === 'list' ? '' : `/${other.name}${suffix}`}`, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (verb === 'list')
          expect(listed.parse(await response.json()).items.map((item) => item.name)).toEqual([f.name]);
        else expect(response.status).toBe(404);
        expect(await owner.select().from(durableConsumers).where(eq(durableConsumers.name, other.name))).toEqual(
          before,
        );
      });
    }
  }
  for (const [index, f] of fixture.entries()) {
    test(`tenant ${index}: own list/inspect/pull/ack/stream/delete succeed; foreign six verbs are hidden without mutation`, async () => {
      const other = fixture[1 - index];
      if (!other) throw new Error('Missing other tenant');
      const app = tenantApp(f);
      const request = (path: string, method = 'GET', body?: unknown) =>
        app.request(`/events/consumers${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const list = listed.parse(await (await request('')).json());
      expect(list.items.map((item) => item.name)).toEqual([f.name]);
      const before = await owner.select().from(durableConsumers).where(eq(durableConsumers.name, other.name));
      for (const [suffix, method, body] of [
        ['', 'GET', undefined],
        ['/pull', 'POST', undefined],
        ['/ack', 'POST', { cursor: 999999 }],
        ['/stream', 'GET', undefined],
        ['', 'DELETE', undefined],
      ] as const) {
        const response = await request(`/${other.name}${suffix}`, method, body);
        expect(response.status).toBe(404);
      }
      expect(await owner.select().from(durableConsumers).where(eq(durableConsumers.name, other.name))).toEqual(before);
      expect((await request(`/${f.name}`)).status).toBe(200);
      const page = pulled.parse(await (await request(`/${f.name}/pull`, 'POST')).json());
      expect(page.items.map((item) => item.id)).toEqual([f.eventId]);
      const stream = await request(`/${f.name}/stream`);
      expect(stream.status).toBe(200);
      expect(await stream.text()).toContain(f.eventId);
      expect((await request(`/${f.name}/ack`, 'POST', { cursor: page.cursor })).status).toBe(200);
      expect((await request(`/${f.name}`, 'DELETE')).status).toBe(200);
    });
  }
});
