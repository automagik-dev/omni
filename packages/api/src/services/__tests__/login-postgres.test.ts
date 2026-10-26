/**
 * Human login over REAL PostgreSQL (wish: omni-labs-distribution): Better Auth 1.7
 * on migration 0086's login_* tables, driven through the mounted routes exactly as a
 * browser and a device would, with WhatsApp replaced by a fake that records what
 * lands in the owner's self chat.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { TypedOmniEvent } from '@omni/core';
import { type Database, apiKeys, createDbHandle, loginVerifications } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, like, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { type Login, createLogin } from '../../login';
import { claimTokenOf } from '../../login/config';
import { isLiveGrant } from '../../login/connect';
import type { OwnAccount, WhatsAppAccess } from '../../login/whatsapp';
import { handleConnectMessage, handleDeviceLoginMessage, handleUpdateMessage } from '../../plugins/device-login';
import { loginApiRoutes, loginAuthRoutes, loginPageRoutes } from '../../routes/v2/login';
import type { Services } from '../../services';
import { createSystemUpdater } from '../../system/update';
import { ApiKeyService } from '../api-keys';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const ORIGIN = 'http://localhost:3999';
const OWNER: OwnAccount = {
  instanceId: '11111111-1111-4111-8111-111111111111',
  instanceName: 'owner-whatsapp',
  phone: '5511999990000',
  selfJid: '5511999990000@s.whatsapp.net',
};
const OTHER: OwnAccount = {
  instanceId: '22222222-2222-4222-8222-222222222222',
  instanceName: 'shop',
  phone: '5511988887777',
  selfJid: '5511988887777@s.whatsapp.net',
};
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
type Json = Record<string, unknown>;

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

postgresDescribe('human login (real PostgreSQL)', () => {
  const dbName = `omni_login_${crypto.randomUUID().replaceAll('-', '')}`;
  const saved: Record<string, string | undefined> = {};
  const ENV = [
    'OMNI_LOGIN_ENABLED',
    'OMNI_PUBLIC_URL',
    'OMNI_AUTH_SECRET',
    'OMNI_DEVICE_KEY_SCOPES',
    'TRUSTED_PROXY_HEADER',
  ];
  let close: () => Promise<void>;
  let db: Database;
  let login: Login;
  let app: Hono;
  const sent: { account: OwnAccount; text: string }[] = [];
  const jar = new Map<string, string>();
  let ip = 0;

  const whatsapp: WhatsAppAccess = {
    accounts: async () => [OWNER, OTHER],
    sendToSelf: async (account, _key, text) => {
      sent.push({ account, text });
    },
  };
  const lastCode = (account: OwnAccount) => {
    const message = [...sent].reverse().find((entry) => entry.account.phone === account.phone)?.text ?? '';
    return message.match(/\b(\d{6})\b/)?.[1] ?? '';
  };

  /** A request as a browser on the Omni's own origin would send it, with the cookie jar. */
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    // Each test asks for its own code; the one-a-minute cooldown has its own test.
    if (path.endsWith('/send-code') && !headers['x-keep-cooldown']) login.codeSends.clear();
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await app.request(`${ORIGIN}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': `198.51.100.${++ip % 250}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, ...value] = (pair ?? '').split('=');
      if (name) jar.set(name.trim(), value.join('='));
    }
    const json = ((await response.json().catch(() => null)) ?? {}) as Json;
    return { status: response.status, json, data: (json.data ?? json) as Json };
  }

  const ownerSelfChat = (text: string, upsertType = 'notify') =>
    ({
      id: crypto.randomUUID(),
      type: 'message.received',
      timestamp: Date.now(),
      payload: {
        externalId: `X${Date.now()}`,
        chatId: OWNER.selfJid,
        from: `${OWNER.phone}:12@s.whatsapp.net`,
        content: { type: 'text', text },
        rawPayload: {
          key: { remoteJid: OWNER.selfJid, fromMe: true, id: 'X' },
          isFromMe: true,
          upsertType,
          message: { conversation: text },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
      metadata: { correlationId: 'c', instanceId: OWNER.instanceId, channelType: 'whatsapp-baileys' },
    }) as TypedOmniEvent<'message.received'>;

  async function startDevice(clientId = 'omni-desktop') {
    const code = await call('POST', '/api/auth/device/code', { client_id: clientId }, { origin: '' });
    expect(code.status).toBe(200);
    return code.json as unknown as { device_code: string; user_code: string; verification_uri_complete: string };
  }
  const token = (deviceCode: string, clientId = 'omni-desktop') =>
    call(
      'POST',
      '/api/auth/device/token',
      { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: clientId },
      { origin: '' },
    );

  beforeAll(() => {
    for (const key of ENV) saved[key] = process.env[key];
    process.env.OMNI_LOGIN_ENABLED = 'true';
    process.env.OMNI_PUBLIC_URL = ORIGIN;
    process.env.OMNI_AUTH_SECRET = 'test-secret-test-secret-test-secret-42';
    process.env.OMNI_DEVICE_KEY_SCOPES = 'instances:read,chats:read';
    process.env.TRUSTED_PROXY_HEADER = 'x-forwarded-for';
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 4 });
    close = handle.close;
    db = handle.db;
    const services = { apiKeys: new ApiKeyService(db) } as unknown as Services;
    const created = createLogin(db, services, null, whatsapp);
    if (!created) throw new Error('login did not start');
    login = created;
    app = new Hono();
    app.route('/api/auth', loginAuthRoutes(login));
    app.route('/api/v2/login', loginApiRoutes(login));
    app.route('/api/login', loginPageRoutes(login));
  });

  afterAll(async () => {
    await close?.().catch(() => undefined);
    Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '--dbname',
        superUrl,
        '-c',
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`,
      ],
    });
    for (const key of ENV) {
      if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = saved[key];
    }
  });

  test('an unclaimed Omni says so, and claiming needs the claim token', async () => {
    expect((await call('GET', '/api/v2/login/status')).data).toMatchObject({ claimed: false, whatsapp: false });
    expect((await call('GET', '/api/v2/login/claim/accounts')).status).toBe(404);
    expect(
      (await call('GET', '/api/v2/login/claim/accounts', undefined, { 'x-omni-claim-token': 'wrong' })).status,
    ).toBe(404);
    const accounts = await call('GET', '/api/v2/login/claim/accounts', undefined, {
      'x-omni-claim-token': claimTokenOf(login.config),
    });
    expect(accounts.data as unknown).toEqual([
      { instanceId: OWNER.instanceId, name: 'owner-whatsapp', phone: '+55 11 •••• 0000' },
      { instanceId: OTHER.instanceId, name: 'shop', phone: '+55 11 •••• 7777' },
    ]);
  });

  test('Better Auth paths outside the allowlist do not exist', async () => {
    expect((await call('POST', '/api/auth/phone-number/send-otp', { phoneNumber: `+${OWNER.phone}` })).status).toBe(
      404,
    );
    expect((await call('POST', '/api/auth/sign-up/email', { email: 'a@b.c', password: 'x', name: 'x' })).status).toBe(
      404,
    );
  });

  test("the code goes to the self chat; the right code claims, and the Omni is the claimer's alone", async () => {
    const claim = { 'x-omni-claim-token': claimTokenOf(login.config) };
    const send = await call('POST', '/api/v2/login/claim/send-code', { instanceId: OWNER.instanceId }, claim);
    expect(send.data).toEqual({ sentTo: '+55 11 •••• 0000' });
    expect(sent.at(-1)?.account.phone).toBe(OWNER.phone);
    const code = lastCode(OWNER);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = code === '000000' ? '111111' : '000000';
    expect(
      (await call('POST', '/api/v2/login/claim/verify', { instanceId: OWNER.instanceId, code: wrong }, claim)).status,
    ).toBe(400);
    const verified = await call('POST', '/api/v2/login/claim/verify', { instanceId: OWNER.instanceId, code }, claim);
    expect(verified.status).toBe(200);
    expect([...jar.keys()].some((name) => name.includes('session_token'))).toBe(true);

    const status = await call('GET', '/api/v2/login/status');
    expect(status.data).toMatchObject({ claimed: true, whatsapp: true });
    // The owner's number is never listed on the public status.
    expect(JSON.stringify(status.json)).not.toContain(OWNER.phone);
    // Claimed: the claim surface is gone, even with the token.
    expect((await call('GET', '/api/v2/login/claim/accounts', undefined, claim)).status).toBe(404);
    expect((await call('POST', '/api/v2/login/claim/send-code', { instanceId: OTHER.instanceId }, claim)).status).toBe(
      404,
    );
  });

  test('a device approved by a code the owner sends to themselves gets one key, once', async () => {
    const device = await startDevice();
    expect(device.verification_uri_complete).toContain(`${ORIGIN}/api/login/device`);
    expect((await token(device.device_code)).json?.error).toBe('authorization_pending');

    // Omni's own send of the code ('append') approves nothing.
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`, 'append'))).toBeNull();
    // A code inside a longer message approves nothing.
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`please approve ${device.user_code}`))).toBeNull();

    const approved = await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`));
    expect(approved).toMatchObject({ clientId: 'omni-desktop' });
    expect(sent.at(-1)?.text).toContain('The Automagik app is now connected to your Omni.');
    // The same message again does nothing.
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`))).toBeNull();

    await new Promise((done) => setTimeout(done, 2100));
    const granted = await token(device.device_code);
    expect(granted.status).toBe(200);
    const accessToken = String(granted.json.access_token);

    const bearer = { authorization: `Bearer ${accessToken}`, cookie: '' };
    // The device token is no session against Better Auth's own endpoints.
    expect((await call('GET', '/api/auth/get-session', undefined, bearer)).json).toEqual({});
    expect(
      (await call('GET', '/api/auth/passkey/generate-register-options', undefined, bearer)).status,
    ).toBeGreaterThanOrEqual(400);
    // The owner's browser session is not a device token.
    const browserToken = [...jar].find(([name]) => name.includes('session_token'))?.[1] ?? '';
    expect(browserToken).not.toBe('');
    const asBrowser = { authorization: `Bearer ${decodeURIComponent(browserToken)}`, cookie: '' };
    expect((await call('POST', '/api/v2/login/device-key', { deviceName: 'Sneaky' }, asBrowser)).status).toBe(401);

    const key = await call('POST', '/api/v2/login/device-key', { deviceName: 'Test laptop' }, bearer);
    expect(key.status).toBe(200);
    const minted = key.data as { apiKey: string; keyId: string; keyExpiresAt: string | null };
    expect(minted.apiKey).toMatch(/^omni_sk_/);
    expect(minted.keyExpiresAt).toBeNull();
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, minted.keyId));
    expect(row?.scopes).toEqual(['instances:read', 'chats:read']);
    expect(row?.expiresAt).toBeNull();
    expect(row?.name).toBe('device: Test laptop');
    expect(row?.description).toContain('the Automagik app');

    // The device token works once.
    expect((await call('POST', '/api/v2/login/device-key', { deviceName: 'Again' }, bearer)).status).toBe(401);
  });

  test('Unfold gets its scopes under the ceiling, plus an agent key, in the same one-time exchange', async () => {
    const device = await startDevice('unfold');
    const approved = await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`));
    expect(approved).toMatchObject({ clientId: 'unfold' });
    expect(sent.at(-1)?.text).toContain('Unfold is now connected to your Omni.');

    await new Promise((done) => setTimeout(done, 2100));
    const granted = await token(device.device_code, 'unfold');
    expect(granted.status).toBe(200);
    const bearer = { authorization: `Bearer ${String(granted.json.access_token)}`, cookie: '' };

    const key = await call('POST', '/api/v2/login/device-key', { deviceName: 'Test Mac' }, bearer);
    expect(key.status).toBe(200);
    const minted = key.data as {
      keyId: string;
      scopes: string[];
      companions: { name: string; apiKey: string; keyId: string; scopes: string[] }[];
    };
    // This suite's ceiling is instances:read,chats:read: Unfold's instances:* narrows to it.
    expect(minted.scopes).toEqual(['instances:read', 'chats:read']);
    expect(minted.companions).toHaveLength(1);
    const agent = minted.companions[0];
    expect(agent?.name).toBe('agent');
    expect(agent?.apiKey).toMatch(/^omni_sk_/);
    expect(agent?.keyId).not.toBe(minted.keyId);
    expect(agent?.scopes).toEqual(['instances:read']);

    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, agent?.keyId ?? ''));
    expect(row?.scopes).toEqual(['instances:read']);
    expect(row?.name).toBe('device: Test Mac (agent)');
    expect(row?.description).toContain(minted.keyId);

    // Spent: no second pair.
    expect((await call('POST', '/api/v2/login/device-key', { deviceName: 'Again' }, bearer)).status).toBe(401);
  });

  test('a ceiling that leaves Unfold nothing is refused before the token is spent', async () => {
    const device = await startDevice('unfold');
    await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`));
    await new Promise((done) => setTimeout(done, 2100));
    const granted = await token(device.device_code, 'unfold');
    const bearer = { authorization: `Bearer ${String(granted.json.access_token)}`, cookie: '' };
    const ceiling = login.config.deviceKeyScopes;
    login.config.deviceKeyScopes = ['tts:synthesize'];
    try {
      const refused = await call('POST', '/api/v2/login/device-key', { deviceName: 'Mac' }, bearer);
      expect(refused.status).toBe(403);
      expect((refused.json.error as Json)?.code).toBe('NO_DEVICE_SCOPES');
    } finally {
      login.config.deviceKeyScopes = ceiling;
    }
    // The same token still works once the ceiling allows it.
    expect((await call('POST', '/api/v2/login/device-key', { deviceName: 'Mac' }, bearer)).status).toBe(200);
  });

  test('an older client keeps its single key and gets no companions', async () => {
    const device = await startDevice('omni-dsh');
    await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`));
    await new Promise((done) => setTimeout(done, 2100));
    const granted = await token(device.device_code, 'omni-dsh');
    const bearer = { authorization: `Bearer ${String(granted.json.access_token)}`, cookie: '' };
    const key = await call('POST', '/api/v2/login/device-key', { deviceName: 'DSH' }, bearer);
    expect(key.status).toBe(200);
    expect(key.data).toMatchObject({ scopes: ['instances:read', 'chats:read'], companions: [] });
  });

  /** The owner's "connect", or the same message changed by `change` (another chat, an old one...). */
  const connectMessage = (change: (event: TypedOmniEvent<'message.received'>) => void = () => {}) => {
    const event = ownerSelfChat('connect');
    change(event);
    return event;
  };
  const rawOf = (event: TypedOmniEvent<'message.received'>) => event.payload.rawPayload as Record<string, unknown>;
  const grantOf = (url: string) => new URL(url).searchParams.get('grant') ?? '';

  test('"connect" in the owner\'s self chat answers with a link that connects one device, once', async () => {
    login.connectLinks.clear();
    // Omni's own send, someone else, another account's self chat, another chat: no link.
    expect(await handleConnectMessage(login, ownerSelfChat('connect', 'append'))).toBeNull();
    expect(
      await handleConnectMessage(
        login,
        connectMessage((event) => {
          rawOf(event).key = { remoteJid: OWNER.selfJid, fromMe: false, id: 'X' };
          rawOf(event).isFromMe = false;
        }),
      ),
    ).toBeNull();
    expect(
      await handleConnectMessage(
        login,
        connectMessage((event) => {
          event.metadata.instanceId = OTHER.instanceId;
          event.payload.chatId = OTHER.selfJid;
          rawOf(event).key = { remoteJid: OTHER.selfJid, fromMe: true, id: 'X' };
        }),
      ),
    ).toBeNull();
    expect(
      await handleConnectMessage(
        login,
        connectMessage((event) => {
          event.payload.chatId = '5511900001111@s.whatsapp.net';
          rawOf(event).key = { remoteJid: '5511900001111@s.whatsapp.net', fromMe: true, id: 'X' };
        }),
      ),
    ).toBeNull();
    // A "connect" from minutes ago (a replayed event) gets nothing either.
    expect(
      await handleConnectMessage(
        login,
        connectMessage((event) => {
          rawOf(event).messageTimestamp = Math.floor(Date.now() / 1000) - 300;
        }),
      ),
    ).toBeNull();

    const before = sent.length;
    const link = await handleConnectMessage(login, connectMessage());
    if (!link || !('url' in link)) throw new Error('no link');
    expect(link.url.startsWith(`${ORIGIN}/api/login/app?grant=`)).toBe(true);
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)?.account.phone).toBe(OWNER.phone);
    expect(sent.at(-1)?.text).toContain(link.url);
    const grant = grantOf(link.url);
    expect(grant).toMatch(/^[A-Za-z0-9_-]{24}$/);
    // Only a hash is stored.
    const stored = await db
      .select()
      .from(loginVerifications)
      .where(like(loginVerifications.identifier, 'omni-connect:%'));
    expect(JSON.stringify(stored)).not.toContain(grant);

    // Opening the page (or WhatsApp's link preview) does not spend the grant.
    for (let i = 0; i < 2; i++) {
      const page = await (await app.request(link.url)).text();
      expect(page).toContain(`const grant = ${JSON.stringify(grant)};`);
    }
    expect(await (await app.request(`${ORIGIN}/api/login/app?grant=${'A'.repeat(24)}`)).text()).toContain(
      'This link expired',
    );

    expect(
      (await call('POST', '/api/v2/login/connect', { grant, clientId: 'evil', deviceName: 'Laptop' })).status,
    ).toBe(400);
    const connected = await call('POST', '/api/v2/login/connect', {
      grant,
      clientId: 'omni-desktop',
      deviceName: 'Connect laptop',
    });
    expect(connected.status).toBe(200);
    const minted = connected.data as { apiKey: string; keyId: string; apiUrl: string };
    expect(minted.apiKey).toMatch(/^omni_sk_/);
    expect(minted.apiUrl).toBe(ORIGIN);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, minted.keyId));
    expect(row?.name).toBe('device: Connect laptop');
    expect(row?.scopes).toEqual(['instances:read', 'chats:read']);
    expect(sent.at(-1)?.text).toContain('The Automagik app is now connected to your Omni.');

    // Once: the same grant again, and its page, say it expired.
    const again = await call('POST', '/api/v2/login/connect', { grant, clientId: 'omni-desktop', deviceName: 'Again' });
    expect(again.status).toBe(410);
    expect((again.json.error as Json).code).toBe('LINK_EXPIRED');
    expect(await (await app.request(link.url)).text()).toContain('This link expired');
  });

  test('connect links expire, a new one retires the oldest, and a self chat waits after a few', async () => {
    login.connectLinks.clear();
    const issue = async () => {
      const link = await handleConnectMessage(login, connectMessage());
      if (!link || !('url' in link)) throw new Error('no link');
      return grantOf(link.url);
    };
    const old = await issue();
    await db
      .update(loginVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(loginVerifications.identifier, 'omni-connect:%'));
    expect(await isLiveGrant(login, old)).toBe(false);
    expect(
      (await call('POST', '/api/v2/login/connect', { grant: old, clientId: 'omni-dsh', deviceName: 'Late' })).status,
    ).toBe(410);

    const grants = [await issue(), await issue(), await issue(), await issue()];
    expect(await Promise.all(grants.map((grant) => isLiveGrant(login, grant)))).toEqual([false, true, true, true]);

    // Five links in ten minutes, then a "wait" instead of a sixth.
    const wait = await handleConnectMessage(login, connectMessage());
    expect(wait).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    expect(sent.at(-1)?.text).toContain('Wait');
    expect(await isLiveGrant(login, grants[3] ?? '')).toBe(true);
  });

  test("an update starts only on the owner's own update code, in their self chat, once", async () => {
    const spawned: string[][] = [];
    const updater = createSystemUpdater({
      version: '2.261023.7',
      login,
      eventBus: null,
      env: {
        OMNI_UPDATE_COMMAND: 'omni update --yes',
        OMNI_UPDATE_STATE_DIR: `/tmp/omni-update-${crypto.randomUUID()}`,
      },
      fetch: async () => new Response(JSON.stringify({ latest: '2.261023.8' })),
      spawn: (command, args) => {
        spawned.push([command, ...args]);
        return { onError: () => {}, onExit: () => {}, unref: () => {} };
      },
    });
    expect(await updater.request('2.261023.8', 'key-1')).toMatchObject({ ok: true });
    const code = sent.at(-1)?.text.match(/^update ([A-Z0-9]{6})$/m)?.[1] ?? '';
    expect(sent.at(-1)?.account.phone).toBe(OWNER.phone);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    // Only a hash is stored.
    const stored = await db
      .select()
      .from(loginVerifications)
      .where(like(loginVerifications.identifier, 'omni-update:%'));
    expect(stored.length).toBe(1);
    expect(JSON.stringify(stored)).not.toContain(code);

    const message = (change: (event: TypedOmniEvent<'message.received'>) => void = () => {}) => {
      const event = ownerSelfChat(`update ${code}`);
      change(event);
      return event;
    };
    // Omni's own send, someone else, another account's self chat, another chat: nothing starts.
    expect(await handleUpdateMessage(login, updater, ownerSelfChat(`update ${code}`, 'append'))).toBeNull();
    expect(
      await handleUpdateMessage(
        login,
        updater,
        message((event) => {
          rawOf(event).key = { remoteJid: OWNER.selfJid, fromMe: false, id: 'X' };
          rawOf(event).isFromMe = false;
        }),
      ),
    ).toBeNull();
    expect(
      await handleUpdateMessage(
        login,
        updater,
        message((event) => {
          event.metadata.instanceId = OTHER.instanceId;
          event.payload.chatId = OTHER.selfJid;
          rawOf(event).key = { remoteJid: OTHER.selfJid, fromMe: true, id: 'X' };
        }),
      ),
    ).toBeNull();
    expect(
      await handleUpdateMessage(
        login,
        updater,
        message((event) => {
          event.payload.chatId = '5511900001111@s.whatsapp.net';
          rawOf(event).key = { remoteJid: '5511900001111@s.whatsapp.net', fromMe: true, id: 'X' };
        }),
      ),
    ).toBeNull();
    expect(spawned).toEqual([]);

    expect(await handleUpdateMessage(login, updater, message())).toBe('started');
    expect(spawned).toEqual([['omni', 'update', '--yes']]);
    expect(await handleUpdateMessage(login, updater, message())).toBeNull();
    expect(spawned.length).toBe(1);
  });

  test('an update code expires with its request', async () => {
    const updater = createSystemUpdater({
      version: '2.261023.7',
      login,
      eventBus: null,
      env: {
        OMNI_UPDATE_COMMAND: 'omni update --yes',
        OMNI_UPDATE_STATE_DIR: `/tmp/omni-update-${crypto.randomUUID()}`,
      },
      fetch: async () => new Response(JSON.stringify({ latest: '2.261023.8' })),
      spawn: () => {
        throw new Error('must not run');
      },
    });
    expect(await updater.request('2.261023.8', 'key-1')).toMatchObject({ ok: true });
    const code = sent.at(-1)?.text.match(/^update ([A-Z0-9]{6})$/m)?.[1] ?? '';
    await db
      .update(loginVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(loginVerifications.identifier, 'omni-update:%'));
    expect(await updater.status()).not.toHaveProperty('pending');
    expect(await handleUpdateMessage(login, updater, ownerSelfChat(`update ${code}`))).toBeNull();
    // An expired request no longer blocks a new one.
    expect(await updater.request('2.261023.8', 'key-1')).toMatchObject({ ok: true });
  });

  test('a device approved on the web page after the owner signs in with a WhatsApp code', async () => {
    jar.clear();
    const device = await startDevice();
    // Not signed in: approving fails.
    expect(
      (await call('POST', '/api/auth/device/approve', { userCode: device.user_code })).status,
    ).toBeGreaterThanOrEqual(400);

    expect((await call('POST', '/api/v2/login/send-code')).data).toEqual({ sentTo: '+55 11 •••• 0000' });
    expect((await call('POST', '/api/v2/login/verify', { code: lastCode(OWNER) })).status).toBe(200);

    const shown = await call('GET', `/api/auth/device?user_code=${encodeURIComponent(device.user_code)}`);
    expect(shown.status).toBe(200);
    expect((await call('POST', '/api/auth/device/approve', { userCode: device.user_code })).status).toBe(200);
    await new Promise((done) => setTimeout(done, 2100));
    expect((await token(device.device_code)).status).toBe(200);
  });

  test('another connected number cannot become a second user', async () => {
    jar.clear();
    // Better Auth's own verify endpoint is not public, and the owner code only ever goes to the owner.
    expect(
      (await call('POST', '/api/auth/phone-number/verify', { phoneNumber: `+${OTHER.phone}`, code: '123456' })).status,
    ).toBe(404);
    await call('POST', '/api/v2/login/send-code');
    expect(sent.at(-1)?.account.phone).toBe(OWNER.phone);
    await expect(
      login.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: `+${OTHER.phone}` } }).then(async () =>
        login.auth.api.verifyPhoneNumber({
          body: { phoneNumber: `+${OTHER.phone}`, code: lastCode(OTHER) },
          returnHeaders: true,
        }),
      ),
    ).rejects.toThrow();
  });

  test('the pages are served, and a passkey can be set up from a signed-in session', async () => {
    const claimPage = await app.request(`${ORIGIN}/api/login/claim`);
    expect(claimPage.status).toBe(200);
    const claimHtml = await claimPage.text();
    expect(claimHtml).toContain('Make this Omni yours');
    // Buttons are display:block; hidden ones must still hide.
    expect(claimHtml).toContain('[hidden]{display:none!important}');
    expect((await app.request(`${ORIGIN}/api/login/device`)).status).toBe(200);

    await call('POST', '/api/v2/login/send-code');
    await call('POST', '/api/v2/login/verify', { code: lastCode(OWNER) });
    const options = await call('GET', '/api/auth/passkey/generate-register-options');
    expect(options.status).toBe(200);
    expect(options.json.rp).toMatchObject({ id: 'localhost', name: 'Omni' });
  });

  test("a device's QR opens the owner's WhatsApp only for a live request", async () => {
    const device = await startDevice();
    const hop = await app.request(`${ORIGIN}/api/login/whatsapp?user_code=${device.user_code}`, {
      headers: { 'x-forwarded-for': '198.51.100.201' },
    });
    expect(hop.status).toBe(302);
    const shown = `${device.user_code.slice(0, 4)}-${device.user_code.slice(4)}`;
    expect(hop.headers.get('location')).toBe(
      `https://wa.me/${OWNER.phone}?text=${encodeURIComponent(`Omni ${shown}`)}`,
    );
    const unknown = await app.request(`${ORIGIN}/api/login/whatsapp?user_code=ABCDEFGH`, {
      headers: { 'x-forwarded-for': '198.51.100.202' },
    });
    expect(unknown.status).toBe(404);
  });

  test('one login code a minute per number, whoever asks', async () => {
    expect((await call('POST', '/api/v2/login/send-code')).status).toBe(200);
    const again = await call('POST', '/api/v2/login/send-code', undefined, { 'x-keep-cooldown': '1' });
    expect(again.status).toBe(429);
  });

  test('the database refuses a second owner even if the application check is raced', async () => {
    const second = async () => {
      await db.execute(
        sql`INSERT INTO login_users (id, name, email, created_at, updated_at) VALUES ('second', 'x', 'x@y.invalid', now(), now())`,
      );
    };
    await expect(second()).rejects.toThrow();
  });
});
