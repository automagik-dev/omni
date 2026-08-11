/**
 * Inbound media emission (issue #897).
 *
 * Meta Cloud defers the media download: an inbound audio/image/video/document
 * webhook carries only a `media_id`, never a public URL. The plugin must surface
 * that id on the emitted `message.received` `content.mediaId` so the media
 * pipeline can materialize the bytes via `downloadInboundMedia`. Before the fix
 * the id lived only in `rawPayload.mediaId`, `content.mediaId` was undefined, and
 * the media processor skipped the message — audio was persisted but never
 * transcribed.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import type { MetaInboundMessage } from '@omni/core/schemas';
import { WhatsAppBusinessPlugin } from '../plugin';

const instanceId = '00000000-0000-4000-8000-000000000001';
const PHONE_NUMBER_ID = '999888777';
const CUSTOMER = '5511987654321';
const META_MEDIA_ID = '1234567890123456';

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
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function inboundAudio(): MetaInboundMessage {
  return {
    id: 'wamid.audio-1',
    from: CUSTOMER,
    timestamp: '1785245000',
    type: 'audio',
    audio: { id: META_MEDIA_ID, mime_type: 'audio/ogg; codecs=opus', voice: true },
  } as MetaInboundMessage;
}

type ReceivedContent = { type: string; mediaId?: string; mediaUrl?: string; mimeType?: string; isVoiceNote?: boolean };

describe('WhatsAppBusinessPlugin inbound media emission', () => {
  let plugin: WhatsAppBusinessPlugin;
  let bus: MockEventBus;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    bus = new MockEventBus();
    plugin = new WhatsAppBusinessPlugin();
    await plugin.initialize(createContext(bus));
    // connect() validates the token via GET /{phone_number_id}.
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ id: PHONE_NUMBER_ID }));
    await plugin.connect(instanceId, {
      instanceId,
      credentials: { metaAccessToken: 'EAAtest', metaPhoneNumberId: PHONE_NUMBER_ID, metaWabaId: '111222333' },
    });
    fetchSpy.mockClear();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('surfaces the Meta media id on content.mediaId (not just rawPayload)', async () => {
    const state = plugin.getInstanceState(instanceId);
    if (!state) throw new Error('instance not connected in test setup');
    await plugin.handleInboundMessage(instanceId, inboundAudio(), undefined, state.dedupeCache);

    const received = bus.published.find((e) => e.type === 'message.received');
    expect(received).toBeDefined();
    const payload = received?.payload as { content: ReceivedContent; rawPayload?: { mediaId?: string } };

    // The defining assertion for #897: the media pipeline reads content.mediaId.
    expect(payload.content.type).toBe('audio');
    expect(payload.content.mediaId).toBe(META_MEDIA_ID);
    expect(payload.content.mimeType).toBe('audio/ogg; codecs=opus');
    expect(payload.content.isVoiceNote).toBe(true);
    // No public URL is available for deferred Meta media.
    expect(payload.content.mediaUrl).toBeUndefined();
    // Still mirrored in the raw record for debugging.
    expect(payload.rawPayload?.mediaId).toBe(META_MEDIA_ID);
  });
});
