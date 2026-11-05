/**
 * Tests for the edit-channel endpoint's messageId resolution.
 *
 * Bug: The edit-channel endpoint passed the internal Omni UUID directly to
 * the channel plugin, but plugins (e.g. Baileys) need the platform-native
 * external message ID. This caused edits to silently fail on WhatsApp.
 *
 * Fix: When messageId is a UUID, look it up in the database and resolve
 * it to the externalId before calling plugin.editMessage().
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { ChatService } from '../services/chats';
import { MessageService } from '../services/messages';
import { createMigratedTestDatabase } from './fixtures/pg-clone';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('edit-channel messageId resolution', () => {
  let db: Database;
  const clone = createMigratedTestDatabase({ superUrl, psqlBin });
  let messageService: MessageService;
  let chatService: ChatService;
  let testInstanceId: string;
  let testChatId: string;

  beforeAll(async () => {
    db = clone.setup();
    chatService = new ChatService(db, null);
    messageService = new MessageService(db, null);

    // Create test instance
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-edit-resolve-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) throw new Error('Failed to create test instance');
    testInstanceId = instance.id;

    // Create test chat
    const { chat } = await chatService.findOrCreate(testInstanceId, 'test-edit-resolve@g.us', {
      chatType: 'group',
      channel: 'whatsapp-baileys',
    });
    testChatId = chat.id;
  });

  afterAll(() => clone.teardown());

  test('resolves internal UUID to externalId via getById', async () => {
    // Create a message with a known externalId
    const message = await messageService.create({
      chatId: testChatId,
      externalId: '3EB0A1B2C3D4E5F6',
      source: 'realtime',
      messageType: 'text',
      textContent: 'Original message',
      platformTimestamp: new Date(),
      isFromMe: true,
    });

    // The internal UUID should be a valid UUID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(UUID_REGEX.test(message.id)).toBe(true);

    // Simulate what the edit-channel handler now does: resolve UUID to externalId
    const resolved = await messageService.getById(message.id);
    expect(resolved.externalId).toBe('3EB0A1B2C3D4E5F6');
  });

  test('getById throws NotFoundError for non-existent UUID', async () => {
    const fakeUuid = '00000000-0000-4000-a000-000000000000';

    await expect(messageService.getById(fakeUuid)).rejects.toThrow(/not found/i);
  });

  test('cross-instance UUID lookup is rejected by ownership check', async () => {
    // Create a second instance (Instance B)
    const [instanceB] = await db
      .insert(instances)
      .values({
        name: `test-edit-resolve-b-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instanceB) throw new Error('Failed to create second test instance');

    // Create a message belonging to Instance A (testInstanceId)
    const message = await messageService.create({
      chatId: testChatId,
      externalId: '3EB0CROSS_INSTANCE_TEST',
      source: 'realtime',
      messageType: 'text',
      textContent: 'Message on instance A',
      platformTimestamp: new Date(),
      isFromMe: true,
    });

    // Simulate the cross-tenant check: fetch the message, then verify its chat's instanceId
    const resolved = await messageService.getById(message.id);
    const chat = await chatService.getById(resolved.chatId);

    // The message's chat belongs to testInstanceId (Instance A),
    // so requesting from Instance B should be detected as cross-tenant
    expect(chat.instanceId).toBe(testInstanceId);
    expect(chat.instanceId).not.toBe(instanceB.id);

    // Cleanup Instance B
    await db.delete(instances).where(eq(instances.id, instanceB.id));
  });
});
