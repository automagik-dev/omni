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
import { type Database, apiKeys, createDbHandle } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type Login, createLogin } from '../../login';
import { claimTokenOf } from '../../login/config';
import type { OwnAccount, WhatsAppAccess } from '../../login/whatsapp';
import { handleDeviceLoginMessage } from '../../plugins/device-login';
import { loginApiRoutes, loginAuthRoutes, loginPageRoutes } from '../../routes/v2/login';
import type { Services } from '../../services';
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

  async function startDevice() {
    const code = await call('POST', '/api/auth/device/code', { client_id: 'omni-desktop' }, { origin: '' });
    expect(code.status).toBe(200);
    return code.json as unknown as { device_code: string; user_code: string; verification_uri_complete: string };
  }
  const token = (deviceCode: string) =>
    call(
      'POST',
      '/api/auth/device/token',
      { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: 'omni-desktop' },
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
    app.route('/login', loginPageRoutes(login));
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
    expect((await call('GET', '/api/v2/login/status')).data).toMatchObject({ claimed: false, whatsapp: null });
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
    expect(status.data).toMatchObject({ claimed: true, whatsapp: `+${OWNER.phone}` });
    // Claimed: the claim surface is gone, even with the token.
    expect((await call('GET', '/api/v2/login/claim/accounts', undefined, claim)).status).toBe(404);
    expect((await call('POST', '/api/v2/login/claim/send-code', { instanceId: OTHER.instanceId }, claim)).status).toBe(
      404,
    );
  });

  test('a device approved by a code the owner sends to themselves gets one key, once', async () => {
    const device = await startDevice();
    expect(device.verification_uri_complete).toContain(`${ORIGIN}/login/device`);
    expect((await token(device.device_code)).json?.error).toBe('authorization_pending');

    // Omni's own send of the code ('append') approves nothing.
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`, 'append'))).toBeNull();
    // A code inside a longer message approves nothing.
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`please approve ${device.user_code}`))).toBeNull();

    const approved = await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`));
    expect(approved).toMatchObject({ clientId: 'omni-desktop' });
    expect(sent.at(-1)?.text).toContain('approved the Omni desktop app');
    // The same message again does nothing.
    expect(await handleDeviceLoginMessage(login, ownerSelfChat(`Omni ${device.user_code}`))).toBeNull();

    await new Promise((done) => setTimeout(done, 2100));
    const granted = await token(device.device_code);
    expect(granted.status).toBe(200);
    const accessToken = String(granted.json.access_token);

    const bearer = { authorization: `Bearer ${accessToken}`, 'x-omni-client': 'omni-desktop', cookie: '' };
    const key = await call('POST', '/api/v2/login/device-key', { deviceName: 'Test laptop' }, bearer);
    expect(key.status).toBe(200);
    const minted = key.data as { apiKey: string; keyId: string; keyExpiresAt: string | null };
    expect(minted.apiKey).toMatch(/^omni_sk_/);
    expect(minted.keyExpiresAt).toBeNull();
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, minted.keyId));
    expect(row?.scopes).toEqual(['instances:read', 'chats:read']);
    expect(row?.expiresAt).toBeNull();
    expect(row?.name).toBe('device: Test laptop');

    // The device token works once.
    expect((await call('POST', '/api/v2/login/device-key', { deviceName: 'Again' }, bearer)).status).toBe(401);
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
    const claimPage = await app.request(`${ORIGIN}/login/claim`);
    expect(claimPage.status).toBe(200);
    expect(await claimPage.text()).toContain('Welcome to your Omni');
    expect((await app.request(`${ORIGIN}/login/device`)).status).toBe(200);

    await call('POST', '/api/v2/login/send-code');
    await call('POST', '/api/v2/login/verify', { code: lastCode(OWNER) });
    const options = await call('GET', '/api/auth/passkey/generate-register-options');
    expect(options.status).toBe(200);
    expect(options.json.rp).toMatchObject({ id: 'localhost', name: 'Omni' });
  });
});
