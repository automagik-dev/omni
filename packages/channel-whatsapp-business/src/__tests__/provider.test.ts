/**
 * Meta-compatible provider (#1661 part B; first provider: Kapso).
 *
 * Kapso mirrors the Cloud API at `https://api.kapso.ai/meta/whatsapp/v24.0`
 * with an `X-API-Key` header, and forwards Meta's webhooks in Meta's format
 * signed with a secret the user chooses: `X-Webhook-Signature`, a bare hex
 * HMAC-SHA256 of the raw body. An instance opts in per field; an instance
 * with none of them set is Meta direct, exactly as before.
 *
 * Runs the real plugin, client and webhook handler; fetch and the bus are
 * stubbed, so nothing reaches Meta or Kapso.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import { MetaWhatsAppClient } from '../client';
import { handleMetaWebhook } from '../handlers/webhook';
import { WhatsAppBusinessPlugin } from '../plugin';
import { listTemplatesFromMeta } from '../templates';

const KAPSO_BASE = 'https://api.kapso.ai/meta/whatsapp/v24.0';
const KAPSO_KEY = 'test-kapso-api-key';
const KAPSO_SECRET = 'test-forwarding-secret';
const APP_SECRET = 'test-meta-app-secret';

const KAPSO_INSTANCE = '00000000-0000-4000-8000-000000000ca5';
const KAPSO_PHONE_ID = '647015955153740';
const META_INSTANCE = '00000000-0000-4000-8000-000000000e7a';
const META_PHONE_ID = '106540352242922';
const CUSTOMER = '15551234567';

class RecordingBus implements EventBus {
  published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  async connect(): Promise<void> {}
  async publish(type: string, payload: unknown): Promise<PublishResult> {
    this.published.push({ type, payload: payload as Record<string, unknown> });
    return { id: `evt-${this.published.length}`, sequence: this.published.length, stream: 'test' };
  }
  async publishGeneric(type: string, payload: unknown): Promise<PublishResult> {
    return this.publish(type, payload);
  }
  async subscribe(): Promise<Subscription> {
    return { id: 's1', pattern: '*', unsubscribe: async () => {} };
  }
  async subscribePattern(): Promise<Subscription> {
    return { id: 's2', pattern: '*', unsubscribe: async () => {} };
  }
  async subscribeMany(): Promise<Subscription> {
    return { id: 's3', pattern: '*', unsubscribe: async () => {} };
  }
  async subscribeAll(): Promise<Subscription> {
    return { id: 's4', pattern: '*', unsubscribe: async () => {} };
  }
  async close(): Promise<void> {}
  isConnected(): boolean {
    return true;
  }
}

class NullStorage implements PluginStorage {
  async get<T>(): Promise<T | null> {
    return null;
  }
  async set(): Promise<void> {}
  async delete(): Promise<boolean> {
    return false;
  }
  async has(): Promise<boolean> {
    return false;
  }
  async keys(): Promise<string[]> {
    return [];
  }
}

class SilentLogger implements Logger {
  debug() {}
  info() {}
  warn() {}
  error() {}
  child(): Logger {
    return this;
  }
}

async function hmacHex(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A Meta-format `messages` webhook for one phone number id. */
function inboundBody(phoneNumberId: string, wamid: string, extraEntry?: Record<string, unknown>): string {
  const entry = (pnid: string, id: string) => ({
    id: 'waba-1',
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550001111', phone_number_id: pnid },
          messages: [{ from: CUSTOMER, id, timestamp: '1739230999', type: 'text', text: { body: 'Hi' } }],
        },
      },
    ],
  });
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [entry(phoneNumberId, wamid), ...(extraEntry ? [extraEntry] : [])],
  });
}

function post(body: string, headers: Record<string, string>): Request {
  return new Request('https://example.com/api/v2/channels/whatsapp-business/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Meta-compatible provider (Kapso)', () => {
  let plugin: WhatsAppBusinessPlugin;
  let bus: RecordingBus;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    bus = new RecordingBus();
    plugin = new WhatsAppBusinessPlugin();
    const context: PluginContext = {
      eventBus: bus,
      storage: new NullStorage(),
      logger: new SilentLogger(),
      config: {
        env: 'development',
        apiBaseUrl: 'http://localhost:3000',
        webhookBaseUrl: 'http://localhost:3000/webhooks',
        mediaStorage: { type: 'local', basePath: '/tmp/media' },
      },
      db: { execute: async () => [], getDrizzle: () => null },
    };
    await plugin.initialize(context);
    fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok({ id: KAPSO_PHONE_ID }))
      .mockResolvedValueOnce(ok({ id: META_PHONE_ID }));
    await plugin.connect(KAPSO_INSTANCE, {
      instanceId: KAPSO_INSTANCE,
      credentials: {
        metaAccessToken: KAPSO_KEY,
        metaPhoneNumberId: KAPSO_PHONE_ID,
        metaWabaId: 'waba-kapso',
        metaApiBaseUrl: KAPSO_BASE,
        metaAuthMode: 'x-api-key',
        metaWebhookSecret: KAPSO_SECRET,
        metaSignatureMode: 'x-webhook-signature',
      },
    });
    await plugin.connect(META_INSTANCE, {
      instanceId: META_INSTANCE,
      credentials: { metaAccessToken: 'EAAtest', metaPhoneNumberId: META_PHONE_ID, metaWabaId: 'waba-meta' },
    });
    bus.published = [];
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const received = () => bus.published.filter((e) => e.type === 'message.received');

  describe('inbound webhook', () => {
    test('a Kapso-signed Meta-format webhook verifies and dispatches (no META_APP_SECRET needed)', async () => {
      const body = inboundBody(KAPSO_PHONE_ID, 'wamid.kapso-1');
      const response = await handleMetaWebhook(
        post(body, { 'x-webhook-signature': await hmacHex(body, KAPSO_SECRET) }),
        plugin,
        '',
        '',
      );

      expect(response.status).toBe(200);
      expect(received().map((e) => [e.payload.externalId, e.payload.chatId])).toEqual([['wamid.kapso-1', CUSTOMER]]);
    });

    test('a wrong provider signature is 401 and emits nothing', async () => {
      const body = inboundBody(KAPSO_PHONE_ID, 'wamid.kapso-2');
      const wrong = await handleMetaWebhook(
        post(body, { 'x-webhook-signature': await hmacHex(body, 'not-the-secret') }),
        plugin,
        APP_SECRET,
        '',
      );
      const prefixed = await handleMetaWebhook(
        post(body, { 'x-webhook-signature': `sha256=${await hmacHex(body, KAPSO_SECRET)}` }),
        plugin,
        APP_SECRET,
        '',
      );

      expect([wrong.status, prefixed.status]).toEqual([401, 401]);
      expect(bus.published).toEqual([]);
    });

    test('one instance secret cannot vouch for another instance in the same body', async () => {
      const metaEntry = JSON.parse(inboundBody(META_PHONE_ID, 'wamid.spoof')).entry[0];
      const body = inboundBody(KAPSO_PHONE_ID, 'wamid.kapso-3', metaEntry);
      const response = await handleMetaWebhook(
        post(body, { 'x-webhook-signature': await hmacHex(body, KAPSO_SECRET) }),
        plugin,
        APP_SECRET,
        '',
      );

      expect(response.status).toBe(401);
      expect(bus.published).toEqual([]);
    });

    test("a WABA-routed field is verified by the WABA's instances, not by a phone id in its value", async () => {
      // Kapso's own phone id rides in the value, but account_update routes by
      // entry.id: the Meta-direct instance's WABA. Kapso's secret must not pass.
      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-meta',
            changes: [
              {
                field: 'account_update',
                value: {
                  metadata: { display_phone_number: '15550001111', phone_number_id: KAPSO_PHONE_ID },
                  event: 'ACCOUNT_VIOLATION',
                },
              },
            ],
          },
        ],
      });
      const response = await handleMetaWebhook(
        post(body, { 'x-webhook-signature': await hmacHex(body, KAPSO_SECRET) }),
        plugin,
        APP_SECRET,
        '',
      );

      expect(response.status).toBe(401);
      expect(bus.published.filter((e) => e.type === 'channel.alert')).toEqual([]);
    });

    test('a Meta-direct instance is unchanged: Meta signature passes, a provider signature does not', async () => {
      const body = inboundBody(META_PHONE_ID, 'wamid.meta-1');
      const viaProvider = await handleMetaWebhook(
        post(body, { 'x-webhook-signature': await hmacHex(body, KAPSO_SECRET) }),
        plugin,
        APP_SECRET,
        '',
      );
      const viaMeta = await handleMetaWebhook(
        post(body, { 'x-hub-signature-256': `sha256=${await hmacHex(body, APP_SECRET)}` }),
        plugin,
        APP_SECRET,
        '',
      );

      expect([viaProvider.status, viaMeta.status]).toEqual([401, 200]);
      expect(received().map((e) => e.payload.externalId)).toEqual(['wamid.meta-1']);
    });

    test('plugin.handleWebhook serves a provider instance when the Meta env is unset', async () => {
      const saved = { secret: process.env.META_APP_SECRET, token: process.env.META_VERIFY_TOKEN };
      Reflect.deleteProperty(process.env, 'META_APP_SECRET');
      Reflect.deleteProperty(process.env, 'META_VERIFY_TOKEN');
      try {
        const body = inboundBody(KAPSO_PHONE_ID, 'wamid.kapso-4');
        const response = await plugin.handleWebhook(
          post(body, { 'x-webhook-signature': await hmacHex(body, KAPSO_SECRET) }),
        );
        expect(response.status).toBe(200);
        expect(received()).toHaveLength(1);
      } finally {
        if (saved.secret !== undefined) process.env.META_APP_SECRET = saved.secret;
        if (saved.token !== undefined) process.env.META_VERIFY_TOKEN = saved.token;
      }
    });
  });

  describe('outbound', () => {
    test('connect validated the number through the provider base URL with X-API-Key', () => {
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith(`${KAPSO_BASE}/${KAPSO_PHONE_ID}?`)).toBe(true);
      const headers = init.headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe(KAPSO_KEY);
      expect(headers.Authorization).toBeUndefined();
    });

    test('a send uses the provider base URL and header; a Meta-direct send keeps Graph + Bearer', async () => {
      fetchSpy.mockClear();
      fetchSpy.mockImplementation(async () =>
        ok({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: 'wamid.out' }] }),
      );

      await plugin.sendMessage(KAPSO_INSTANCE, { to: CUSTOMER, content: { type: 'text', text: 'Olá' } });
      await plugin.sendMessage(META_INSTANCE, { to: CUSTOMER, content: { type: 'text', text: 'Olá' } });

      const [kapsoUrl, kapsoInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const [metaUrl, metaInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(kapsoUrl).toBe(`${KAPSO_BASE}/${KAPSO_PHONE_ID}/messages`);
      expect(kapsoInit.headers).toMatchObject({ 'X-API-Key': KAPSO_KEY });
      expect((kapsoInit.headers as Record<string, string>).Authorization).toBeUndefined();
      expect(metaUrl).toBe(`https://graph.facebook.com/v25.0/${META_PHONE_ID}/messages`);
      expect(metaInit.headers).toMatchObject({ Authorization: 'Bearer EAAtest' });
    });

    test("inbound media downloads through the provider's signed download_url without auth headers", async () => {
      fetchSpy.mockClear();
      fetchSpy
        .mockResolvedValueOnce(
          ok({
            url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
            download_url: 'https://api.kapso.ai/meta/whatsapp/media_download?token=signed',
            mime_type: 'image/jpeg',
          }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

      const media = await plugin.downloadInboundMedia(KAPSO_INSTANCE, 'media-1');

      expect([...media.buffer]).toEqual([1, 2, 3]);
      const [lookupUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const [downloadUrl, downloadInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(lookupUrl).toBe(`${KAPSO_BASE}/media-1`);
      expect(downloadUrl).toBe('https://api.kapso.ai/meta/whatsapp/media_download?token=signed');
      expect(downloadInit.headers).toEqual({});
    });

    test("a provider lookup without download_url never sends the key to Meta's lookaside", async () => {
      fetchSpy.mockClear();
      fetchSpy.mockResolvedValueOnce(
        ok({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=2', mime_type: 'image/jpeg' }),
      );

      await expect(plugin.downloadInboundMedia(KAPSO_INSTANCE, 'media-2')).rejects.toThrow('off the provider origin');
      expect(fetchSpy.mock.calls.map((call: unknown[]) => call[0])).toEqual([`${KAPSO_BASE}/media-2`]);
    });

    test('connect refuses a non-https provider base URL', async () => {
      await expect(
        plugin.connect('00000000-0000-4000-8000-0000000000aa', {
          instanceId: '00000000-0000-4000-8000-0000000000aa',
          credentials: {
            metaAccessToken: KAPSO_KEY,
            metaPhoneNumberId: '1',
            metaWabaId: '2',
            metaApiBaseUrl: 'http://api.kapso.ai/meta/whatsapp/v24.0',
          },
        }),
      ).rejects.toThrow('Invalid Meta-compatible provider settings');
    });
  });
});

describe('MetaWhatsAppClient transport', () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  afterEach(() => fetchSpy.mockRestore());

  /** URL and headers of every request the client made. */
  function requests(): { url: string; headers: Record<string, string> }[] {
    return fetchSpy.mock.calls.map((call: unknown[]) => ({
      url: String(call[0]),
      headers: Object.fromEntries(new Headers((call[1] as RequestInit | undefined)?.headers).entries()),
    }));
  }

  test('x-api-key without a provider base URL still sends Bearer to Graph', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(ok({ id: META_PHONE_ID }));
    const client = new MetaWhatsAppClient({
      accessToken: KAPSO_KEY,
      phoneNumberId: META_PHONE_ID,
      authMode: 'x-api-key',
    });

    await client.getPhoneNumberInfo();

    const [request] = requests();
    expect(request?.url.startsWith('https://graph.facebook.com/')).toBe(true);
    expect(request?.headers.authorization).toBe(`Bearer ${KAPSO_KEY}`);
    expect(request?.headers['x-api-key']).toBeUndefined();
  });

  test('a raw Graph paging.next from the provider is fetched from the provider base', async () => {
    fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        ok({
          data: [],
          paging: { next: 'https://graph.facebook.com/v24.0/waba-kapso/message_templates?limit=1&after=CURSOR' },
        }),
      )
      .mockResolvedValueOnce(ok({ data: [] }));
    const client = new MetaWhatsAppClient(
      { accessToken: KAPSO_KEY, phoneNumberId: KAPSO_PHONE_ID, baseUrl: KAPSO_BASE, authMode: 'x-api-key' },
      'waba-kapso',
    );

    await listTemplatesFromMeta(client, 'waba-kapso', { pageSize: 1 });

    const urls = requests().map((request) => request.url);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(`${KAPSO_BASE}/waba-kapso/message_templates?limit=1&after=CURSOR`);
    expect(urls.some((url) => url.includes('graph.facebook.com'))).toBe(false);
    expect(requests().every((request) => request.headers['x-api-key'] === KAPSO_KEY)).toBe(true);
  });
});
