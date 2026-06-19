import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import { TwilioWhatsAppPlugin } from '../plugin';

const instanceId = '00000000-0000-4000-8000-000000000001';

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

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
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

async function connectPlugin(plugin: TwilioWhatsAppPlugin): Promise<void> {
  await plugin.connect(instanceId, {
    instanceId,
    credentials: {
      twilioAccountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      twilioAuthToken: 'auth-token',
      twilioFrom: 'whatsapp:+15550001111',
    },
    options: { twilioStatusCallbackUrl: 'https://example.com/status' },
  });
}

function requestBody(fetchSpy: ReturnType<typeof spyOn>): URLSearchParams {
  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return init.body as URLSearchParams;
}

describe('TwilioWhatsAppPlugin', () => {
  let plugin: TwilioWhatsAppPlugin;
  let eventBus: MockEventBus;

  beforeEach(async () => {
    plugin = new TwilioWhatsAppPlugin();
    eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    await connectPlugin(plugin);
  });

  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  test('sends image captions and preserves delivered text in message.sent', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ sid: 'SM123', status: 'queued' }));

    const result = await plugin.sendMessage(instanceId, {
      to: '+15559998888',
      content: {
        type: 'image',
        caption: 'photo caption',
        mediaUrl: 'https://cdn.example.com/photo.jpg',
      },
    });

    expect(result.success).toBe(true);
    expect(requestBody(fetchSpy).get('Body')).toBe('photo caption');

    const sent = eventBus.published.find((event) => event.type === 'message.sent');
    expect(sent?.payload).toMatchObject({
      externalId: 'SM123',
      chatId: 'whatsapp:+15559998888',
      content: {
        type: 'image',
        text: 'photo caption',
        mediaUrl: 'https://cdn.example.com/photo.jpg',
      },
    });
  });

  test('attaches document captions alongside media', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ sid: 'SM456', status: 'queued' }));

    const result = await plugin.sendMessage(instanceId, {
      to: '+15559998888',
      content: {
        type: 'document',
        caption: 'document caption',
        mediaUrl: 'https://cdn.example.com/report.pdf',
      },
    });

    expect(result.success).toBe(true);
    const body = requestBody(fetchSpy);
    expect(body.get('MediaUrl')).toBe('https://cdn.example.com/report.pdf');
    expect(body.get('Body')).toBe('document caption');

    const sent = eventBus.published.find((event) => event.type === 'message.sent');
    expect(sent?.payload).toMatchObject({
      externalId: 'SM456',
      content: {
        type: 'document',
        text: 'document caption',
        mediaUrl: 'https://cdn.example.com/report.pdf',
      },
    });
  });

  test('preserves location body text in message.sent', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ sid: 'SM789', status: 'queued' }));

    const result = await plugin.sendMessage(instanceId, {
      to: '+15559998888',
      content: {
        type: 'location',
        location: {
          latitude: 37.785834,
          longitude: -122.406417,
          name: 'HQ',
          address: '1 Market St',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(requestBody(fetchSpy).get('Body')).toBe('HQ\n1 Market St\n37.785834,-122.406417');

    const sent = eventBus.published.find((event) => event.type === 'message.sent');
    expect(sent?.payload).toMatchObject({
      externalId: 'SM789',
      content: {
        type: 'location',
        text: 'HQ\n1 Market St\n37.785834,-122.406417',
      },
    });
  });
});
