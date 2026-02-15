/**
 * Tests for multi-instance isolation
 *
 * Verifies that instances are completely isolated
 * Tests that same user across instances creates separate records
 *
 * Related to bug fix: Multi-tenant isolation is by design, not a bug
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { chatIdMappings, chats, instances, messages, persons, platformIdentities } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { ChatService } from '../services/chats';
import { MessageService } from '../services/messages';
import { PersonService } from '../services/persons';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Multi-Instance Isolation', () => {
  let db: Database;
  let chatService: ChatService;
  let messageService: MessageService;
  let personService: PersonService;
  let instance1Id: string;
  let instance2Id: string;

  const samePhoneNumber = '+5534968357777';
  const sameExternalUserId = '553496835777@s.whatsapp.net';

  beforeAll(async () => {
    db = getTestDb();
    chatService = new ChatService(db, null);
    messageService = new MessageService(db, null);
    personService = new PersonService(db, null);

    // Create two separate instances
    const [instance1] = await db
      .insert(instances)
      .values({
        name: `test-instance-1-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();

    const [instance2] = await db
      .insert(instances)
      .values({
        name: `test-instance-2-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();

    if (!instance1 || !instance2) {
      throw new Error('Failed to create test instances');
    }

    instance1Id = instance1.id;
    instance2Id = instance2.id;
  });

  afterAll(async () => {
    if (!instance1Id || !instance2Id) return; // Skip cleanup if instances not created

    // Cleanup all test data for instance 1
    const testChats1 = await db.select().from(chats).where(eq(chats.instanceId, instance1Id));
    for (const chat of testChats1) {
      await db.delete(messages).where(eq(messages.chatId, chat.id));
    }
    await db.delete(chats).where(eq(chats.instanceId, instance1Id));

    // Cleanup all test data for instance 2
    const testChats2 = await db.select().from(chats).where(eq(chats.instanceId, instance2Id));
    for (const chat of testChats2) {
      await db.delete(messages).where(eq(messages.chatId, chat.id));
    }
    await db.delete(chats).where(eq(chats.instanceId, instance2Id));

    // Cleanup chatIdMappings for both instances
    await db.delete(chatIdMappings).where(eq(chatIdMappings.instanceId, instance1Id));
    await db.delete(chatIdMappings).where(eq(chatIdMappings.instanceId, instance2Id));

    // Cleanup platform identities for instance 1
    const testIdentities1 = await db
      .select()
      .from(platformIdentities)
      .where(eq(platformIdentities.instanceId, instance1Id));
    const personIds1 = [...new Set(testIdentities1.map((i) => i.personId).filter(Boolean))];
    await db.delete(platformIdentities).where(eq(platformIdentities.instanceId, instance1Id));

    // Cleanup platform identities for instance 2
    const testIdentities2 = await db
      .select()
      .from(platformIdentities)
      .where(eq(platformIdentities.instanceId, instance2Id));
    const personIds2 = [...new Set(testIdentities2.map((i) => i.personId).filter(Boolean))];
    await db.delete(platformIdentities).where(eq(platformIdentities.instanceId, instance2Id));

    // Cleanup orphaned persons (ones created by tests, no remaining identities)
    const allPersonIds = [...new Set([...personIds1, ...personIds2])];
    for (const personId of allPersonIds) {
      if (!personId) continue;
      const [remainingIdentities] = await db
        .select()
        .from(platformIdentities)
        .where(eq(platformIdentities.personId, personId))
        .limit(1);
      if (!remainingIdentities) {
        await db.delete(persons).where(eq(persons.id, personId));
      }
    }

    // Delete instances (cascade will handle remaining data)
    await db.delete(instances).where(eq(instances.id, instance1Id));
    await db.delete(instances).where(eq(instances.id, instance2Id));
  });

  test('should create separate Person records for same user across instances', async () => {
    // Create identity in instance 1
    const result1 = await personService.findOrCreateIdentity(
      {
        channel: 'whatsapp-baileys',
        instanceId: instance1Id,
        platformUserId: sameExternalUserId,
        platformUsername: 'Test User',
      },
      {
        matchByPhone: samePhoneNumber,
        createPerson: true,
        displayName: 'Test User',
      },
    );

    // Create identity in instance 2 with same phone/external ID
    const result2 = await personService.findOrCreateIdentity(
      {
        channel: 'whatsapp-baileys',
        instanceId: instance2Id,
        platformUserId: sameExternalUserId,
        platformUsername: 'Test User',
      },
      {
        matchByPhone: samePhoneNumber,
        createPerson: true,
        displayName: 'Test User',
      },
    );

    // Both should link to the SAME person (multi-instance linking by phone)
    expect(result1.person).not.toBeNull();
    expect(result2.person).not.toBeNull();
    expect(result1.person?.id).toBe(result2.person?.id);

    // But identities should be different (instance-scoped)
    expect(result1.identity.id).not.toBe(result2.identity.id);
    expect(result1.identity.instanceId).toBe(instance1Id);
    expect(result2.identity.instanceId).toBe(instance2Id);

    // Both identities have same platformUserId but different internal IDs
    expect(result1.identity.platformUserId).toBe(sameExternalUserId);
    expect(result2.identity.platformUserId).toBe(sameExternalUserId);

    // Second identity should be linked (found existing person by phone)
    expect(result2.wasLinked).toBe(true);

    // Cleanup
    if (result1.person) {
      await db.delete(platformIdentities).where(eq(platformIdentities.personId, result1.person.id));
      await db.delete(persons).where(eq(persons.id, result1.person.id));
    }
  });

  test('should create separate Chat records for same external ID across instances', async () => {
    // Create chat in instance 1
    const { chat: chat1 } = await chatService.findOrCreate(instance1Id, sameExternalUserId, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Create chat in instance 2 with same external ID
    const { chat: chat2 } = await chatService.findOrCreate(instance2Id, sameExternalUserId, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Verify they are different Chat records
    expect(chat1.id).not.toBe(chat2.id);
    expect(chat1.instanceId).toBe(instance1Id);
    expect(chat2.instanceId).toBe(instance2Id);

    // Both have same external ID but different internal IDs
    expect(chat1.externalId).toBe(chat2.externalId);
    expect(chat1.externalId).toBe(sameExternalUserId);

    // Cleanup
    await db.delete(chats).where(eq(chats.id, chat1.id));
    await db.delete(chats).where(eq(chats.id, chat2.id));
  });

  test('should create separate Message records for same external ID across instances', async () => {
    // Create chats first
    const { chat: chat1 } = await chatService.findOrCreate(instance1Id, sameExternalUserId, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    const { chat: chat2 } = await chatService.findOrCreate(instance2Id, sameExternalUserId, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    const sameMessageExternalId = 'msg-12345';

    // Create message in instance 1
    const message1 = await messageService.create({
      chatId: chat1.id,
      externalId: sameMessageExternalId,
      source: 'realtime',
      messageType: 'text',
      textContent: 'Test message',
      platformTimestamp: new Date(),
      isFromMe: false,
      hasMedia: false,
    });

    // Create message in instance 2 with same external ID
    const message2 = await messageService.create({
      chatId: chat2.id,
      externalId: sameMessageExternalId,
      source: 'realtime',
      messageType: 'text',
      textContent: 'Test message',
      platformTimestamp: new Date(),
      isFromMe: false,
      hasMedia: false,
    });

    // Verify they are different Message records
    expect(message1.id).not.toBe(message2.id);
    expect(message1.chatId).toBe(chat1.id);
    expect(message2.chatId).toBe(chat2.id);

    // Both have same external ID but different internal IDs
    expect(message1.externalId).toBe(message2.externalId);
    expect(message1.externalId).toBe(sameMessageExternalId);

    // Cleanup
    await db.delete(messages).where(eq(messages.id, message1.id));
    await db.delete(messages).where(eq(messages.id, message2.id));
    await db.delete(chats).where(eq(chats.id, chat1.id));
    await db.delete(chats).where(eq(chats.id, chat2.id));
  });

  test('should scope chat lookup to instance', async () => {
    // Create chat in instance 1
    const { chat: chat1 } = await chatService.findOrCreate(instance1Id, sameExternalUserId, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Try to find chat in instance 2 (should not find instance 1's chat)
    const foundInInstance2 = await chatService.getByExternalId(instance2Id, sameExternalUserId);
    expect(foundInInstance2).toBeNull();

    // Find in instance 1 (should succeed)
    const foundInInstance1 = await chatService.getByExternalId(instance1Id, sameExternalUserId);
    expect(foundInInstance1).not.toBeNull();
    expect(foundInInstance1?.id).toBe(chat1.id);

    // Cleanup
    await db.delete(chats).where(eq(chats.id, chat1.id));
  });

  test('should list chats scoped to instance', async () => {
    // Create chat in instance 1
    const { chat: chat1 } = await chatService.findOrCreate(instance1Id, `chat1-${Date.now()}@s.whatsapp.net`, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Create chat in instance 2
    const { chat: chat2 } = await chatService.findOrCreate(instance2Id, `chat2-${Date.now()}@s.whatsapp.net`, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // List chats for instance 1
    const { items: chats1 } = await chatService.list({ instanceId: instance1Id });
    expect(chats1.some((c) => c.id === chat1.id)).toBe(true);
    expect(chats1.some((c) => c.id === chat2.id)).toBe(false);

    // List chats for instance 2
    const { items: chats2 } = await chatService.list({ instanceId: instance2Id });
    expect(chats2.some((c) => c.id === chat2.id)).toBe(true);
    expect(chats2.some((c) => c.id === chat1.id)).toBe(false);

    // Cleanup
    await db.delete(chats).where(eq(chats.id, chat1.id));
    await db.delete(chats).where(eq(chats.id, chat2.id));
  });

  test('should maintain separate message counts per instance', async () => {
    // Create chats
    const { chat: chat1 } = await chatService.findOrCreate(instance1Id, sameExternalUserId, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    const { chat: chat2 } = await chatService.findOrCreate(instance2Id, sameExternalUserId, {
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });

    // Send 5 messages to instance 1
    for (let i = 0; i < 5; i++) {
      await messageService.create({
        chatId: chat1.id,
        externalId: `msg-instance1-${i}`,
        source: 'realtime',
        messageType: 'text',
        textContent: `Message ${i}`,
        platformTimestamp: new Date(),
        isFromMe: false,
        hasMedia: false,
      });
    }

    // Send 10 messages to instance 2
    for (let i = 0; i < 10; i++) {
      await messageService.create({
        chatId: chat2.id,
        externalId: `msg-instance2-${i}`,
        source: 'realtime',
        messageType: 'text',
        textContent: `Message ${i}`,
        platformTimestamp: new Date(),
        isFromMe: false,
        hasMedia: false,
      });
    }

    // Verify counts are separate
    const [chatData1] = await db.select().from(chats).where(eq(chats.id, chat1.id));
    const [chatData2] = await db.select().from(chats).where(eq(chats.id, chat2.id));

    expect(chatData1).toBeDefined();
    expect(chatData2).toBeDefined();
    expect(chatData1?.messageCount).toBe(5);
    expect(chatData2?.messageCount).toBe(10);

    // Cleanup
    await db.delete(messages).where(eq(messages.chatId, chat1.id));
    await db.delete(messages).where(eq(messages.chatId, chat2.id));
    await db.delete(chats).where(eq(chats.id, chat1.id));
    await db.delete(chats).where(eq(chats.id, chat2.id));
  });

  test('should not share chatIdMappings across instances', async () => {
    const lidJid = '63750317031625@lid';
    const phoneJid = '553496835777@s.whatsapp.net';

    // Create mapping in instance 1
    await db.insert(chatIdMappings).values({
      instanceId: instance1Id,
      lidId: lidJid,
      phoneId: phoneJid,
    });

    // Try to find mapping in instance 2 (should not exist)
    const [mappingInInstance2] = await db
      .select()
      .from(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, instance2Id), eq(chatIdMappings.lidId, lidJid)));

    expect(mappingInInstance2).toBeUndefined();

    // Find mapping in instance 1 (should exist)
    const [mappingInInstance1] = await db
      .select()
      .from(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, instance1Id), eq(chatIdMappings.lidId, lidJid)));

    expect(mappingInInstance1).toBeDefined();
    expect(mappingInInstance1?.phoneId).toBe(phoneJid);

    // Cleanup - use both lidId and phoneId in WHERE to match the composite primary key
    await db
      .delete(chatIdMappings)
      .where(
        and(
          eq(chatIdMappings.instanceId, instance1Id),
          eq(chatIdMappings.lidId, lidJid),
          eq(chatIdMappings.phoneId, phoneJid),
        ),
      );
  });
});
