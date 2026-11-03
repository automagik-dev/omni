/**
 * An agent host pairs through the device flow as `omni-agent-host` and gets a key that reads
 * events and nothing else (#1461, owner decision 2026-11-03). Real PostgreSQL, the whole API
 * app (createApp): device code, the operator's `omni approve`, the token, the device key, and
 * then that key against the real routes. The key's secret is never printed.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Database, apiKeys, durableConsumers, omniEvents } from '@omni/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../app';
import type { Login } from '../login';
import { DEFAULT_DEVICE_KEY_SCOPES } from '../login/config';
import { ApiKeyService } from '../services/api-keys';
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

  test('pairs through the device flow and gets exactly read-events', async () => {
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
    expect(data.scopes).toEqual(['events:read']);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, agentKeyId));
    expect(row?.scopes).toEqual(['events:read']);
    expect(row?.description).toContain('agent host');

    // It validates itself with no auth scope (#1572) and sees the same set.
    const validated = await asAgentHost('POST', '/api/v2/auth/validate');
    expect(validated.status).toBe(200);
    expect(JSON.stringify(await validated.json())).toContain('"events:read"');
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

  test('lists and inspects consumers, but cannot pull, ack, stream, create or delete one', async () => {
    const listed = await asAgentHost('GET', '/api/v2/events/consumers');
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).toContain(consumer);
    expect((await asAgentHost('GET', `/api/v2/events/consumers/${consumer}`)).status).toBe(200);

    const [before] = await db.select().from(durableConsumers).where(eq(durableConsumers.name, consumer));
    for (const [method, path, body] of [
      ['POST', `/api/v2/events/consumers/${consumer}/pull`, undefined],
      ['POST', `/api/v2/events/consumers/${consumer}/ack`, { cursor: 0 }],
      ['GET', `/api/v2/events/consumers/${consumer}/stream`, undefined],
      ['POST', '/api/v2/events/consumers', { name: 'agent-host-own', eventType: 'custom.*' }],
      ['DELETE', `/api/v2/events/consumers/${consumer}`, undefined],
    ] as const) {
      expect({ method, path, status: (await asAgentHost(method, path, body)).status }).toEqual({
        method,
        path,
        status: 403,
      });
    }
    const [after] = await db.select().from(durableConsumers).where(eq(durableConsumers.name, consumer));
    expect(after).toEqual(before);
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
    expect(row?.scopes).toEqual(['events:read']);
  });

  test("the operator's ceiling narrows the key and never widens it", async () => {
    const ceiling = login.config.deviceKeyScopes;
    try {
      // A ceiling without events:read leaves the host nothing; its token is not spent.
      const token = await approvedDeviceToken();
      const bearer = { authorization: `Bearer ${token}` };
      login.config.deviceKeyScopes = ['messages:*', 'instances:read'];
      const refused = await request('POST', '/api/v2/login/device-key', { deviceName: 'host' }, bearer);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(await refused.json())).toContain('NO_DEVICE_SCOPES');
      // A ceiling far wider than the host's set still gives exactly read-events.
      login.config.deviceKeyScopes = ['events:*', 'messages:*', 'instances:*'];
      const minted = await request('POST', '/api/v2/login/device-key', { deviceName: 'host' }, bearer);
      expect(minted.status).toBe(200);
      expect(MintedKey.parse(await minted.json()).data.scopes).toEqual(['events:read']);
    } finally {
      login.config.deviceKeyScopes = ceiling;
    }
    expect(login.config.deviceKeyScopes).toEqual([...DEFAULT_DEVICE_KEY_SCOPES]);
  });
});
