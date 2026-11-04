/**
 * #1279 — the Brazilian ninth digit. For area codes 31+ WhatsApp's id
 * (`wa_id`) has no 9 after the area code, but people type numbers with it.
 * Inbound messages are keyed by Meta's `from` (the wa_id); outbound ones used
 * to be keyed by `to` as typed, so one person ended up in two chats (and the
 * delivered/read/failed webhooks, keyed by wa_id, missed the outbound chat).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
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

/** A Meta send response; `waId` is what Meta resolved the recipient to. */
function sentResponse(waId: string, wamid = 'wamid.out-1'): Response {
  return okResponse({
    messaging_product: 'whatsapp',
    contacts: [{ input: 'as-typed', wa_id: waId }],
    messages: [{ id: wamid }],
  });
}

const sentChatIds = (bus: MockEventBus) =>
  bus.published.filter((e) => e.type === 'message.sent').map((e) => (e.payload as { chatId: string }).chatId);

describe('Brazilian ninth digit on whatsapp-business (#1279)', () => {
  let plugin: WhatsAppBusinessPlugin;
  let bus: MockEventBus;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    plugin = new WhatsAppBusinessPlugin();
    bus = new MockEventBus();
    await plugin.initialize(createContext(bus));
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
    bus.published = [];
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('message.sent is keyed by the wa_id Meta returns, so it lands in the inbound chat', async () => {
    fetchSpy.mockResolvedValueOnce(sentResponse('553491234567'));

    await plugin.sendMessage(instanceId, { to: '+55 34 9 9123-4567', content: { type: 'text', text: 'oi' } });

    expect(sentChatIds(bus)).toEqual(['553491234567']);

    // The person's reply arrives with from = wa_id: same chat id.
    await receiveInbound(plugin, inboundText('wamid.reply', '553491234567'));
    const received = bus.published.find((e) => e.type === 'message.received');
    expect((received?.payload as { chatId: string }).chatId).toBe('553491234567');
  });

  test('without a wa_id in the response, the ninth digit is normalized like the Baileys channel', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.x' }] }));

    await plugin.sendMessage(instanceId, { to: '+5534991234567', content: { type: 'text', text: 'oi' } });

    expect(sentChatIds(bus)).toEqual(['553491234567']);
  });

  test('area codes 11-30 keep the ninth digit, and + is dropped', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.y' }] }));

    await plugin.sendMessage(instanceId, { to: '+5511987654321', content: { type: 'text', text: 'oi' } });

    expect(sentChatIds(bus)).toEqual(['5511987654321']);
  });

  test('message.failed uses the same normalized chat id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 131026, message: 'Message undeliverable' } }), { status: 400 }),
    );

    await plugin.sendMessage(instanceId, { to: '+55 34 9 9123-4567', content: { type: 'text', text: 'oi' } });

    const failed = bus.published.find((e) => e.type === 'message.failed');
    expect((failed?.payload as { chatId: string }).chatId).toBe('553491234567');
  });

  test('sendTyping finds the inbound wamid when the chat id is written with the ninth digit', async () => {
    await receiveInbound(plugin, inboundText('wamid.in', '553491234567'));
    fetchSpy.mockResolvedValueOnce(okResponse({ success: true }));

    await plugin.sendTyping(instanceId, '+5534991234567', 2500);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).message_id).toBe('wamid.in');
  });
});
