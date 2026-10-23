/**
 * Scan to connect, end to end without a network: the device registers a slot, the owner's
 * self-chat message makes this Omni answer it, and the device collects and opens the box,
 * through the relay's own slot logic (@omni/connect-relay) kept in memory.
 */

import { describe, expect, test } from 'bun:test';
import { type ConnectPayload, newPairing, open, pairingMessage, writeHashOf } from '@omni/connect-relay';
import { type SlotRecord, type SlotStorage, handleSlot } from '@omni/connect-relay/slot';
import type { TypedOmniEvent } from '@omni/core';
import type { Login } from '../../login';
import type { OwnAccount } from '../../login/whatsapp';
import { SCAN_CLIENT, handleConnectMessage } from '../connect-relay';

const RELAY = 'https://relay.example.test';
const OWNER: OwnAccount = {
  instanceId: '11111111-1111-4111-8111-111111111111',
  instanceName: 'owner-whatsapp',
  phone: '5511999990000',
  selfJid: '5511999990000@s.whatsapp.net',
};

const toRequest = (input: string | URL | Request, init?: RequestInit): Request =>
  input instanceof Request ? new Request(input, init) : new Request(String(input), init);

/** The relay: one in-memory slot store per slot id, answered by the relay's own handler. */
function memoryRelay() {
  const slots = new Map<string, SlotRecord>();
  const storageOf = (slot: string): SlotStorage => ({
    get: async () => (slots.has(slot) ? structuredClone(slots.get(slot)) : undefined),
    put: async (_key, value) => {
      slots.set(slot, structuredClone(value));
    },
    deleteAll: async () => {
      slots.delete(slot);
    },
    setAlarm: async () => {},
  });
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = toRequest(input, init);
    const slot = new URL(request.url).pathname.split('/').at(-1) ?? '';
    calls.push(`${request.method} ${slot}`);
    return handleSlot(storageOf(slot), slot, request);
  }) as typeof globalThis.fetch;
  return { fetch, calls, slots };
}

function fakeLogin(overrides: Partial<Login['config']> = {}) {
  const created: { id: string; scopes: string[] }[] = [];
  const revoked: string[] = [];
  const sent: string[] = [];
  const events: unknown[] = [];
  const login = {
    config: {
      enabled: true,
      publicUrl: 'https://omni.example.test',
      secret: 'x'.repeat(40),
      deviceKeyScopes: ['instances:read', 'messages:read'],
      deviceKeyTtlDays: null,
      connectRelayUrl: RELAY,
      ...overrides,
    },
    services: {
      apiKeys: {
        create: async (input: { scopes: string[] }) => {
          const key = { id: `key-${created.length + 1}`, scopes: input.scopes };
          created.push(key);
          return { key, plainTextKey: `omni_sk_${key.id}` };
        },
        revoke: async (id: string) => {
          revoked.push(id);
          return null;
        },
      },
    },
    eventBus: { publish: async (type: string, payload: unknown) => void events.push({ type, payload }) },
    whatsapp: {
      accounts: async () => [OWNER],
      sendToSelf: async (_account: OwnAccount, _key: string, text: string) => void sent.push(text),
    },
  } as unknown as Login;
  return { login, created, revoked, sent, events };
}

const owner = async () => ({ id: 'owner-1', phone: OWNER.phone });

function selfChat(text: string, { fromMe = true, upsertType = 'notify', at = Date.now() } = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'message.received',
    timestamp: at,
    metadata: { instanceId: OWNER.instanceId, correlationId: 'c' },
    payload: {
      externalId: 'X',
      chatId: OWNER.selfJid,
      from: OWNER.selfJid,
      content: { type: 'text', text },
      rawPayload: {
        key: { remoteJid: OWNER.selfJid, fromMe, id: 'X' },
        isFromMe: fromMe,
        upsertType,
        message: { conversation: text },
        messageTimestamp: Math.floor(at / 1000),
      },
    },
  } as unknown as TypedOmniEvent<'message.received'>;
}

async function register(relay: ReturnType<typeof memoryRelay>) {
  const pairing = newPairing();
  const created = await relay.fetch(`${RELAY}/v1/slots/${pairing.slot}`, {
    method: 'POST',
    body: JSON.stringify({ writeHash: await writeHashOf(pairing) }),
  });
  expect(created.status).toBe(201);
  return pairing;
}

describe('scan to connect', () => {
  test("the owner's message answers the device's slot with this Omni's address and a fresh device key", async () => {
    const relay = memoryRelay();
    const { login, created, sent, events } = fakeLogin();
    const pairing = await register(relay);

    const result = await handleConnectMessage(login, selfChat(pairingMessage(pairing)), {
      fetch: relay.fetch,
      ownerOf: owner,
    });
    expect(result).toEqual({ slot: pairing.slot, keyId: 'key-1' });
    expect(created).toHaveLength(1);
    expect(sent[0]).toContain('New device connected');
    expect(events).toEqual([
      {
        type: 'access.device_authorized',
        payload: { userId: 'owner-1', clientId: SCAN_CLIENT, deviceName: 'scanned to connect', apiKeyId: 'key-1' },
      },
    ]);

    const collected = await relay.fetch(`${RELAY}/v1/slots/${pairing.slot}`);
    expect(collected.status).toBe(200);
    const payload: ConnectPayload = await open(pairing, ((await collected.json()) as { box: string }).box);
    expect(payload).toEqual({
      url: 'https://omni.example.test',
      apiKey: 'omni_sk_key-1',
      keyId: 'key-1',
      scopes: ['instances:read', 'messages:read'],
      keyExpiresAt: null,
    });
  });

  test('nobody but the owner, typing it fresh in their own self chat, can answer', async () => {
    const relay = memoryRelay();
    const { login, created } = fakeLogin();
    const pairing = await register(relay);
    const deps = { fetch: relay.fetch, ownerOf: owner };
    // Omni's own send arrives as 'append'; a message from someone else is not fromMe.
    expect(
      await handleConnectMessage(login, selfChat(pairingMessage(pairing), { upsertType: 'append' }), deps),
    ).toBeNull();
    expect(await handleConnectMessage(login, selfChat(pairingMessage(pairing), { fromMe: false }), deps)).toBeNull();
    // Quoted inside a longer message, it is not a pairing.
    expect(
      await handleConnectMessage(login, selfChat(`see omni-connect:${pairing.slot}.${pairing.key} ok`), deps),
    ).toBeNull();
    // Older than a slot can live.
    expect(
      await handleConnectMessage(login, selfChat(pairingMessage(pairing), { at: Date.now() - 11 * 60_000 }), deps),
    ).toBeNull();
    // No owner yet.
    expect(
      await handleConnectMessage(login, selfChat(pairingMessage(pairing)), { ...deps, ownerOf: async () => null }),
    ).toBeNull();
    expect(created).toHaveLength(0);
  });

  test('a slot the relay does not hold costs no key, and a refused answer revokes the key it minted', async () => {
    const relay = memoryRelay();
    const { login, created, revoked } = fakeLogin();
    const deps = { fetch: relay.fetch, ownerOf: owner };
    // Never registered (or expired): nothing is minted.
    expect(await handleConnectMessage(login, selfChat(pairingMessage(newPairing())), deps)).toBeNull();
    expect(created).toHaveLength(0);

    // The relay holds the slot, then refuses the answer: the key is revoked at once.
    const pairing = await register(relay);
    const refusing = (async (input: string | URL | Request, init?: RequestInit) =>
      toRequest(input, init).method === 'PUT'
        ? new Response(null, { status: 409 })
        : relay.fetch(input, init)) as typeof fetch;
    expect(
      await handleConnectMessage(login, selfChat(pairingMessage(pairing)), { ...deps, fetch: refusing }),
    ).toBeNull();
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(['key-1']);
  });

  test('turned off, it reads nothing', async () => {
    const relay = memoryRelay();
    const { login } = fakeLogin({ connectRelayUrl: null });
    const pairing = await register(relay);
    expect(
      await handleConnectMessage(login, selfChat(pairingMessage(pairing)), { fetch: relay.fetch, ownerOf: owner }),
    ).toBeNull();
    expect(relay.calls).toEqual([`POST ${pairing.slot}`]);
  });
});
