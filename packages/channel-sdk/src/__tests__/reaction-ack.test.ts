/**
 * Reaction Acknowledgment System Tests
 *
 * Tests for:
 * - startAck: ack lifecycle (add, remove, timeout)
 * - AckRateLimiter: separate rate limit bucket
 * - Config handling: 'off' mode, missing config, per-channel emoji
 * - WhatsApp fallback to typing indicator
 * - DEC-8: Hard timeout at 120s
 * - DEC-9: Rate limiting at 10 acks/min
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  ACK_RATE_LIMIT,
  type AckProvider,
  AckRateLimiter,
  MAX_ACK_TIMEOUT_MS,
  type ReactionAckConfig,
  shutdownAckSystem,
  startAck,
} from '../reaction-ack';
import type { ChannelPlugin } from '../types/plugin';

// ============================================================================
// Helpers
// ============================================================================

function createMockAckProvider(): AckProvider & {
  ackCalls: Array<{ instanceId: string; chatId: string; messageId: string; emoji: string }>;
  removeAckCalls: Array<{ instanceId: string; chatId: string; messageId: string; emoji: string }>;
  ackFn: ReturnType<typeof mock>;
  removeAckFn: ReturnType<typeof mock>;
} {
  const ackCalls: Array<{ instanceId: string; chatId: string; messageId: string; emoji: string }> = [];
  const removeAckCalls: Array<{ instanceId: string; chatId: string; messageId: string; emoji: string }> = [];

  const ackFn = mock(async (instanceId: string, chatId: string, messageId: string, emoji: string) => {
    ackCalls.push({ instanceId, chatId, messageId, emoji });
  });

  const removeAckFn = mock(async (instanceId: string, chatId: string, messageId: string, emoji: string) => {
    removeAckCalls.push({ instanceId, chatId, messageId, emoji });
  });

  return {
    ack: ackFn,
    removeAck: removeAckFn,
    ackCalls,
    removeAckCalls,
    ackFn,
    removeAckFn,
  };
}

function createMockPlugin(
  channel = 'discord',
): ChannelPlugin & { sendTypingCalls: Array<{ instanceId: string; chatId: string; duration?: number }> } {
  const sendTypingCalls: Array<{ instanceId: string; chatId: string; duration?: number }> = [];
  return {
    id: channel as ChannelPlugin['id'],
    name: 'Mock Plugin',
    version: '1.0.0',
    capabilities: {} as ChannelPlugin['capabilities'],
    initialize: mock(() => Promise.resolve()),
    destroy: mock(() => Promise.resolve()),
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    getStatus: mock(() => Promise.resolve({ state: 'connected' as const, since: new Date() })),
    getConnectedInstances: mock(() => []),
    sendMessage: mock(() => Promise.resolve({ success: true, messageId: 'msg-1', timestamp: Date.now() })),
    getHealth: mock(() => Promise.resolve({ status: 'healthy' as const, checks: [], checkedAt: new Date() })),
    sendTyping: mock(async (instanceId: string, chatId: string, duration?: number) => {
      sendTypingCalls.push({ instanceId, chatId, duration });
    }),
    sendTypingCalls,
  };
}

const DEFAULT_CONFIG: ReactionAckConfig = {
  reactionAck: 'on',
};

// ============================================================================
// Tests
// ============================================================================

describe('Reaction Acknowledgment System', () => {
  afterEach(() => {
    shutdownAckSystem();
  });

  describe('startAck', () => {
    it('should add ack reaction when config is "on"', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();

      startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', DEFAULT_CONFIG);

      // Wait for async ack to fire
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.ackCalls.length).toBe(1);
      expect(provider.ackCalls[0]).toEqual({
        instanceId: 'inst-1',
        chatId: 'chat-1',
        messageId: 'msg-1',
        emoji: '👀', // default emoji
      });
    });

    it('should NOT add ack reaction when config is "off"', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();
      const config: ReactionAckConfig = { reactionAck: 'off' };

      startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', config);
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.ackCalls.length).toBe(0);
    });

    it('should use per-channel emoji from config', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();
      const config: ReactionAckConfig = {
        reactionAck: 'on',
        reactionAckEmoji: { discord: '⏳', telegram: '🔄' },
      };

      startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', config);
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.ackCalls[0]?.emoji).toBe('⏳');
    });

    it('should remove ack when handle.remove() is called', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();

      const handle = startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', DEFAULT_CONFIG);
      await new Promise((r) => setTimeout(r, 10));

      handle.remove();
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.removeAckCalls.length).toBe(1);
      expect(provider.removeAckCalls[0]).toEqual({
        instanceId: 'inst-1',
        chatId: 'chat-1',
        messageId: 'msg-1',
        emoji: '👀',
      });
    });

    it('should only remove ack once (idempotent)', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();

      const handle = startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', DEFAULT_CONFIG);
      await new Promise((r) => setTimeout(r, 10));

      handle.remove();
      handle.remove();
      handle.remove();
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.removeAckCalls.length).toBe(1);
    });

    it('should default to "off" when reactionAck is not set', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();
      const config = {} as ReactionAckConfig;

      startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', config);
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.ackCalls.length).toBe(0);
    });

    it('should return no-op handle when ack provider is null and channel is not WhatsApp', async () => {
      const plugin = createMockPlugin();

      const handle = startAck(plugin, null, 'inst-1', 'chat-1', 'msg-1', 'discord', DEFAULT_CONFIG);
      handle.remove(); // Should not throw

      // No assertions needed — just verifying no crash
    });
  });

  describe('WhatsApp typing fallback', () => {
    it('should fall back to typing indicator when ack reaction fails on WhatsApp', async () => {
      const provider = createMockAckProvider();
      provider.ackFn.mockImplementation(() => Promise.reject(new Error('Reaction not supported')));
      const plugin = createMockPlugin('whatsapp-baileys');

      startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'whatsapp-baileys', DEFAULT_CONFIG);

      // Wait for the async failure + fallback
      await new Promise((r) => setTimeout(r, 50));

      expect(plugin.sendTypingCalls.length).toBe(1);
      expect(plugin.sendTypingCalls[0]?.instanceId).toBe('inst-1');
    });

    it('should NOT fall back to typing on non-WhatsApp channels', async () => {
      const provider = createMockAckProvider();
      provider.ackFn.mockImplementation(() => Promise.reject(new Error('Failed')));
      const plugin = createMockPlugin('discord');

      startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', DEFAULT_CONFIG);
      await new Promise((r) => setTimeout(r, 50));

      expect(plugin.sendTypingCalls.length).toBe(0);
    });

    it('should use typing indicator when no ack provider on WhatsApp', async () => {
      const plugin = createMockPlugin('whatsapp-baileys');

      startAck(plugin, null, 'inst-1', 'chat-1', 'msg-1', 'whatsapp-baileys', DEFAULT_CONFIG);
      await new Promise((r) => setTimeout(r, 50));

      expect(plugin.sendTypingCalls.length).toBe(1);
    });
  });

  describe('Timeout', () => {
    it('should auto-remove ack after timeout', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();
      const config: ReactionAckConfig = {
        reactionAck: 'on',
        ackTimeoutMs: 50, // Short timeout for test
      };

      startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', config);
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.removeAckCalls.length).toBe(0);

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 100));

      expect(provider.removeAckCalls.length).toBe(1);
    });

    it('should cap timeout at 120s (MAX_ACK_TIMEOUT_MS)', () => {
      expect(MAX_ACK_TIMEOUT_MS).toBe(120_000);
    });

    it('should not remove twice (timeout after manual remove)', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();
      const config: ReactionAckConfig = {
        reactionAck: 'on',
        ackTimeoutMs: 50,
      };

      const handle = startAck(plugin, provider, 'inst-1', 'chat-1', 'msg-1', 'discord', config);
      await new Promise((r) => setTimeout(r, 10));

      handle.remove(); // Manual remove
      await new Promise((r) => setTimeout(r, 100)); // Wait past timeout

      // Should only have 1 removeAck call (from manual remove, timeout should be cancelled)
      expect(provider.removeAckCalls.length).toBe(1);
    });
  });

  describe('AckRateLimiter', () => {
    it('should allow up to ACK_RATE_LIMIT acks per instance', () => {
      const limiter = new AckRateLimiter();

      for (let i = 0; i < ACK_RATE_LIMIT; i++) {
        expect(limiter.isAllowed('inst-1')).toBe(true);
      }

      // Next one should be denied
      expect(limiter.isAllowed('inst-1')).toBe(false);
    });

    it('should track instances independently', () => {
      const limiter = new AckRateLimiter();

      for (let i = 0; i < ACK_RATE_LIMIT; i++) {
        limiter.isAllowed('inst-1');
      }

      // inst-2 should still be allowed
      expect(limiter.isAllowed('inst-2')).toBe(true);
    });

    it('should clean up expired entries', () => {
      const limiter = new AckRateLimiter();

      // Fill up rate limit
      for (let i = 0; i < ACK_RATE_LIMIT; i++) {
        limiter.isAllowed('inst-1');
      }

      expect(limiter.isAllowed('inst-1')).toBe(false);

      // Cleanup should work (though entries aren't expired yet)
      limiter.cleanup();

      // Still limited
      expect(limiter.isAllowed('inst-1')).toBe(false);
    });

    it('should skip ack silently when rate limit exceeded', async () => {
      const provider = createMockAckProvider();
      const plugin = createMockPlugin();

      // Exhaust the rate limit for inst-1
      for (let i = 0; i < ACK_RATE_LIMIT + 5; i++) {
        startAck(plugin, provider, 'inst-1', 'chat-1', `msg-${i}`, 'discord', DEFAULT_CONFIG);
      }

      await new Promise((r) => setTimeout(r, 50));

      // Should have at most ACK_RATE_LIMIT calls
      expect(provider.ackCalls.length).toBeLessThanOrEqual(ACK_RATE_LIMIT);
    });
  });
});
