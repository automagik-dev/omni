/**
 * Pairing with nothing configured, over REAL PostgreSQL (wish: omni-labs-distribution):
 * no OMNI_LOGIN_ENABLED, no OMNI_PUBLIC_URL, no OMNI_AUTH_SECRET and no WhatsApp. The
 * operator claims with the boot claim token or an admin key, approves devices with
 * `omni approve`, hands out links with `omni connect`, and may link WhatsApp later.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { EventBus, TypedOmniEvent } from '@omni/core';
import { type Database, createDbHandle, globalSettings, loginUsers } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type Login, createLogin, ownerOf } from '../../login';
import { DEFAULT_DEVICE_KEY_SCOPES, claimTokenOf } from '../../login/config';
import { AUTH_SECRET_SETTING, resolveLoginDefaults } from '../../login/secret';
import type { OwnAccount, WhatsAppAccess } from '../../login/whatsapp';
import { handleConnectMessage, handleDeviceLoginMessage } from '../../plugins/device-login';
import { loginApiRoutes, loginAuthRoutes, loginPageRoutes } from '../../routes/v2/login';
import { ownerRoutes } from '../../routes/v2/owner';
import type { Services } from '../../services';
import type { AppVariables } from '../../types';
import { ApiKeyService } from '../api-keys';
import { SettingsService } from '../settings';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

/** The address the operator's server answers on: plain http on a private network, no fixed public URL. */
const ORIGIN = 'http://omni-box.tail.ts.net:8882';
const OWNER: OwnAccount = {
  instanceId: '33333333-3333-4333-8333-333333333333',
  instanceName: 'owner-whatsapp',
  phone: '5511977776666',
  selfJid: '5511977776666@s.whatsapp.net',
};
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const ADMIN_KEY_ID = '44444444-4444-4444-8444-444444444444';
type Json = Record<string, unknown>;

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

postgresDescribe('pairing with nothing configured (real PostgreSQL)', () => {
  const dbName = `omni_login_op_${crypto.randomUUID().replaceAll('-', '')}`;
  const saved: Record<string, string | undefined> = {};
  const ENV = [
    'OMNI_LOGIN_ENABLED',
    'OMNI_PUBLIC_URL',
    'OMNI_AUTH_SECRET',
    'OMNI_DEVICE_KEY_SCOPES',
    'OMNI_MULTITENANCY_ENABLED',
    'TRUSTED_PROXY_HEADER',
  ];
  let close: () => Promise<void>;
  let db: Database;
  let login: Login;
  let app: Hono;
  let secret: string | undefined;
  let linked: OwnAccount[] = [];
  const sent: { account: OwnAccount; text: string }[] = [];
  const events: { type: string; payload: Json }[] = [];
  let ip = 0;

  const whatsapp: WhatsAppAccess = {
    accounts: async () => linked,
    sendToSelf: async (account, _key, text) => {
      sent.push({ account, text });
    },
  };
  const eventBus = {
    publish: async (type: string, payload: Json) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID() };
    },
  } as unknown as EventBus;

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    if (path.endsWith('/send-code')) login.codeSends.clear();
    const response = await app.request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'x-forwarded-for': `203.0.113.${++ip % 250}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = ((await response.json().catch(() => null)) ?? {}) as Json;
    return { status: response.status, json, data: (json.data ?? json) as Json };
  }

  async function startDevice(clientId = 'omni-dsh') {
    const code = await call('POST', '/api/auth/device/code', { client_id: clientId });
    expect(code.status).toBe(200);
    return code.json as unknown as { device_code: string; user_code: string; verification_uri_complete: string };
  }
  const deviceToken = (deviceCode: string, clientId = 'omni-dsh') =>
    call('POST', '/api/auth/device/token', { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: clientId });
  async function deviceKey(deviceCode: string) {
    const granted = await deviceToken(deviceCode);
    const access = String(granted.json.access_token ?? '');
    expect(access).not.toBe('');
    return call('POST', '/api/v2/login/device-key', { deviceName: 'laptop' }, { authorization: `Bearer ${access}` });
  }
  /** Back to an Omni nobody owns, for the claim tests. */
  const unclaim = async () => {
    await db.delete(loginUsers);
  };

  const ownerSelfChat = (text: string) =>
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
          upsertType: 'notify',
          message: { conversation: text },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
      metadata: { correlationId: 'c', instanceId: OWNER.instanceId, channelType: 'whatsapp-baileys' },
    }) as TypedOmniEvent<'message.received'>;

  beforeAll(async () => {
    for (const key of ENV) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
    process.env.TRUSTED_PROXY_HEADER = 'x-forwarded-for';
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 4 });
    close = handle.close;
    db = handle.db;
    const defaults = await resolveLoginDefaults(db);
    secret = defaults.secret;
    const services = { apiKeys: new ApiKeyService(db) } as unknown as Services;
    const created = createLogin(db, services, eventBus, whatsapp, defaults);
    if (!created) throw new Error('login did not start with nothing configured');
    login = created;
    const root = new Hono<{ Variables: AppVariables }>();
    root.route('/api/auth', loginAuthRoutes(login));
    root.route('/api/v2/login', loginApiRoutes(login));
    root.route('/api/login', loginPageRoutes(login));
    // The admin key's request, past the auth and scope middleware (auth:admin; see zero-config.test.ts).
    root.use('/api/v2/owner/*', async (c, next) => {
      c.set('login', login);
      c.set('apiKey', { id: ADMIN_KEY_ID } as AppVariables['apiKey']);
      await next();
    });
    root.route('/api/v2/owner', ownerRoutes);
    app = root as unknown as Hono;
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

  test('login is on with nothing set; the generated secret is kept once and survives a restart', async () => {
    expect(secret).toHaveLength(43);
    expect(login.config.publicUrl).toBeNull();
    const [row] = await db.select().from(globalSettings).where(eq(globalSettings.key, AUTH_SECRET_SETTING));
    expect(row?.isSecret).toBe(true);
    // A restart (a new settings service) and a second replica read the same secret.
    expect((await resolveLoginDefaults(db)).secret).toBe(secret as string);
    expect(await new SettingsService(db).ensureGeneratedSecret(AUTH_SECRET_SETTING, () => 'other'.repeat(10))).toBe(
      secret as string,
    );

    const status = await call('GET', '/api/v2/login/status');
    expect(status.status).toBe(200);
    expect(status.data).toMatchObject({
      claimed: false,
      whatsapp: false,
      passkeys: false,
      deviceUrl: `${ORIGIN}/api/login/device`,
    });
    // Passkeys need a fixed URL: their Better Auth routes are not there.
    expect((await call('GET', '/api/auth/passkey/generate-authenticate-options')).status).toBe(404);
  });

  test("a device's links follow the address it asked on", async () => {
    const device = await startDevice();
    expect(device.verification_uri_complete.startsWith(`${ORIGIN}/api/login/device?user_code=`)).toBe(true);
  });

  test('an unknown code approves nothing and claims nothing', async () => {
    const answer = await call('POST', '/api/v2/owner/approve', { userCode: 'ABCD-EFGH' });
    expect(answer.status).toBe(404);
    expect(await ownerOf(login)).toBeNull();
  });

  test('omni approve on an unclaimed Omni claims it and lets the device in, with no WhatsApp', async () => {
    const device = await startDevice();
    const approved = await call('POST', '/api/v2/owner/approve', { userCode: device.user_code.toLowerCase() });
    expect(approved.status).toBe(200);
    expect(approved.data).toMatchObject({ approved: true, claimed: true, clientId: 'omni-dsh' });
    const owner = await ownerOf(login);
    expect(owner?.phone).toBeNull();
    expect(events.find((event) => event.type === 'access.owner_claimed')?.payload).toMatchObject({
      userId: owner?.id,
      via: 'operator',
      apiKeyId: ADMIN_KEY_ID,
    });
    expect(events.some((event) => event.type === 'access.device_code_approved')).toBe(true);

    const key = await deviceKey(device.device_code);
    expect(key.status).toBe(200);
    expect(key.data.scopes).toEqual([...DEFAULT_DEVICE_KEY_SCOPES]);
    expect(key.data.apiUrl).toBe(ORIGIN);
    // A device key can never reach the operator routes.
    expect(ApiKeyService.scopeAllows(key.data.scopes as string[], 'auth:admin')).toBe(false);
    // No WhatsApp anywhere: nothing went to a self chat.
    expect(sent).toHaveLength(0);

    // The second approval of the same code finds nothing waiting.
    expect((await call('POST', '/api/v2/owner/approve', { userCode: device.user_code })).status).toBe(404);
  });

  test('omni connect hands out a link that connects one device, once', async () => {
    const issued = await call('POST', '/api/v2/owner/connect', {});
    expect(issued.status).toBe(201);
    expect(issued.data.claimed).toBe(false);
    const url = String(issued.data.url);
    expect(url.startsWith(`${ORIGIN}/api/login/app?grant=`)).toBe(true);
    expect(String(issued.data.appLink)).toContain(encodeURIComponent(ORIGIN));
    const grant = new URL(url).searchParams.get('grant') ?? '';

    const connect = { grant, clientId: 'omni-dsh', deviceName: 'work laptop' };
    const first = await call('POST', '/api/v2/login/connect', connect);
    expect(first.status).toBe(200);
    expect(first.data.scopes).toEqual([...DEFAULT_DEVICE_KEY_SCOPES]);
    expect((await call('POST', '/api/v2/login/connect', connect)).status).toBe(410);

    // The operator can name the address devices use; a bad one is refused.
    const named = await call('POST', '/api/v2/owner/connect', { url: 'https://omni.example.com/' });
    expect(String(named.data.url).startsWith('https://omni.example.com/api/login/app?grant=')).toBe(true);
    expect((await call('POST', '/api/v2/owner/connect', { url: 'ftp://omni.example.com' })).status).toBe(400);
    expect(events.filter((event) => event.type === 'access.connect_link_issued').at(-1)?.payload).toMatchObject({
      via: 'operator',
    });
  });

  test('the claim token alone claims an unclaimed Omni; a wrong token or a claimed Omni does not', async () => {
    await unclaim();
    const token = { 'x-omni-claim-token': claimTokenOf(login.config) };
    expect((await call('POST', '/api/v2/login/claim/token', undefined, { 'x-omni-claim-token': 'nope' })).status).toBe(
      404,
    );
    const claimed = await call('POST', '/api/v2/login/claim/token', undefined, token);
    expect(claimed.status).toBe(201);
    expect((await ownerOf(login))?.phone).toBeNull();
    // It hands back the link `omni connect` prints: Automagik connects with it, once, with no other sign-in.
    const grant = new URL(String(claimed.data.url)).searchParams.get('grant') ?? '';
    expect(String(claimed.data.url).startsWith(`${ORIGIN}/api/login/app?grant=`)).toBe(true);
    expect(claimed.data.appLink).toBe(`omni://connect?url=${encodeURIComponent(ORIGIN)}&grant=${grant}`);
    expect(Date.parse(String(claimed.data.expiresAt))).toBeGreaterThan(Date.now());
    const connect = { grant, clientId: 'omni-dsh', deviceName: 'first laptop' };
    expect((await call('POST', '/api/v2/login/connect', connect)).status).toBe(200);
    expect((await call('POST', '/api/v2/login/connect', connect)).status).toBe(410);
    expect(events.filter((event) => event.type === 'access.connect_link_issued').at(-1)?.payload).toMatchObject({
      via: 'operator',
    });
    expect((await call('POST', '/api/v2/login/claim/token', undefined, token)).status).toBe(404);
    expect((await call('POST', '/api/v2/owner/claim')).data).toEqual({ claimed: false, whatsapp: false });
  });

  test('omni claim makes the admin key holder the owner of an unclaimed Omni', async () => {
    await unclaim();
    expect((await call('POST', '/api/v2/owner/claim')).data).toEqual({ claimed: true, whatsapp: false });
    expect((await call('POST', '/api/v2/owner/claim')).data).toEqual({ claimed: false, whatsapp: false });
  });

  test("before the owner links WhatsApp, nobody's self chat speaks for them", async () => {
    linked = [OWNER];
    expect(await handleConnectMessage(login, ownerSelfChat('connect'))).toBeNull();
    const device = await startDevice();
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`))).toBeNull();
  });

  test('WhatsApp linked later: the phone approves devices, and the link step closes', async () => {
    const token = { 'x-omni-claim-token': claimTokenOf(login.config) };
    const accounts = await call('GET', '/api/v2/login/claim/accounts', undefined, token);
    expect(accounts.status).toBe(200);
    const send = await call('POST', '/api/v2/login/claim/send-code', { instanceId: OWNER.instanceId }, token);
    expect(send.status).toBe(200);
    const code = sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);
    const verified = await call('POST', '/api/v2/login/claim/verify', { instanceId: OWNER.instanceId, code }, token);
    expect(verified.status).toBe(200);
    expect(verified.data).toEqual({ claimed: true, linked: true });
    expect((await ownerOf(login))?.phone).toBe(OWNER.phone);
    expect(events.some((event) => event.type === 'access.owner_whatsapp_linked')).toBe(true);
    expect((await call('GET', '/api/v2/login/status')).data).toMatchObject({ claimed: true, whatsapp: true });
    // Linked: the claim surface is closed, even with the token.
    expect((await call('GET', '/api/v2/login/claim/accounts', undefined, token)).status).toBe(404);

    // Approving from the phone works now.
    const device = await startDevice();
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`))).not.toBeNull();
    expect((await deviceKey(device.device_code)).status).toBe(200);

    // And "connect" answers, without a fixed address, with how to get a link.
    expect(await handleConnectMessage(login, ownerSelfChat('connect'))).toEqual({ needsAddress: true });
    expect(sent.at(-1)?.text).toContain('omni connect');
  });
});
