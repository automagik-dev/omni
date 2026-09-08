/**
 * Tests for POST /messages/send/presence endpoint
 *
 * @see api-completeness wish
 */

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { OmniError } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createServices } from '../services';
import type { AppVariables } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

// Helper to create a mock plugin with configurable capabilities
function createMockPlugin(
  overrides: Partial<{
    canSendTyping: boolean;
    sendTyping: (instanceId: string, chatId: string, duration?: number) => Promise<void>;
    sendPresenceStatus: (
      instanceId: string,
      chatId: string,
      type: 'typing' | 'recording' | 'paused',
      duration?: number,
      options?: { threadId?: string; status?: string; loadingMessages?: string[] },
    ) => Promise<{
      delivered: boolean;
      method: string;
      threadId?: string;
      status?: string;
      loadingMessages?: string[];
      reason?: string;
    }>;
  }> = {},
) {
  return {
    capabilities: {
      canSendText: true,
      canSendMedia: true,
      canSendReaction: true,
      canSendTyping: overrides.canSendTyping ?? true,
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
    sendTyping: overrides.sendTyping ?? mock(async () => {}),
    ...(overrides.sendPresenceStatus ? { sendPresenceStatus: overrides.sendPresenceStatus } : {}),
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

describeWithDb('POST /messages/send/presence', () => {
  let db: Database;
  let testInstance: Instance;
  let testSlackInstance: Instance;
  const insertedInstanceIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();

    // Create a test instance
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-presence-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) {
      throw new Error('Failed to create test instance');
    }
    testInstance = instance;
    insertedInstanceIds.push(instance.id);

    const [slackInstance] = await db
      .insert(instances)
      .values({
        name: `test-slack-presence-${Date.now()}`,
        channel: 'slack' as const,
      })
      .returning();
    if (!slackInstance) {
      throw new Error('Failed to create Slack test instance');
    }
    testSlackInstance = slackInstance;
    insertedInstanceIds.push(slackInstance.id);
  });

  afterAll(async () => {
    // Clean up test instances
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

    // Import and mount the messages routes
    const { messagesRoutes } = require('../routes/v2/messages');
    app.route('/messages', messagesRoutes);

    return { app, mockPlugin, mockRegistry };
  }

  test('successfully sends typing indicator', async () => {
    const sendTypingMock = mock(async () => {});
    const mockPlugin = createMockPlugin({ sendTyping: sendTypingMock });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'typing',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { type: string; duration: number } };
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('typing');
    expect(body.data.duration).toBe(5000); // default duration
    expect(sendTypingMock).toHaveBeenCalledTimes(1);
  });

  test('successfully sends recording indicator (WhatsApp)', async () => {
    const sendTypingMock = mock(async () => {});
    const mockPlugin = createMockPlugin({ sendTyping: sendTypingMock });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'recording',
        duration: 10000,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { type: string; duration: number } };
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('recording');
    expect(body.data.duration).toBe(10000);
    expect(sendTypingMock).toHaveBeenCalledTimes(1);
  });

  test('successfully sends paused indicator', async () => {
    const sendTypingMock = mock(async () => {});
    const mockPlugin = createMockPlugin({ sendTyping: sendTypingMock });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'paused',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { type: string; duration: number } };
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('paused');
    expect(body.data.duration).toBe(0); // paused uses 0 duration
    expect(sendTypingMock).toHaveBeenCalledTimes(1);
  });

  test('returns error when channel does not support typing', async () => {
    const mockPlugin = createMockPlugin({ canSendTyping: false });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'typing',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(body.error.message).toContain('typing indicators or thread status');
  });

  test('uses Slack thread status sender when native typing capability is false', async () => {
    const sendPresenceStatusMock = mock(
      async (
        _instanceId: string,
        _chatId: string,
        _type: 'typing' | 'recording' | 'paused',
        _duration?: number,
        options?: { threadId?: string; status?: string; loadingMessages?: string[] },
      ) => ({
        delivered: true,
        method: 'agents.sessions.setStatus',
        threadId: options?.threadId,
        status: options?.status ?? 'is typing...',
        loadingMessages: options?.loadingMessages,
      }),
    );
    const mockPlugin = createMockPlugin({ canSendTyping: false, sendPresenceStatus: sendPresenceStatusMock });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testSlackInstance.id,
        to: 'C12345',
        type: 'typing',
        threadId: '1234567890.001',
        status: 'analisando contexto...',
        loadingMessages: ['Lendo contexto...', 'Chamando ferramentas...'],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { delivered: boolean; method: string; threadId?: string; status?: string; loadingMessages?: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.delivered).toBe(true);
    expect(body.data.method).toBe('agents.sessions.setStatus');
    expect(body.data.threadId).toBe('1234567890.001');
    expect(body.data.status).toBe('analisando contexto...');
    expect(body.data.loadingMessages).toEqual(['Lendo contexto...', 'Chamando ferramentas...']);
    expect(sendPresenceStatusMock).toHaveBeenCalledTimes(1);
    expect(sendPresenceStatusMock.mock.calls[0]).toEqual([
      testSlackInstance.id,
      'C12345',
      'typing',
      0,
      {
        threadId: '1234567890.001',
        status: 'analisando contexto...',
        loadingMessages: ['Lendo contexto...', 'Chamando ferramentas...'],
      },
    ]);
  });

  test('validates duration bounds (max 30000)', async () => {
    const sendTypingMock = mock(async () => {});
    const mockPlugin = createMockPlugin({ sendTyping: sendTypingMock });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'typing',
        duration: 50000, // exceeds max of 30000
      }),
    });

    expect(res.status).toBe(400);
  });

  test('validates duration bounds (min 0)', async () => {
    const sendTypingMock = mock(async () => {});
    const mockPlugin = createMockPlugin({ sendTyping: sendTypingMock });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'typing',
        duration: -1000, // below min of 0
      }),
    });

    expect(res.status).toBe(400);
  });

  test('accepts duration of 0 (until paused)', async () => {
    const sendTypingMock = mock(async () => {});
    const mockPlugin = createMockPlugin({ sendTyping: sendTypingMock });
    const { app } = createTestApp(mockPlugin);

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'typing',
        duration: 0,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { duration: number } };
    expect(body.data.duration).toBe(0);
  });

  test('returns error for invalid instance ID', async () => {
    const { app } = createTestApp();

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: '00000000-0000-0000-0000-000000000000',
        to: '5511999999999@s.whatsapp.net',
        type: 'typing',
      }),
    });

    expect(res.status).toBe(400);
  });

  test('returns error for missing required fields', async () => {
    const { app } = createTestApp();

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        // missing 'to' and 'type'
      }),
    });

    expect(res.status).toBe(400);
  });

  test('returns error for invalid presence type', async () => {
    const { app } = createTestApp();

    const res = await app.request('/messages/send/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5511999999999@s.whatsapp.net',
        type: 'invalid_type',
      }),
    });

    expect(res.status).toBe(400);
  });
});
