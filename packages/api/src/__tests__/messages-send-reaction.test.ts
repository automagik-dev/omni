/**
 * Tests for POST /messages/send/reaction (#386).
 *
 * Specifically covers the fromMe resolution contract:
 *   - target message found in DB → fromMe comes from messages.isFromMe
 *   - target message NOT in DB (history gap / unsynced chat) → fromMe is left
 *     undefined so the channel plugin applies its own heuristic. Previously
 *     this forced fromMe=false, which broke bot-to-own-message reactions in
 *     unsynced scenarios.
 */

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { NotFoundError, OmniError } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { chats, instances, messages } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createServices } from '../services';
import type { AppVariables } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

type SendMessageMock = ReturnType<typeof mock<(...args: unknown[]) => Promise<unknown>>>;

function createMockPlugin(sendMessageMock: SendMessageMock) {
  return {
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
    sendMessage: sendMessageMock,
  };
}

function createMockChannelRegistry(plugin: ReturnType<typeof createMockPlugin> | null) {
  return {
    get: mock(() => plugin),
    getAll: mock(() => (plugin ? [plugin] : [])),
    has: mock(() => !!plugin),
  };
}

describeWithDb('POST /messages/send/reaction — fromMe resolution (#386)', () => {
  let db: Database;
  let testInstance: Instance;
  let testChat: { id: string; externalId: string };
  let groupChat: { id: string; externalId: string };
  let inboundMessage: { id: string; externalId: string };
  let outboundMessage: { id: string; externalId: string };
  let groupInboundMessage: { id: string; externalId: string };
  const groupParticipant = '178035101794451@lid';
  const insertedInstanceIds: string[] = [];
  const insertedChatIds: string[] = [];
  const insertedMessageIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();

    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-react-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) throw new Error('Failed to create test instance');
    testInstance = instance;
    insertedInstanceIds.push(instance.id);

    const [chat] = await db
      .insert(chats)
      .values({
        instanceId: testInstance.id,
        externalId: '5511777777777@s.whatsapp.net',
        chatType: 'dm',
        channel: 'whatsapp-baileys',
        name: 'React Test Chat',
      })
      .returning();
    if (!chat) throw new Error('Failed to create test chat');
    testChat = { id: chat.id, externalId: chat.externalId };
    insertedChatIds.push(chat.id);

    const [group] = await db
      .insert(chats)
      .values({
        instanceId: testInstance.id,
        externalId: '120363424772797713@g.us',
        chatType: 'group',
        channel: 'whatsapp-baileys',
        name: 'React Test Group',
      })
      .returning();
    if (!group) throw new Error('Failed to create test group chat');
    groupChat = { id: group.id, externalId: group.externalId };
    insertedChatIds.push(group.id);

    const [inbound] = await db
      .insert(messages)
      .values({
        chatId: testChat.id,
        externalId: `INBOUND-${Date.now()}`,
        source: 'realtime',
        messageType: 'text',
        textContent: 'Inbound message',
        platformTimestamp: new Date(),
        isFromMe: false,
      })
      .returning();
    if (!inbound) throw new Error('Failed to create inbound message');
    inboundMessage = { id: inbound.id, externalId: inbound.externalId };
    insertedMessageIds.push(inbound.id);

    const outboundExternalId = `OUTBOUND-${Date.now()}`;
    const [outbound] = await db
      .insert(messages)
      .values({
        chatId: testChat.id,
        externalId: outboundExternalId,
        source: 'realtime',
        messageType: 'text',
        textContent: 'Outbound message',
        platformTimestamp: new Date(),
        isFromMe: true,
        rawPayload: {
          key: {
            id: outboundExternalId,
            fromMe: true,
            remoteJid: testChat.externalId,
            participant: '5511999999999@s.whatsapp.net',
          },
        },
      })
      .returning();
    if (!outbound) throw new Error('Failed to create outbound message');
    outboundMessage = { id: outbound.id, externalId: outbound.externalId };
    insertedMessageIds.push(outbound.id);

    const [groupInbound] = await db
      .insert(messages)
      .values({
        chatId: groupChat.id,
        externalId: '3AAFEE9E6DB2E7864DE2',
        source: 'realtime',
        messageType: 'text',
        textContent: 'Inbound group message',
        platformTimestamp: new Date(),
        isFromMe: false,
        rawPayload: {
          key: {
            id: '3AAFEE9E6DB2E7864DE2',
            fromMe: false,
            remoteJid: groupChat.externalId,
            participant: groupParticipant,
            participantAlt: '5511947879044@s.whatsapp.net',
            addressingMode: 'lid',
          },
        },
      })
      .returning();
    if (!groupInbound) throw new Error('Failed to create group inbound message');
    groupInboundMessage = { id: groupInbound.id, externalId: groupInbound.externalId };
    insertedMessageIds.push(groupInbound.id);
  });

  afterAll(async () => {
    for (const id of insertedMessageIds) await db.delete(messages).where(eq(messages.id, id));
    for (const id of insertedChatIds) await db.delete(chats).where(eq(chats.id, id));
    for (const id of insertedInstanceIds) await db.delete(instances).where(eq(instances.id, id));
  });

  function createTestApp(sendMessageMock: SendMessageMock) {
    const services = createServices(db, null);
    const plugin = createMockPlugin(sendMessageMock);
    const mockRegistry = createMockChannelRegistry(plugin);

    const app = new Hono<{ Variables: AppVariables }>();

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

    const { messagesRoutes } = require('../routes/v2/messages');
    app.route('/messages', messagesRoutes);

    return { app };
  }

  test('target message found and inbound → fromMe=false (sourced from DB)', async () => {
    const sendMessageMock = mock(async () => ({ success: true, messageId: 'REACT-1', timestamp: Date.now() }));
    const { app } = createTestApp(sendMessageMock);

    const res = await app.request('/messages/send/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: testChat.externalId,
        messageId: inboundMessage.externalId,
        emoji: '👍',
      }),
    });

    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const outgoing = (sendMessageMock.mock.calls[0] as unknown[])[1] as {
      metadata?: { fromMe?: boolean };
    };
    expect(outgoing.metadata).toBeDefined();
    expect(outgoing.metadata?.fromMe).toBe(false);
  });

  test('target group message from another participant includes participant key metadata', async () => {
    const sendMessageMock = mock(async () => ({ success: true, messageId: 'REACT-GROUP-1', timestamp: Date.now() }));
    const { app } = createTestApp(sendMessageMock);

    const res = await app.request('/messages/send/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: groupChat.externalId,
        messageId: groupInboundMessage.externalId,
        emoji: '👍',
      }),
    });

    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const outgoing = (sendMessageMock.mock.calls[0] as unknown[])[1] as {
      metadata?: { fromMe?: boolean; targetParticipant?: string };
    };
    expect(outgoing.metadata?.fromMe).toBe(false);
    expect(outgoing.metadata?.targetParticipant).toBe(groupParticipant);
  });

  test('target message found and outbound → fromMe=true (sourced from DB)', async () => {
    const sendMessageMock = mock(async () => ({ success: true, messageId: 'REACT-2', timestamp: Date.now() }));
    const { app } = createTestApp(sendMessageMock);

    const res = await app.request('/messages/send/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: testChat.externalId,
        messageId: outboundMessage.externalId,
        emoji: '🔥',
      }),
    });

    expect(res.status).toBe(200);
    const outgoing = (sendMessageMock.mock.calls[0] as unknown[])[1] as {
      metadata?: { fromMe?: boolean; targetParticipant?: string };
    };
    expect(outgoing.metadata?.fromMe).toBe(true);
    expect(outgoing.metadata?.targetParticipant).toBeUndefined();
  });

  test('target message NOT in DB → fromMe is undefined so plugin heuristic decides (#386)', async () => {
    const sendMessageMock = mock(async () => ({ success: true, messageId: 'REACT-3', timestamp: Date.now() }));
    const { app } = createTestApp(sendMessageMock);

    const res = await app.request('/messages/send/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: testChat.externalId,
        messageId: 'MISSING-MESSAGE-NOT-IN-DB',
        emoji: '👍',
      }),
    });

    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const outgoing = (sendMessageMock.mock.calls[0] as unknown[])[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(outgoing.metadata).toBeDefined();
    expect('fromMe' in (outgoing.metadata ?? {})).toBe(false);
    expect(outgoing.metadata?.fromMe).toBeUndefined();
  });

  test('target chat NOT in DB → fromMe is undefined, plugin still invoked', async () => {
    const sendMessageMock = mock(async () => ({ success: true, messageId: 'REACT-4', timestamp: Date.now() }));
    const { app } = createTestApp(sendMessageMock);

    const res = await app.request('/messages/send/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: testInstance.id,
        to: '5519000000000@s.whatsapp.net',
        messageId: 'SOME-MESSAGE-ID',
        emoji: '✅',
      }),
    });

    expect(res.status).toBe(200);
    const outgoing = (sendMessageMock.mock.calls[0] as unknown[])[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(outgoing.metadata?.fromMe).toBeUndefined();
  });
});
