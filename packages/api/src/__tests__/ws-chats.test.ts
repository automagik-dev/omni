/**
 * Tests for ws/chats.ts refactored helpers
 */

import { describe, expect, test } from 'bun:test';
import { createChatWebSocketHandler } from '../ws/chats';

// Mock database
const mockDb = {} as Parameters<typeof createChatWebSocketHandler>[0];

describe('createChatWebSocketHandler', () => {
  describe('broadcast filtering', () => {
    test('should broadcast message.new to all subscribers', () => {
      const handler = createChatWebSocketHandler(mockDb, null, 'test-instance');
      const received: string[] = [];

      // Mock WebSocket
      const mockWs = {
        send: (data: string) => received.push(data),
      };

      // Simulate open and subscribe
      handler.open(mockWs);

      // Broadcast a message
      handler.broadcast({
        type: 'message.new',
        chatId: 'chat-123',
        content: 'Hello',
      });

      expect(received.length).toBe(1);
      const parsed = JSON.parse(received[0] ?? '{}') as Record<string, unknown>;
      expect(parsed).toMatchObject({
        type: 'message.new',
        chatId: 'chat-123',
      });
    });

    test('should filter by chatId when subscribed to specific chat', () => {
      const handler = createChatWebSocketHandler(mockDb, null, 'test-instance');
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      // Subscribe to specific chat
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          chatId: 'chat-123',
        }),
      );

      // Broadcast to different chat - should NOT receive
      handler.broadcast({
        type: 'message.new',
        chatId: 'chat-456',
        content: 'Hello',
      });

      expect(received.length).toBe(0);

      // Broadcast to subscribed chat - should receive
      handler.broadcast({
        type: 'message.new',
        chatId: 'chat-123',
        content: 'Hello',
      });

      expect(received.length).toBe(1);
    });

    test('should filter chat.typing when includeTyping is false', () => {
      const handler = createChatWebSocketHandler(mockDb, null, 'test-instance');
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      // Subscribe without typing
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          includeTyping: false,
        }),
      );

      // Broadcast typing - should NOT receive
      handler.broadcast({
        type: 'chat.typing',
        chatId: 'chat-123',
        userId: 'user-1',
      });

      expect(received.length).toBe(0);

      // Broadcast message - should receive
      handler.broadcast({
        type: 'message.new',
        chatId: 'chat-123',
        content: 'Hello',
      });

      expect(received.length).toBe(1);
    });

    test('should filter chat.presence when includePresence is false', () => {
      const handler = createChatWebSocketHandler(mockDb, null, 'test-instance');
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          includePresence: false,
        }),
      );

      handler.broadcast({
        type: 'chat.presence',
        chatId: 'chat-123',
        status: 'online',
      });

      expect(received.length).toBe(0);
    });

    test('should filter chat.read when includeReadReceipts is false', () => {
      const handler = createChatWebSocketHandler(mockDb, null, 'test-instance');
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          includeReadReceipts: false,
        }),
      );

      handler.broadcast({
        type: 'chat.read',
        chatId: 'chat-123',
        messageId: 'msg-1',
      });

      expect(received.length).toBe(0);
    });

    test('should handle unsubscribe', () => {
      const handler = createChatWebSocketHandler(mockDb, null, 'test-instance');
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(mockWs, JSON.stringify({ type: 'unsubscribe' }));

      handler.broadcast({
        type: 'message.new',
        chatId: 'chat-123',
        content: 'Hello',
      });

      expect(received.length).toBe(0);
    });

    test('should handle close', () => {
      const handler = createChatWebSocketHandler(mockDb, null, 'test-instance');
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.close(mockWs);

      handler.broadcast({
        type: 'message.new',
        chatId: 'chat-123',
        content: 'Hello',
      });

      expect(received.length).toBe(0);
    });
  });
});
