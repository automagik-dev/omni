/** C2 grant reads through real ingress claims, HTTP auth, and a migrated runtime-role database. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { ConnectorRegistry } from '@omni/connector-sdk';
import { setTenantSecretMasterKey } from '@omni/core';
import {
  type AgentGrantSourceKind,
  DEFAULT_ROLE_NAMES,
  type Database,
  agentSourceGrants,
  agents,
  applyTenancyRoles,
  automations,
  connectorEventSubscriptions,
  connectors,
  createDbHandle,
  durableConsumers,
  instances,
  omniEvents,
  tenants,
  webhookSources,
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
import { PostgresJsSession } from 'drizzle-orm/postgres-js/session';
import { z } from 'zod';
import { createApp } from '../app';
import { ApiKeyService, type CreateApiKeyResult } from '../services/api-keys';
import { ConnectorService } from '../services/connectors';
import type { ConsumerCaller, EventConsumerService } from '../services/event-consumers';
import { WebhookService } from '../services/webhooks';
import { sealCredentialField } from '../tenancy/sealed-credentials';
import {
  HOOK_SECRET,
  TYPED_EVENT,
  connectorHookBus,
  eventsOnlyConnector,
  signHook,
} from './fixtures/events-only-connector';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const pgDescribe = superUrl ? describe : describe.skip;
const pageSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), journalSeq: z.number() })),
  cursor: z.number(),
  leaseId: z.string().optional(),
});
const eventIdSchema = z.object({ eventId: z.string().uuid() });

pgDescribe('paired-agent active source grants (C2, real PostgreSQL)', () => {
  const database = `pa_grants_${randomUUID().replaceAll('-', '')}`;
  const A = randomUUID();
  const B = randomUUID();
  const IA = randomUUID();
  const IA2 = randomUUID();
  const IB = randomUUID();
  const T = randomUUID();
  const C = randomUUID();
  const otherC = randomUUID();
  const S = randomUUID();
  const typedS = randomUUID();
  const target = randomUUID();
  const closers: (() => Promise<void>)[] = [];
  const previous = { ...process.env };
  // Fixture seam: the existing events-only GitLab definition verifies a signed delivery and
  // parses merge_request.merged. The bus only acknowledges publication; the REAL ingress
  // claim writes each complete journal row, including its trusted source stamp, before publish.
  const { bus } = connectorHookBus();
  let db: Database;
  let app: ReturnType<typeof createApp>['app'];
  let consumers: EventConsumerService;
  let connectorService: ConnectorService;
  let webhooks: WebhookService;
  let a: CreateApiKeyResult;
  let wide: CreateApiKeyResult;
  let b: CreateApiKeyResult;
  let plain: CreateApiKeyResult;
  let W: string;
  let otherW: string;
  function open(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, database, role), maxConnections: 4 });
    closers.push(handle.close);
    return handle.db;
  }
  beforeAll(async () => {
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    setTenantSecretMasterKey(Buffer.alloc(32, 0x62));
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    const owner = open();
    await owner.insert(agents).values([
      { id: A, name: 'c2-a', provider: 'claude' },
      { id: B, name: 'c2-b', provider: 'claude' },
    ]);
    await owner.insert(instances).values([
      { id: IA, name: 'c2-a', channel: 'whatsapp-baileys', agentId: A },
      { id: IA2, name: 'c2-a-second', channel: 'whatsapp-baileys', agentId: A },
      { id: IB, name: 'c2-b', channel: 'whatsapp-baileys', agentId: B },
    ]);
    const keys = new ApiKeyService(owner);
    a = await keys.create({
      name: 'agent:c2-a',
      scopes: ['events:*'],
      instanceIds: [IA],
      createdBy: 'system:auto-provision',
    });
    wide = await keys.create({
      name: 'agent:c2-a',
      scopes: ['events:*'],
      instanceIds: [IA, IA2],
      createdBy: 'system:auto-provision',
    });
    b = await keys.create({
      name: 'agent:c2-b',
      scopes: ['events:*'],
      instanceIds: [IB],
      createdBy: 'system:auto-provision',
    });
    plain = await keys.create({ name: 'c2-plain', scopes: ['events:*'] });
    await owner.insert(tenants).values({
      id: T,
      slug: T,
      displayName: 'C2 ingress',
      maxKeyTtlSeconds: 86400,
      maxKeyRateLimit: 1000,
      maxKeyBudget: 1000,
    });
    await owner
      .insert(automations)
      .values({ id: target, name: 'c2-target', triggerEventType: 'connector.event', actions: [], tenantId: T });
    await owner.insert(connectors).values(
      [C, otherC].map((id) => ({
        id,
        name: id,
        provider: 'gitlab',
        status: 'connected',
        tenantId: T,
        credentials: sealCredentialField(T, '{}'),
        hookSecret: sealCredentialField(T, HOOK_SECRET),
      })),
    );
    await owner.insert(connectorEventSubscriptions).values([
      {
        id: S,
        connectorId: C,
        providerEventKey: 'merge_request.merged',
        ingress: 'subscription',
        verificationSecret: sealCredentialField(T, HOOK_SECRET),
        targetAutomationId: target,
        tenantId: T,
      },
      { id: typedS, connectorId: C, providerEventKey: TYPED_EVENT, ingress: 'connector', tenantId: T },
      { connectorId: otherC, providerEventKey: TYPED_EVENT, ingress: 'connector', tenantId: T },
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
    const application = createApp(db, bus, null, null);
    app = application.app;
    consumers = application.services.eventConsumers;
    const registry = new ConnectorRegistry();
    registry.register(eventsOnlyConnector);
    connectorService = new ConnectorService(db, bus, registry);
    webhooks = new WebhookService(db, bus);
    W = (await webhooks.create({ name: 'c2-webhook' })).id;
    otherW = (await webhooks.create({ name: 'c2-ungranted' })).id;
  }, 180_000);
  beforeEach(async () => {
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    await db.delete(durableConsumers);
    await db.delete(agentSourceGrants);
    await db.delete(omniEvents);
  });
  afterEach(() => {
    for (const name of ['OMNI_PAIRED_AGENT_CONSUMERS', 'OMNI_MULTITENANCY_ENABLED']) {
      if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = previous[name];
    }
  });
  afterAll(async () => {
    setTenantSecretMasterKey(null);
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
    return app.request(`/api/v2/events/consumers${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': key.plainTextKey },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function create(eventType = '*', shared = false, key = a) {
    const name = `c2-${randomUUID()}`;
    const response = await request(key, '', 'POST', { name, eventType, shared, startFrom: 'beginning' });
    expect(response.status).toBe(201);
    const created = z
      .object({
        data: z.object({
          agentId: z.string().nullable(),
          scoped: z.boolean(),
          instanceIds: z.array(z.string()).nullable(),
        }),
      })
      .parse(await response.json());
    if (key === a) {
      expect(created.data.agentId).toBe(A);
      expect(created.data.scoped).toBe(true);
      expect(created.data.instanceIds).toEqual([IA]);
    }
    return name;
  }
  async function pull(name: string, key = a, query = '') {
    const response = await request(key, `/${name}/pull${query}`, 'POST');
    expect(response.status).toBe(200);
    return pageSchema.parse(await response.json());
  }
  async function sourceTenant(kind: AgentGrantSourceKind, sourceId: string) {
    const read = {
      connector: () =>
        db.select({ tenantId: connectors.tenantId }).from(connectors).where(eq(connectors.id, sourceId)).limit(1),
      connector_subscription: () =>
        db
          .select({ tenantId: connectorEventSubscriptions.tenantId })
          .from(connectorEventSubscriptions)
          .where(eq(connectorEventSubscriptions.id, sourceId))
          .limit(1),
      webhook_source: () =>
        db
          .select({ tenantId: webhookSources.tenantId })
          .from(webhookSources)
          .where(eq(webhookSources.id, sourceId))
          .limit(1),
      agent: () =>
        db.select({ tenantId: omniEvents.tenantId }).from(omniEvents).where(eq(omniEvents.agentId, sourceId)).limit(1),
    };
    return (await read[kind]())[0]?.tenantId ?? null;
  }
  // The future writer stamps the SOURCE tenant, never the consuming agent's.
  async function grant(kind: AgentGrantSourceKind, sourceId: string, agentId = A, tenantId?: string | null) {
    const sourceTenantId = tenantId === undefined ? await sourceTenant(kind, sourceId) : tenantId;
    const [row] = await db
      .insert(agentSourceGrants)
      .values({ agentId, sourceKind: kind, sourceId, approvedByKeyId: plain.key.id, tenantId: sourceTenantId })
      .returning();
    if (!row) throw new Error('Grant fixture insert failed');
    return row.id;
  }
  async function revoke(id: string) {
    await db.update(agentSourceGrants).set({ revokedAt: new Date() }).where(eq(agentSourceGrants.id, id));
  }
  async function row(id: string) {
    const [event] = await db.select().from(omniEvents).where(eq(omniEvents.id, id));
    if (!event) throw new Error(`Missing claimed event ${id}`);
    return event;
  }
  async function typed(connectorId = C) {
    const raw = JSON.stringify({ id: randomUUID() });
    const outcome = await connectorService.receiveForConnector(connectorId, raw, signHook(raw));
    expect(outcome.status).toBe(202);
    const event = await row(eventIdSchema.parse(outcome.body).eventId);
    expect(event.eventType).toBe(TYPED_EVENT);
    expect([event.sourceKind, event.sourceId, event.tenantId, event.instanceId]).toEqual([
      'connector',
      connectorId,
      T,
      null,
    ]);
    return event;
  }
  async function legacy() {
    const raw = JSON.stringify({ id: randomUUID() });
    const outcome = await connectorService.receive(S, raw, signHook(raw));
    expect(outcome.status).toBe(202);
    const event = await row(eventIdSchema.parse(outcome.body).eventId);
    expect([event.sourceKind, event.sourceId]).toEqual(['connector_subscription', S]);
    return event;
  }
  async function webhook(source = 'c2-webhook') {
    const outcome = await webhooks.receive(source, { id: randomUUID() }, {});
    const event = await row(outcome.eventId);
    expect([event.sourceKind, event.sourceId]).toEqual(['webhook_source', source === 'c2-webhook' ? W : otherW]);
    return event;
  }
  function caller(key = a, agentId = A): ConsumerCaller {
    return { keyId: key.key.id, instanceIds: key.key.instanceIds, principal: { kind: 'agent', agentId } };
  }

  test('real restricted system key drains a typed GitLab claim as runtime; B and plain get 404; ungranted sources and revoked subsequent claims are excluded', async () => {
    await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
    const name = await create('connector.gitlab.*');
    const granted = await typed();
    await typed(otherC);
    await webhook('c2-ungranted');
    expect((await pull(name)).items).toEqual([]);
    const approval = await grant('connector', C);
    expect((await pull(name)).items.map((item) => item.id)).toEqual([granted.id]);
    for (const key of [b, plain]) {
      expect((await request(key, `/${name}`)).status).toBe(404);
      expect((await request(key, `/${name}/pull`, 'POST')).status).toBe(404);
    }
    await revoke(approval);
    await typed();
    expect((await pull(name)).items).toEqual([]);
    // A wildcard owned consumer proves webhook exclusion independently of the type predicate.
    expect((await pull(await create())).items).toEqual([]);
  });

  test('positive legacy subscription and webhook grants authorize only their exact kind and id', async () => {
    const old = await legacy();
    const hook = await webhook();
    const name = await create();
    expect((await pull(name)).items).toEqual([]);
    await grant('connector_subscription', S);
    await grant('webhook_source', W);
    expect((await pull(name)).items.map((item) => item.id)).toEqual([old.id, hook.id]);
    // A different consumer agent has no grants even when its key is a real system agent key.
    expect((await pull(await create('*', false, b), b)).items).toEqual([]);
  });

  test('typed C never matches subscription-kind grants naming C or either subscription', async () => {
    await typed();
    const name = await create('connector.gitlab.*');
    for (const id of [C, S, typedS]) {
      await grant('connector_subscription', id);
      expect((await pull(name)).items).toEqual([]);
    }
  });

  test('legacy S never matches a connector grant naming its parent; same-id wrong-kind grants deliver nothing', async () => {
    await legacy();
    await webhook();
    const name = await create();
    await grant('connector', C);
    await grant('connector', S);
    await grant('connector', W);
    await grant('webhook_source', S);
    await grant('connector_subscription', W);
    expect((await pull(name)).items).toEqual([]);
  });

  test('a real authenticated trigger stamps A and requires an agent grant naming A, never B', async () => {
    const response = await app.request('/api/v2/events/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': a.plainTextKey },
      body: JSON.stringify({ eventType: 'custom.c2.trigger', payload: { agentId: B }, idempotencyKey: randomUUID() }),
    });
    expect(response.status).toBe(201);
    const event = await row(eventIdSchema.parse(await response.json()).eventId);
    expect([event.agentId, event.producingKeyId, event.instanceId]).toEqual([A, a.key.id, null]);
    const name = await create('custom.c2.*');
    await grant('agent', B);
    expect((await pull(name)).items).toEqual([]);
    await grant('agent', A);
    expect((await pull(name)).items.map((item) => item.id)).toEqual([event.id]);
  });

  test('pull, shared lease/ack, and stream agree; an active expired lease redelivers, then revocation stops reclaim', async () => {
    const approval = await grant('connector', C);
    const events = [await typed(), await typed()];
    const normal = await create('connector.gitlab.*');
    const shared = await create('connector.gitlab.*', true);
    const expected = events.map((event) => event.id);
    expect((await pull(normal)).items.map((item) => item.id)).toEqual(expected);
    const streamed = await consumers.scanForStream(normal, 0, { tenantId: null, caller: caller() });
    expect(streamed.items.map((item) => item.id)).toEqual(expected);
    const leased = await pull(shared);
    expect(leased.items.map((item) => item.id)).toEqual(expected);
    expect(leased.leaseId).toBeDefined();
    expect((await request(a, `/${shared}/ack`, 'POST', { leaseId: leased.leaseId })).status).toBe(200);
    expect((await pull(shared)).items).toEqual([]);
    async function expire(name: string) {
      const persisted = await consumers.getByName(name);
      const state = persisted.leaseState;
      if (!state) throw new Error('Expected shared lease state');
      // Expire the actual persisted lease without wall-clock sleeps or a forged cursor.
      await db
        .update(durableConsumers)
        .set({ leaseState: { ...state, leases: state.leases.map((lease) => ({ ...lease, expiresAt: 0 })) } })
        .where(eq(durableConsumers.id, persisted.id));
    }
    const outstanding = await create('connector.gitlab.*', true);
    const old = await pull(outstanding);
    expect(old.items.map((item) => item.id)).toEqual(expected);
    expect(old.leaseId).toBeDefined();
    await expire(outstanding);
    const redelivered = await pull(outstanding);
    expect(redelivered.items.map((item) => item.id)).toEqual(expected);
    expect(redelivered.leaseId).toBeDefined();
    expect(redelivered.leaseId).not.toBe(old.leaseId);
    await revoke(approval);
    await expire(outstanding);
    expect((await pull(outstanding)).items).toEqual([]);
    expect((await consumers.scanForStream(normal, 0, { tenantId: null, caller: caller() })).items).toEqual([]);
  });

  test('instance branch intersects consumer and caller restrictions without constraining granted S/A rows', async () => {
    const ids: string[] = [];
    for (const instanceId of [IA, IA2, IB]) {
      const [event] = await db
        .insert(omniEvents)
        .values({ channel: 'internal', eventType: 'custom.c2.instance', instanceId, direction: 'internal' })
        .returning();
      if (!event) throw new Error('Missing instance event');
      ids.push(event.id);
    }
    const [first, second] = ids;
    if (!first || !second) throw new Error('Missing instance fixture ids');
    const hook = await webhook();
    await grant('webhook_source', W);
    const name = await create();
    // Consumer [IA] is narrower than the valid wide key [IA, IA2].
    expect((await pull(name, wide)).items.map((item) => item.id)).toEqual([first, hook.id]);
    await db
      .update(durableConsumers)
      .set({ instanceIds: [IA, IA2] })
      .where(eq(durableConsumers.name, name));
    // Caller [IA] is now narrower than the consumer [IA, IA2].
    expect((await pull(name)).items.map((item) => item.id)).toEqual([first, hook.id]);
    expect(
      (await consumers.scanForStream(name, 0, { tenantId: null, caller: caller() })).items.map((item) => item.id),
    ).toEqual([first, hook.id]);
    expect((await pull(name, wide)).items.map((item) => item.id)).toEqual([first, second, hook.id]);
  });

  for (const off of ['unset', 'multitenancy'] as const) {
    test(`${off}: an existing owned consumer gets I only; legacy delivery remains unchanged`, async () => {
      await grant('connector', C);
      const typedEvent = await typed();
      const [instanceEvent] = await db
        .insert(omniEvents)
        .values({ channel: 'internal', eventType: 'custom.c2.instance', instanceId: IA })
        .returning();
      if (!instanceEvent) throw new Error('Missing instance event');
      const name = await create();
      const legacyName = await create('*', false, plain);
      const all = [typedEvent.id, instanceEvent.id];
      expect((await pull(name)).items.map((item) => item.id)).toEqual(all);
      if (off === 'unset') Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
      else process.env.OMNI_MULTITENANCY_ENABLED = 'true';
      expect((await pull(name)).items.map((item) => item.id)).toEqual([instanceEvent.id]);
      expect((await pull(legacyName, plain)).items.map((item) => item.id)).toEqual(all);
      if (off === 'unset') process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
      else Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
      expect((await pull(name)).items.map((item) => item.id)).toEqual(all);
    });
  }
  for (const agentOwned of [true, false]) {
    test(`${agentOwned ? 'grant' : 'legacy'} reclaim caps a >500-match expired range, preserves its remainder before fresh rows and never skips or duplicates a page`, async () => {
      const eventType: `custom.${string}` = `custom.cap.${randomUUID()}`;
      if (agentOwned) await grant('connector', C);
      const key = agentOwned ? a : plain;
      const name = await create(eventType, true, key);
      const values = Array.from({ length: 1003 }, () => ({
        channel: 'internal' as const,
        eventType,
        journalReady: true,
        ...(agentOwned
          ? {
              sourceKind: 'connector' as const,
              sourceId: C,
              metadata: { source: 'connector', connectorId: C, subscriptionIds: [typedS] },
            }
          : { instanceId: IA }),
      }));
      const events = await db.insert(omniEvents).values(values).returning();
      events.sort((left, right) => Number(left.journalSeq) - Number(right.journalSeq));
      const end = Number(events.at(-1)?.journalSeq);
      const expiredId = randomUUID();
      await db
        .update(durableConsumers)
        .set({ leaseState: { claimed: end, leases: [{ id: expiredId, from: 0, to: end, expiresAt: 0 }] } })
        .where(eq(durableConsumers.name, name));
      const freshValue = values[0];
      if (!freshValue) throw new Error('Missing fresh fixture');
      const [fresh] = await db.insert(omniEvents).values(freshValue).returning();
      if (!fresh) throw new Error('Missing fresh row');
      const first = await pull(name, key, '?limit=500');
      expect(first.items.map((item) => item.id)).toEqual(events.slice(0, 500).map((item) => item.id));
      expect(first.cursor).toBe(Number(events[499]?.journalSeq));
      const state = (await consumers.getByName(name)).leaseState;
      const remainder = state?.leases.find((lease) => lease.from === first.cursor);
      expect(remainder).toMatchObject({ to: end, expiresAt: 0 });
      expect(remainder?.id).not.toBe(expiredId);
      expect((await request(key, `/${name}/ack`, 'POST', { leaseId: expiredId })).status).toBe(400);
      expect((await request(key, `/${name}/ack`, 'POST', { leaseId: first.leaseId })).status).toBe(200);
      const second = await pull(name, key, '?limit=500');
      expect(second.items.map((item) => item.id)).toEqual(events.slice(500, 1000).map((item) => item.id));
      // Only the delivered second page expires; the still-expired tail remains independently claimable.
      const secondState = (await consumers.getByName(name)).leaseState;
      if (!secondState) throw new Error('Missing split state');
      await db
        .update(durableConsumers)
        .set({
          leaseState: {
            ...secondState,
            leases: secondState.leases.map((lease) => ({
              ...lease,
              expiresAt: lease.id === second.leaseId ? 0 : lease.expiresAt,
            })),
          },
        })
        .where(eq(durableConsumers.name, name));
      // planSharedPull selects expired leases in stored order: the remainder precedes fresh rows.
      const third = await pull(name, key, '?limit=500');
      expect(third.items.map((item) => item.id)).toEqual(events.slice(1000).map((item) => item.id));
      expect((await request(key, `/${name}/ack`, 'POST', { leaseId: third.leaseId })).status).toBe(200);
      const retry = await pull(name, key, '?limit=500');
      expect(retry.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
      expect(retry.leaseId).not.toBe(second.leaseId);
      expect((await request(key, `/${name}/ack`, 'POST', { leaseId: second.leaseId })).status).toBe(400);
      expect((await request(key, `/${name}/ack`, 'POST', { leaseId: retry.leaseId })).status).toBe(200);
      const next = await pull(name, key, '?limit=500');
      expect(next.items.map((item) => item.id)).toEqual([fresh.id]);
      expect((await request(key, `/${name}/ack`, 'POST', { leaseId: next.leaseId })).status).toBe(200);
      const delivered = [...first.items, ...second.items, ...third.items, ...next.items].map((item) => item.id);
      expect(delivered).toEqual([...events.map((event) => event.id), fresh.id]);
      expect(new Set(delivered).size).toBe(1004);
      expect((await pull(name, key)).items).toEqual([]);
      expect((await consumers.getByName(name)).leaseState?.leases).toEqual([]);
    }, 30_000);
  }

  async function tenantEvent(kind: 'connector' | 'agent') {
    if (kind === 'connector') return typed();
    return (
      await db
        .insert(omniEvents)
        .values({ agentId: B, channel: 'internal', eventType: 'custom.tenant.agent', journalReady: true })
        .returning()
    )[0];
  }
  async function expireAll(name: string) {
    const state = (await consumers.getByName(name)).leaseState;
    if (!state) throw new Error('Missing reclaim state');
    await db
      .update(durableConsumers)
      .set({ leaseState: { ...state, leases: state.leases.map((lease) => ({ ...lease, expiresAt: 0 })) } })
      .where(eq(durableConsumers.name, name));
  }

  for (const kind of ['connector', 'agent'] as const) {
    for (const mismatch of ['other', 'null'] as const) {
      const tenantId = mismatch === 'other' ? randomUUID() : null;
      test(`${kind} grants require the source tenant: ${mismatch}/T never delivers on pull, shared ack, stream or expired reclaim`, async () => {
        if (kind === 'agent') await db.update(agents).set({ tenantId: T }).where(eq(agents.id, B));
        try {
          const event = await tenantEvent(kind);
          if (!event) throw new Error('Missing tenant row');
          expect(event.tenantId).toBe(T);
          const approval = await grant(kind, kind === 'connector' ? C : B, A, tenantId);
          const name = await create();
          const shared = await create('*', true);
          expect((await pull(name)).items).toEqual([]);
          expect((await pull(shared)).items).toEqual([]);
          expect((await consumers.scanForStream(name, 0, { tenantId: null, caller: caller() })).items).toEqual([]);
          await db.update(agentSourceGrants).set({ tenantId: T }).where(eq(agentSourceGrants.id, approval));
          expect((await pull(name)).items.map((item) => item.id)).toEqual([event.id]);
          expect(
            (await consumers.scanForStream(name, 0, { tenantId: null, caller: caller() })).items.map((item) => item.id),
          ).toEqual([event.id]);
          const leased = await pull(shared);
          expect(leased.items.map((item) => item.id)).toEqual([event.id]);
          expect((await request(a, `/${shared}/ack`, 'POST', { leaseId: leased.leaseId })).status).toBe(200);
          const reclaim = await create('*', true);
          const original = await pull(reclaim);
          expect(original.items.map((item) => item.id)).toEqual([event.id]);
          await expireAll(reclaim);
          await db.update(agentSourceGrants).set({ tenantId }).where(eq(agentSourceGrants.id, approval));
          expect((await pull(reclaim)).items).toEqual([]);
          expect((await consumers.getByName(reclaim)).leaseState?.leases).toEqual([]);
          expect((await consumers.scanForStream(name, 0, { tenantId: null, caller: caller() })).items).toEqual([]);
        } finally {
          if (kind === 'agent') await db.update(agents).set({ tenantId: null }).where(eq(agents.id, B));
        }
      });
    }
  }

  test('single-tenant normal source create and receive persist NULL source/event/grant tenants and deliver on all paths including reclaim', async () => {
    const source = await webhooks.create({ name: `normal-${randomUUID()}` });
    expect(source.tenantId).toBeNull();
    const result = await webhooks.receive(source.name, { proof: 'normal ingress' }, {});
    const event = await row(result.eventId);
    expect(event.tenantId).toBe(source.tenantId);
    const approval = await grant('webhook_source', source.id);
    const [stored] = await db.select().from(agentSourceGrants).where(eq(agentSourceGrants.id, approval));
    expect(stored?.tenantId).toBe(source.tenantId);
    const name = await create();
    expect((await pull(name)).items.map((item) => item.id)).toEqual([event.id]);
    expect(
      (await consumers.scanForStream(name, 0, { tenantId: null, caller: caller() })).items.map((item) => item.id),
    ).toEqual([event.id]);
    const shared = await create('*', true);
    const first = await pull(shared);
    const state = (await consumers.getByName(shared)).leaseState;
    if (!state) throw new Error('Missing lease');
    await db
      .update(durableConsumers)
      .set({ leaseState: { ...state, leases: state.leases.map((lease) => ({ ...lease, expiresAt: 0 })) } })
      .where(eq(durableConsumers.name, shared));
    const again = await pull(shared);
    expect(again.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    expect(again.items.map((item) => item.id)).toEqual([event.id]);
    expect((await request(a, `/${shared}/ack`, 'POST', { leaseId: again.leaseId })).status).toBe(200);
    expect((await pull(shared)).items).toEqual([]);
  });

  test('NULL-tenant producing-agent grant delivers NULL rows through pull, stream, shared ack and expired reclaim', async () => {
    const [event] = await db
      .insert(omniEvents)
      .values({ agentId: B, channel: 'internal', eventType: 'custom.null.producer', journalReady: true })
      .returning();
    if (!event) throw new Error('Missing producing-agent row');
    expect(event.tenantId).toBeNull();
    const approval = await grant('agent', B);
    const [stored] = await db.select().from(agentSourceGrants).where(eq(agentSourceGrants.id, approval));
    expect(stored?.tenantId).toBeNull();
    const name = await create();
    expect((await pull(name)).items.map((item) => item.id)).toEqual([event.id]);
    expect(
      (await consumers.scanForStream(name, 0, { tenantId: null, caller: caller() })).items.map((item) => item.id),
    ).toEqual([event.id]);
    const shared = await create('*', true);
    const first = await pull(shared);
    expect(first.items.map((item) => item.id)).toEqual([event.id]);
    await expireAll(shared);
    const again = await pull(shared);
    expect(again.items.map((item) => item.id)).toEqual([event.id]);
    expect(again.leaseId).not.toBe(first.leaseId);
    expect((await request(a, `/${shared}/ack`, 'POST', { leaseId: again.leaseId })).status).toBe(200);
    expect((await pull(shared)).items).toEqual([]);
  });

  test('single-tenant typed normal ingress stamps the persisted source tenant; writer-stamped grant delivers end to end', async () => {
    const [source] = await db.select().from(connectors).where(eq(connectors.id, C));
    if (!source) throw new Error('Missing persisted source');
    const event = await typed();
    const approval = await grant('connector', C);
    const [stored] = await db.select().from(agentSourceGrants).where(eq(agentSourceGrants.id, approval));
    expect(process.env.OMNI_MULTITENANCY_ENABLED).toBeUndefined();
    expect(event.tenantId).toBe(source.tenantId);
    expect(stored?.tenantId).toBe(source.tenantId);
    expect(source.tenantId).not.toBeNull();
    expect((await pull(await create())).items.map((item) => item.id)).toEqual([event.id]);
  });
  test('EXPLAIN of the real grant scan retains the three G1 journal index paths with tenant equality', async () => {
    await typed();
    await db.insert(omniEvents).values([
      { channel: 'internal', eventType: TYPED_EVENT, instanceId: IA, journalReady: true },
      { channel: 'internal', eventType: TYPED_EVENT, agentId: B, journalReady: true },
      ...Array.from({ length: 2500 }, (): typeof omniEvents.$inferInsert => ({
        channel: 'internal' as const,
        eventType: TYPED_EVENT,
        sourceKind: 'connector' as const,
        sourceId: otherC,
        metadata: { source: 'connector', connectorId: otherC, subscriptionIds: [] },
        journalReady: true,
      })),
    ]);
    await grant('connector', C);
    await grant('agent', B);
    const name = await create(TYPED_EVENT);
    const prepared = spyOn(PostgresJsSession.prototype, 'prepareQuery');
    let query: { sql: string; params: unknown[] } | undefined;
    try {
      await consumers.scanForStream(name, 0, { tenantId: null, caller: caller() });
      query = prepared.mock.calls
        .map(([statement]) => statement)
        .find((statement) => statement.sql.includes('union all'));
    } finally {
      prepared.mockRestore();
    }
    if (!query) throw new Error('Missing real UNION scan');
    expect(query.sql).toContain('is not distinct from');
    const explain = sql`EXPLAIN (FORMAT JSON) `;
    for (const [index, part] of query.sql.split(/\$(\d+)/).entries()) {
      explain.append(index % 2 === 0 ? sql.raw(part) : sql`${query.params[Number(part) - 1]}`);
    }
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      return tx.execute(explain);
    });
    const rendered = JSON.stringify(plan);
    for (const index of [
      'omni_events_instance_type_seq_idx',
      'omni_events_source_type_seq_idx',
      'omni_events_agent_type_seq_idx',
    ])
      expect(rendered).toContain(index);
  }, 15_000);
});
