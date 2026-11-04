/** G4 acceptance against a disposable database, FORCE RLS and a verified runtime role. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';
import { type Automation, createAutomationEngine, setTenantSecretMasterKey } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  automations,
  connectorEventSubscriptions,
  connectors,
  createDbHandle,
  omniEvents,
} from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../app';
import { ConnectorService } from '../services/connectors';
import { sealCredentialField } from '../tenancy/sealed-credentials';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import {
  HOOK_SECRET,
  TYPED_EVENT,
  connectorHookBus,
  eventsOnlyConnector,
  signHook,
} from './fixtures/events-only-connector';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const TENANT_A = '10000000-0000-4000-8000-000000000041';
const TENANT_B = '10000000-0000-4000-8000-000000000042';
const MASTER_KEY = Buffer.alloc(32, 0x42);

/** WHATWG drops credentials on hostless socket URLs; postgres-js reads ?user= there. */
function roleUrl(database: string, user?: { name: string; password: string }): string {
  const url = new URL(superUrl);
  url.pathname = `/${database}`;
  if (user) {
    if (url.hostname) {
      url.username = user.name;
      url.password = user.password;
    } else {
      url.searchParams.set('user', user.name);
      url.searchParams.set('password', user.password);
    }
  }
  return url.toString();
}

postgresDescribe('per-connector hook acceptance (real PostgreSQL)', () => {
  const database = `omni_hooks_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const handles: ReturnType<typeof createDbHandle>[] = [];
  const connectorId = randomUUID();
  const noSecretId = randomUUID();
  const clickupId = randomUUID();
  const natsConnectorId = randomUUID();
  const natsLegacyId = randomUUID();
  const ids = {
    target1: randomUUID(),
    target2: randomUUID(),
    unnamed: randomUUID(),
    foreign: randomUUID(),
    legacy: randomUUID(),
    legacyOther: randomUUID(),
  };
  const subscriptions = {
    target1: randomUUID(),
    target2: randomUUID(),
    glob: randomUUID(),
    filtered: randomUUID(),
    paused: randomUUID(),
    legacy: randomUUID(),
    error: randomUUID(),
    pausedOnly: randomUUID(),
  };
  const transport = connectorHookBus();
  const fired: string[] = [];
  let db: Database;
  let runtimeUrl = '';
  let service: ConnectorService;
  let app: ReturnType<typeof createApp>['app'];
  const engine = createAutomationEngine({ reconcileIntervalMs: 0 });

  function open(url: string) {
    const handle = createDbHandle({ url, maxConnections: 4 });
    handles.push(handle);
    return handle.db;
  }
  function tenant<T>(fn: () => Promise<T>, tenantId = TENANT_A): Promise<T> {
    return runTenantWorkDb(db, tenantId, fn);
  }
  async function journal() {
    return tenant(() => scopedHandle(db).select().from(omniEvents));
  }
  async function post(body: Record<string, unknown>, id = connectorId, clientIp = '192.0.2.44') {
    const raw = JSON.stringify(body);
    return app.request(
      `/api/v2/connectors/hooks/${id}`,
      { method: 'POST', body: raw, headers: signHook(raw) },
      { remoteAddr: clientIp },
    );
  }
  async function loadAutomation(
    owner: Database,
    id: string,
    name: string,
    type: string,
    tenantId: string,
  ): Promise<Automation> {
    const actions: (typeof automations.$inferInsert)['actions'] = [
      { type: 'send_message', config: { instanceId: 'synthetic', to: name, contentTemplate: 'accepted' } },
    ];
    const [row] = await owner.insert(automations).values({ id, name, triggerEventType: type, actions }).returning();
    if (!row) throw new Error('Automation seed failed');
    await owner.update(automations).set({ tenantId }).where(eq(automations.id, id));
    return {
      id,
      name,
      description: null,
      triggerEventType: type,
      triggerConditions: [],
      conditionLogic: 'and',
      actions: [{ type: 'send_message', config: { instanceId: 'synthetic', to: name, contentTemplate: 'accepted' } }],
      debounce: { mode: 'none' },
      enabled: true,
      priority: 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  beforeAll(async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    const owner = open(roleUrl(database));
    await owner.execute(sql`INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget)
      VALUES (${TENANT_A}, 'hooks-a', 'Hooks A', 86400, 1000, 1000), (${TENANT_B}, 'hooks-b', 'Hooks B', 86400, 1000, 1000)`);
    for (const id of [connectorId, noSecretId, clickupId, natsConnectorId]) {
      await owner.insert(connectors).values({
        id,
        provider: id === clickupId ? 'clickup' : 'gitlab',
        name: id,
        credentials: sealCredentialField(TENANT_A, '{}'),
        hookSecret: id === noSecretId ? null : sealCredentialField(TENANT_A, HOOK_SECRET),
        status: 'connected',
        tenantId: TENANT_A,
      });
    }
    const definitions = await Promise.all([
      loadAutomation(owner, ids.target1, 'first', TYPED_EVENT, TENANT_A),
      loadAutomation(owner, ids.target2, 'second', TYPED_EVENT, TENANT_A),
      loadAutomation(owner, ids.unnamed, 'unnamed', TYPED_EVENT, TENANT_A),
      loadAutomation(owner, ids.foreign, 'foreign', TYPED_EVENT, TENANT_B),
      loadAutomation(owner, ids.legacy, 'legacy', 'connector.event', TENANT_A),
      loadAutomation(owner, ids.legacyOther, 'legacy-other', 'connector.event', TENANT_A),
    ]);
    await owner.insert(connectorEventSubscriptions).values(
      [
        {
          id: subscriptions.target1,
          connectorId,
          providerEventKey: TYPED_EVENT,
          targetAutomationId: ids.target1,
          filters: { 'project.id': 7 },
        },
        {
          id: subscriptions.target2,
          connectorId,
          providerEventKey: TYPED_EVENT,
          targetAutomationId: ids.target2,
          filters: { 'project.id': 7 },
        },
        { id: subscriptions.glob, connectorId, providerEventKey: 'connector.gitlab.*' },
        {
          id: subscriptions.filtered,
          connectorId,
          providerEventKey: 'connector.gitlab.merge_request.*',
          filters: { 'project.id': 8 },
        },
        { id: subscriptions.paused, connectorId, providerEventKey: TYPED_EVENT, status: 'paused' },
        { id: randomUUID(), connectorId: natsConnectorId, providerEventKey: TYPED_EVENT },
        {
          id: subscriptions.error,
          connectorId: natsConnectorId,
          providerEventKey: 'connector.gitlab.recovered',
          status: 'error',
        },
        {
          id: subscriptions.pausedOnly,
          connectorId: natsConnectorId,
          providerEventKey: 'connector.gitlab.issue.opened',
          status: 'paused',
        },
      ].map((row): typeof connectorEventSubscriptions.$inferInsert => ({
        ...row,
        ingress: 'connector',
        tenantId: TENANT_A,
      })),
    );
    await owner.insert(connectorEventSubscriptions).values(
      [
        {
          id: subscriptions.legacy,
          connectorId: clickupId,
          providerEventKey: 'taskStatusUpdated',
          targetAutomationId: ids.legacy,
        },
        {
          id: natsLegacyId,
          connectorId: natsConnectorId,
          providerEventKey: 'merge_request.merged',
          targetAutomationId: ids.legacy,
        },
      ].map((row): typeof connectorEventSubscriptions.$inferInsert => ({
        ...row,
        ingress: 'subscription',
        verificationSecret: sealCredentialField(TENANT_A, HOOK_SECRET),
        tenantId: TENANT_A,
      })),
    );
    await applyTenantRlsEnforcement(owner);
    const passwords = { ddl: randomUUID(), runtime: randomUUID(), authPlane: randomUUID() };
    await applyTenancyRoles(owner, passwords, DEFAULT_ROLE_NAMES, database);
    runtimeUrl = roleUrl(database, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
    db = open(runtimeUrl);
    const identity = z
      .array(z.object({ current_user: z.string(), rolsuper: z.boolean(), rolbypassrls: z.boolean() }))
      .parse(
        await db.execute(sql`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`),
      );
    expect(identity).toEqual([{ current_user: DEFAULT_ROLE_NAMES.runtime, rolsuper: false, rolbypassrls: false }]);
    const registry = new ConnectorRegistry([eventsOnlyConnector, clickupManifest]);
    service = new ConnectorService(db, transport.bus, registry);
    const result = createApp(db, transport.bus, null, null);
    result.services.connectors = service;
    app = result.app;
    await engine.start(transport.bus, definitions, {
      sendMessage: async (_instanceId, to) => {
        fired.push(to);
      },
    });
  }, 180_000);

  afterAll(async () => {
    await engine.stop();
    for (const handle of handles) await handle.close();
    setTenantSecretMasterKey(null);
    const dropped = Bun.spawnSync([
      psqlBin,
      '-X',
      '--no-psqlrc',
      '-v',
      'ON_ERROR_STOP=1',
      '--dbname',
      superUrl,
      '-c',
      `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
    ]);
    if (dropped.exitCode !== 0) throw new Error(dropped.stderr.toString());
  });

  test('two targets share one claim; only listed targets fire once and forged routing is replaced', async () => {
    const providerId = randomUUID();
    const body = {
      id: providerId,
      event: 'merge_request.merged',
      eventType: TYPED_EVENT,
      project: { id: 7 },
      connectorId: randomUUID(),
      subscriptionIds: ['forged'],
      targetAutomationIds: [ids.unnamed, ids.foreign],
      rawPayload: { duplicate: true },
      echo: HOOK_SECRET,
    };
    const first = await post(body);
    expect(first.status).toBe(202);
    expect(fired).toEqual(['first', 'second']);
    const [row] = (await journal()).filter(
      (event) => event.idempotencyKey === `connector:${connectorId}:${providerId}`,
    );
    if (!row) throw new Error('Missing typed journal claim');
    const matchedIds = [subscriptions.target1, subscriptions.target2, subscriptions.glob];
    expect(row.metadata).toEqual({
      correlationId: row.id,
      source: 'connector',
      connectorId,
      provider: 'gitlab',
      fullEventType: TYPED_EVENT,
      subscriptionIds: expect.arrayContaining(matchedIds),
      tenantId: TENANT_A,
      envelopeVersion: 1,
    });
    const payload = z
      .object({
        connectorId: z.string(),
        subscriptionIds: z.array(z.string()),
        targetAutomationIds: z.array(z.string()),
      })
      .passthrough()
      .parse(row.rawPayload);
    expect(payload.connectorId).toBe(connectorId);
    expect(payload.subscriptionIds.sort()).toEqual(matchedIds.sort());
    expect(payload.targetAutomationIds.sort()).toEqual([ids.target1, ids.target2].sort());
    expect(payload).not.toHaveProperty('rawPayload');
    expect(JSON.stringify(row)).not.toContain(HOOK_SECRET);
    expect(transport.events.at(-1)?.id).toBe(row.id);
    expect(transport.events.at(-1)?.payload).toEqual(row.rawPayload);
    expect(JSON.stringify(transport.events)).not.toContain(HOOK_SECRET);
    const duplicate = await post(body);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true, eventId: row.id });
    expect((await journal()).filter((event) => event.idempotencyKey === row.idempotencyKey)).toHaveLength(1);
    expect(fired).toEqual(['first', 'second']);
    for (const id of matchedIds) {
      const [subscription] = await tenant(() =>
        scopedHandle(db).select().from(connectorEventSubscriptions).where(eq(connectorEventSubscriptions.id, id)),
      );
      expect(subscription).toMatchObject({ totalDeliveries: 1, totalDuplicates: 1 });
    }
  });

  test('target-less delivery and exact dot filters fire nothing in either tenant', async () => {
    const before = fired.length;
    // Explicit provider name wins over eventKey; the exact target filters miss.
    expect(
      (await post({ id: randomUUID(), event: 'different', eventType: TYPED_EVENT, project: { id: 9 } })).status,
    ).toBe(202);
    expect(fired.length).toBe(before);
    const payload = z.object({ targetAutomationIds: z.array(z.string()) }).parse(transport.events.at(-1)?.payload);
    expect(payload.targetAutomationIds).toEqual([]);
  });

  test('error subscriptions still match and recover to active after success', async () => {
    const before = fired.length;
    expect((await post({ event: 'recovered', id: randomUUID() }, natsConnectorId)).status).toBe(202);
    const [row] = await tenant(() =>
      scopedHandle(db)
        .select()
        .from(connectorEventSubscriptions)
        .where(eq(connectorEventSubscriptions.id, subscriptions.error)),
    );
    expect(row).toMatchObject({ status: 'active', consecutiveFailures: 0, totalDeliveries: 1, lastError: null });
    expect(fired.length).toBe(before);
  });

  test('foreign eventType falls back to provider/eventKey; unmatched stores only counters', async () => {
    const before = (await journal()).length;
    const published = transport.events.length;
    const raw = JSON.stringify({
      event: 'issue.opened',
      eventType: 'connector.other.forged',
      id: randomUUID(),
      private: 'never-stored',
    });
    // No subscriptions on this fixture connector, so it is unmatched.
    expect((await service.receiveForConnector(natsConnectorId, raw, signHook(raw))).status).toBe(202);
    expect((await journal()).length).toBe(before);
    expect(transport.events.length).toBe(published);
    const [view] = await tenant(() =>
      scopedHandle(db).select().from(connectors).where(eq(connectors.id, natsConnectorId)),
    );
    expect(view).toMatchObject({ totalUnmatched: 1, lastUnmatchedEventType: 'connector.gitlab.issue.opened' });
    expect(view?.lastUnmatchedAt).toBeInstanceOf(Date);
    const [paused] = await tenant(() =>
      scopedHandle(db)
        .select()
        .from(connectorEventSubscriptions)
        .where(eq(connectorEventSubscriptions.id, subscriptions.pausedOnly)),
    );
    expect(paused).toMatchObject({ status: 'paused', totalDeliveries: 0 });
    expect(await tenant(() => service.getById(natsConnectorId))).toMatchObject({
      totalUnmatched: 1,
      lastUnmatchedEventType: 'connector.gitlab.issue.opened',
    });
  });

  test('bad signature, missing/unknown/unopenable secret and malformed id are the same public 401', async () => {
    const raw = JSON.stringify({ id: randomUUID() });
    const before = (await journal()).length;
    const unknown = await service.receiveForConnector(randomUUID(), raw, signHook(raw));
    for (const outcome of [
      await service.receiveForConnector(connectorId, raw, signHook(raw, 'wrong')),
      await service.receiveForConnector(noSecretId, raw, signHook(raw)),
      await service.receiveForConnector('invalid', raw, signHook(raw)),
    ])
      expect(outcome).toEqual(unknown);
    expect(unknown.status).toBe(401);
    setTenantSecretMasterKey(Buffer.alloc(32, 0x43));
    try {
      expect(await service.receiveForConnector(connectorId, raw, signHook(raw))).toEqual(unknown);
    } finally {
      setTenantSecretMasterKey(MASTER_KEY);
    }
    expect((await journal()).length).toBe(before);
  });

  test('connector subscription on the per-subscription route journals and fires nothing', async () => {
    const before = (await journal()).length;
    const count = fired.length;
    const body = JSON.stringify({ event: 'merge_request.merged', id: randomUUID() });
    const response = await app.request(`/api/v2/connectors/events/${subscriptions.target1}`, {
      method: 'POST',
      body,
      headers: signHook(body),
    });
    expect(response.status).toBe(401);
    expect((await journal()).length).toBe(before);
    expect(fired.length).toBe(count);
  });

  test('ClickUp retains its URL, identity, single routing ids, rawPayload and provider target list', async () => {
    const providerId = randomUUID();
    const provider = {
      event: 'taskStatusUpdated',
      task_id: 'task-1',
      history_items: [{ id: providerId, date: 1780000000000 }],
      targetAutomationIds: [ids.foreign],
    };
    const raw = JSON.stringify(provider);
    const before = fired.length;
    const response = await app.request(`/api/v2/connectors/events/${subscriptions.legacy}`, {
      method: 'POST',
      body: raw,
      headers: { 'x-signature': createHmac('sha256', HOOK_SECRET).update(raw).digest('hex') },
    });
    expect(response.status).toBe(202);
    expect(fired.slice(before)).toEqual(['legacy']);
    const [row] = (await journal()).filter(
      (event) => event.idempotencyKey === `connector:${subscriptions.legacy}:${providerId}`,
    );
    expect(row?.rawPayload).toEqual({
      ...provider,
      connectorId: clickupId,
      subscriptionId: subscriptions.legacy,
      targetAutomationId: ids.legacy,
      provider: 'clickup',
      eventKey: 'taskStatusUpdated',
      providerEventId: providerId,
      occurredAt: new Date(1780000000000).toISOString(),
      rawPayload: provider,
    });
    expect(row?.eventType).toBe('connector.event');
    expect(
      (
        await app.request(`/api/v2/connectors/events/${subscriptions.legacy}`, {
          method: 'POST',
          body: raw,
          headers: signHook(raw),
        })
      ).status,
    ).toBe(200);
    expect(fired.slice(before)).toEqual(['legacy']);
  });

  test('failed publish releases the claim and a retry succeeds under FORCE RLS', async () => {
    const providerId = randomUUID();
    const body = { id: providerId, project: { id: 9 } };
    transport.failNextPublish(true);
    try {
      expect((await post(body)).status).toBe(500);
    } finally {
      transport.failNextPublish(false);
    }
    expect(
      (await journal()).filter((row) => row.idempotencyKey === `connector:${connectorId}:${providerId}`),
    ).toHaveLength(0);
    expect((await post(body)).status).toBe(202);
    expect(
      (await journal()).filter((row) => row.idempotencyKey === `connector:${connectorId}:${providerId}`),
    ).toHaveLength(1);
  });

  test('signed malformed JSON and parser-invalid input are unmatched 202; filters and paused rows do not match', async () => {
    const count = (await journal()).length;
    const raw = '{';
    expect((await service.receiveForConnector(connectorId, raw, signHook(raw))).status).toBe(202);
    const invalid = JSON.stringify({ event: 42 });
    expect((await service.receiveForConnector(connectorId, invalid, signHook(invalid))).status).toBe(202);
    expect((await journal()).length).toBe(count);
    const before = fired.length;
    expect((await post({ id: randomUUID(), project: { id: 8 } })).status).toBe(202);
    const routing = z
      .object({ subscriptionIds: z.array(z.string()), targetAutomationIds: z.array(z.string()) })
      .parse(transport.events.at(-1)?.payload);
    expect(routing.subscriptionIds.sort()).toEqual([subscriptions.glob, subscriptions.filtered].sort());
    expect(routing.targetAutomationIds).toEqual([]);
    expect(fired.length).toBe(before);
  });

  test('real PG and NATS agree on durable large bodies; provider oversize is 413 with its claim released', async () => {
    const child = Bun.spawn(
      [
        'bun',
        `${import.meta.dir}/fixtures/connector-hooks-nats-run.ts`,
        JSON.stringify({
          url: runtimeUrl,
          tenantId: TENANT_A,
          connectorId: natsConnectorId,
          subscriptionId: natsLegacyId,
        }),
      ],
      {
        env: { ...process.env, LOG_LEVEL: 'silent' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`NATS/Postgres child exited ${code}: ${stderr}`);
    const result = z
      .object({
        realPostgres: z.boolean(),
        delivered: z.array(z.object({ type: z.string() })),
        maxPayload: z.number(),
        bodyBytes: z.number(),
        oversizedStatus: z.number(),
        oversizedRows: z.number(),
      })
      .parse(JSON.parse(stdout.trim().split('\n').pop() ?? ''));
    expect(result.realPostgres).toBe(true);
    expect(result.oversizedStatus).toBe(413);
    expect(result.oversizedRows).toBe(0);
    expect(result.delivered.map((event) => event.type).sort()).toEqual(['connector.event', TYPED_EVENT].sort());
    expect(result.bodyBytes).toBeGreaterThan(result.maxPayload / 2);
  }, 30_000);
  test('concurrent duplicate hooks arbitrate both idempotency indexes: one claim and one fire per target', async () => {
    for (let round = 0; round < 10; round++) {
      const providerEventId = randomUUID();
      const beforeFired = fired.length;
      const beforePublished = transport.events.length;
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          // Each retry burst has its own peer bucket, isolated from other gate suites.
          post(
            { id: providerEventId, eventType: TYPED_EVENT, project: { id: 7 } },
            connectorId,
            `192.0.2.${100 + round}`,
          ),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 202]);
      const receipts = await Promise.all(responses.map((response) => response.json()));
      expect(new Set(receipts.map((receipt) => z.object({ eventId: z.string() }).parse(receipt).eventId)).size).toBe(1);
      expect(
        (await journal()).filter((row) => row.idempotencyKey === `connector:${connectorId}:${providerEventId}`),
      ).toHaveLength(1);
      expect(fired.slice(beforeFired)).toEqual(['first', 'second']);
      expect(transport.events.length - beforePublished).toBe(1);
    }
  });

  const prefix = 'connector.gitlab.';
  const invalidNames = [
    { label: '256-character explicit typed name', eventType: `${prefix}${'a'.repeat(256 - prefix.length)}` },
    { label: '256-character fallback typed name', event: 'b'.repeat(256 - prefix.length) },
    { label: 'dangling provider prefix', eventType: prefix },
    { label: 'unicode name', eventType: `${prefix}ünïcode` },
    { label: 'wildcard name', eventType: `${prefix}*` },
    { label: 'name containing a space', eventType: `${prefix}merge request` },
  ];
  for (const { label, ...fields } of invalidNames) {
    test(`${label} is unmatched 202 before glob matching, with a bounded counter name`, async () => {
      const beforeRows = (await journal()).length;
      const beforePublished = transport.events.length;
      const beforeFired = fired.length;
      const [before] = await tenant(() =>
        scopedHandle(db).select().from(connectors).where(eq(connectors.id, connectorId)),
      );
      const response = await post({ id: randomUUID(), ...fields });
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ received: true, ignored: true });
      const [after] = await tenant(() =>
        scopedHandle(db).select().from(connectors).where(eq(connectors.id, connectorId)),
      );
      const expectedName = 'eventType' in fields ? fields.eventType : `${prefix}${fields.event}`;
      expect(after).toMatchObject({
        totalUnmatched: (before?.totalUnmatched ?? 0) + 1,
        lastUnmatchedEventType: expectedName?.slice(0, 200),
      });
      expect(after?.lastUnmatchedAt).toBeInstanceOf(Date);
      expect((await journal()).length).toBe(beforeRows);
      expect(transport.events.length).toBe(beforePublished);
      expect(fired.length).toBe(beforeFired);
    });
  }

  for (const length of [201, 255, 400]) {
    test(`${length}-character unmatched name counts once and stores only the first 200 characters, 202`, async () => {
      const name = `${prefix}${'u'.repeat(length - prefix.length)}`;
      const [before] = await tenant(() =>
        scopedHandle(db).select().from(connectors).where(eq(connectors.id, natsConnectorId)),
      );
      const beforeRows = (await journal()).length;
      const beforePublished = transport.events.length;
      expect((await post({ id: randomUUID(), eventType: name }, natsConnectorId)).status).toBe(202);
      const [after] = await tenant(() =>
        scopedHandle(db).select().from(connectors).where(eq(connectors.id, natsConnectorId)),
      );
      expect(after).toMatchObject({
        totalUnmatched: (before?.totalUnmatched ?? 0) + 1,
        lastUnmatchedEventType: name.slice(0, 200),
      });
      expect((await journal()).length).toBe(beforeRows);
      expect(transport.events.length).toBe(beforePublished);
    });
  }

  test('empty and parser-invalid signed bodies are unmatched unparsed 202 with no row or publish', async () => {
    for (const raw of ['', '{', '[]', 'null', JSON.stringify({ event: 42 })]) {
      const [before] = await tenant(() =>
        scopedHandle(db).select().from(connectors).where(eq(connectors.id, connectorId)),
      );
      const beforeRows = (await journal()).length;
      const beforePublished = transport.events.length;
      expect((await service.receiveForConnector(connectorId, raw, signHook(raw))).status).toBe(202);
      const [after] = await tenant(() =>
        scopedHandle(db).select().from(connectors).where(eq(connectors.id, connectorId)),
      );
      expect(after).toMatchObject({
        totalUnmatched: (before?.totalUnmatched ?? 0) + 1,
        lastUnmatchedEventType: `${prefix}unparsed`,
      });
      expect((await journal()).length).toBe(beforeRows);
      expect(transport.events.length).toBe(beforePublished);
    }
  });
});
