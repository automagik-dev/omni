/**
 * Tests for chat scoping via instanceIds filter on ChatService.list().
 *
 * Verifies that API key chat scoping correctly filters chats by instance.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { chats, instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { ChatService } from '../services/chats';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Chat scoping — instanceIds filter', () => {
  let db: Database;
  let chatService: ChatService;
  let inst1Id: string;
  let inst2Id: string;
  let inst3Id: string;

  beforeAll(async () => {
    db = getTestDb();
    chatService = new ChatService(db, null);

    // Create 3 instances
    const suffix = Date.now();
    const [inst1] = await db
      .insert(instances)
      .values({ name: `scope-test-1-${suffix}`, channel: 'whatsapp-baileys' as const })
      .returning();
    const [inst2] = await db
      .insert(instances)
      .values({ name: `scope-test-2-${suffix}`, channel: 'whatsapp-baileys' as const })
      .returning();
    const [inst3] = await db
      .insert(instances)
      .values({ name: `scope-test-3-${suffix}`, channel: 'whatsapp-baileys' as const })
      .returning();

    if (!inst1 || !inst2 || !inst3) throw new Error('Failed to create test instances');
    inst1Id = inst1.id;
    inst2Id = inst2.id;
    inst3Id = inst3.id;

    // Create chats across instances
    await db.insert(chats).values([
      {
        instanceId: inst1Id,
        externalId: 'user-a@s.whatsapp.net',
        chatType: 'dm',
        channel: 'whatsapp-baileys',
        name: 'User A (inst1)',
        visibility: 'visible',
        lastMessageAt: new Date(),
      },
      {
        instanceId: inst1Id,
        externalId: 'user-b@s.whatsapp.net',
        chatType: 'dm',
        channel: 'whatsapp-baileys',
        name: 'User B (inst1)',
        visibility: 'visible',
        lastMessageAt: new Date(),
      },
      {
        instanceId: inst2Id,
        externalId: 'user-c@s.whatsapp.net',
        chatType: 'dm',
        channel: 'whatsapp-baileys',
        name: 'User C (inst2)',
        visibility: 'visible',
        lastMessageAt: new Date(),
      },
      {
        instanceId: inst3Id,
        externalId: 'user-d@s.whatsapp.net',
        chatType: 'dm',
        channel: 'whatsapp-baileys',
        name: 'User D (inst3)',
        visibility: 'visible',
        lastMessageAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    // Cleanup test data
    if (inst1Id) await db.delete(chats).where(eq(chats.instanceId, inst1Id));
    if (inst2Id) await db.delete(chats).where(eq(chats.instanceId, inst2Id));
    if (inst3Id) await db.delete(chats).where(eq(chats.instanceId, inst3Id));
    if (inst1Id) await db.delete(instances).where(eq(instances.id, inst1Id));
    if (inst2Id) await db.delete(instances).where(eq(instances.id, inst2Id));
    if (inst3Id) await db.delete(instances).where(eq(instances.id, inst3Id));
  });

  test('instanceIds: [inst-1] only returns chats from instance 1', async () => {
    const result = await chatService.list({ instanceIds: [inst1Id] });
    expect(result.items.length).toBe(2);
    for (const chat of result.items) {
      expect(chat.instanceId).toBe(inst1Id);
    }
    const names = result.items.map((c) => c.name).sort();
    expect(names).toEqual(['User A (inst1)', 'User B (inst1)']);
  });

  test('no instanceIds filter returns all chats (unscoped)', async () => {
    const result = await chatService.list({});
    // Should contain at least our 4 test chats (may have others from parallel tests)
    const testNames = result.items.map((c) => c.name).filter((n) => n?.includes('(inst'));
    expect(testNames.length).toBeGreaterThanOrEqual(4);
  });

  test('instanceIds: [inst-1, inst-2] returns chats from both instances', async () => {
    const result = await chatService.list({ instanceIds: [inst1Id, inst2Id] });
    const instanceIdsInResult = new Set(result.items.map((c) => c.instanceId));
    // Should only contain inst1 and inst2 chats
    for (const id of instanceIdsInResult) {
      expect([inst1Id, inst2Id]).toContain(id as string);
    }
    // Should have at least 3 chats (2 from inst1 + 1 from inst2)
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    // inst3 should NOT appear
    expect(result.items.some((c) => c.instanceId === inst3Id)).toBe(false);
  });

  test('instanceIds: [inst-3] returns only inst3 chats', async () => {
    const result = await chatService.list({ instanceIds: [inst3Id] });
    expect(result.items.length).toBe(1);
    expect(result.items[0]!.instanceId).toBe(inst3Id);
    expect(result.items[0]!.name).toBe('User D (inst3)');
  });

  test('instanceIds: [] (empty array) returns all chats (no filter applied)', async () => {
    // Empty array should not add an IN() clause
    const result = await chatService.list({ instanceIds: [] });
    const testChats = result.items.filter((c) => c.name?.includes('(inst'));
    expect(testChats.length).toBeGreaterThanOrEqual(4);
  });
});
