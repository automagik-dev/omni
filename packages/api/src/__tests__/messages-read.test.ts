/**
 * Tests for read receipt endpoints:
 * - POST /messages/:id/read (single message)
 * - POST /messages/read (batch)
 * - POST /chats/:id/read (entire chat)
 *
 * @see api-completeness wish
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { NotFoundError, OmniError } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { chats, instances, messages } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createServices } from '../services';
import type { AppVariables } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

// Helper to create a mock plugin with configurable capabilities
function createMockPlugin(
  overrides: Partial<{
    canReceiveReadReceipts: boolean;
    markAsRead: (instanceId: string, chatId: string, messageIds: string[]) => Promise<void>;
    markChatAsRead: (instanceId: string, chatId: string) => Promise<void>;
  }> = {},
) {
  return {
    capabilities: {
      canSendText: true,
      canSendMedia: true,
      canSendReaction: true,
      canSendTyping: true,
      canReceiveReadReceipts: overrides.canReceiveReadReceipts ?? true,
      canReceiveDeliveryReceipts: true,
      canEditMessage: true,
      canDeleteMessage: true,
      canReplyToMessage: true,
      canForwardMessage: true,
      canSendContact: true,
      canSendLocation: true,
      canSendSticker: true,
      canHandleGroups: true,
      canHandleBroadcast: false,
      maxMessageLength: 65536,
      supportedMediaTypes: [],
      maxFileSize: 100 * 1024 * 1024,
    },
    markAsRead: overrides.markAsRead ?? mock(async () => {}),
    markChatAsRead: overrides.markChatAsRead ?? mock(async () => {}),
  };
}

// Helper to create a mock channel registry
function createMockChannelRegistry(plugin: ReturnType<typeof createMockPlugin> | null = null) {
  return {
    get: mock(() => plugin),
    getAll: mock(() => (plugin ? [plugin] : [])),
    has: mock(() => !!plugin),
  };
}

describeWithDb('Read Receipt Endpoints', () => {
  let db: Database;
  let testInstance: Instance;
  let testChat: { id: string; externalId: string };
  let testMessage: { id: string; externalId: string };
  const insertedInstanceIds: string[] = [];
  const insertedChatIds: string[] = [];
  const insertedMessageIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();

    // Create a test instance
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-read-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) {
      throw new Error('Failed to create test instance');
    }
    testInstance = instance;
    insertedInstanceIds.push(instance.id);

    // Create a test chat
    const [chat] = await db
      .insert(chats)
      .values({
        instanceId: testInstance.id,
        externalId: `test-chat-${Date.now()}@g.us`,
        chatType: 'group',
        channel: 'whatsapp-baileys',
        name: 'Test Chat',
      })
      .returning();
    if (!chat) {
      throw new Error('Failed to create test chat');
    }
    testChat = { id: chat.id, externalId: chat.externalId };
    insertedChatIds.push(chat.id);

    // Create a test message
    const [message] = await db
      .insert(messages)
      .values({
        chatId: testChat.id,
        externalId: `BAE5TEST${Date.now()}`,
        source: 'realtime',
        messageType: 'text',
        textContent: 'Test message',
        platformTimestamp: new Date(),
        isFromMe: false,
      })
      .returning();
    if (!message) {
      throw new Error('Failed to create test message');
    }
    testMessage = { id: message.id, externalId: message.externalId };
    insertedMessageIds.push(message.id);
  });

  afterAll(async () => {
    // Clean up in reverse order (messages -> chats -> instances)
    for (const id of insertedMessageIds) {
      await db.delete(messages).where(eq(messages.id, id));
    }
    for (const id of insertedChatIds) {
      await db.delete(chats).where(eq(chats.id, id));
    }
    for (const id of insertedInstanceIds) {
      await db.delete(instances).where(eq(instances.id, id));
    }
  });

  function createTestApp(mockPlugin: ReturnType<typeof createMockPlugin> | null = createMockPlugin()) {
    const services = createServices(db, null);
    const mockRegistry = createMockChannelRegistry(mockPlugin);

    const app = new Hono<{ Variables: AppVariables }>();

    // Error handler
    app.onError((error, c) => {
      if (error instanceof NotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404);
      }
      if (error instanceof OmniError) {
        return c.json({ error: { code: error.code, message: error.message } }, 400);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
    });

    app.use('*', async (c, next) => {
      c.set('services', services);
      c.set('channelRegistry', mockRegistry as unknown as AppVariables['channelRegistry']);
      c.set('apiKey', { id: 'test-key', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null });
      await next();
    });

    // Import and mount routes
    const { messagesRoutes } = require('../routes/v2/messages');
    const { chatsRoutes } = require('../routes/v2/chats');
    app.route('/messages', messagesRoutes);
    app.route('/chats', chatsRoutes);

    return { app, mockPlugin, mockRegistry };
  }

  describe('POST /messages/:id/read (single message)', () => {
    test('successfully marks single message as read', async () => {
      const markAsReadMock = mock(async () => {});
      const mockPlugin = createMockPlugin({ markAsRead: markAsReadMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/messages/${testMessage.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { messageId: string; externalMessageId: string } };
      expect(body.success).toBe(true);
      expect(body.data.messageId).toBe(testMessage.id);
      expect(body.data.externalMessageId).toBe(testMessage.externalId);
      expect(markAsReadMock).toHaveBeenCalledTimes(1);
      expect(markAsReadMock).toHaveBeenCalledWith(testInstance.id, testChat.externalId, [testMessage.externalId]);
    });

    test('returns error when channel does not support read receipts', async () => {
      const mockPlugin = createMockPlugin({ canReceiveReadReceipts: false });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/messages/${testMessage.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
    });

    test('returns 404 for non-existent message', async () => {
      const { app } = createTestApp();

      const res = await app.request('/messages/00000000-0000-0000-0000-000000000000/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
        }),
      });

      expect(res.status).toBe(404);
    });

    test('returns error when instance does not match message', async () => {
      // Create a second instance
      const [otherInstance] = await db
        .insert(instances)
        .values({
          name: `test-other-${Date.now()}`,
          channel: 'whatsapp-baileys' as const,
        })
        .returning();
      if (!otherInstance) {
        throw new Error('Failed to create other instance');
      }
      insertedInstanceIds.push(otherInstance.id);

      const { app } = createTestApp();

      const res = await app.request(`/messages/${testMessage.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: otherInstance.id,
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION');
      expect(body.error.message).toContain('Instance ID does not match');
    });
  });

  describe('POST /messages/read (batch)', () => {
    test('successfully marks multiple messages as read', async () => {
      const markAsReadMock = mock(async () => {});
      const mockPlugin = createMockPlugin({ markAsRead: markAsReadMock });
      const { app } = createTestApp(mockPlugin);

      const messageIds = ['MSG001', 'MSG002', 'MSG003'];

      const res = await app.request('/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
          chatId: testChat.externalId, // using external ID
          messageIds,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { messageCount: number } };
      expect(body.success).toBe(true);
      expect(body.data.messageCount).toBe(3);
      expect(markAsReadMock).toHaveBeenCalledTimes(1);
      expect(markAsReadMock).toHaveBeenCalledWith(testInstance.id, testChat.externalId, messageIds);
    });

    test('successfully marks batch using internal chat UUID', async () => {
      const markAsReadMock = mock(async () => {});
      const mockPlugin = createMockPlugin({ markAsRead: markAsReadMock });
      const { app } = createTestApp(mockPlugin);

      const messageIds = ['MSG001'];

      const res = await app.request('/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
          chatId: testChat.id, // using internal UUID
          messageIds,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { chatId: string } };
      expect(body.success).toBe(true);
      // Should resolve to external ID
      expect(body.data.chatId).toBe(testChat.externalId);
      expect(markAsReadMock).toHaveBeenCalledWith(testInstance.id, testChat.externalId, messageIds);
    });

    test('returns error when channel does not support read receipts', async () => {
      const mockPlugin = createMockPlugin({ canReceiveReadReceipts: false });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request('/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
          chatId: testChat.externalId,
          messageIds: ['MSG001'],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
    });

    test('validates messageIds array (min 1)', async () => {
      const { app } = createTestApp();

      const res = await app.request('/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
          chatId: testChat.externalId,
          messageIds: [], // empty array
        }),
      });

      expect(res.status).toBe(400);
    });

    test('validates messageIds array (max 100)', async () => {
      const { app } = createTestApp();

      // Create array with 101 elements
      const tooManyIds = Array.from({ length: 101 }, (_, i) => `MSG${i}`);

      const res = await app.request('/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
          chatId: testChat.externalId,
          messageIds: tooManyIds,
        }),
      });

      expect(res.status).toBe(400);
    });

    test('returns error when instance does not match chat', async () => {
      // Create a second instance
      const [otherInstance] = await db
        .insert(instances)
        .values({
          name: `test-other-batch-${Date.now()}`,
          channel: 'whatsapp-baileys' as const,
        })
        .returning();
      if (!otherInstance) {
        throw new Error('Failed to create other instance');
      }
      insertedInstanceIds.push(otherInstance.id);

      const { app } = createTestApp();

      const res = await app.request('/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: otherInstance.id,
          chatId: testChat.id, // internal UUID of chat belonging to different instance
          messageIds: ['MSG001'],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION');
      expect(body.error.message).toContain('Instance ID does not match');
    });
  });

  describe('POST /chats/:id/read (entire chat)', () => {
    test('successfully marks entire chat as read using markChatAsRead', async () => {
      const markChatAsReadMock = mock(async () => {});
      const mockPlugin = createMockPlugin({ markChatAsRead: markChatAsReadMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/chats/${testChat.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { chatId: string; externalChatId: string } };
      expect(body.success).toBe(true);
      expect(body.data.chatId).toBe(testChat.id);
      expect(body.data.externalChatId).toBe(testChat.externalId);
      expect(markChatAsReadMock).toHaveBeenCalledTimes(1);
      expect(markChatAsReadMock).toHaveBeenCalledWith(testInstance.id, testChat.externalId);
    });

    test('falls back to markAsRead with "all" when markChatAsRead not available', async () => {
      const markAsReadMock = mock(async () => {});
      // Create plugin without markChatAsRead
      const mockPlugin = {
        capabilities: {
          canSendText: true,
          canSendMedia: true,
          canSendReaction: true,
          canSendTyping: true,
          canReceiveReadReceipts: true,
          canReceiveDeliveryReceipts: true,
          canEditMessage: true,
          canDeleteMessage: true,
          canReplyToMessage: true,
          canForwardMessage: true,
          canSendContact: true,
          canSendLocation: true,
          canSendSticker: true,
          canHandleGroups: true,
          canHandleBroadcast: false,
          maxMessageLength: 65536,
          supportedMediaTypes: [],
          maxFileSize: 100 * 1024 * 1024,
        },
        markAsRead: markAsReadMock,
        // markChatAsRead is NOT defined
      };
      const { app } = createTestApp(mockPlugin as unknown as ReturnType<typeof createMockPlugin>);

      const res = await app.request(`/chats/${testChat.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
        }),
      });

      expect(res.status).toBe(200);
      expect(markAsReadMock).toHaveBeenCalledTimes(1);
      expect(markAsReadMock).toHaveBeenCalledWith(testInstance.id, testChat.externalId, ['all']);
    });

    test('returns error when channel does not support read receipts', async () => {
      const mockPlugin = createMockPlugin({ canReceiveReadReceipts: false });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/chats/${testChat.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
    });

    test('returns 404 for non-existent chat', async () => {
      const { app } = createTestApp();

      const res = await app.request('/chats/00000000-0000-0000-0000-000000000000/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: testInstance.id,
        }),
      });

      expect(res.status).toBe(404);
    });

    test('returns error when instance does not match chat', async () => {
      // Create a second instance
      const [otherInstance] = await db
        .insert(instances)
        .values({
          name: `test-other-chat-${Date.now()}`,
          channel: 'whatsapp-baileys' as const,
        })
        .returning();
      if (!otherInstance) {
        throw new Error('Failed to create other instance');
      }
      insertedInstanceIds.push(otherInstance.id);

      const { app } = createTestApp();

      const res = await app.request(`/chats/${testChat.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: otherInstance.id,
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION');
      expect(body.error.message).toContain('Instance ID does not match');
    });
  });
});
