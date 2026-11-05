/**
 * Tenancy for the agent-host scope set (#1461): under FORCE RLS and a tenant context, a
 * credential holding exactly the agent host's scopes sees only its own tenant's events, and of
 * the consumers only those it created in its own tenant: another tenant's consumer is a 404
 * even when it carries the same owner key id.
 *
 * Why not a key from the device flow or ApiKeyService: login is off under multitenancy
 * (login/config.ts loginWanted), so no device key can exist there today; and an api_keys
 * key is not tenant-bound (middleware/tenancy.ts: the tenancy edge does not recognise it, it
 * stays in the legacy world). Tenant credentials carry the tenant role vocabulary, never the
 * literal `events:read`. So this is the C15 harness (event-consumers-tenant-enforced-postgres):
 * the runtime role under FORCE RLS, a tenant context for tenant A, and the agent host's scopes
 * from deviceKeysFor, through the real scope enforcer and the real events and consumer routes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { DEFAULT_DEVICE_KEY_SCOPES, deviceKeysFor, readLoginConfig } from '../login/config';
import { errorHandler } from '../middleware/error';
import { scopeEnforcerMiddleware } from '../middleware/scope-enforcer';
import { eventConsumersRoutes } from '../routes/v2/event-consumers';
import { eventsRoutes } from '../routes/v2/events';
import { EventConsumerService } from '../services/event-consumers';
import { EventService } from '../services/events';
import { buildWorkerTenantContext, runInWorkerTenantScope } from '../tenancy/worker-tenant-context';
import type { AppVariables } from '../types';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';
const pgDescribe = superUrl ? describe : describe.skip;
const AGENT_HOST_SCOPES = deviceKeysFor('omni-agent-host', DEFAULT_DEVICE_KEY_SCOPES).scopes;

pgDescribe('the agent-host scope set under FORCE RLS and a tenant context', () => {
  const database = `agent_host_tenancy_${randomUUID().replaceAll('-', '')}`;
  const [mine, theirs] = [0, 1].map(() => ({
    tenantId: randomUUID(),
    instanceId: randomUUID(),
    consumer: `agent-host-${randomUUID().slice(0, 8)}`,
    eventId: randomUUID(),
  })) as [Fixture, Fixture];
  type Fixture = { tenantId: string; instanceId: string; consumer: string; eventId: string };
  /** One key id for every request: the owner the consumer rules compare against. */
  const hostKeyId = randomUUID();
  /** In the other tenant, owned by the same key id: tenancy alone must hide it. */
  const theirsOwned = `agent-host-owned-${randomUUID().slice(0, 8)}`;
  const closers: (() => Promise<void>)[] = [];
  const previous = process.env.OMNI_MULTITENANCY_ENABLED;
  let runtime: Database;
  let owner: Database;
  let app: Hono<{ Variables: AppVariables }>;

  function open(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, database, role), maxConnections: 4 });
    closers.push(handle.close);
    return handle.db;
  }

  beforeAll(async () => {
    process.env.OMNI_MULTITENANCY_ENABLED = 'true';
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    owner = open();
    for (const f of [mine, theirs]) {
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
        .values({ id: f.instanceId, tenantId: f.tenantId, name: f.consumer, channel: 'whatsapp-baileys' });
      // Unscoped: what an instance-unrestricted key like the agent host's can see in its tenant.
      await owner.insert(durableConsumers).values({
        name: f.consumer,
        tenantId: f.tenantId,
        eventType: 'custom.agent-host.*',
        scoped: false,
        cursor: 0,
      });
      if (f === theirs) {
        await owner.insert(durableConsumers).values({
          name: theirsOwned,
          tenantId: f.tenantId,
          eventType: 'custom.agent-host.*',
          ownerKeyId: hostKeyId,
          cursor: 0,
        });
      }
      // The event's tenant is derived from its instance by the ownership trigger.
      await owner.insert(omniEvents).values({
        id: f.eventId,
        channel: 'internal',
        eventType: 'custom.agent-host.proof',
        instanceId: f.instanceId,
        journalReady: true,
      });
    }
    await applyTenantRlsEnforcement(owner);
    const passwords = { ddl: randomUUID(), runtime: randomUUID(), authPlane: randomUUID() };
    await applyTenancyRoles(owner, passwords, DEFAULT_ROLE_NAMES, database);
    runtime = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
    await assertPgTestRole(runtime, DEFAULT_ROLE_NAMES.runtime);

    app = new Hono<{ Variables: AppVariables }>();
    app.onError(errorHandler);
    app.use('*', async (c, next) => {
      c.set('authContext', buildWorkerTenantContext(mine.tenantId));
      c.set('apiKey', {
        id: hostKeyId,
        name: 'device: agent host',
        scopes: AGENT_HOST_SCOPES,
        instanceIds: null,
        expiresAt: null,
        profile: null,
        chatAllowlist: [],
        instanceAllowlist: [],
        outboundRecipientAllowlist: [],
      });
      c.set('services', {
        db: runtime,
        events: new EventService(runtime),
        eventConsumers: new EventConsumerService(runtime),
      } as unknown as AppVariables['services']);
      await runInWorkerTenantScope(runtime, mine.tenantId, next);
    });
    app.use('*', scopeEnforcerMiddleware);
    // The production order (routes/v2/index.ts): consumers before the /events/:id catch.
    app.route('/api/v2', eventConsumersRoutes);
    app.route('/api/v2/events', eventsRoutes);
  }, 180_000);

  afterAll(async () => {
    try {
      for (const close of closers.reverse()) await close();
      dropDatabaseOrThrow({ superUrl, psqlBin }, database);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
      else process.env.OMNI_MULTITENANCY_ENABLED = previous;
    }
  });

  const get = (path: string) => app.request(`/api/v2${path}`);

  test('the credential holds exactly the agent-host set, and no device key can be minted here', () => {
    expect(AGENT_HOST_SCOPES).toEqual(['events:read', 'events:consume']);
    expect(readLoginConfig({ ...process.env, OMNI_AUTH_SECRET: 'x'.repeat(40) })).toBeNull();
  });

  test('enforcement is on, and the other tenant rows exist (the probes are not vacuous)', async () => {
    const states = await runtime.execute(
      sql`select relname, relforcerowsecurity from pg_class where relname = 'omni_events'`,
    );
    expect(states.map((row) => row.relforcerowsecurity)).toEqual([true]);
    const events = await owner.select().from(omniEvents).where(eq(omniEvents.id, theirs.eventId));
    expect(events.map((row) => row.tenantId)).toEqual([theirs.tenantId]);
    const consumers = await owner.select().from(durableConsumers).where(eq(durableConsumers.name, theirs.consumer));
    expect(consumers).toHaveLength(1);
  });

  test("lists and reads its own tenant's events, never the other tenant's", async () => {
    const list = await get('/events');
    expect(list.status).toBe(200);
    const listed = await list.text();
    expect(listed).toContain(mine.eventId);
    expect(listed).not.toContain(theirs.eventId);

    const search = await app.request('/api/v2/events/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'summary' }),
    });
    expect(search.status).toBe(200);
    const found = await search.text();
    expect(found).toContain(mine.eventId);
    expect(found).not.toContain(theirs.eventId);

    expect((await get(`/events/${mine.eventId}`)).status).toBe(200);
    expect((await get(`/events/${mine.eventId}/trace`)).status).toBe(200);
    expect((await get(`/events/${theirs.eventId}`)).status).toBe(404);
    expect((await get(`/events/${theirs.eventId}/trace`)).status).toBe(404);
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/api/v2${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  const row = async (name: string) =>
    (await owner.select().from(durableConsumers).where(eq(durableConsumers.name, name)))[0];

  test("sees no consumer it did not create: its own tenant's unowned one, and the other tenant's", async () => {
    const list = await get('/events/consumers');
    expect(list.status).toBe(200);
    const listed = await list.text();
    for (const name of [mine.consumer, theirs.consumer, theirsOwned]) expect(listed).not.toContain(name);
    const before = await Promise.all([mine.consumer, theirs.consumer, theirsOwned].map(row));
    for (const name of [mine.consumer, theirs.consumer, theirsOwned]) {
      for (const [method, suffix, body] of [
        ['GET', '', undefined],
        ['POST', '/pull', undefined],
        ['POST', '/ack', { cursor: 0 }],
        ['GET', '/stream', undefined],
        ['DELETE', '', undefined],
      ] as const) {
        const status = (await send(method, `/events/consumers/${name}${suffix}`, body)).status;
        expect({ name, method, suffix, status }).toEqual({ name, method, suffix, status: 404 });
      }
    }
    expect(await Promise.all([mine.consumer, theirs.consumer, theirsOwned].map(row))).toEqual(before);
  });

  test("runs its own consumer in its own tenant, paging only its tenant's events", async () => {
    const own = `agent-host-tenant-own-${randomUUID().slice(0, 8)}`;
    const created = await send('POST', '/events/consumers', {
      name: own,
      eventType: 'custom.agent-host.*',
      startFrom: 'beginning',
    });
    expect(created.status).toBe(201);
    expect(await row(own)).toMatchObject({ tenantId: mine.tenantId, ownerKeyId: hostKeyId, scoped: false });
    expect(await (await get('/events/consumers')).text()).toContain(own);
    expect((await get(`/events/consumers/${own}`)).status).toBe(200);

    const pulled = await send('POST', `/events/consumers/${own}/pull`);
    expect(pulled.status).toBe(200);
    const page = (await pulled.json()) as { items: { id: string }[]; cursor: number };
    expect(page.items.map((item) => item.id)).toEqual([mine.eventId]);
    expect((await send('POST', `/events/consumers/${own}/ack`, { cursor: page.cursor })).status).toBe(200);

    const stream = await get(`/events/consumers/${own}/stream?after=0`);
    expect(stream.status).toBe(200);
    const reader = stream.body?.getReader();
    if (!reader) throw new Error('no body');
    let text = '';
    while (!text.includes(mine.eventId)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(text).toContain(mine.eventId);
    expect(text).not.toContain(theirs.eventId);

    expect((await send('DELETE', `/events/consumers/${own}`)).status).toBe(200);
    expect(await row(own)).toBeUndefined();
  });
});
