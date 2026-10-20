/**
 * Device pairing without a database (wish: omni-labs-distribution, Group 2):
 * server config, the code a message carries, phone parsing, the approver
 * predicates the subscriber applies to a message.received event, and the three
 * public routes over fake services. The approve/consume transitions run
 * against real PostgreSQL in device-pairing-postgres.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TypedOmniEvent } from '@omni/core';
import { Hono } from 'hono';
import { directSenderPhone, handlePairingMessage, isOwnerSelfChatText } from '../../plugins/device-pairing';
import { pairingRoutes } from '../../routes/v2/pairing';
import type { Services } from '../../services';
import type { AppVariables } from '../../types';
import {
  CODE_ALPHABET,
  type PairingConfig,
  type PairingMessage,
  codeInMessage,
  generateCode,
  phoneDigits,
  readPairingConfig,
} from '../device-pairing';

const INSTANCE = '11111111-1111-4111-8111-111111111111';
const SELF = '5511999990000@s.whatsapp.net';

describe('readPairingConfig', () => {
  test('is off with nothing set, and defaults to read scopes', () => {
    const config = readPairingConfig({});
    expect(config.enabled).toBe(false);
    expect(config.instanceId).toBeNull();
    expect(config.scopes).toEqual(['instances:read', 'chats:read', 'messages:read', 'events:read']);
    expect(config.keyTtlDays).toBe(90);
  });

  test('reads every variable', () => {
    const config = readPairingConfig({
      OMNI_PAIRING_ENABLED: 'true',
      OMNI_PAIRING_INSTANCE_ID: INSTANCE,
      OMNI_PAIRING_ALLOWED_NUMBERS: '+55 11 98888-7777, 5511977776666',
      OMNI_PAIRING_KEY_SCOPES: 'instances:*,messages:write',
      OMNI_PAIRING_KEY_TTL_DAYS: '7',
      OMNI_PAIRING_KEY_RATE_LIMIT: '60',
      OMNI_PAIRING_PUBLIC_URL: 'https://omni.example.com',
    });
    expect(config).toEqual({
      enabled: true,
      instanceId: INSTANCE,
      allowedNumbers: ['5511988887777', '5511977776666'],
      scopes: ['instances:*', 'messages:write'],
      keyTtlDays: 7,
      keyRateLimit: 60,
      publicUrl: 'https://omni.example.com',
    });
  });

  test('refuses scopes that would let a paired key do everything or mint keys', () => {
    for (const scopes of ['*', 'keys:write', 'keys:*', 'instances:read,platform:admin']) {
      expect(() => readPairingConfig({ OMNI_PAIRING_KEY_SCOPES: scopes })).toThrow();
    }
  });

  test('refuses a malformed instance id or TTL', () => {
    expect(() => readPairingConfig({ OMNI_PAIRING_INSTANCE_ID: 'pessoal-whatsapp' })).toThrow();
    expect(() => readPairingConfig({ OMNI_PAIRING_KEY_TTL_DAYS: '0' })).toThrow();
  });
});

describe('codes', () => {
  test('generated codes are XXXX-XXXX from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[^-]{4}-[^-]{4}$/);
      for (const char of code.replace('-', '')) expect(CODE_ALPHABET).toContain(char);
    }
  });

  test('a message is a code only when it is nothing but the code', () => {
    expect(codeInMessage('7KQ4-9XZP')).toBe('7KQ4-9XZP');
    expect(codeInMessage('  7kq4 9xzp ')).toBe('7KQ4-9XZP');
    expect(codeInMessage('7KQ49XZP')).toBe('7KQ4-9XZP');
    expect(codeInMessage('Omni 7KQ4-9XZP')).toBe('7KQ4-9XZP');
    expect(codeInMessage('omni: 7KQ4-9XZP')).toBe('7KQ4-9XZP');
    expect(codeInMessage('my code is 7KQ4-9XZP')).toBeNull();
    expect(codeInMessage('7KQ4-9XZP thanks')).toBeNull();
    // 0, 1, I, L, O and U are never in a code.
    expect(codeInMessage('7KQ4-9XZ0')).toBeNull();
    expect(codeInMessage('IKQ4-9XZP')).toBeNull();
    expect(codeInMessage(undefined)).toBeNull();
  });
});

describe('phoneDigits', () => {
  test('reads phone addresses and refuses LIDs and groups', () => {
    expect(phoneDigits('5511999990000@s.whatsapp.net')).toBe('5511999990000');
    expect(phoneDigits('5511999990000:12@s.whatsapp.net')).toBe('5511999990000');
    expect(phoneDigits('5511999990000')).toBe('5511999990000');
    expect(phoneDigits('100000001234567@lid')).toBeNull();
    expect(phoneDigits('120363000000000000@g.us')).toBeNull();
    expect(phoneDigits(null)).toBeNull();
  });
});

type ReceivedOverrides = {
  chatId?: string;
  from?: string;
  text?: string;
  raw?: Record<string, unknown>;
  replyToId?: string;
  instanceId?: string;
  tenantId?: string;
};

function received(o: ReceivedOverrides = {}): TypedOmniEvent<'message.received'> {
  const chatId = o.chatId ?? SELF;
  return {
    id: crypto.randomUUID(),
    type: 'message.received',
    timestamp: Date.now(),
    payload: {
      externalId: 'ABCDEF',
      chatId,
      from: o.from ?? '5511999990000:12@s.whatsapp.net',
      content: { type: 'text', text: o.text ?? '7KQ4-9XZP' },
      ...(o.replyToId ? { replyToId: o.replyToId } : {}),
      rawPayload: {
        key: { remoteJid: chatId, fromMe: true, id: 'ABCDEF' },
        isFromMe: true,
        upsertType: 'notify',
        message: { conversation: o.text ?? '7KQ4-9XZP' },
        messageTimestamp: Math.floor(Date.now() / 1000),
        ...o.raw,
      },
    },
    metadata: {
      correlationId: 'c',
      instanceId: o.instanceId ?? INSTANCE,
      channelType: 'whatsapp-baileys',
      ...(o.tenantId ? { tenantId: o.tenantId } : {}),
    },
  } as TypedOmniEvent<'message.received'>;
}

describe('approver predicates', () => {
  test('the owner typing in the self chat is the owner', () => {
    expect(isOwnerSelfChatText(received(), SELF)).toBe(true);
  });

  test("a self chat addressed by the account's LID counts, with the phone JID beside it", () => {
    const lid = '100000000000001@lid';
    const event = received({
      chatId: lid,
      raw: { key: { remoteJid: lid, remoteJidAlt: SELF, fromMe: true, id: 'X' } },
    });
    expect(isOwnerSelfChatText(event, SELF)).toBe(true);
    // Someone else's LID chat does not.
    const other = received({
      chatId: lid,
      raw: { key: { remoteJid: lid, remoteJidAlt: '5511900001111@s.whatsapp.net', fromMe: true, id: 'X' } },
    });
    expect(isOwnerSelfChatText(other, SELF)).toBe(false);
  });

  test('anything else is not', () => {
    const cases: TypedOmniEvent<'message.received'>[] = [
      // Another chat.
      received({ chatId: '5511900001111@s.whatsapp.net' }),
      // Not from the account.
      received({ raw: { key: { remoteJid: SELF, fromMe: false }, isFromMe: false } }),
      // History sync.
      received({ raw: { isHistorySync: true } }),
      // A reply, a quote, a forward.
      received({ replyToId: 'OLDER' }),
      received({ raw: { quotedMessage: { conversation: 'x' } } }),
      received({
        raw: { message: { extendedTextMessage: { text: '7KQ4-9XZP', contextInfo: { isForwarded: true } } } },
      }),
      received({ raw: { message: { protocolMessage: { type: 14 } } } }),
      // Sent by Omni's own device (an API send to its own number), or of unknown origin.
      received({ raw: { upsertType: 'append' } }),
      received({ raw: { upsertType: undefined } }),
    ];
    for (const event of cases) expect(isOwnerSelfChatText(event, SELF)).toBe(false);
    // With the account's identity unknown (disconnected) nothing is the owner.
    expect(isOwnerSelfChatText(received(), null)).toBe(false);
  });

  test('a direct message from someone else names their phone, resolved for LIDs', () => {
    const dm = (raw: Record<string, unknown>, from: string, chatId: string) =>
      received({ chatId, from, raw: { key: { remoteJid: chatId, fromMe: false }, isFromMe: false, ...raw } });
    const phone = '5511988887777@s.whatsapp.net';
    expect(directSenderPhone(dm({}, phone, phone))).toBe('5511988887777');
    expect(directSenderPhone(dm({ resolvedSenderPhone: '5511988887777' }, '1000001@lid', '1000001@lid'))).toBe(
      '5511988887777',
    );
    expect(directSenderPhone(dm({}, '1000001@lid', '1000001@lid'))).toBeNull();
    expect(directSenderPhone(dm({}, phone, '120363000000000000@g.us'))).toBeNull();
    expect(directSenderPhone(received())).toBeNull();
  });
});

describe('handlePairingMessage', () => {
  const config: PairingConfig = {
    enabled: true,
    instanceId: INSTANCE,
    allowedNumbers: [],
    scopes: ['instances:read'],
    keyTtlDays: 30,
    keyRateLimit: null,
    publicUrl: null,
  };

  function servicesSeeing(seen: PairingMessage[]): Services {
    return {
      devicePairing: {
        approveFromMessage: async (message: PairingMessage) => {
          seen.push(message);
          return null;
        },
      },
    } as unknown as Services;
  }

  test('only code-shaped messages on the pairing instance reach the service', async () => {
    const seen: PairingMessage[] = [];
    const services = servicesSeeing(seen);
    await handlePairingMessage(services, config, received({ text: 'hello there' }));
    await handlePairingMessage(services, config, received({ instanceId: '22222222-2222-4222-8222-222222222222' }));
    expect(seen.length).toBe(0);
    await handlePairingMessage(services, config, received({ text: 'Omni 7KQ4-9XZP' }));
    expect(seen.length).toBe(1);
    expect(seen[0]?.text).toBe('Omni 7KQ4-9XZP');
  });

  test('a tenant-stamped envelope approves nothing', async () => {
    const seen: PairingMessage[] = [];
    await handlePairingMessage(
      servicesSeeing(seen),
      config,
      received({ tenantId: '33333333-3333-4333-8333-333333333333' }),
    );
    expect(seen.length).toBe(0);
  });
});

describe('pairing routes', () => {
  const ENV = [
    'OMNI_PAIRING_ENABLED',
    'OMNI_PAIRING_INSTANCE_ID',
    'OMNI_PAIRING_KEY_SCOPES',
    'OMNI_PAIRING_PUBLIC_URL',
    'OMNI_MULTITENANCY_ENABLED',
    'TRUSTED_PROXY_HEADER',
  ];
  const saved: Record<string, string | undefined> = {};
  const id = '44444444-4444-4444-8444-444444444444';
  const token = 'omni_pt_aaaaaaaaaaaaaaaaaaaaaaaa';

  beforeEach(() => {
    for (const key of ENV) saved[key] = process.env[key];
    process.env.OMNI_PAIRING_ENABLED = 'true';
    process.env.OMNI_PAIRING_INSTANCE_ID = INSTANCE;
    process.env.OMNI_PAIRING_PUBLIC_URL = 'https://omni.example.com';
    Reflect.deleteProperty(process.env, 'OMNI_PAIRING_KEY_SCOPES');
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    // Each request gets its own client IP so the per-IP limiter only bites where a test means it to.
    process.env.TRUSTED_PROXY_HEADER = 'x-forwarded-for';
  });
  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = saved[key];
    }
  });

  function app(overrides: { instance?: Record<string, unknown> | null; start?: unknown; poll?: unknown } = {}) {
    const instance =
      overrides.instance === undefined
        ? {
            id: INSTANCE,
            isActive: true,
            channel: 'whatsapp-baileys',
            ownerIdentifier: '5511999990000:12@s.whatsapp.net',
          }
        : overrides.instance;
    const services = {
      instances: {
        getById: async () => {
          if (!instance) throw new Error('not found');
          return instance;
        },
      },
      devicePairing: {
        start: async () =>
          overrides.start === undefined
            ? { pairingId: id, code: '7KQ4-9XZP', pollToken: token, expiresAt: new Date('2030-01-01T00:00:00Z') }
            : overrides.start,
        poll: async (pairingId: string, pollToken: string) =>
          pairingId === id && pollToken === token ? (overrides.poll ?? { status: 'pending' }) : null,
        cancel: async (pairingId: string, pollToken: string) => (pairingId === id && pollToken === token ? true : null),
      },
    } as unknown as Services;
    const hono = new Hono<{ Variables: AppVariables }>();
    hono.use('*', async (c, next) => {
      c.set('services', services);
      await next();
    });
    hono.route('/api/v2/pair', pairingRoutes);
    return hono;
  }

  let ipCounter = 0;
  const freshIp = () => `198.51.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  const startRequest = (body: unknown = { deviceName: 'Laptop' }, ip = freshIp()) =>
    new Request('http://localhost/api/v2/pair/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });
  const pollRequest = (method = 'GET', pollToken = token, pairingId = id) =>
    new Request(`http://localhost/api/v2/pair/${pairingId}`, {
      method,
      headers: { 'x-pairing-token': pollToken, 'x-forwarded-for': freshIp() },
    });

  test('one IP gets ten starts per ten minutes', async () => {
    const hono = app();
    const ip = '192.0.2.10';
    for (let i = 0; i < 10; i++) expect((await hono.request(startRequest(undefined, ip))).status).toBe(200);
    expect((await hono.request(startRequest(undefined, ip))).status).toBe(429);
    expect((await hono.request(startRequest())).status).toBe(200);
  });

  test('every route is 404 with pairing off or multitenancy on', async () => {
    for (const setup of [
      () => Reflect.deleteProperty(process.env, 'OMNI_PAIRING_ENABLED'),
      () => Reflect.deleteProperty(process.env, 'OMNI_PAIRING_INSTANCE_ID'),
      () => {
        process.env.OMNI_MULTITENANCY_ENABLED = 'true';
      },
      () => {
        process.env.OMNI_PAIRING_KEY_SCOPES = '*';
      },
    ]) {
      setup();
      const hono = app();
      const off = await hono.request(startRequest());
      expect(off.status).toBe(404);
      expect(off.headers.get('x-ratelimit-limit')).toBeNull();
      expect((await hono.request(pollRequest())).status).toBe(404);
      expect((await hono.request(pollRequest('DELETE'))).status).toBe(404);
      process.env.OMNI_PAIRING_ENABLED = 'true';
      process.env.OMNI_PAIRING_INSTANCE_ID = INSTANCE;
      Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
      Reflect.deleteProperty(process.env, 'OMNI_PAIRING_KEY_SCOPES');
    }
  });

  test('start returns the code, the pairing number and a prefilled link', async () => {
    const response = await app().request(startRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        pairingId: id,
        code: '7KQ4-9XZP',
        sendTo: '+5511999990000',
        waLink: 'https://wa.me/5511999990000?text=Omni%207KQ4-9XZP',
        expiresAt: '2030-01-01T00:00:00.000Z',
        pollToken: token,
        pollIntervalMs: 2000,
      },
    });
  });

  test('start validates its body', async () => {
    for (const body of [{}, { deviceName: '' }, { deviceName: 'x'.repeat(81) }, { deviceName: 'ok', extra: 1 }]) {
      expect((await app().request(startRequest(body))).status).toBe(400);
    }
  });

  test('start is 503 when the pairing instance cannot take codes, 429 when too many wait', async () => {
    expect((await app({ instance: null }).request(startRequest())).status).toBe(503);
    expect(
      (await app({ instance: { id: INSTANCE, isActive: false, channel: 'whatsapp-baileys' } }).request(startRequest()))
        .status,
    ).toBe(503);
    expect(
      (
        await app({ instance: { id: INSTANCE, isActive: true, channel: 'telegram', ownerIdentifier: '123' } }).request(
          startRequest(),
        )
      ).status,
    ).toBe(503);
    expect((await app({ start: null }).request(startRequest())).status).toBe(429);
  });

  test('poll and cancel answer 404 for a wrong token or a malformed id', async () => {
    expect((await app().request(pollRequest('GET', 'omni_pt_not-the-right-token'))).status).toBe(404);
    expect((await app().request(pollRequest('GET', token, 'not-a-uuid'))).status).toBe(404);
    expect(
      (
        await app().request(
          new Request(`http://localhost/api/v2/pair/${id}`, { headers: { 'x-forwarded-for': freshIp() } }),
        )
      ).status,
    ).toBe(404);
    expect((await app().request(pollRequest('DELETE', 'omni_pt_not-the-right-token'))).status).toBe(404);
  });

  test('poll carries the key and the API URL only on the approved read', async () => {
    expect(await (await app().request(pollRequest())).json()).toEqual({ data: { status: 'pending' } });
    const approved = {
      status: 'approved',
      apiKey: 'omni_sk_minted',
      keyId: '55555555-5555-4555-8555-555555555555',
      scopes: ['instances:read'],
      keyExpiresAt: new Date('2030-02-01T00:00:00Z'),
    };
    expect(await (await app({ poll: approved }).request(pollRequest())).json()).toEqual({
      data: {
        status: 'approved',
        apiKey: 'omni_sk_minted',
        keyId: '55555555-5555-4555-8555-555555555555',
        scopes: ['instances:read'],
        keyExpiresAt: '2030-02-01T00:00:00.000Z',
        apiUrl: 'https://omni.example.com',
      },
    });
    expect(await (await app().request(pollRequest('DELETE'))).json()).toEqual({ data: { cancelled: true } });
  });
});
