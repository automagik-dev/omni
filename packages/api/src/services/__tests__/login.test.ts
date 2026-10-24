/**
 * Human login without a database (wish: omni-labs-distribution): configuration,
 * the claim token, the device code a WhatsApp message carries, the owner's
 * self-chat rule, and every login route answering a bare 404 when login is off.
 * The flows themselves run against real PostgreSQL in login-postgres.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import type { TypedOmniEvent } from '@omni/core';
import { Hono } from 'hono';
import { phoneDigits } from '../../lib/phone';
import type { Login } from '../../login';
import { claimTokenOf, isDeviceClient, readLoginConfig } from '../../login/config';
import { LINKS_PER_WINDOW, LINK_WINDOW_MS, allowConnectLink, isConnectRequest } from '../../login/connect';
import { appPage } from '../../login/pages';
import { maskPhone } from '../../login/whatsapp';
import { isOwnerSelfChatText, userCodeInMessage } from '../../plugins/device-login';
import { landingRoutes, loginApiRoutes, loginAuthRoutes, loginPageRoutes } from '../../routes/v2/login';

const SELF = '5511999990000@s.whatsapp.net';
const ON = {
  OMNI_LOGIN_ENABLED: 'true',
  OMNI_PUBLIC_URL: 'https://omni.example.com/',
  OMNI_AUTH_SECRET: 'x'.repeat(40),
};

describe('readLoginConfig', () => {
  test('is on with nothing set, off only when switched off, and always off with multitenancy', () => {
    expect(readLoginConfig({}, { secret: 's'.repeat(43) })).toMatchObject({ enabled: true, publicUrl: null });
    expect(readLoginConfig({ OMNI_LOGIN_ENABLED: 'false' }, { secret: 's'.repeat(43) })).toBeNull();
    expect(readLoginConfig({ OMNI_LOGIN_ENABLED: 'FALSE' })).toBeNull();
    expect(readLoginConfig({ ...ON, OMNI_MULTITENANCY_ENABLED: 'true' })).toBeNull();
  });

  test('reads the public URL, secret and device-key settings', () => {
    expect(readLoginConfig(ON)).toEqual({
      enabled: true,
      publicUrl: 'https://omni.example.com',
      secret: 'x'.repeat(40),
      deviceKeyScopes: ['instances:*', 'chats:*', 'messages:*', 'events:*', 'system:read', 'system:update'],
      deviceKeyTtlDays: null,
    });
    expect(
      readLoginConfig({ ...ON, OMNI_DEVICE_KEY_SCOPES: 'instances:read', OMNI_DEVICE_KEY_TTL_DAYS: '30' }),
    ).toMatchObject({
      deviceKeyScopes: ['instances:read'],
      deviceKeyTtlDays: 30,
    });
  });

  test('takes the generated secret and the stored public URL when the environment has neither', () => {
    expect(readLoginConfig({}, { secret: 'g'.repeat(43), publicUrl: 'http://omni.tail.ts.net:8882' })).toMatchObject({
      secret: 'g'.repeat(43),
      publicUrl: 'http://omni.tail.ts.net:8882',
    });
    // The environment wins over both.
    expect(readLoginConfig(ON, { secret: 'g'.repeat(43), publicUrl: 'http://other' })).toMatchObject({
      secret: 'x'.repeat(40),
      publicUrl: 'https://omni.example.com',
    });
  });

  test('refuses a short or missing secret, a URL with a path, and scopes that govern Omni itself', () => {
    expect(() => readLoginConfig({ ...ON, OMNI_AUTH_SECRET: 'short' })).toThrow();
    expect(() => readLoginConfig({})).toThrow();
    expect(() => readLoginConfig({ ...ON, OMNI_PUBLIC_URL: 'https://omni.example.com/app' })).toThrow();
    expect(() => readLoginConfig({ ...ON, OMNI_PUBLIC_URL: 'ftp://omni.example.com' })).toThrow();
    for (const scopes of [
      '*',
      'keys:write',
      'instances:read,platform:admin',
      'settings:write',
      'auth:admin',
      'trust:write',
      'audit:read',
    ]) {
      expect(() => readLoginConfig({ ...ON, OMNI_DEVICE_KEY_SCOPES: scopes })).toThrow();
    }
  });

  test('the claim token follows the secret and nothing else', () => {
    const config = readLoginConfig(ON);
    if (!config) throw new Error('unreachable');
    expect(claimTokenOf(config)).toBe(claimTokenOf(config));
    expect(claimTokenOf(config)).toHaveLength(24);
    expect(claimTokenOf({ secret: 'y'.repeat(40) })).not.toBe(claimTokenOf(config));
  });

  test('only the known device clients', () => {
    expect(['omni-desktop', 'omni-dsh', 'omni-cli'].every(isDeviceClient)).toBe(true);
    expect(isDeviceClient('evil')).toBe(false);
  });
});

describe('phones', () => {
  test('digits of a phone address, never of a LID or group', () => {
    expect(phoneDigits('+55 11 99999-0000')).toBe('5511999990000');
    expect(phoneDigits('5511999990000:12@s.whatsapp.net')).toBe('5511999990000');
    expect(phoneDigits('100000001234567@lid')).toBeNull();
    expect(phoneDigits('120363000000000000@g.us')).toBeNull();
    expect(phoneDigits(undefined)).toBeNull();
    expect(maskPhone('5511999990000')).toBe('+55 11 •••• 0000');
  });
});

describe('userCodeInMessage', () => {
  test('a message is a device code only when it is nothing but the code', () => {
    expect(userCodeInMessage('K7Q4-X9ZP')).toBe('K7Q4X9ZP');
    expect(userCodeInMessage('Omni K7Q4-X9ZP')).toBe('K7Q4X9ZP');
    expect(userCodeInMessage(' omni: k7q4 x9zp ')).toBe('K7Q4X9ZP');
    expect(userCodeInMessage('please approve K7Q4-X9ZP')).toBeNull();
    expect(userCodeInMessage('K7Q4-X9ZP thanks')).toBeNull();
    // Better Auth's alphabet has no 0, 1, I or O.
    expect(userCodeInMessage('K7Q4-X9Z0')).toBeNull();
    expect(userCodeInMessage(undefined)).toBeNull();
  });
});

function received(
  raw: Record<string, unknown> = {},
  chatId = SELF,
  replyToId?: string,
): TypedOmniEvent<'message.received'> {
  return {
    id: 'e',
    type: 'message.received',
    timestamp: Date.now(),
    payload: {
      externalId: 'X',
      chatId,
      from: '5511999990000:12@s.whatsapp.net',
      content: { type: 'text', text: 'Omni K7Q4-X9ZP' },
      ...(replyToId ? { replyToId } : {}),
      rawPayload: {
        key: { remoteJid: chatId, fromMe: true, id: 'X' },
        isFromMe: true,
        upsertType: 'notify',
        message: { conversation: 'Omni K7Q4-X9ZP' },
        ...raw,
      },
    },
    metadata: { correlationId: 'c', instanceId: 'i', channelType: 'whatsapp-baileys' },
  } as TypedOmniEvent<'message.received'>;
}

describe('isOwnerSelfChatText', () => {
  test('the owner typing in their own self chat, on one of their devices', () => {
    expect(isOwnerSelfChatText(received(), SELF)).toBe(true);
  });

  test("a self chat addressed by the account's LID counts, with the phone JID beside it", () => {
    const lid = '100000000000001@lid';
    expect(
      isOwnerSelfChatText(received({ key: { remoteJid: lid, remoteJidAlt: SELF, fromMe: true } }, lid), SELF),
    ).toBe(true);
    expect(
      isOwnerSelfChatText(
        received({ key: { remoteJid: lid, remoteJidAlt: '5511900001111@s.whatsapp.net', fromMe: true } }, lid),
        SELF,
      ),
    ).toBe(false);
  });

  test('anything else is not', () => {
    const cases = [
      received({}, '5511900001111@s.whatsapp.net'),
      received({ key: { remoteJid: SELF, fromMe: false }, isFromMe: false }),
      received({ upsertType: 'append' }),
      received({ upsertType: undefined }),
      received({ isHistorySync: true }),
      received({}, SELF, 'OLDER'),
      received({ quotedMessage: { conversation: 'x' } }),
      received({ message: { extendedTextMessage: { text: 'x', contextInfo: { isForwarded: true } } } }),
      received({ message: { protocolMessage: { type: 14 } } }),
    ];
    for (const event of cases) expect(isOwnerSelfChatText(event, SELF)).toBe(false);
    expect(isOwnerSelfChatText(received(), null)).toBe(false);
  });
});

describe('login off', () => {
  test('every login route answers a bare 404, with no rate-limit headers', async () => {
    const app = new Hono();
    app.route('/api/auth', loginAuthRoutes(null));
    app.route('/api/v2/login', loginApiRoutes(null));
    app.route('/api/login', loginPageRoutes(null));
    for (const [method, path] of [
      ['POST', '/api/auth/device/code'],
      ['GET', '/api/auth/get-session'],
      ['GET', '/api/v2/login/status'],
      ['POST', '/api/v2/login/send-code'],
      ['POST', '/api/v2/login/claim/verify'],
      ['POST', '/api/v2/login/device-key'],
      ['POST', '/api/v2/login/connect'],
      ['GET', '/api/login/claim'],
      ['GET', '/api/login/device'],
      ['GET', '/api/login/app?grant=AAAAAAAAAAAAAAAAAAAAAAAA'],
    ] as const) {
      const response = await app.request(`https://omni.example.com${path}`, { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('x-ratelimit-limit')).toBeNull();
    }
  });
});

describe('connect links', () => {
  test('only a message that is nothing but "connect" asks for one', () => {
    for (const text of ['connect', ' Connect ', 'CONNECT', 'omni connect', 'Omni  Connect', 'conectar']) {
      expect(isConnectRequest(text)).toBe(true);
    }
    for (const text of ['connect me', 'please connect', 'omni', 'connected', '', undefined]) {
      expect(isConnectRequest(text)).toBe(false);
    }
  });

  test('a self chat gets a few links per window, then waits', () => {
    const login = { connectLinks: new Map() } as unknown as Login;
    const start = 1_000_000;
    for (let i = 0; i < LINKS_PER_WINDOW; i++) expect(allowConnectLink(login, 'self', start + i)).toBe(0);
    const wait = allowConnectLink(login, 'self', start + LINKS_PER_WINDOW);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(LINK_WINDOW_MS / 1000);
    // Another self chat has its own count, and the window moves on.
    expect(allowConnectLink(login, 'other', start)).toBe(0);
    expect(allowConnectLink(login, 'self', start + LINK_WINDOW_MS + 1)).toBe(0);
  });

  test('the app page carries a live grant into the app link, and says when one expired', () => {
    const live = appPage({ grant: 'AbCdEfGhIjKlMnOpQrStUv_-' });
    expect(live).toContain('const grant = "AbCdEfGhIjKlMnOpQrStUv_-";');
    expect(live).toContain("'&grant=' + encodeURIComponent(grant)");
    const expired = appPage({ expired: true });
    expect(expired).toContain('This link expired');
    expect(expired).not.toContain('openApp');
    expect(appPage()).toContain('const grant = null;');
  });
});

describe('the landing page at the Omni address', () => {
  const notFound = (c: { json: (body: unknown, status: 404) => Response; req: { path: string } }) =>
    c.json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: GET ${c.req.path}` } }, 404);
  const mount = (login: Login | null) => {
    const app = new Hono();
    app.route('/', landingRoutes(login, notFound as never));
    return app;
  };
  const html = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

  test('a browser gets the page; anything else keeps the JSON 404', async () => {
    const app = mount({ config: { publicUrl: 'https://omni.example.com' } } as Login);
    for (const path of ['/', '/api']) {
      const page = await app.request(`https://omni.example.com${path}`, { headers: html });
      expect(page.status).toBe(200);
      const body = await page.text();
      expect(body).toContain('This is an Omni');
      expect(body).toContain(`href="omni://connect?url=${encodeURIComponent('https://omni.example.com')}"`);
      expect(body).toContain('Text <strong>connect</strong> to yourself');
      expect(body).toContain('https://github.com/automagik-dev/automagik/releases/latest');

      for (const headers of [{}, { accept: 'application/json' }, { accept: '*/*' }] as Record<string, string>[]) {
        const json = await app.request(`https://omni.example.com${path}`, { headers });
        expect(json.status).toBe(404);
        expect(await json.json()).toEqual({ error: { code: 'NOT_FOUND', message: `Endpoint not found: GET ${path}` } });
      }
    }
  });

  test('with login off the page only offers the app download', async () => {
    const body = await (await mount(null).request('https://omni.example.com/', { headers: html })).text();
    expect(body).toContain('This is an Omni');
    expect(body.includes('href="omni://connect')).toBe(false);
    expect(body.includes('Text <strong>connect</strong>')).toBe(false);
  });
});
