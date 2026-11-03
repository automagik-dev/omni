/**
 * An agent host pairs through the device flow as `omni-agent-host` and gets a key that reads
 * events and runs durable consumers of its own, nothing else (#1461, owner decisions
 * 2026-11-03). Real PostgreSQL, the whole API app (createApp): device code, the operator's
 * `omni approve`, the token, the device key, and then that key against the real routes. Any
 * consumer the key did not create is a 404 to it; it owns at most 10. The key's secret is
 * never printed.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Database, apiKeys, durableConsumers, instances, omniEvents } from '@omni/db';
import { eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../app';
import type { Login } from '../login';
import { DEFAULT_DEVICE_KEY_SCOPES } from '../login/config';
import { ApiKeyService } from '../services/api-keys';
import { MAX_CONSUMERS_PER_OWN_ONLY_KEY } from '../services/event-consumers';
import { EventService } from '../services/events';
import { createMigratedTestDatabase } from './fixtures/pg-clone';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const CLIENT = 'omni-agent-host';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const ENV = [
  'OMNI_LOGIN_ENABLED',
  'OMNI_PUBLIC_URL',
  'OMNI_AUTH_SECRET',
  'OMNI_DEVICE_KEY_SCOPES',
  'OMNI_MULTITENANCY_ENABLED',
  'TRUSTED_PROXY_HEADER',
] as const;

const DeviceCode = z.object({ device_code: z.string(), user_code: z.string() });
const AccessToken = z.object({ access_token: z.string().min(1) });
const MintedKey = z.object({
  data: z.object({ apiKey: z.string().startsWith('omni_sk_'), keyId: z.string().uuid(), scopes: z.array(z.string()) }),
});
const HOST_SCOPES = ['events:read', 'events:consume'];
const ConsumerBody = z.object({
  data: z.object({
    name: z.string(),
    scoped: z.boolean(),
    instanceIds: z.array(z.string()).nullable(),
    ownerKeyId: z.string().nullable(),
  }),
});
const ConsumerList = z.object({ items: z.array(z.object({ name: z.string() })) });
const PullBody = z.object({ items: z.array(z.object({ id: z.string() })), cursor: z.number() });
const TypesBody = z.object({ items: z.array(z.object({ eventType: z.string(), consumers: z.array(z.string()) })) });

/** Read SSE text until `until` matches (or the body ends), then cancel the body (client disconnect). */
async function readUntil(response: Response, until: RegExp): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  while (!until.test(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  await reader.cancel();
  return text;
}

postgresDescribe('the omni-agent-host device key (real PostgreSQL)', () => {
  const clone = createMigratedTestDatabase({ superUrl, psqlBin });
  const saved: Partial<Record<(typeof ENV)[number], string>> = {};
  let db: Database;
  let app: ReturnType<typeof createApp>['app'];
  let login: Login;
  let adminKey = '';
  let agentKey = '';
  let agentKeyId = '';
  let ip = 0;
  const eventId = crypto.randomUUID();
  const consumer = `agent-host-feed-${crypto.randomUUID().slice(0, 8)}`;

  type Headers = Record<string, string>;
  const request = (method: string, path: string, body?: unknown, headers: Headers = {}) =>
    app.request(`http://localhost:3999${path}`, {
      method,
      headers: {
        'x-forwarded-for': `198.51.100.${++ip % 250}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const asAdmin = (method: string, path: string, body?: unknown) =>
    request(method, path, body, { 'x-api-key': adminKey });
  const asAgentHost = (method: string, path: string, body?: unknown) =>
    request(method, path, body, { 'x-api-key': agentKey });
  const asKey = (key: string, method: string, path: string, body?: unknown) =>
    request(method, path, body, { 'x-api-key': key });
  const listedNames = async (key: string) => {
    const listed = await asKey(key, 'GET', '/api/v2/events/consumers');
    expect(listed.status).toBe(200);
    return ConsumerList.parse(await listed.json()).items.map((item) => item.name);
  };
  const consumerRow = async (name: string) =>
    (await db.select().from(durableConsumers).where(eq(durableConsumers.name, name)))[0];
  /** Every consumer route, against `name`: what an events:consume key may reach on its own consumer. */
  const consumerRoutes = (name: string) =>
    [
      ['GET', `/api/v2/events/consumers/${name}`, undefined],
      ['POST', `/api/v2/events/consumers/${name}/pull`, undefined],
      ['POST', `/api/v2/events/consumers/${name}/ack`, { cursor: 0 }],
      ['GET', `/api/v2/events/consumers/${name}/stream`, undefined],
      ['DELETE', `/api/v2/events/consumers/${name}`, undefined],
    ] as const;

  /** Device code, the operator's approval, and the device token: what a paired host holds. */
  async function approvedDeviceToken(): Promise<string> {
    const code = await request('POST', '/api/auth/device/code', { client_id: CLIENT });
    expect(code.status).toBe(200);
    const device = DeviceCode.parse(await code.json());
    const approved = await asAdmin('POST', '/api/v2/owner/approve', { userCode: device.user_code });
    expect(approved.status).toBe(200);
    // The device polls no faster than the server's interval.
    await new Promise((done) => setTimeout(done, 2100));
    const token = await request('POST', '/api/auth/device/token', {
      grant_type: DEVICE_GRANT,
      device_code: device.device_code,
      client_id: CLIENT,
    });
    expect(token.status).toBe(200);
    return AccessToken.parse(await token.json()).access_token;
  }

  beforeAll(async () => {
    for (const key of ENV) saved[key] = process.env[key];
    process.env.OMNI_LOGIN_ENABLED = 'true';
    process.env.OMNI_PUBLIC_URL = 'http://localhost:3999';
    process.env.OMNI_AUTH_SECRET = 'test-secret-test-secret-test-secret-42';
    process.env.TRUSTED_PROXY_HEADER = 'x-forwarded-for';
    // The default ceiling: what an Omni with nothing configured hands a device.
    Reflect.deleteProperty(process.env, 'OMNI_DEVICE_KEY_SCOPES');
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    db = clone.setup();
    const created = createApp(db, null, null);
    app = created.app;
    if (!created.login) throw new Error('login did not start');
    login = created.login;
    adminKey = (await new ApiKeyService(db).create({ name: 'operator', scopes: ['*'] })).plainTextKey;

    await db.insert(omniEvents).values({
      id: eventId,
      channel: 'internal',
      eventType: 'custom.agent-host.proof',
      journalReady: true,
    });
    const made = await asAdmin('POST', '/api/v2/events/consumers', {
      name: consumer,
      eventType: 'custom.agent-host.*',
    });
    expect(made.status).toBe(201);
  }, 120_000);

  afterAll(async () => {
    try {
      await clone.teardown();
    } finally {
      for (const key of ENV) {
        if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = saved[key];
      }
    }
  });

  test('pairs through the device flow and gets exactly read-events and consume', async () => {
    const token = await approvedDeviceToken();
    const minted = await request(
      'POST',
      '/api/v2/login/device-key',
      { deviceName: 'Agent host' },
      {
        authorization: `Bearer ${token}`,
      },
    );
    expect(minted.status).toBe(200);
    const { data } = MintedKey.parse(await minted.json());
    agentKey = data.apiKey;
    agentKeyId = data.keyId;
    expect(data.scopes).toEqual(HOST_SCOPES);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, agentKeyId));
    expect(row?.scopes).toEqual(HOST_SCOPES);
    expect(row?.description).toContain('agent host');

    // It validates itself with no auth scope (#1572) and sees the same set.
    const validated = await asAgentHost('POST', '/api/v2/auth/validate');
    expect(validated.status).toBe(200);
    const described = JSON.stringify(await validated.json());
    expect(described).toContain('"events:read"');
    expect(described).toContain('"events:consume"');
  });

  test('reads events: list (what stream and wait poll), get, trace, search', async () => {
    const list = await asAgentHost('GET', `/api/v2/events?since=${new Date(Date.now() - 3_600_000).toISOString()}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain(eventId);
    expect((await asAgentHost('GET', `/api/v2/events/${eventId}`)).status).toBe(200);
    expect((await asAgentHost('GET', `/api/v2/events/${eventId}/trace`)).status).toBe(200);
    expect((await asAgentHost('POST', '/api/v2/events/search', { format: 'summary' })).status).toBe(200);
    expect((await asAgentHost('GET', '/api/v2/events/types')).status).toBe(200);
  });

  test("does not see or touch the operator's consumer: 404 on every route, the row untouched", async () => {
    expect(await listedNames(agentKey)).not.toContain(consumer);
    const before = await consumerRow(consumer);
    for (const [method, path, body] of consumerRoutes(consumer)) {
      expect({ method, path, status: (await asAgentHost(method, path, body)).status }).toEqual({
        method,
        path,
        status: 404,
      });
    }
    expect(await consumerRow(consumer)).toEqual(before);
    // A name that does not exist answers the same 404: the two cannot be told apart.
    expect((await asAgentHost('GET', '/api/v2/events/consumers/no-such-consumer')).status).toBe(404);
  });

  test('runs its own consumer: create, inspect, pull, ack, stream, list, delete', async () => {
    const own = `agent-host-own-${crypto.randomUUID().slice(0, 8)}`;
    const created = await asAgentHost('POST', '/api/v2/events/consumers', {
      name: own,
      eventType: 'custom.agent-host.*',
      startFrom: 'beginning',
    });
    expect(created.status).toBe(201);
    // Unscoped (it follows instance-less events too), and owned by the host's key.
    expect(ConsumerBody.parse(await created.json()).data).toMatchObject({
      name: own,
      scoped: false,
      instanceIds: null,
      ownerKeyId: agentKeyId,
    });
    expect((await consumerRow(own))?.ownerKeyId).toBe(agentKeyId);

    expect((await asAgentHost('GET', `/api/v2/events/consumers/${own}`)).status).toBe(200);
    const listed = await listedNames(agentKey);
    expect(listed).toContain(own);
    expect(listed).not.toContain(consumer);

    const pulled = await asAgentHost('POST', `/api/v2/events/consumers/${own}/pull`);
    expect(pulled.status).toBe(200);
    const page = PullBody.parse(await pulled.json());
    expect(page.items.map((item) => item.id)).toContain(eventId);
    expect(page.cursor).toBeGreaterThan(0);
    const acked = await asAgentHost('POST', `/api/v2/events/consumers/${own}/ack`, { cursor: page.cursor });
    expect(acked.status).toBe(200);
    expect(Number((await consumerRow(own))?.cursor)).toBe(page.cursor);

    const stream = await asAgentHost('GET', `/api/v2/events/consumers/${own}/stream?after=0`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(await readUntil(stream, new RegExp(eventId))).toContain('event: connected');

    expect((await asAgentHost('DELETE', `/api/v2/events/consumers/${own}`)).status).toBe(200);
    expect(await consumerRow(own)).toBeUndefined();
    expect((await asAgentHost('GET', `/api/v2/events/consumers/${own}`)).status).toBe(404);
  });

  test('events:write and admin keys keep their access, to their consumers and to the host one', async () => {
    const own = `agent-host-kept-${crypto.randomUUID().slice(0, 8)}`;
    expect(
      (await asAgentHost('POST', '/api/v2/events/consumers', { name: own, eventType: 'custom.agent-host.*' })).status,
    ).toBe(201);
    const writer = (
      await new ApiKeyService(db).create({ name: 'events writer', scopes: ['events:read', 'events:write'] })
    ).plainTextKey;
    try {
      for (const key of [adminKey, writer]) {
        const listed = await listedNames(key);
        expect(listed).toContain(consumer);
        expect(listed).toContain(own);
        for (const name of [consumer, own]) {
          expect((await asKey(key, 'GET', `/api/v2/events/consumers/${name}`)).status).toBe(200);
          const pulled = await asKey(key, 'POST', `/api/v2/events/consumers/${name}/pull`);
          expect(pulled.status).toBe(200);
          const { cursor } = PullBody.parse(await pulled.json());
          expect((await asKey(key, 'POST', `/api/v2/events/consumers/${name}/ack`, { cursor })).status).toBe(200);
        }
      }
      // An events:write key's create is stamped exactly as before: no owner on an unscoped consumer.
      const theirs = `agent-host-writer-${crypto.randomUUID().slice(0, 8)}`;
      expect(
        (await asKey(writer, 'POST', '/api/v2/events/consumers', { name: theirs, eventType: 'custom.*' })).status,
      ).toBe(201);
      expect((await consumerRow(theirs))?.ownerKeyId).toBeNull();
      expect((await consumerRow(consumer))?.ownerKeyId).toBeNull();
      expect(await listedNames(agentKey)).not.toContain(theirs);
      expect((await asKey(writer, 'DELETE', `/api/v2/events/consumers/${theirs}`)).status).toBe(200);
      // The operator can still delete the host's consumer.
      expect((await asAgentHost('GET', `/api/v2/events/consumers/${own}`)).status).toBe(200);
      expect((await asAdmin('DELETE', `/api/v2/events/consumers/${own}`)).status).toBe(200);
      expect(await consumerRow(own)).toBeUndefined();
    } finally {
      await db.delete(durableConsumers).where(like(durableConsumers.name, 'agent-host-writer-%'));
    }
  });

  test('its event-type inventory names only its own consumers; events:write and admin keys see them all', async () => {
    const own = `agent-host-types-${crypto.randomUUID().slice(0, 8)}`;
    expect(
      (await asAgentHost('POST', '/api/v2/events/consumers', { name: own, eventType: 'custom.agent-host.*' })).status,
    ).toBe(201);
    const writer = (
      await new ApiKeyService(db).create({ name: 'events writer', scopes: ['events:read', 'events:write'] })
    ).plainTextKey;
    const inventory = async (key: string) => {
      const response = await asKey(key, 'GET', '/api/v2/events/types');
      expect(response.status).toBe(200);
      const text = await response.text();
      const row = TypesBody.parse(JSON.parse(text)).items.find((item) => item.eventType === 'custom.agent-host.proof');
      if (!row) throw new Error('the proof event type is missing from the inventory');
      return { text, consumers: [...row.consumers].sort() };
    };
    try {
      expect((await inventory(agentKey)).consumers).toEqual([own]);
      // Not ownOnly: byte for byte the inventory without an owner rule, which names the
      // operator's consumer and the host's.
      const unfiltered = JSON.stringify({ items: await new EventService(db).getTypes({}), meta: { since: null } });
      for (const key of [adminKey, writer]) {
        const seen = await inventory(key);
        expect(seen.consumers).toEqual([consumer, own].sort());
        expect(seen.text).toBe(unfiltered);
      }
    } finally {
      await db.delete(durableConsumers).where(eq(durableConsumers.name, own));
    }
  });

  test('a create body naming another key as owner is ignored: the owner is the calling key', async () => {
    const writerKey = await new ApiKeyService(db).create({
      name: 'events writer',
      scopes: ['events:read', 'events:write'],
    });
    const hostClaim = `agent-host-claim-${crypto.randomUUID().slice(0, 8)}`;
    const writerClaim = `agent-host-claim-${crypto.randomUUID().slice(0, 8)}`;
    try {
      // The host cannot hand its consumer to another key...
      const created = await asAgentHost('POST', '/api/v2/events/consumers', {
        name: hostClaim,
        eventType: 'custom.agent-host.*',
        ownerKeyId: writerKey.key.id,
      });
      expect(created.status).toBe(201);
      expect(ConsumerBody.parse(await created.json()).data.ownerKeyId).toBe(agentKeyId);
      expect((await consumerRow(hostClaim))?.ownerKeyId).toBe(agentKeyId);
      expect((await asAgentHost('GET', `/api/v2/events/consumers/${hostClaim}`)).status).toBe(200);
      // ...and another key cannot plant a consumer in the host's set.
      const planted = await asKey(writerKey.plainTextKey, 'POST', '/api/v2/events/consumers', {
        name: writerClaim,
        eventType: 'custom.agent-host.*',
        ownerKeyId: agentKeyId,
      });
      expect(planted.status).toBe(201);
      expect((await consumerRow(writerClaim))?.ownerKeyId).toBeNull();
      expect(await listedNames(agentKey)).not.toContain(writerClaim);
    } finally {
      await db.delete(durableConsumers).where(like(durableConsumers.name, 'agent-host-claim-%'));
    }
  });

  test(`owns at most ${MAX_CONSUMERS_PER_OWN_ONLY_KEY} consumers; events:write keys are not capped`, async () => {
    const prefix = `agent-host-cap-${crypto.randomUUID().slice(0, 6)}`;
    const create = (key: string, index: number) =>
      asKey(key, 'POST', '/api/v2/events/consumers', { name: `${prefix}-${index}`, eventType: 'custom.*' });
    const owned = async () =>
      (await db.select().from(durableConsumers).where(eq(durableConsumers.ownerKeyId, agentKeyId))).length;
    try {
      expect(await owned()).toBe(0);
      for (let index = 0; index < MAX_CONSUMERS_PER_OWN_ONLY_KEY; index++) {
        expect({ index, status: (await create(agentKey, index)).status }).toEqual({ index, status: 201 });
      }
      const refused = await create(agentKey, MAX_CONSUMERS_PER_OWN_ONLY_KEY);
      expect(refused.status).toBe(409);
      expect(JSON.stringify(await refused.json())).toContain('CONSUMER_LIMIT_REACHED');
      expect(await consumerRow(`${prefix}-${MAX_CONSUMERS_PER_OWN_ONLY_KEY}`)).toBeUndefined();
      expect(await owned()).toBe(MAX_CONSUMERS_PER_OWN_ONLY_KEY);

      expect((await asAgentHost('DELETE', `/api/v2/events/consumers/${prefix}-0`)).status).toBe(200);
      expect((await create(agentKey, MAX_CONSUMERS_PER_OWN_ONLY_KEY)).status).toBe(201);
      expect(await owned()).toBe(MAX_CONSUMERS_PER_OWN_ONLY_KEY);

      const writer = (await new ApiKeyService(db).create({ name: 'events writer', scopes: ['events:write'] }))
        .plainTextKey;
      for (let index = 100; index <= 100 + MAX_CONSUMERS_PER_OWN_ONLY_KEY; index++) {
        expect({ index, status: (await create(writer, index)).status }).toEqual({ index, status: 201 });
      }
    } finally {
      await db.delete(durableConsumers).where(like(durableConsumers.name, `${prefix}-%`));
    }
  });

  test('concurrent creates by one key cannot overshoot the cap', async () => {
    const prefix = `agent-host-race-${crypto.randomUUID().slice(0, 6)}`;
    try {
      const statuses = await Promise.all(
        Array.from({ length: MAX_CONSUMERS_PER_OWN_ONLY_KEY + 5 }, async (_, index) => {
          const response = await asAgentHost('POST', '/api/v2/events/consumers', {
            name: `${prefix}-${index}`,
            eventType: 'custom.*',
          });
          return response.status;
        }),
      );
      expect(statuses.filter((status) => status === 201)).toHaveLength(MAX_CONSUMERS_PER_OWN_ONLY_KEY);
      expect(statuses.filter((status) => status === 409)).toHaveLength(5);
      const rows = await db.select().from(durableConsumers).where(eq(durableConsumers.ownerKeyId, agentKeyId));
      expect(rows).toHaveLength(MAX_CONSUMERS_PER_OWN_ONLY_KEY);
    } finally {
      await db.delete(durableConsumers).where(like(durableConsumers.name, `${prefix}-%`));
    }
  });

  test('a revoked or expired host key is 401 on every consumer route, and its consumer stays as it was', async () => {
    const keys = new ApiKeyService(db);
    for (const ending of ['revoked', 'expired'] as const) {
      const made = await keys.create({ name: `device: agent host (${ending})`, scopes: HOST_SCOPES });
      const name = `agent-host-${ending}-${crypto.randomUUID().slice(0, 6)}`;
      expect(
        (await asKey(made.plainTextKey, 'POST', '/api/v2/events/consumers', { name, eventType: 'custom.*' })).status,
      ).toBe(201);
      const before = await consumerRow(name);
      expect(before?.ownerKeyId).toBe(made.key.id);
      if (ending === 'revoked') await keys.revoke(made.key.id, 'test');
      else await keys.update(made.key.id, { expiresAt: new Date(Date.now() - 60_000) });
      for (const [method, path, body] of [
        ['GET', '/api/v2/events/consumers', undefined],
        ['POST', '/api/v2/events/consumers', { name: `${name}-again`, eventType: 'custom.*' }],
        ...consumerRoutes(name),
      ] as const) {
        expect({ ending, method, path, status: (await asKey(made.plainTextKey, method, path, body)).status }).toEqual({
          ending,
          method,
          path,
          status: 401,
        });
      }
      expect(await consumerRow(name)).toEqual(before);
      expect(await consumerRow(`${name}-again`)).toBeUndefined();
      await db.delete(durableConsumers).where(eq(durableConsumers.name, name));
    }
  });

  test('an instance-restricted events:consume key creates scoped consumers it owns and sees only those', async () => {
    const instanceId = crypto.randomUUID();
    const other = crypto.randomUUID();
    await db.insert(instances).values([
      { id: instanceId, name: `agent-host-${instanceId.slice(0, 8)}`, channel: 'whatsapp-baileys' },
      { id: other, name: `agent-host-${other.slice(0, 8)}`, channel: 'whatsapp-baileys' },
    ]);
    const made = await new ApiKeyService(db).create({
      name: 'restricted agent host',
      scopes: HOST_SCOPES,
      instanceIds: [instanceId],
    });
    const name = `agent-host-restricted-${crypto.randomUUID().slice(0, 6)}`;
    const host = `agent-host-unrestricted-${crypto.randomUUID().slice(0, 6)}`;
    try {
      expect(
        (await asAgentHost('POST', '/api/v2/events/consumers', { name: host, eventType: 'custom.*' })).status,
      ).toBe(201);
      const created = await asKey(made.plainTextKey, 'POST', '/api/v2/events/consumers', {
        name,
        eventType: 'custom.*',
      });
      expect(created.status).toBe(201);
      expect(ConsumerBody.parse(await created.json()).data).toMatchObject({
        scoped: true,
        instanceIds: [instanceId],
        ownerKeyId: made.key.id,
      });
      expect(await listedNames(made.plainTextKey)).toEqual([name]);
      expect((await asKey(made.plainTextKey, 'POST', `/api/v2/events/consumers/${name}/pull`)).status).toBe(200);
      for (const foreign of [consumer, host]) {
        expect((await asKey(made.plainTextKey, 'GET', `/api/v2/events/consumers/${foreign}`)).status).toBe(404);
        expect((await asKey(made.plainTextKey, 'POST', `/api/v2/events/consumers/${foreign}/pull`)).status).toBe(404);
      }
      // Its instance set still binds it: naming an instance outside it is refused.
      const outside = await asKey(made.plainTextKey, 'POST', '/api/v2/events/consumers', {
        name: `${name}-outside`,
        eventType: 'custom.*',
        scoped: true,
        instanceIds: [other],
      });
      expect(outside.status).toBe(403);
      // And the unrestricted host does not see the restricted key's consumer.
      expect((await asAgentHost('GET', `/api/v2/events/consumers/${name}`)).status).toBe(404);
    } finally {
      await db.delete(durableConsumers).where(inArray(durableConsumers.name, [name, host, `${name}-outside`]));
    }
  });

  test('every write the brief names answers 403', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/v2/messages/send', { instanceId: crypto.randomUUID(), to: 'x', text: 'hi' }],
      ['POST', '/api/v2/automations', { name: 'x' }],
      ['POST', '/api/v2/instances', { name: 'x', channel: 'whatsapp-baileys' }],
      ['PATCH', `/api/v2/instances/${crypto.randomUUID()}`, { name: 'x' }],
      ['DELETE', `/api/v2/instances/${crypto.randomUUID()}`, undefined],
      ['POST', '/api/v2/keys', { name: 'x', scopes: ['*'] }],
      ['POST', '/api/v2/providers', { name: 'x' }],
      ['PUT', '/api/v2/settings/server.public_url', { value: 'http://example.invalid' }],
      ['POST', '/api/v2/events/schemas', { eventType: 'custom.x', schema: {} }],
      ['POST', '/api/v2/events/trigger', { eventType: 'custom.x', payload: {} }],
    ] as const) {
      expect({ method, path, status: (await asAgentHost(method, path, body)).status }).toEqual({
        method,
        path,
        status: 403,
      });
    }
  });

  test('cannot widen itself: no child key, no other client, no scope change', async () => {
    expect((await asAgentHost('POST', '/api/v2/keys/children', { name: 'child', scopes: ['*'] })).status).toBe(403);
    expect((await asAgentHost('PATCH', `/api/v2/keys/${agentKeyId}`, { scopes: ['*'] })).status).toBe(403);
    // The device-key exchange takes a one-time device token, never an API key.
    expect(
      (
        await request(
          'POST',
          '/api/v2/login/device-key',
          { deviceName: 'again' },
          {
            authorization: `Bearer ${agentKey}`,
          },
        )
      ).status,
    ).toBe(401);
    // It cannot approve a device, or hand out a connect link, for itself or another client.
    expect((await asAgentHost('POST', '/api/v2/owner/approve', { userCode: 'ABCD-EFGH' })).status).toBe(403);
    expect((await asAgentHost('POST', '/api/v2/owner/connect', { clientId: 'omni-cli' })).status).toBe(403);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, agentKeyId));
    expect(row?.scopes).toEqual(HOST_SCOPES);
  });

  test("the operator's ceiling narrows the key and never widens it", async () => {
    const ceiling = login.config.deviceKeyScopes;
    try {
      // A ceiling with neither events:read nor events:consume leaves the host nothing; its
      // token is not spent.
      const token = await approvedDeviceToken();
      const bearer = { authorization: `Bearer ${token}` };
      for (const ceiling of [['messages:*', 'instances:read'], ['events:write']]) {
        login.config.deviceKeyScopes = ceiling;
        const refused = await request('POST', '/api/v2/login/device-key', { deviceName: 'host' }, bearer);
        expect({ ceiling, status: refused.status }).toEqual({ ceiling, status: 403 });
        expect(JSON.stringify(await refused.json())).toContain('NO_DEVICE_SCOPES');
      }
      // A ceiling without events:consume still mints a read-only key, not a refusal.
      login.config.deviceKeyScopes = ['events:read', 'messages:*'];
      const readOnly = await request('POST', '/api/v2/login/device-key', { deviceName: 'host' }, bearer);
      expect(readOnly.status).toBe(200);
      const readOnlyKey = MintedKey.parse(await readOnly.json()).data;
      expect(readOnlyKey.scopes).toEqual(['events:read']);
      expect(
        (await asKey(readOnlyKey.apiKey, 'POST', '/api/v2/events/consumers', { name: 'ro', eventType: 'custom.*' }))
          .status,
      ).toBe(403);
      // A ceiling far wider than the host's set still gives exactly read-events and consume.
      const wider = { authorization: `Bearer ${await approvedDeviceToken()}` };
      login.config.deviceKeyScopes = ['events:*', 'messages:*', 'instances:*'];
      const minted = await request('POST', '/api/v2/login/device-key', { deviceName: 'host' }, wider);
      expect(minted.status).toBe(200);
      expect(MintedKey.parse(await minted.json()).data.scopes).toEqual(HOST_SCOPES);
    } finally {
      login.config.deviceKeyScopes = ceiling;
    }
    expect(login.config.deviceKeyScopes).toEqual([...DEFAULT_DEVICE_KEY_SCOPES]);
  });
});
