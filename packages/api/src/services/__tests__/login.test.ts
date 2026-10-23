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
import { claimTokenOf, isDeviceClient, readLoginConfig } from '../../login/config';
import { maskPhone } from '../../login/whatsapp';
import { isOwnerSelfChatText, userCodeInMessage } from '../../plugins/device-login';
import { loginApiRoutes, loginAuthRoutes, loginPageRoutes } from '../../routes/v2/login';

const SELF = '5511999990000@s.whatsapp.net';
const ON = {
  OMNI_LOGIN_ENABLED: 'true',
  OMNI_PUBLIC_URL: 'https://omni.example.com/',
  OMNI_AUTH_SECRET: 'x'.repeat(40),
};

describe('readLoginConfig', () => {
  test('is off unless enabled, and always off with multitenancy', () => {
    expect(readLoginConfig({})).toBeNull();
    expect(readLoginConfig({ ...ON, OMNI_MULTITENANCY_ENABLED: 'true' })).toBeNull();
  });

  test('reads the public URL, secret and device-key settings', () => {
    expect(readLoginConfig(ON)).toEqual({
      enabled: true,
      publicUrl: 'https://omni.example.com',
      secret: 'x'.repeat(40),
      deviceKeyScopes: ['instances:read', 'chats:read', 'messages:read', 'events:read'],
      deviceKeyTtlDays: null,
    });
    expect(
      readLoginConfig({ ...ON, OMNI_DEVICE_KEY_SCOPES: 'instances:*', OMNI_DEVICE_KEY_TTL_DAYS: '30' }),
    ).toMatchObject({
      deviceKeyScopes: ['instances:*'],
      deviceKeyTtlDays: 30,
    });
  });

  test('refuses a short secret, a missing URL, and scopes that would let a device mint keys', () => {
    expect(() => readLoginConfig({ ...ON, OMNI_AUTH_SECRET: 'short' })).toThrow();
    expect(() => readLoginConfig({ ...ON, OMNI_PUBLIC_URL: '' })).toThrow();
    for (const scopes of ['*', 'keys:write', 'instances:read,platform:admin']) {
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
      ['GET', '/api/login/claim'],
      ['GET', '/api/login/device'],
    ] as const) {
      const response = await app.request(`https://omni.example.com${path}`, { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('x-ratelimit-limit')).toBeNull();
    }
  });
});
