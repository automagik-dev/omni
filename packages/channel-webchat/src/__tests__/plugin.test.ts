/**
 * WebchatChannelPlugin — HTTP routing guard rails, inbound POST → message.received,
 * outbound send → SSE backlog replayed to the visitor's stream.
 */

import { beforeEach, describe, expect, it } from 'bun:test';

import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import { WebchatChannelPlugin } from '../plugin';

const instanceId = '00000000-0000-4000-8000-000000000042';
const visitorId = 'visitor-0001';
const base = `http://omni.test/api/v2/channels/webchat/${instanceId}`;

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

function post(body: unknown): Request {
  return new Request(`${base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Read the SSE body until `count` frames arrived, then cancel the stream. */
async function readFrames(response: Response, count: number): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let buffer = '';
  while (buffer.split('\n\n').length - 1 < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
  }
  await reader.cancel();
  return buffer.split('\n\n').filter(Boolean);
}

describe('WebchatChannelPlugin', () => {
  let bus: MockEventBus;
  let plugin: WebchatChannelPlugin;

  beforeEach(async () => {
    bus = new MockEventBus();
    plugin = new WebchatChannelPlugin();
    await plugin.initialize(createContext(bus));
  });

  it('refuses an instance that is not connected', async () => {
    const response = await plugin.handleWebhook(post({ visitorId, text: 'oi' }));
    expect(response.status).toBe(404);
    expect(bus.published.filter((e) => e.type === 'message.received')).toHaveLength(0);
  });

  describe('connected instance', () => {
    beforeEach(async () => {
      await plugin.connect(instanceId, { instanceId, credentials: {} });
    });

    it('answers 404 on an unknown action and 405 on the wrong method', async () => {
      expect((await plugin.handleWebhook(new Request(`${base}/nope`))).status).toBe(404);
      expect((await plugin.handleWebhook(new Request(`${base}/messages`))).status).toBe(405);
    });

    it('turns a visitor POST into message.received on the visitor chat', async () => {
      const response = await plugin.handleWebhook(post({ visitorId, name: 'Ana', text: 'oi' }));
      expect(response.status).toBe(202);
      const received = bus.published.find((e) => e.type === 'message.received');
      expect(received?.payload).toMatchObject({ chatId: visitorId, from: visitorId, content: { text: 'oi' } });
      expect(received?.metadata).toMatchObject({ instanceId });
    });

    it('rejects a body that fails the schema', async () => {
      const response = await plugin.handleWebhook(post({ visitorId: 'x', text: '' }));
      expect(response.status).toBe(400);
      expect(bus.published.filter((e) => e.type === 'message.received')).toHaveLength(0);
    });

    it('requires a valid visitorId to open the event stream', async () => {
      const response = await plugin.handleWebhook(new Request(`${base}/events`));
      expect(response.status).toBe(400);
    });

    it('keeps a reply for an offline visitor and replays it when the stream opens', async () => {
      const result = await plugin.sendMessage(instanceId, { to: visitorId, content: { type: 'text', text: 'olá' } });
      expect(result.success).toBe(true);
      expect(bus.published.some((e) => e.type === 'message.sent')).toBe(true);

      const stream = await plugin.handleWebhook(new Request(`${base}/events?visitorId=${visitorId}`));
      expect(stream.headers.get('Content-Type')).toBe('text/event-stream');
      const [ready, message] = await readFrames(stream, 2);
      expect(ready).toContain('event: ready');
      expect(message).toContain('event: message');
      expect(message).toContain('"text":"olá"');
    });
  });
});
