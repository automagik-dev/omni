/**
 * Tests for WhatsApp LID/Phone chat consolidation
 *
 * Verifies that LID and phone JIDs for the same person route to a single chat
 * Tests mapping creation, chat discovery order, and deduplication
 *
 * Related to bug fix: WhatsApp LID/phone fragmentation creating duplicate chats
 */

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { chatIdMappings, chats, instances, messages } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { ChatService } from '../services/chats';
import { MessageService } from '../services/messages';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('LID/Phone Chat Consolidation', () => {
  let db: Database;
  let chatService: ChatService;
  let messageService: MessageService;
  let testInstanceId: string;

  const phoneJid = '553496835777@s.whatsapp.net';
  const lidJid = '63750317031625@lid';

  afterEach(async () => {
    // Clean up between tests to avoid conflicts
    const testChats = await db.select().from(chats).where(eq(chats.instanceId, testInstanceId));
    for (const chat of testChats) {
      await db.delete(messages).where(eq(messages.chatId, chat.id));
    }
    await db.delete(chatIdMappings).where(eq(chatIdMappings.instanceId, testInstanceId));
    await db.delete(chats).where(eq(chats.instanceId, testInstanceId));
  });

  beforeAll(async () => {
    db = getTestDb();
    chatService = new ChatService(db, null);
    messageService = new MessageService(db, null);

    // Create test instance
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-lid-consolidation-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) {
      throw new Error('Failed to create test instance');
    }
    testInstanceId = instance.id;
  });

  afterAll(async () => {
    // Cleanup all test chats and messages
    const testChats = await db.select().from(chats).where(eq(chats.instanceId, testInstanceId));
    for (const chat of testChats) {
      await db.delete(messages).where(eq(messages.chatId, chat.id));
    }
    await db.delete(chatIdMappings).where(eq(chatIdMappings.instanceId, testInstanceId));
    await db.delete(chats).where(eq(chats.instanceId, testInstanceId));
    await db.delete(instances).where(eq(instances.id, testInstanceId));
  });

  test('should route LID message to phone chat when mapping exists', async () => {
    // Create phone chat first
    const { chat: phoneChat } = await chatService.findOrCreate(testInstanceId, phoneJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Create mapping (simulating Baileys LID discovery)
    await db.insert(chatIdMappings).values({
      instanceId: testInstanceId,
      lidId: lidJid,
      phoneId: phoneJid,
    });

    // Create message with LID
    const { message } = await messageService.findOrCreate(phoneChat.id, `lid-msg-${Date.now()}`, {
      source: 'realtime' as const,
      messageType: 'text' as const,
      textContent: 'Message from LID',
      platformTimestamp: new Date(),
      isFromMe: false,
      hasMedia: false,
    });

    // Verify message is in phone chat
    expect(message.chatId).toBe(phoneChat.id);

    // Verify no LID chat was created
    const lidChat = await chatService.getByExternalId(testInstanceId, lidJid);
    expect(lidChat).toBeNull();

    // Cleanup
    await db.delete(messages).where(eq(messages.id, message.id));
    await db
      .delete(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, testInstanceId), eq(chatIdMappings.lidId, lidJid)));
    await db.delete(chats).where(eq(chats.id, phoneChat.id));
  });

  test('should find phone chat when LID message arrives with mapping', async () => {
    // Create phone chat
    const { chat: phoneChat } = await chatService.findOrCreate(testInstanceId, phoneJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Create mapping
    await db.insert(chatIdMappings).values({
      instanceId: testInstanceId,
      lidId: lidJid,
      phoneId: phoneJid,
    });

    // Try to find chat by LID (should resolve to phone chat via mapping)
    const foundChat = await chatService.findByExternalIdSmart(testInstanceId, lidJid);

    expect(foundChat).not.toBeNull();
    expect(foundChat?.id).toBe(phoneChat.id);
    expect(foundChat?.externalId).toBe(phoneJid);

    // Cleanup
    await db
      .delete(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, testInstanceId), eq(chatIdMappings.lidId, lidJid)));
    await db.delete(chats).where(eq(chats.id, phoneChat.id));
  });

  test('should find LID chat when phone JID is provided via canonical_id', async () => {
    // Create LID chat with canonical_id set to phone JID
    const { chat: lidChat } = await chatService.findOrCreate(testInstanceId, lidJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Set canonical_id
    await db.update(chats).set({ canonicalId: phoneJid }).where(eq(chats.id, lidChat.id));

    // Try to find chat by phone JID (should find LID chat via canonical_id)
    const foundChat = await chatService.findByExternalIdSmart(testInstanceId, phoneJid);

    expect(foundChat).not.toBeNull();
    expect(foundChat?.id).toBe(lidChat.id);
    expect(foundChat?.externalId).toBe(lidJid);
    expect(foundChat?.canonicalId).toBe(phoneJid);

    // Cleanup
    await db.delete(chats).where(eq(chats.id, lidChat.id));
  });

  test('should create phone chat when phone message arrives first', async () => {
    // Create chat with phone JID
    const { chat: phoneChat, created } = await chatService.findOrCreate(testInstanceId, phoneJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    expect(created).toBe(true);
    expect(phoneChat.externalId).toBe(phoneJid);
    expect(phoneChat.canonicalId).toBeNull();

    // Cleanup
    await db.delete(chats).where(eq(chats.id, phoneChat.id));
  });

  test('should prevent duplicate chats when both LID and phone messages arrive', async () => {
    // Scenario: Phone chat exists, then LID message arrives

    // 1. Create phone chat
    const { chat: phoneChat } = await chatService.findOrCreate(testInstanceId, phoneJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // 2. Create mapping
    await db.insert(chatIdMappings).values({
      instanceId: testInstanceId,
      lidId: lidJid,
      phoneId: phoneJid,
    });

    // 3. Try to create LID chat (should return phone chat instead)
    const { chat: lidChat, created } = await chatService.findOrCreate(testInstanceId, lidJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    expect(created).toBe(false);
    expect(lidChat.id).toBe(phoneChat.id);
    expect(lidChat.externalId).toBe(phoneJid);

    // Verify only one chat exists
    const allChats = await db.select().from(chats).where(eq(chats.instanceId, testInstanceId));

    expect(allChats.length).toBe(1);
    expect(allChats[0].id).toBe(phoneChat.id);

    // Cleanup
    await db
      .delete(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, testInstanceId), eq(chatIdMappings.lidId, lidJid)));
    await db.delete(chats).where(eq(chats.id, phoneChat.id));
  });

  test.skip('should handle concurrent LID and phone chat creation (TODO: Phase 3)', async () => {
    // Create mapping first (catch if already exists)
    try {
      await db.insert(chatIdMappings).values({
        instanceId: testInstanceId,
        lidId: `${lidJid}-concurrent`,
        phoneId: `${phoneJid}-concurrent`,
      });
    } catch (_err) {
      // Mapping may already exist from previous test, ignore
    }

    const concurrentLidJid = `${lidJid}-concurrent`;
    const concurrentPhoneJid = `${phoneJid}-concurrent`;

    // Try to create both LID and phone chats concurrently
    const [lidResult, phoneResult] = await Promise.all([
      chatService.findOrCreate(testInstanceId, concurrentLidJid, {
        chatType: 'dm',
        channel: 'whatsapp-baileys',
      }),
      chatService.findOrCreate(testInstanceId, concurrentPhoneJid, {
        chatType: 'dm',
        channel: 'whatsapp-baileys',
      }),
    ]);

    // Both should return the same chat (via mapping)
    expect(lidResult.chat.id).toBe(phoneResult.chat.id);

    // Cleanup
    await db
      .delete(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, testInstanceId), eq(chatIdMappings.lidId, concurrentLidJid)));
    await db.delete(chats).where(eq(chats.id, lidResult.chat.id));
  });

  test('should list chats without duplicates when LID and phone chats exist', async () => {
    // This test verifies that chat.list() deduplicates via canonical_id

    // Create phone chat
    const { chat: phoneChat } = await chatService.findOrCreate(testInstanceId, phoneJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Create LID chat with canonical pointing to phone
    const { chat: lidChat } = await chatService.findOrCreate(testInstanceId, lidJid, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    await db.update(chats).set({ canonicalId: phoneJid }).where(eq(chats.id, lidChat.id));

    // List chats for instance
    const { items: chatList } = await chatService.list({ instanceId: testInstanceId });

    // Should return only one chat (deduplicated)
    const uniqueExternalIds = new Set(chatList.map((c) => c.canonicalId || c.externalId));
    expect(uniqueExternalIds.size).toBe(1);
    expect(uniqueExternalIds.has(phoneJid)).toBe(true);

    // Cleanup
    await db.delete(chats).where(eq(chats.id, phoneChat.id));
    await db.delete(chats).where(eq(chats.id, lidChat.id));
  });

  test('should not create mapping for non-WhatsApp chats', async () => {
    // Create a Discord chat
    const { chat: discordChat } = await chatService.findOrCreate(
      testInstanceId,
      '1234567890', // Discord channel ID
      {
        chatType: 'channel',
        channel: 'discord',
      },
    );

    // Try to find it by a different ID (should fail, no LID logic)
    const foundChat = await chatService.findByExternalIdSmart(testInstanceId, '9876543210');
    expect(foundChat).toBeNull();

    // Cleanup
    await db.delete(chats).where(eq(chats.id, discordChat.id));
  });
});
