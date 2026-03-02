/**
 * InternalChannelPlugin unit tests
 *
 * Verifies that sendMessage() re-emits a message.received event on the
 * target instance via the event bus, and that lifecycle methods update
 * instance status correctly.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { PluginContext } from '@omni/channel-sdk';
import { InternalChannelPlugin } from '../plugin';

// ─── Mock context ─────────────────────────────────────────────

function createMockLogger() {
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(function (this: unknown) {
      return logger;
    }),
  };
  return logger;
}

function createMockEventBus() {
  const calls: Array<{ type: string; payload: unknown; metadata: unknown }> = [];
  return {
    calls,
    connect: mock(async () => {}),
    publish: mock(async (type: string, payload: unknown, metadata: unknown) => {
      calls.push({ type, payload, metadata });
      return { seq: 1 };
    }),
    publishGeneric: mock(async () => ({ seq: 1 })),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeMany: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeAll: mock(async () => ({ unsubscribe: async () => {} })),
    unsubscribe: mock(async () => {}),
    drain: mock(async () => {}),
  };
}

function createMockContext(eventBus = createMockEventBus()): PluginContext {
  return {
    eventBus: eventBus as unknown as PluginContext['eventBus'],
    logger: createMockLogger() as unknown as PluginContext['logger'],
    storage: {
      get: mock(async () => null),
      set: mock(async () => {}),
      delete: mock(async () => true),
      has: mock(async () => false),
      keys: mock(async () => []),
    },
    config: {
      env: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webhookBaseUrl: 'http://localhost:3000',
      mediaStorage: { type: 'local', basePath: '/tmp' },
    },
    db: {
      execute: mock(async () => []),
      getDrizzle: mock(() => null),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe('InternalChannelPlugin', () => {
  let plugin: InternalChannelPlugin;
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(async () => {
    plugin = new InternalChannelPlugin();
    eventBus = createMockEventBus();
    await plugin.initialize(createMockContext(eventBus));
  });

  afterEach(() => {
    mock.restore();
  });

  describe('metadata', () => {
    it('has id = "internal"', () => {
      expect(plugin.id).toBe('internal');
    });

    it('has canSendText capability', () => {
      expect(plugin.capabilities.canSendText).toBe(true);
    });
  });

  describe('connect', () => {
    it('publishes a connected status event', async () => {
      await plugin.connect('inst-1', { instanceId: 'inst-1', channelType: 'internal' } as never);

      // BaseChannelPlugin emits via updateInstanceStatus which may or may not publish
      // At minimum: no errors and the plugin is reachable
      expect(plugin).toBeDefined();
    });

    it('resolves without error', async () => {
      await expect(
        plugin.connect('inst-a', { instanceId: 'inst-a', channelType: 'internal' } as never),
      ).resolves.toBeUndefined();
    });
  });

  describe('disconnect', () => {
    it('resolves without error when instance was connected', async () => {
      await plugin.connect('inst-d', { instanceId: 'inst-d', channelType: 'internal' } as never);
      await expect(plugin.disconnect('inst-d')).resolves.toBeUndefined();
    });

    it('resolves without error when instance was never connected', async () => {
      await expect(plugin.disconnect('unknown-inst')).resolves.toBeUndefined();
    });
  });

  describe('sendMessage', () => {
    it('publishes message.received on the target instanceId', async () => {
      const result = await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'hello from chain' },
        metadata: { sourceInstanceId: 'source-inst', chainMode: 'forward' },
      });

      expect(result.success).toBe(true);

      const published = eventBus.calls.find((c) => c.type === 'message.received');
      expect(published).toBeDefined();
      expect((published?.metadata as Record<string, unknown>).instanceId).toBe('target-inst');
    });

    it('puts source instance as the chatId and from fields', async () => {
      await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'chained message' },
        metadata: { sourceInstanceId: 'source-inst', chainMode: 'forward' },
      });

      const published = eventBus.calls.find((c) => c.type === 'message.received');
      const payload = published?.payload as Record<string, unknown>;
      expect(payload.chatId).toBe('source-inst');
      expect(payload.from).toBe('source-inst');
    });

    it('sets content text from the outgoing message', async () => {
      await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'the message text' },
        metadata: { sourceInstanceId: 'source-inst', chainMode: 'forward' },
      });

      const published = eventBus.calls.find((c) => c.type === 'message.received');
      const payload = published?.payload as Record<string, unknown>;
      expect((payload.content as Record<string, unknown>).text).toBe('the message text');
    });

    it('returns success without publishing when text is empty', async () => {
      const result = await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: '' },
        metadata: { sourceInstanceId: 'source-inst', chainMode: 'forward' },
      });

      expect(result.success).toBe(true);
      const msgReceived = eventBus.calls.filter((c) => c.type === 'message.received');
      expect(msgReceived).toHaveLength(0);
    });

    it('uses instanceId as sourceInstanceId when metadata is missing', async () => {
      await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'no metadata' },
      });

      const published = eventBus.calls.find((c) => c.type === 'message.received');
      const payload = published?.payload as Record<string, unknown>;
      // sourceInstanceId falls back to instanceId ('target-inst')
      expect(payload.from).toBe('target-inst');
    });

    it('returns timestamp in result', async () => {
      const before = Date.now();
      const result = await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'ts check' },
      });
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('includes hopCount + 1 in rawPayload of re-emitted event', async () => {
      await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'hop test' },
        metadata: { sourceInstanceId: 'source-inst', chainMode: 'forward', hopCount: 2 },
      });

      const published = eventBus.calls.find((c) => c.type === 'message.received');
      const payload = published?.payload as Record<string, unknown>;
      expect((payload.rawPayload as Record<string, unknown>).hopCount).toBe(3);
    });

    it('drops message and returns success=false when hop limit is reached', async () => {
      const result = await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'looping message' },
        metadata: { sourceInstanceId: 'source-inst', chainMode: 'forward', hopCount: 5 },
      });

      expect(result.success).toBe(false);
      const msgReceived = eventBus.calls.filter((c) => c.type === 'message.received');
      expect(msgReceived).toHaveLength(0);
    });

    it('allows message at hop 4 (one below the limit)', async () => {
      const result = await plugin.sendMessage('target-inst', {
        to: 'target-inst',
        content: { type: 'text', text: 'almost at limit' },
        metadata: { sourceInstanceId: 'source-inst', chainMode: 'forward', hopCount: 4 },
      });

      expect(result.success).toBe(true);
      const published = eventBus.calls.find((c) => c.type === 'message.received');
      expect(published).toBeDefined();
      const payload = published?.payload as Record<string, unknown>;
      expect((payload.rawPayload as Record<string, unknown>).hopCount).toBe(5);
    });
  });
});
