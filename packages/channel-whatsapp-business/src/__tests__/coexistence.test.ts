/**
 * Coexistence webhooks (#1661): a number on both the WhatsApp Business app and
 * the Cloud API. Fixtures are Meta's documented payloads (Embedded Signup >
 * Onboard WhatsApp Business app users: smb_message_echoes, history,
 * smb_app_state_sync), using Meta's example ids and 555 numbers.
 *
 * Runs the real plugin and the real signed webhook handler; only the event bus,
 * storage and the token check on connect are stubbed.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import { MetaWebhookPayloadSchema } from '@omni/core/schemas';
import { handleMetaWebhook } from '../handlers/webhook';
import { WhatsAppBusinessPlugin } from '../plugin';

const APP_SECRET = 'test-app-secret-coexistence';
const instanceId = '00000000-0000-4000-8000-000000001661';
const WABA_ID = '102290129340398';
const PHONE_NUMBER_ID = '106540352242922';
const BUSINESS = '15550783881';
const USER = '16505551234';
const METADATA = { display_phone_number: BUSINESS, phone_number_id: PHONE_NUMBER_ID };

interface Published {
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

class RecordingBus implements EventBus {
  published: Published[] = [];
  async connect(): Promise<void> {}
  async publish(type: string, payload: unknown, metadata?: unknown): Promise<PublishResult> {
    this.published.push({
      type,
      payload: payload as Record<string, unknown>,
      metadata: (metadata ?? {}) as Record<string, unknown>,
    });
    return { id: `evt-${this.published.length}`, sequence: this.published.length, stream: 'test' };
  }
  async publishGeneric(type: string, payload: unknown, metadata?: unknown): Promise<PublishResult> {
    return this.publish(type, payload, metadata);
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

/** Mirrors the API storage: `keys(pattern)` treats `*` as a wildcard. */
class MapStorage implements PluginStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async keys(pattern?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    if (!pattern) return keys;
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    return keys.filter((k) => regex.test(k));
  }
}

class RecordingLogger implements Logger {
  readonly warnings: string[] = [];
  debug() {}
  info() {}
  warn(message: string) {
    this.warnings.push(message);
  }
  error() {}
  child(): Logger {
    return this;
  }
}

function envelope(field: string, value: Record<string, unknown>) {
  return { object: 'whatsapp_business_account', entry: [{ id: WABA_ID, changes: [{ value, field }] }] };
}

async function signedPost(payload: unknown): Promise<Request> {
  const body = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  return new Request('https://example.com/api/v2/channels/whatsapp-business/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${hex}` },
    body,
  });
}

// ─── Meta's documented payloads ──────────────────────────────────────────

const ECHO_WAMID = 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA';

/** smb_message_echoes example payload. */
function echoPayload(echo: Record<string, unknown> = {}) {
  return envelope('smb_message_echoes', {
    messaging_product: 'whatsapp',
    metadata: METADATA,
    message_echoes: [
      {
        from: BUSINESS,
        to: USER,
        id: ECHO_WAMID,
        timestamp: '1700255121',
        type: 'text',
        text: { body: "Here's the info you requested! https://www.meta.com/quest/quest-3/" },
        ...echo,
      },
    ],
  });
}

const PLACEHOLDER_WAMID = 'wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA';

/** history example payload: two threads, one media_placeholder. */
function historyPayload() {
  return envelope('history', {
    messaging_product: 'whatsapp',
    metadata: METADATA,
    history: [
      {
        metadata: { phase: 0, chunk_order: 1, progress: 55 },
        threads: [
          {
            id: USER,
            messages: [
              {
                from: BUSINESS,
                id: 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA',
                timestamp: '1739230955',
                type: 'text',
                text: { body: "Here's the info you requested! https://www.meta.com/quest/quest-3/" },
                history_context: { status: 'read' },
              },
              {
                from: BUSINESS,
                id: PLACEHOLDER_WAMID,
                timestamp: '1739230970',
                type: 'media_placeholder',
                history_context: { status: 'played' },
              },
              {
                from: USER,
                id: 'wamid.N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0',
                timestamp: '1739230970',
                type: 'text',
                text: { body: 'Thanks!' },
                history_context: { status: 'read' },
              },
            ],
          },
          {
            id: '12125557890',
            messages: [
              {
                from: BUSINESS,
                id: 'wamid.BIyNDlBOEI5N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGQUQ4NDc0',
                timestamp: '1739230970',
                type: 'text',
                text: {
                  body: 'Thanks for your order! As a thank you, use code THANKS30 to get 30% of your next order.',
                },
                history_context: { status: 'delivered' },
              },
            ],
          },
        ],
      },
    ],
  });
}

/** history "media message asset" example: the content behind a placeholder. */
function mediaAssetPayload(from: string) {
  return envelope('history', {
    messaging_product: 'whatsapp',
    metadata: METADATA,
    messages: [
      {
        from,
        id: PLACEHOLDER_WAMID,
        timestamp: '1738796547',
        type: 'image',
        image: {
          caption: 'Black Prince echeveria',
          mime_type: 'image/jpeg',
          sha256: '3f9d94d399fa61c191bc1d4ca71375a035cd9b9f5b1128e1f0963a415c16b0cc',
          id: '24230790383178626',
        },
      },
    ],
  });
}

/** history "chat history sharing declined" example (Meta shows the bare value). */
function declinedHistoryPayload() {
  return envelope('history', {
    messaging_product: 'whatsapp',
    metadata: METADATA,
    history: [
      {
        errors: [
          {
            code: 2593109,
            title: 'History sync is turned off by the business from the WhatsApp Business App',
            message: 'History sync is turned off by the business from the WhatsApp Business App',
            error_data: { details: 'History sharing is turned off by the business' },
          },
        ],
      },
    ],
  });
}

/** smb_app_state_sync payload with the example values from Meta's table. */
function stateSyncPayload(items: Array<Record<string, unknown>>) {
  return envelope('smb_app_state_sync', { messaging_product: 'whatsapp', metadata: METADATA, state_sync: items });
}

const PABLO = {
  type: 'contact',
  contact: { full_name: 'Pablo Morales', first_name: 'Pablo', phone_number: USER },
  action: 'add',
  metadata: { timestamp: '1738346006' },
};

// ─── Harness ─────────────────────────────────────────────────────────────

describe('WhatsApp Business coexistence webhooks', () => {
  let plugin: WhatsAppBusinessPlugin;
  let bus: RecordingBus;
  let storage: MapStorage;
  let logger: RecordingLogger;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    bus = new RecordingBus();
    storage = new MapStorage();
    logger = new RecordingLogger();
    plugin = new WhatsAppBusinessPlugin();
    const context: PluginContext = {
      eventBus: bus,
      storage,
      logger,
      config: {
        env: 'development',
        apiBaseUrl: 'http://localhost:3000',
        webhookBaseUrl: 'http://localhost:3000/webhooks',
        mediaStorage: { type: 'local', basePath: '/tmp/media' },
      },
      db: { execute: async () => [], getDrizzle: () => null },
    };
    await plugin.initialize(context);
    // connect() validates the token via GET /{phone_number_id}.
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: PHONE_NUMBER_ID }), { status: 200 }),
    );
    await plugin.connect(instanceId, {
      instanceId,
      credentials: { metaAccessToken: 'EAAtest', metaPhoneNumberId: PHONE_NUMBER_ID, metaWabaId: WABA_ID },
    });
    bus.published = [];
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function post(payload: unknown): Promise<number> {
    const response = await handleMetaWebhook(await signedPost(payload), plugin, APP_SECRET, 'verify');
    return response.status;
  }

  const received = () => bus.published.filter((e) => e.type === 'message.received');
  const raw = (e: Published) => e.payload.rawPayload as Record<string, unknown>;

  describe('schema', () => {
    test('keeps message_echoes, history and state_sync values (no longer stripped)', () => {
      const values = [echoPayload(), historyPayload(), stateSyncPayload([PABLO])].map(
        (p) => MetaWebhookPayloadSchema.parse(p).entry[0]?.changes[0]?.value as Record<string, unknown>,
      );
      expect(values[0]?.message_echoes).toHaveLength(1);
      expect(values[1]?.history).toHaveLength(1);
      expect(values[2]?.state_sync).toHaveLength(1);
    });

    test('template status and account_update values keep their fields too (were parsed to {})', () => {
      const template = {
        message_template_id: '1234567890',
        message_template_name: 'order_update',
        message_template_language: 'en_US',
        event: 'APPROVED',
      };
      const account = { event: 'PARTNER_REMOVED', waba_info: { waba_id: WABA_ID, owner_business_id: '1' } };
      const [templateValue, accountValue] = [
        envelope('message_template_status_update', template),
        envelope('account_update', account),
      ].map((p) => MetaWebhookPayloadSchema.parse(p).entry[0]?.changes[0]?.value);
      expect(templateValue).toEqual(template);
      expect(accountValue).toEqual(account);
    });
  });

  describe('smb_message_echoes', () => {
    test('emits message.received in the customer chat with own-device evidence', async () => {
      expect(await post(echoPayload())).toBe(200);

      const events = received();
      expect(events).toHaveLength(1);
      const [event] = events;
      if (!event) throw new Error('no event');
      expect(event.payload).toMatchObject({
        externalId: ECHO_WAMID,
        chatId: USER,
        from: BUSINESS,
        senderInstanceId: instanceId,
        content: { type: 'text', text: "Here's the info you requested! https://www.meta.com/quest/quest-3/" },
      });
      expect(event.metadata.ingestMode).toBe('realtime');
      expect(raw(event)).toMatchObject({
        isFromMe: true,
        key: { id: ECHO_WAMID, fromMe: true },
        upsertType: 'notify',
        messageTimestamp: 1700255121,
        coexistence: 'smb_message_echoes',
        noAgentDispatch: true,
        meta: { to: USER },
      });
      // No remoteJid: the self-chat command checks (device-login, whatsapp-self) require one.
      expect((raw(event).key as Record<string, unknown>).remoteJid).toBeUndefined();
    });

    test('is never published as an API send (no message.sent)', async () => {
      await post(echoPayload());
      expect(bus.published.map((e) => e.type)).toEqual(['message.received']);
    });

    test('the same echo delivered twice is recorded once', async () => {
      await post(echoPayload());
      await post(echoPayload());
      expect(received()).toHaveLength(1);
    });

    test('an image echo carries the Meta media id for the media pipeline', async () => {
      await post(
        echoPayload({ type: 'image', text: undefined, image: { id: '1479537139650973', mime_type: 'image/jpeg' } }),
      );
      expect(received()[0]?.payload.content).toMatchObject({ type: 'image', mediaId: '1479537139650973' });
    });

    test('an echo without a recipient phone number, or a reaction echo, is skipped', async () => {
      await post(echoPayload({ to: undefined, to_user_id: 'US.13491208655302741918' }));
      await post(echoPayload({ id: 'wamid.react', type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } }));
      expect(bus.published).toEqual([]);
    });
  });

  describe('history', () => {
    test('ingests each thread message as history-sync, placeholders skipped', async () => {
      expect(await post(historyPayload())).toBe(200);

      const events = received();
      expect(events.map((e) => [e.payload.chatId, e.payload.from])).toEqual([
        [USER, BUSINESS],
        [USER, USER],
        ['12125557890', BUSINESS],
      ]);
      for (const event of events) {
        expect(event.metadata.ingestMode).toBe('history-sync');
        expect(raw(event)).toMatchObject({ isHistorySync: true, coexistence: 'history', noAgentDispatch: true });
      }
      const [businessSent, userSent] = events;
      expect(raw(businessSent as Published)).toMatchObject({
        isFromMe: true,
        key: { fromMe: true },
        messageTimestamp: 1739230955,
        historyStatus: 'read',
      });
      expect(businessSent?.payload.senderInstanceId).toBe(instanceId);
      expect(raw(userSent as Published)).toMatchObject({ isFromMe: false, key: { fromMe: false } });
      expect(userSent?.payload.senderInstanceId).toBeUndefined();
      // History is not live: no upsertType, so it is never own-device evidence.
      expect(raw(businessSent as Published).upsertType).toBeUndefined();
    });

    test("a media asset follows its placeholder into the sender's chat", async () => {
      await post(historyPayload());
      bus.published = [];

      await post(mediaAssetPayload(USER));

      const [asset] = received();
      expect(asset?.payload).toMatchObject({
        externalId: PLACEHOLDER_WAMID,
        chatId: USER,
        content: { type: 'image', mediaId: '24230790383178626', text: 'Black Prince echeveria' },
      });
      expect(asset?.metadata.ingestMode).toBe('history-sync');
    });

    test('a business-sent media asset finds its chat through the placeholder', async () => {
      await post(historyPayload());
      bus.published = [];

      await post(mediaAssetPayload(BUSINESS));

      const [asset] = received();
      expect(asset?.payload).toMatchObject({ chatId: USER, from: BUSINESS });
      expect(raw(asset as Published)).toMatchObject({ isFromMe: true });
    });

    test('a business message is told apart by the thread, not the display number (ninth digit)', async () => {
      await post(
        envelope('history', {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511900000001', phone_number_id: PHONE_NUMBER_ID },
          history: [
            {
              metadata: { phase: 0, chunk_order: 1, progress: 100 },
              threads: [
                {
                  id: '5511900000002',
                  messages: [
                    {
                      from: '551100000001',
                      id: 'wamid.br-1',
                      timestamp: '1739230955',
                      type: 'text',
                      text: { body: 'Oi' },
                    },
                    {
                      from: '5511900000002',
                      id: 'wamid.br-2',
                      timestamp: '1739230960',
                      type: 'text',
                      text: { body: 'Olá' },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      expect(received().map((e) => [e.payload.chatId, raw(e).isFromMe])).toEqual([
        ['5511900000002', true],
        ['5511900000002', false],
      ]);
    });

    test('declined history (2593109) acks 200, emits nothing and warns', async () => {
      expect(await post(declinedHistoryPayload())).toBe(200);
      expect(bus.published).toEqual([]);
      expect(logger.warnings).toContain('[whatsapp-business] history not shared');
    });
  });

  describe('smb_app_state_sync', () => {
    test('add stores the contact for the contacts sync and names the chat now', async () => {
      expect(await post(stateSyncPayload([PABLO]))).toBe(200);

      expect(bus.published).toEqual([
        expect.objectContaining({
          type: 'custom.contacts.names',
          payload: { names: [{ jid: USER, name: 'Pablo Morales' }] },
          metadata: expect.objectContaining({ instanceId, channelType: 'whatsapp-business' }),
        }),
      ]);
      const seen: unknown[] = [];
      const result = await plugin.fetchContacts(instanceId, { onContact: (c) => void seen.push(c) });
      expect(result.totalFetched).toBe(1);
      expect(seen).toEqual([{ platformUserId: USER, name: 'Pablo Morales', phone: `+${USER}`, isGroup: false }]);
    });

    test('remove drops the stored contact', async () => {
      await post(stateSyncPayload([PABLO]));
      await post(
        stateSyncPayload([
          { type: 'contact', contact: { phone_number: USER }, action: 'remove', metadata: { timestamp: '1738346100' } },
        ]),
      );
      expect((await plugin.fetchContacts(instanceId)).totalFetched).toBe(0);
    });

    test('a contact without a phone number is skipped', async () => {
      await post(stateSyncPayload([{ ...PABLO, contact: { full_name: 'No Phone', user_id: 'US.1' } }]));
      expect(bus.published).toEqual([]);
      expect(storage.data.size).toBe(0);
    });
  });

  describe('live messages field is unchanged', () => {
    test('an inbound customer message carries no coexistence keys and stays dispatchable', async () => {
      await post(
        envelope('messages', {
          messaging_product: 'whatsapp',
          metadata: METADATA,
          contacts: [{ profile: { name: 'Pablo' }, wa_id: USER }],
          messages: [{ from: USER, id: 'wamid.live-1', timestamp: '1739230999', type: 'text', text: { body: 'Hi' } }],
        }),
      );
      const [event] = received();
      expect(event?.payload).toMatchObject({ chatId: USER, from: USER, senderName: 'Pablo' });
      expect(event?.metadata.ingestMode).toBe('realtime');
      expect(Object.keys(raw(event as Published)).sort()).toEqual(
        ['filename', 'mediaId', 'meta', 'platformTimestampMs'].sort(),
      );
    });
  });
});
