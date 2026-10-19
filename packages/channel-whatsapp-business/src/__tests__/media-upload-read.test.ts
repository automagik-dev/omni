/**
 * #1278 — two requests the API accepts used to end in 5xx on the Cloud API
 * plugin:
 *
 *   1. media sent as file bytes (`metadata.base64`, the convention every other
 *      channel reads) went out as `{ link: "" }`; Meta answered #132018. The
 *      plugin now uploads the bytes (`POST /{phone-number-id}/media`) and
 *      sends the returned `{ id }`.
 *   2. `chats read` threw CAPABILITY_NOT_SUPPORTED: the plugin exposed neither
 *      `markChatAsRead` nor `markAsRead`. Both now mark the newest remembered
 *      inbound wamid (or the given wamids) read, honour `readReceipts: 'off'`,
 *      skip messages Omni sent and report Meta failures as CHANNEL_SEND_FAILED.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import { ERROR_CODES, OmniError } from '@omni/core';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import type { MetaInboundMessage } from '@omni/core/schemas';
import { WhatsAppBusinessPlugin } from '../plugin';

const instanceId = '00000000-0000-4000-8000-000000000001';
const PHONE_NUMBER_ID = '999888777';
const CUSTOMER = '5511987654321';

class MockLogger implements Logger {
  debug() {}
  info() {}
  warn() {}
  error() {}
  child(): Logger {
    return this;
  }
}

class MockStorage implements PluginStorage {
  private readonly data = new Map<string, unknown>();

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

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }
}

class MockEventBus implements EventBus {
  published: Array<{ type: string; payload: unknown; metadata?: unknown }> = [];

  async connect(): Promise<void> {}

  async publish(type: string, payload: unknown, metadata?: unknown): Promise<PublishResult> {
    this.published.push({ type, payload, metadata });
    return { id: 'test-id', sequence: 1, stream: 'test-stream' };
  }

  async publishGeneric(type: string, payload: unknown, metadata?: unknown): Promise<PublishResult> {
    return this.publish(type, payload, metadata);
  }

  async subscribe(): Promise<Subscription> {
    return { id: 'sub-1', pattern: '*', unsubscribe: async () => {} };
  }

  async subscribePattern(): Promise<Subscription> {
    return { id: 'sub-2', pattern: '*', unsubscribe: async () => {} };
  }

  async subscribeMany(): Promise<Subscription> {
    return { id: 'sub-3', pattern: '*', unsubscribe: async () => {} };
  }

  async subscribeAll(): Promise<Subscription> {
    return { id: 'sub-4', pattern: '*', unsubscribe: async () => {} };
  }

  async close(): Promise<void> {}

  isConnected(): boolean {
    return true;
  }
}

function createContext(eventBus: MockEventBus): PluginContext {
  return {
    eventBus,
    storage: new MockStorage(),
    logger: new MockLogger(),
    config: {
      env: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webhookBaseUrl: 'http://localhost:3000/webhooks',
      mediaStorage: { type: 'local', basePath: '/tmp/media' },
    },
    db: { execute: async () => [], getDrizzle: () => null },
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function inboundText(wamid: string, from: string = CUSTOMER): MetaInboundMessage {
  return {
    id: wamid,
    from,
    timestamp: '1785245000',
    type: 'text',
    text: { body: 'olá' },
  } as MetaInboundMessage;
}

async function receiveInbound(plugin: WhatsAppBusinessPlugin, msg: MetaInboundMessage): Promise<void> {
  const state = plugin.getInstanceState(instanceId);
  if (!state) throw new Error('instance not connected in test setup');
  await plugin.handleInboundMessage(instanceId, msg, undefined, state.dedupeCache);
}

function sentResponse(wamid = 'wamid.out-1'): Response {
  return okResponse({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: wamid }] });
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('WhatsAppBusinessPlugin media from file bytes (#1278)', () => {
  let plugin: WhatsAppBusinessPlugin;
  let eventBus: MockEventBus;
  let fetchSpy: ReturnType<typeof spyOn>;

  const sentEvent = () => eventBus.published.find((e) => e.type === 'message.sent')?.payload as Record<string, unknown>;

  beforeEach(async () => {
    plugin = new WhatsAppBusinessPlugin();
    eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ id: PHONE_NUMBER_ID }));
    await plugin.connect(instanceId, {
      instanceId,
      credentials: { metaAccessToken: 'EAAtest', metaPhoneNumberId: PHONE_NUMBER_ID, metaWabaId: '111222333' },
    });
    fetchSpy.mockClear();
    // Never reach the real Graph API: any call a test did not queue fails.
    fetchSpy.mockImplementation(async () => {
      throw new Error('unexpected fetch');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('uploads base64 bytes to /{phone-number-id}/media and sends the returned id', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ id: 'media-123' })).mockResolvedValueOnce(sentResponse());

    const result = await plugin.sendMessage(instanceId, {
      to: CUSTOMER,
      content: { type: 'image', mimeType: 'image/png', caption: 'Recibo' },
      metadata: { base64: PNG_BYTES.toString('base64') },
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const [uploadUrl, uploadInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(uploadUrl).toContain(`/${PHONE_NUMBER_ID}/media`);
    const form = uploadInit.body as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('type')).toBe('image/png');
    const file = form.get('file') as File;
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG_BYTES);

    const [sendUrl, sendInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toContain(`/${PHONE_NUMBER_ID}/messages`);
    expect(JSON.parse(sendInit.body as string).image).toEqual({ id: 'media-123', caption: 'Recibo' });
  });

  test('keeps the filename on an uploaded document', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ id: 'media-doc' })).mockResolvedValueOnce(sentResponse());

    await plugin.sendMessage(instanceId, {
      to: CUSTOMER,
      content: { type: 'document', mimeType: 'application/pdf', filename: 'boleto.pdf' },
      metadata: { base64: Buffer.from('%PDF-1.4').toString('base64') },
    });

    const form = (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect((form.get('file') as File).name).toBe('boleto.pdf');
    const sent = JSON.parse((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(sent.document).toEqual({ id: 'media-doc', filename: 'boleto.pdf' });
  });

  test('a public URL is still sent as link, without an upload', async () => {
    fetchSpy.mockResolvedValueOnce(sentResponse());

    await plugin.sendMessage(instanceId, {
      to: CUSTOMER,
      content: { type: 'image', mimeType: 'image/jpeg', mediaUrl: 'https://cdn.example.com/a.jpg' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(sent.image).toEqual({ link: 'https://cdn.example.com/a.jpg' });
  });

  test('rejects media with neither a URL nor bytes, without calling Meta', async () => {
    const result = await plugin.sendMessage(instanceId, {
      to: CUSTOMER,
      content: { type: 'image', mimeType: 'image/png' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('public URL or non-empty file bytes');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects base64 that decodes to no bytes, without uploading an empty file', async () => {
    const result = await plugin.sendMessage(instanceId, {
      to: CUSTOMER,
      content: { type: 'image', mimeType: 'image/png' },
      metadata: { base64: '!!!!' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('non-empty file bytes');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('message.sent keeps the media details and the uploaded media id of a base64 send', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ id: 'media-doc' })).mockResolvedValueOnce(sentResponse());

    await plugin.sendMessage(instanceId, {
      to: CUSTOMER,
      content: { type: 'document', mimeType: 'application/pdf', filename: 'boleto.pdf', caption: 'Seu boleto' },
      metadata: { base64: Buffer.from('%PDF-1.4').toString('base64') },
    });

    const sent = sentEvent();
    expect(sent.content).toMatchObject({
      type: 'document',
      text: 'Seu boleto',
      caption: 'Seu boleto',
      mimeType: 'application/pdf',
      filename: 'boleto.pdf',
    });
    expect(sent.rawPayload).toEqual({ mediaSource: 'meta-upload', metaMediaId: 'media-doc' });
  });

  test('message.sent of a URL send carries the URL and no upload reference', async () => {
    fetchSpy.mockResolvedValueOnce(sentResponse());

    await plugin.sendMessage(instanceId, {
      to: CUSTOMER,
      content: { type: 'image', mimeType: 'image/jpeg', mediaUrl: 'https://cdn.example.com/a.jpg' },
    });

    const sent = sentEvent();
    expect(sent.content).toMatchObject({ mediaUrl: 'https://cdn.example.com/a.jpg', mimeType: 'image/jpeg' });
    expect(sent.rawPayload).toBeUndefined();
  });
});

describe('WhatsAppBusinessPlugin read receipts (#1278)', () => {
  let plugin: WhatsAppBusinessPlugin;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    plugin = new WhatsAppBusinessPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ id: PHONE_NUMBER_ID }));
    await plugin.connect(instanceId, {
      instanceId,
      credentials: { metaAccessToken: 'EAAtest', metaPhoneNumberId: PHONE_NUMBER_ID, metaWabaId: '111222333' },
    });
    fetchSpy.mockClear();
    // Never reach the real Graph API: any call a test did not queue fails.
    fetchSpy.mockImplementation(async () => {
      throw new Error('unexpected fetch');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const readBody = (call: number) =>
    JSON.parse((fetchSpy.mock.calls[call] as [string, RequestInit])[1].body as string) as Record<string, unknown>;

  test('markChatAsRead marks the newest inbound message read (no typing indicator)', async () => {
    await receiveInbound(plugin, inboundText('wamid.older'));
    await receiveInbound(plugin, inboundText('wamid.newest'));
    fetchSpy.mockResolvedValueOnce(okResponse({ success: true }));

    await plugin.markChatAsRead(instanceId, `+${CUSTOMER}`);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(readBody(0)).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.newest' });
  });

  test('markChatAsRead is a no-op when no inbound message is remembered for the chat', async () => {
    await expect(plugin.markChatAsRead(instanceId, '5511900000000')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("markAsRead with ['all'] behaves like markChatAsRead", async () => {
    await receiveInbound(plugin, inboundText('wamid.only'));
    fetchSpy.mockResolvedValueOnce(okResponse({ success: true }));

    await plugin.markAsRead(instanceId, CUSTOMER, ['all']);

    expect(readBody(0).message_id).toBe('wamid.only');
  });

  test('markAsRead marks each given wamid read', async () => {
    fetchSpy.mockImplementation(async () => okResponse({ success: true }));

    await plugin.markAsRead(instanceId, CUSTOMER, ['wamid.a', 'wamid.b']);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect([readBody(0).message_id, readBody(1).message_id]).toEqual(['wamid.a', 'wamid.b']);
  });

  test('markAsRead skips messages Omni sent: Meta only accepts reads of received ones', async () => {
    fetchSpy.mockImplementation(async () => okResponse({ success: true }));

    await plugin.markAsRead(
      instanceId,
      CUSTOMER,
      ['wamid.in', 'wamid.out'],
      [
        { externalId: 'wamid.in', isFromMe: false },
        { externalId: 'wamid.out', isFromMe: true },
      ],
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(readBody(0).message_id).toBe('wamid.in');
  });

  test("readReceiptMode 'off' sends no read receipt", async () => {
    await receiveInbound(plugin, inboundText('wamid.quiet'));

    await plugin.markChatAsRead(instanceId, CUSTOMER, 'off');
    await plugin.markAsRead(instanceId, CUSTOMER, ['all'], undefined, 'off');
    await plugin.markAsRead(instanceId, CUSTOMER, ['wamid.quiet'], undefined, 'off');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a Meta failure is reported as CHANNEL_SEND_FAILED, not swallowed', async () => {
    await receiveInbound(plugin, inboundText('wamid.fail'));
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 100, message: 'Invalid parameter' } }), { status: 400 }),
    );

    const error = await plugin.markChatAsRead(instanceId, CUSTOMER).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OmniError);
    expect((error as OmniError).code).toBe(ERROR_CODES.CHANNEL_SEND_FAILED);
    expect((error as OmniError).message).toContain('Invalid parameter');
  });
});
