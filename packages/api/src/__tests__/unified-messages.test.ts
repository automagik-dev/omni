/**
 * Integration tests for unified messages (chats, participants, messages)
 *
 * @see unified-messages wish
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { chatParticipants, chats, instances, messages } from '@omni/db';
import { eq } from 'drizzle-orm';
import { ChatService } from '../services/chats';
import { MessageService } from '../services/messages';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Unified Messages', () => {
  let db: Database;
  let chatService: ChatService;
  let messageService: MessageService;
  let testInstanceId: string;

  beforeAll(async () => {
    db = getTestDb();
    chatService = new ChatService(db, null);
    messageService = new MessageService(db, null);

    // Create a test instance
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-unified-messages-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) {
      throw new Error('Failed to create test instance');
    }
    testInstanceId = instance.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testInstanceId) {
      // Delete messages first (foreign key)
      const testChats = await db.select().from(chats).where(eq(chats.instanceId, testInstanceId));
      for (const chat of testChats) {
        await db.delete(messages).where(eq(messages.chatId, chat.id));
        await db.delete(chatParticipants).where(eq(chatParticipants.chatId, chat.id));
      }
      await db.delete(chats).where(eq(chats.instanceId, testInstanceId));
      await db.delete(instances).where(eq(instances.id, testInstanceId));
    }
  });

  describe('ChatService', () => {
    test('should create a chat', async () => {
      const chat = await chatService.create({
        instanceId: testInstanceId,
        externalId: 'test-chat-001@g.us',
        chatType: 'group',
        channel: 'whatsapp-baileys',
        name: 'Test Group',
      });

      expect(chat.id).toBeDefined();
      expect(chat.externalId).toBe('test-chat-001@g.us');
      expect(chat.chatType).toBe('group');
      expect(chat.name).toBe('Test Group');
    });

    test('should find or create a chat (create path)', async () => {
      const { chat, created } = await chatService.findOrCreate(testInstanceId, 'test-chat-002@s.whatsapp.net', {
        chatType: 'dm',
        channel: 'whatsapp-baileys',
      });

      expect(created).toBe(true);
      expect(chat.externalId).toBe('test-chat-002@s.whatsapp.net');
      expect(chat.chatType).toBe('dm');
    });

    test('should find or create a chat (find path)', async () => {
      const { chat: first } = await chatService.findOrCreate(testInstanceId, 'test-chat-003@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const { chat: second, created } = await chatService.findOrCreate(testInstanceId, 'test-chat-003@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      expect(created).toBe(false);
      expect(second.id).toBe(first.id);
    });

    test('should add a participant', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-chat-participants@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const participant = await chatService.addParticipant({
        chatId: chat.id,
        platformUserId: '5511999990001@s.whatsapp.net',
        displayName: 'Test User',
        role: 'member',
      });

      expect(participant.id).toBeDefined();
      expect(participant.platformUserId).toBe('5511999990001@s.whatsapp.net');
      expect(participant.displayName).toBe('Test User');
      expect(participant.isActive).toBe(true);
    });

    test('should get participants', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-chat-get-participants@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      await chatService.addParticipant({
        chatId: chat.id,
        platformUserId: 'user1@s.whatsapp.net',
        displayName: 'User 1',
      });

      await chatService.addParticipant({
        chatId: chat.id,
        platformUserId: 'user2@s.whatsapp.net',
        displayName: 'User 2',
      });

      const participants = await chatService.getParticipants(chat.id);
      expect(participants.length).toBe(2);
    });

    test('should archive and unarchive a chat', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-chat-archive@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const archived = await chatService.archive(chat.id);
      expect(archived.archivedAt).toBeDefined();

      const unarchived = await chatService.unarchive(chat.id);
      expect(unarchived.archivedAt).toBeNull();
    });
  });

  describe('MessageService', () => {
    test('should create a message', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-msg-chat@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const message = await messageService.create({
        chatId: chat.id,
        externalId: 'BAE5ABC123',
        source: 'realtime',
        messageType: 'text',
        textContent: 'Hello, world!',
        platformTimestamp: new Date(),
        senderPlatformUserId: 'sender@s.whatsapp.net',
        senderDisplayName: 'Sender',
        isFromMe: false,
      });

      expect(message.id).toBeDefined();
      expect(message.externalId).toBe('BAE5ABC123');
      expect(message.textContent).toBe('Hello, world!');
      expect(message.source).toBe('realtime');
    });

    test('should find or create a message', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-msg-findorcreate@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const { message: first, created: firstCreated } = await messageService.findOrCreate(chat.id, 'BAE5DEF456', {
        source: 'sync',
        messageType: 'text',
        textContent: 'Synced message',
        platformTimestamp: new Date(),
      });

      expect(firstCreated).toBe(true);
      expect(first.source).toBe('sync');

      const { message: second, created: secondCreated } = await messageService.findOrCreate(chat.id, 'BAE5DEF456', {
        source: 'sync',
        messageType: 'text',
        textContent: 'Different text',
        platformTimestamp: new Date(),
      });

      expect(secondCreated).toBe(false);
      expect(second.id).toBe(first.id);
      expect(second.textContent).toBe('Synced message'); // Original text preserved
    });

    test('should record message edits', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-msg-edit@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const message = await messageService.create({
        chatId: chat.id,
        externalId: 'BAE5EDIT001',
        source: 'realtime',
        messageType: 'text',
        textContent: 'Original',
        platformTimestamp: new Date(),
      });

      // First edit
      const edited1 = await messageService.recordEdit(message.id, 'Edited once', new Date());
      expect(edited1.textContent).toBe('Edited once');
      expect(edited1.editCount).toBe(1);
      expect(edited1.originalText).toBe('Original');
      expect(edited1.status).toBe('edited');

      // Second edit
      const edited2 = await messageService.recordEdit(message.id, 'Edited twice', new Date());
      expect(edited2.textContent).toBe('Edited twice');
      expect(edited2.editCount).toBe(2);
      expect(edited2.originalText).toBe('Original'); // Still the original
    });

    test('should add and remove reactions', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-msg-reactions@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const message = await messageService.create({
        chatId: chat.id,
        externalId: 'BAE5REACT001',
        source: 'realtime',
        messageType: 'text',
        textContent: 'React to me!',
        platformTimestamp: new Date(),
      });

      // Add reaction
      const withReaction = await messageService.addReaction(message.id, {
        emoji: '👍',
        platformUserId: 'reactor@s.whatsapp.net',
        displayName: 'Reactor',
      });

      expect(withReaction.reactions).toHaveLength(1);
      expect(withReaction.reactionCounts).toEqual({ '👍': 1 });

      // Add another reaction
      const withTwoReactions = await messageService.addReaction(message.id, {
        emoji: '❤️',
        platformUserId: 'another@s.whatsapp.net',
      });

      expect(withTwoReactions.reactions).toHaveLength(2);
      expect(withTwoReactions.reactionCounts).toEqual({ '👍': 1, '❤️': 1 });

      // Remove reaction
      const afterRemoval = await messageService.removeReaction(message.id, 'reactor@s.whatsapp.net', '👍');
      expect(afterRemoval.reactions).toHaveLength(1);
      expect(afterRemoval.reactionCounts).toEqual({ '❤️': 1 });
    });

    test('should update delivery status', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-msg-delivery@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const message = await messageService.create({
        chatId: chat.id,
        externalId: 'BAE5DELIVER001',
        source: 'realtime',
        messageType: 'text',
        textContent: 'Track my delivery',
        platformTimestamp: new Date(),
        isFromMe: true,
      });

      const delivered = await messageService.updateDeliveryStatus(message.id, 'delivered');
      expect(delivered.deliveryStatus).toBe('delivered');

      const read = await messageService.updateDeliveryStatus(message.id, 'read');
      expect(read.deliveryStatus).toBe('read');
    });

    test('should get chat messages', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-msg-list@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      // Create several messages
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await messageService.create({
          chatId: chat.id,
          externalId: `BAE5LIST${i.toString().padStart(3, '0')}`,
          source: 'realtime',
          messageType: 'text',
          textContent: `Message ${i}`,
          platformTimestamp: new Date(now.getTime() + i * 1000),
        });
      }

      const messages = await messageService.getChatMessages(chat.id, { limit: 10 });
      expect(messages.length).toBe(5);
    });

    test('should mark message as deleted', async () => {
      const { chat } = await chatService.findOrCreate(testInstanceId, 'test-msg-delete@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      const message = await messageService.create({
        chatId: chat.id,
        externalId: 'BAE5DELETE001',
        source: 'realtime',
        messageType: 'text',
        textContent: 'Delete me',
        platformTimestamp: new Date(),
      });

      const deleted = await messageService.markDeleted(message.id);
      expect(deleted.status).toBe('deleted');
      expect(deleted.deletedAt).toBeDefined();
    });
  });

  describe('Integration: Chat updates with messages', () => {
    test('should update chat lastMessageAt when message is created', async () => {
      const { chat: initialChat } = await chatService.findOrCreate(testInstanceId, 'test-chat-update@g.us', {
        chatType: 'group',
        channel: 'whatsapp-baileys',
      });

      expect(initialChat.lastMessageAt).toBeNull();
      expect(initialChat.messageCount).toBe(0);

      const timestamp = new Date();
      await messageService.create({
        chatId: initialChat.id,
        externalId: 'BAE5CHATUPDATE001',
        source: 'realtime',
        messageType: 'text',
        textContent: 'This should update the chat',
        platformTimestamp: timestamp,
      });

      const updatedChat = await chatService.getById(initialChat.id);
      expect(updatedChat.lastMessageAt).toBeDefined();
      expect(updatedChat.messageCount).toBe(1);
      expect(updatedChat.lastMessagePreview).toBe('This should update the chat');
    });
  });
});
