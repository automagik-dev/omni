/**
 * Tests for reaction echo prevention (#336).
 *
 * Verifies that the bot's own reactions (isFromMe=true) do NOT get
 * dual-emitted as message.received events, preventing dispatch loops.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { WhatsAppPlugin } from '../plugin';

// Minimal mock for EventBus
function createMockEventBus() {
  const published: Array<{ type: string; payload: unknown; metadata: unknown }> = [];
  return {
    published,
    publish: mock(async (type: string, payload: unknown, metadata: unknown) => {
      published.push({ type, payload, metadata });
      return 'mock-correlation-id';
    }),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
  };
}

function createPlugin(eventBus: ReturnType<typeof createMockEventBus>): WhatsAppPlugin {
  const plugin = new WhatsAppPlugin();
  // Initialize with minimal context (cast to never to satisfy full EventBus type)
  plugin.initialize({
    eventBus: eventBus as never,
    logger: {
      child: () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as never,
    storage: {} as never,
    config: {} as never,
    db: {} as never,
  });
  return plugin;
}

describe('Reaction echo prevention (#336)', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;
  let plugin: WhatsAppPlugin;

  beforeEach(() => {
    eventBus = createMockEventBus();
    plugin = createPlugin(eventBus);
    // Reset env
    process.env.OMNI_DUAL_EMIT_REACTIONS = undefined;
  });

  describe('handleReactionReceived with isFromMe=true', () => {
    it('emits reaction.received but NOT message.received', async () => {
      await plugin.handleReactionReceived(
        'instance-1',
        'ext-123',
        'chat-456@s.whatsapp.net',
        '5511999999999',
        '👀',
        'target-msg-789',
        true, // isFromMe
      );

      const types = eventBus.published.map((e) => e.type);
      expect(types).toContain('reaction.received');
      expect(types).not.toContain('message.received');
    });

    it('emits reaction.removed but NOT message.received for emoji removal', async () => {
      await plugin.handleReactionReceived(
        'instance-1',
        'ext-123',
        'chat-456@s.whatsapp.net',
        '5511999999999',
        '', // empty = removal
        'target-msg-789',
        true, // isFromMe
      );

      const types = eventBus.published.map((e) => e.type);
      expect(types).toContain('reaction.removed');
      expect(types).not.toContain('message.received');
    });
  });

  describe('handleReactionReceived with isFromMe=false', () => {
    it('emits both reaction.received AND message.received (dual-emit)', async () => {
      await plugin.handleReactionReceived(
        'instance-1',
        'ext-123',
        'chat-456@s.whatsapp.net',
        '5511999999999',
        '👍',
        'target-msg-789',
        false, // isFromMe
      );

      const types = eventBus.published.map((e) => e.type);
      expect(types).toContain('reaction.received');
      expect(types).toContain('message.received');
    });

    it('skips message.received when OMNI_DUAL_EMIT_REACTIONS=false', async () => {
      process.env.OMNI_DUAL_EMIT_REACTIONS = 'false';

      await plugin.handleReactionReceived(
        'instance-1',
        'ext-123',
        'chat-456@s.whatsapp.net',
        '5511999999999',
        '❤️',
        'target-msg-789',
        false,
      );

      const types = eventBus.published.map((e) => e.type);
      expect(types).toContain('reaction.received');
      expect(types).not.toContain('message.received');
    });
  });

  describe('sentMessageIds cache tracks reaction IDs', () => {
    it('trackSentMessageId makes isBotSentMessage return true', () => {
      plugin.trackSentMessageId('instance-1', 'reaction-msg-001');
      expect(plugin.isBotSentMessage('instance-1', 'reaction-msg-001')).toBe(true);
    });

    it('isBotSentMessage returns false for untracked IDs', () => {
      expect(plugin.isBotSentMessage('instance-1', 'unknown-msg')).toBe(false);
    });

    it('isBotSentMessage returns false for different instance', () => {
      plugin.trackSentMessageId('instance-1', 'reaction-msg-001');
      expect(plugin.isBotSentMessage('instance-2', 'reaction-msg-001')).toBe(false);
    });
  });
});
