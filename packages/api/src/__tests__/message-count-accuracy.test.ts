/**
 * Tests for message count accuracy
 *
 * Verifies that message_count field always matches actual message rows
 * Tests for race conditions, concurrent operations, and failure handling
 *
 * Related to bug fix: Message count mismatches and dual increment issues
 */

// @ts-nocheck - Integration tests with DB queries that may return undefined
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { chats, instances, messages } from '@omni/db';
import { eq, sql } from 'drizzle-orm';
import { ChatService } from '../services/chats';
import { MessageService } from '../services/messages';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Message Count Accuracy', () => {
  let db: Database;
  let messageService: MessageService;
  let chatService: ChatService;
  let testInstanceId: string;
  let testChatId: string;

  beforeAll(async () => {
    db = getTestDb();
    messageService = new MessageService(db, null);
    chatService = new ChatService(db, null);

    // Create test instance
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-msg-count-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) {
      throw new Error('Failed to create test instance');
    }
    testInstanceId = instance.id;

    // Create test chat
    const { chat } = await chatService.findOrCreate(testInstanceId, 'test-chat@s.whatsapp.net', {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });
    testChatId = chat.id;
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(messages).where(eq(messages.chatId, testChatId));
    await db.delete(chats).where(eq(chats.id, testChatId));
    await db.delete(instances).where(eq(instances.id, testInstanceId));
  });
  test('should maintain accurate count when creating messages sequentially', async () => {
    const messageCount = 10;

    // Create messages sequentially
    for (let i = 0; i < messageCount; i++) {
      await messageService.create({
        chatId: testChatId,
        externalId: `msg-sequential-${i}`,
        source: 'realtime',
        messageType: 'text',
        textContent: `Message ${i}`,
        platformTimestamp: new Date(),
        isFromMe: false,
        hasMedia: false,
      });
    }

    // Verify count matches actual messages
    const [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    const [actualCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatId, testChatId));

    const actualCountNum = Number(actualCount.count);

    expect(chatData.messageCount).toBe(messageCount);
    expect(actualCountNum).toBe(messageCount);
    expect(chatData.messageCount).toBe(actualCountNum);
  });

  test('should maintain accurate count when creating messages concurrently', async () => {
    // Reset chat for this test
    await db.delete(messages).where(eq(messages.chatId, testChatId));
    await db.update(chats).set({ messageCount: 0 }).where(eq(chats.id, testChatId));

    const concurrentCount = 100;

    // Create messages concurrently
    const promises = Array.from({ length: concurrentCount }, (_, i) =>
      messageService.create({
        chatId: testChatId,
        externalId: `msg-concurrent-${i}-${Date.now()}`,
        source: 'realtime',
        messageType: 'text',
        textContent: `Concurrent message ${i}`,
        platformTimestamp: new Date(),
        isFromMe: false,
        hasMedia: false,
      }),
    );

    await Promise.all(promises);

    // Verify count matches actual messages
    const [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    const [actualCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatId, testChatId));

    const actualCountNum = Number(actualCount.count);

    expect(chatData.messageCount).toBe(concurrentCount);
    expect(actualCountNum).toBe(concurrentCount);
    expect(chatData.messageCount).toBe(actualCountNum);
  });

  test('should handle sync and realtime messages correctly', async () => {
    // Reset chat
    await db.delete(messages).where(eq(messages.chatId, testChatId));
    await db.update(chats).set({ messageCount: 0 }).where(eq(chats.id, testChatId));

    const syncCount = 50;
    const realtimeCount = 50;

    // Create sync messages
    const syncPromises = Array.from({ length: syncCount }, (_, i) =>
      messageService.create({
        chatId: testChatId,
        externalId: `msg-sync-${i}`,
        source: 'sync',
        messageType: 'text',
        textContent: `Sync message ${i}`,
        platformTimestamp: new Date(),
        isFromMe: false,
        hasMedia: false,
      }),
    );

    // Create realtime messages
    const realtimePromises = Array.from({ length: realtimeCount }, (_, i) =>
      messageService.create({
        chatId: testChatId,
        externalId: `msg-realtime-${i}`,
        source: 'realtime',
        messageType: 'text',
        textContent: `Realtime message ${i}`,
        platformTimestamp: new Date(),
        isFromMe: false,
        hasMedia: false,
      }),
    );

    await Promise.all([...syncPromises, ...realtimePromises]);

    // Verify count includes both sources
    const [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    const [actualCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatId, testChatId));

    const actualCountNum = Number(actualCount.count);
    const expectedTotal = syncCount + realtimeCount;

    expect(chatData.messageCount).toBe(expectedTotal);
    expect(actualCountNum).toBe(expectedTotal);
    expect(chatData.messageCount).toBe(actualCountNum);
  });

  test('should not increment count when message insert fails', async () => {
    // Reset chat
    await db.delete(messages).where(eq(messages.chatId, testChatId));
    await db.update(chats).set({ messageCount: 0 }).where(eq(chats.id, testChatId));

    // Create a message successfully
    await messageService.create({
      chatId: testChatId,
      externalId: 'msg-before-failure',
      source: 'realtime',
      messageType: 'text',
      textContent: 'Message before failure',
      platformTimestamp: new Date(),
      isFromMe: false,
      hasMedia: false,
    });

    // Try to create a duplicate message (should fail due to unique constraint on externalId)
    try {
      await messageService.create({
        chatId: testChatId,
        externalId: 'msg-before-failure', // Same external ID
        source: 'realtime',
        messageType: 'text',
        textContent: 'Duplicate message',
        platformTimestamp: new Date(),
        isFromMe: false,
        hasMedia: false,
      });
      expect(true).toBe(false); // Should not reach here
    } catch (_error) {
      // Expected to fail
    }

    // Verify count only incremented once
    const [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    const [actualCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatId, testChatId));

    const actualCountNum = Number(actualCount.count);

    expect(chatData.messageCount).toBe(1);
    expect(actualCountNum).toBe(1);
    expect(chatData.messageCount).toBe(actualCountNum);
  });

  test('should handle findOrCreate with duplicates correctly', async () => {
    // Reset chat
    await db.delete(messages).where(eq(messages.chatId, testChatId));
    await db.update(chats).set({ messageCount: 0 }).where(eq(chats.id, testChatId));

    const externalId = 'msg-findorcreate-test';
    const defaults = {
      source: 'realtime' as const,
      messageType: 'text' as const,
      textContent: 'Test message',
      platformTimestamp: new Date(),
      isFromMe: false,
      hasMedia: false,
    };

    // Create message first time
    const { message: msg1, created: created1 } = await messageService.findOrCreate(testChatId, externalId, defaults);
    expect(created1).toBe(true);

    // Try to create same message again
    const { message: msg2, created: created2 } = await messageService.findOrCreate(testChatId, externalId, defaults);
    expect(created2).toBe(false);
    expect(msg1.id).toBe(msg2.id);

    // Verify count only incremented once
    const [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    const [actualCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatId, testChatId));

    const actualCountNum = Number(actualCount.count);

    expect(chatData.messageCount).toBe(1);
    expect(actualCountNum).toBe(1);
    expect(chatData.messageCount).toBe(actualCountNum);
  });

  test('should handle concurrent duplicate attempts correctly', async () => {
    // Reset chat
    await db.delete(messages).where(eq(messages.chatId, testChatId));
    await db.update(chats).set({ messageCount: 0 }).where(eq(chats.id, testChatId));

    const externalId = 'msg-concurrent-duplicate';
    const defaults = {
      source: 'realtime' as const,
      messageType: 'text' as const,
      textContent: 'Concurrent duplicate test',
      platformTimestamp: new Date(),
      isFromMe: false,
      hasMedia: false,
    };

    // Try to create same message 10 times concurrently
    const promises = Array.from({ length: 10 }, () =>
      messageService.findOrCreate(testChatId, externalId, defaults).catch((_err) => null),
    );

    const results = await Promise.all(promises);
    const successfulResults = results.filter((r) => r !== null);

    // At least one should succeed
    expect(successfulResults.length).toBeGreaterThan(0);

    // All successful results should return the same message
    const messageIds = new Set(successfulResults.map((r) => r?.message.id));
    expect(messageIds.size).toBe(1);

    // Only one should be marked as created
    const createdCount = successfulResults.filter((r) => r?.created).length;
    expect(createdCount).toBe(1);

    // Verify count only incremented once
    const [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    const [actualCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatId, testChatId));

    const actualCountNum = Number(actualCount.count);

    expect(chatData.messageCount).toBe(1);
    expect(actualCountNum).toBe(1);
    expect(chatData.messageCount).toBe(actualCountNum);
  });

  test('should update lastMessageAt and lastMessagePreview correctly', async () => {
    // Reset chat
    await db.delete(messages).where(eq(messages.chatId, testChatId));
    await db
      .update(chats)
      .set({ messageCount: 0, lastMessageAt: null, lastMessagePreview: null })
      .where(eq(chats.id, testChatId));

    const timestamp1 = new Date('2024-01-01T10:00:00Z');
    const timestamp2 = new Date('2024-01-01T11:00:00Z');

    // Create first message
    await messageService.create({
      chatId: testChatId,
      externalId: 'msg-timestamp-1',
      source: 'realtime',
      messageType: 'text',
      textContent: 'First message',
      platformTimestamp: timestamp1,
      isFromMe: false,
      hasMedia: false,
    });

    let [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    expect(chatData.lastMessageAt?.getTime()).toBe(timestamp1.getTime());
    expect(chatData.lastMessagePreview).toContain('First message');

    // Create second message with later timestamp
    await messageService.create({
      chatId: testChatId,
      externalId: 'msg-timestamp-2',
      source: 'realtime',
      messageType: 'text',
      textContent: 'Second message',
      platformTimestamp: timestamp2,
      isFromMe: false,
      hasMedia: false,
    });

    [chatData] = await db.select().from(chats).where(eq(chats.id, testChatId));

    expect(chatData.lastMessageAt?.getTime()).toBe(timestamp2.getTime());
    expect(chatData.lastMessagePreview).toContain('Second message');
    expect(chatData.messageCount).toBe(2);
  });
});
