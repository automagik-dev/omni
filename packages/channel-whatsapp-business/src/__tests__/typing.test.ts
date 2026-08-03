/**
 * Typing indicator — `plugin.sendTyping` + the inbound-wamid memory feeding it.
 *
 * Meta's Cloud API shows the indicator by marking the newest RECEIVED message
 * as read with `typing_indicator: { type: 'text' }` (no free-standing presence
 * endpoint). These tests exercise the whole chain: inbound webhook message →
 * wamid remembered per chat → sendTyping POSTs the right payload — plus every
 * silent no-op path the sendTyping contract requires.
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

describe('WhatsAppBusinessPlugin.sendTyping', () => {
  let plugin: WhatsAppBusinessPlugin;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    plugin = new WhatsAppBusinessPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    // connect() validates the token via GET /{phone_number_id}.
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ id: PHONE_NUMBER_ID }));
    await plugin.connect(instanceId, {
      instanceId,
      credentials: {
        metaAccessToken: 'EAAtest',
        metaPhoneNumberId: PHONE_NUMBER_ID,
        metaWabaId: '111222333',
      },
    });
    fetchSpy.mockClear();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('posts read + typing_indicator referencing the newest inbound wamid', async () => {
    await receiveInbound(plugin, inboundText('wamid.older'));
    await receiveInbound(plugin, inboundText('wamid.newest'));

    fetchSpy.mockResolvedValueOnce(okResponse({ success: true }));
    await plugin.sendTyping(instanceId, CUSTOMER, 2500);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/${PHONE_NUMBER_ID}/messages`);
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.newest',
      typing_indicator: { type: 'text' },
    });
  });

  test('normalizes the chatId — a +E.164 chat id hits the digits-only key', async () => {
    await receiveInbound(plugin, inboundText('wamid.e164'));

    fetchSpy.mockResolvedValueOnce(okResponse({ success: true }));
    await plugin.sendTyping(instanceId, `+${CUSTOMER}`, 2500);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).message_id).toBe('wamid.e164');
  });

  test('silent no-op when the chat has no remembered inbound message', async () => {
    await plugin.sendTyping(instanceId, '5511900000000', 2500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('silent no-op for an unknown instance', async () => {
    await plugin.sendTyping('00000000-0000-4000-8000-999999999999', CUSTOMER, 2500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('duration === 0 (stop) is accepted and ignored — Meta has no cancel', async () => {
    await receiveInbound(plugin, inboundText('wamid.stop'));

    await plugin.sendTyping(instanceId, CUSTOMER, 0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a Meta API failure is swallowed — typing is best-effort', async () => {
    await receiveInbound(plugin, inboundText('wamid.fail'));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 190, message: 'bad token' } }), { status: 401 }),
    );
    await expect(plugin.sendTyping(instanceId, CUSTOMER, 2500)).resolves.toBeUndefined();
  });

  test('reactions do not overwrite the remembered wamid', async () => {
    await receiveInbound(plugin, inboundText('wamid.real-message'));
    await receiveInbound(plugin, {
      id: 'wamid.reaction',
      from: CUSTOMER,
      timestamp: '1785245001',
      type: 'reaction',
      reaction: { message_id: 'wamid.real-message', emoji: '👍' },
    } as MetaInboundMessage);

    fetchSpy.mockResolvedValueOnce(okResponse({ success: true }));
    await plugin.sendTyping(instanceId, CUSTOMER, 2500);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).message_id).toBe('wamid.real-message');
  });
});
