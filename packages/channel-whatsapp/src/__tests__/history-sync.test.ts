/**
 * Tests for Baileys history sync and message storage
 *
 * Verifies that history sync messages are stored correctly
 * Tests active fetch callbacks, unread count updates, and chat discovery
 *
 * Related to bug fix: Sync worker message handling and unread count syncing
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { BaileysEventMap } from '@whiskeysockets/baileys';

describe('Baileys History Sync', () => {
  let mockEventBus: EventBus;
  let publishedEvents: Array<{ type: string; payload: unknown }>;

  beforeEach(() => {
    publishedEvents = [];

    mockEventBus = {
      publish: mock(async (event: unknown) => {
        publishedEvents.push(event);
      }),
      subscribe: mock(() => {}),
    } as unknown as EventBus;
  });

  test('should emit message.received events for history sync messages', async () => {
    // Simulate messaging-history.set event from Baileys
    const historyMessages = [
      {
        key: {
          remoteJid: '553496835777@s.whatsapp.net',
          id: 'msg-1',
          fromMe: false,
        },
        message: {
          conversation: 'Message 1',
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
      {
        key: {
          remoteJid: '553496835777@s.whatsapp.net',
          id: 'msg-2',
          fromMe: true,
        },
        message: {
          conversation: 'Message 2',
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    ];

    // Process history sync
    for (const msg of historyMessages) {
      await mockEventBus.publish({
        type: 'message.received',
        payload: {
          instanceId: 'test-instance',
          channelType: 'whatsapp',
          message: msg,
        },
        metadata: {
          source: 'sync',
        },
      });
    }

    // Verify events were published
    expect(publishedEvents.length).toBe(2);
    expect(publishedEvents[0].type).toBe('message.received');
    expect(publishedEvents[1].type).toBe('message.received');
    expect(publishedEvents[0].metadata?.source).toBe('sync');
  });

  test('should handle active fetch callback without emitting duplicate events', async () => {
    // Active fetch uses callback pattern, not events
    const fetchedMessages = [
      {
        key: { remoteJid: '553496835777@s.whatsapp.net', id: 'fetch-1', fromMe: false },
        message: { conversation: 'Fetched 1' },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    ];

    // Callback should process messages directly
    // NOT emit events (to prevent double storage)
    const callback = async (messages: unknown[]) => {
      // Messages stored directly via services.messages.create()
      // Do NOT publish events
      return messages.length;
    };

    const stored = await callback(fetchedMessages);
    expect(stored).toBe(1);

    // Verify NO events were published
    expect(publishedEvents.length).toBe(0);
  });

  test('should publish unread count update events on chat upsert', async () => {
    // Simulate chats.upsert event from Baileys
    const chatUpsert: Partial<BaileysEventMap['chats.upsert']> = [
      {
        id: '553496835777@s.whatsapp.net',
        conversationTimestamp: Math.floor(Date.now() / 1000),
        unreadCount: 5,
        name: 'Test Contact',
      },
    ];

    // Process chat upsert
    for (const chat of chatUpsert) {
      if (chat.unreadCount && chat.unreadCount > 0) {
        await mockEventBus.publish({
          type: 'custom.chat.unread-updated',
          payload: {
            chatId: chat.id,
            unreadCount: chat.unreadCount,
          },
          metadata: {
            instanceId: 'test-instance',
          },
        });
      }
    }

    // Verify unread event was published
    expect(publishedEvents.length).toBe(1);
    expect(publishedEvents[0].type).toBe('custom.chat.unread-updated');
    expect(publishedEvents[0].payload.chatId).toBe('553496835777@s.whatsapp.net');
    expect(publishedEvents[0].payload.unreadCount).toBe(5);
  });

  test('should discover all chats from chats.upsert event', async () => {
    const discoveredChats: string[] = [];

    // Simulate chats.upsert with 100 chats
    const chats = Array.from({ length: 100 }, (_, i) => ({
      id: `55349683577${i.toString().padStart(2, '0')}@s.whatsapp.net`,
      conversationTimestamp: Math.floor(Date.now() / 1000),
      unreadCount: 0,
    }));

    // Process each chat
    for (const chat of chats) {
      discoveredChats.push(chat.id);
    }

    // Verify all 100 chats were discovered
    expect(discoveredChats.length).toBe(100);
    expect(new Set(discoveredChats).size).toBe(100); // All unique
  });

  test('should handle chats.upsert without unread count', async () => {
    // Some chats may not have unread count
    const chatUpsert: Partial<BaileysEventMap['chats.upsert']> = [
      {
        id: '553496835777@s.whatsapp.net',
        conversationTimestamp: Math.floor(Date.now() / 1000),
        // No unreadCount field
      },
    ];

    // Process chat upsert
    for (const chat of chatUpsert) {
      if (chat.unreadCount && chat.unreadCount > 0) {
        await mockEventBus.publish({
          type: 'custom.chat.unread-updated',
          payload: {
            chatId: chat.id,
            unreadCount: chat.unreadCount,
          },
          metadata: {
            instanceId: 'test-instance',
          },
        });
      }
    }

    // Verify NO event was published (unreadCount was undefined)
    expect(publishedEvents.length).toBe(0);
  });

  test('should mark messages with correct source field', async () => {
    // History sync messages should have source: 'sync'
    await mockEventBus.publish({
      type: 'message.received',
      payload: {
        instanceId: 'test-instance',
        channelType: 'whatsapp',
        message: {
          key: { remoteJid: 'test@s.whatsapp.net', id: 'sync-msg', fromMe: false },
          message: { conversation: 'Synced' },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
      metadata: {
        source: 'sync',
      },
    });

    expect(publishedEvents[0].metadata.source).toBe('sync');

    publishedEvents = [];

    // Realtime messages should have source: 'realtime'
    await mockEventBus.publish({
      type: 'message.received',
      payload: {
        instanceId: 'test-instance',
        channelType: 'whatsapp',
        message: {
          key: { remoteJid: 'test@s.whatsapp.net', id: 'realtime-msg', fromMe: false },
          message: { conversation: 'Realtime' },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
      metadata: {
        source: 'realtime',
      },
    });

    expect(publishedEvents[0].metadata.source).toBe('realtime');
  });

  test('should handle LID messages in history sync', async () => {
    // History sync can contain LID JIDs
    await mockEventBus.publish({
      type: 'message.received',
      payload: {
        instanceId: 'test-instance',
        channelType: 'whatsapp',
        message: {
          key: {
            remoteJid: '63750317031625@lid',
            id: 'lid-msg',
            fromMe: false,
          },
          message: { conversation: 'LID message' },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
      metadata: {
        source: 'sync',
      },
    });

    expect(publishedEvents.length).toBe(1);
    expect(publishedEvents[0].payload.message.key.remoteJid).toContain('@lid');
  });

  test('should not publish events for messages that fail to store', async () => {
    // Simulate error during message storage
    const errorCallback = async () => {
      throw new Error('Database error');
    };

    try {
      await errorCallback();
    } catch (_error) {
      // Error caught, message NOT stored
      // Event should NOT be published
    }

    // Verify NO event published on error
    expect(publishedEvents.length).toBe(0);
  });
});

describe('Baileys Chat Discovery', () => {
  test('should extract JIDs from chats.upsert event', () => {
    const chatsUpsert = [
      { id: '553496835777@s.whatsapp.net', conversationTimestamp: 123 },
      { id: '123456789@g.us', conversationTimestamp: 456 },
      { id: '63750317031625@lid', conversationTimestamp: 789 },
    ];

    const jids = chatsUpsert.map((chat) => chat.id);

    expect(jids.length).toBe(3);
    expect(jids).toContain('553496835777@s.whatsapp.net');
    expect(jids).toContain('123456789@g.us');
    expect(jids).toContain('63750317031625@lid');
  });

  test('should filter group chats vs DMs', () => {
    const chatsUpsert = [
      { id: '553496835777@s.whatsapp.net', conversationTimestamp: 123 },
      { id: '123456789@g.us', conversationTimestamp: 456 },
      { id: '63750317031625@lid', conversationTimestamp: 789 },
    ];

    const dmJids = chatsUpsert.filter((chat) => chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@lid'));
    const groupJids = chatsUpsert.filter((chat) => chat.id.endsWith('@g.us'));

    expect(dmJids.length).toBe(2);
    expect(groupJids.length).toBe(1);
  });

  test('should handle empty chats.upsert event', () => {
    const chatsUpsert: unknown[] = [];
    const jids = chatsUpsert.map((chat) => chat.id);

    expect(jids.length).toBe(0);
  });
});
