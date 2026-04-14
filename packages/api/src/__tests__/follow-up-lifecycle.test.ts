/**
 * Integration tests for FollowUpLifecycleService.
 *
 * Runs against a real Postgres (skipped when ENABLE_DB_TESTS is unset).
 * Exercises the arm → disarm transitions that the message-pipeline hooks
 * drive in production, plus the closest-wins config resolver.
 *
 * End-to-end path (arm → sweeper fires → disarm on reply) is exercised in
 * `follow-up-sweeper.test.ts` — this file focuses on the lifecycle service.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

// @ts-nocheck — integration test with dynamic db row shapes (see sweeper test)
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import type { EventBus, FollowUpSequenceConfig } from '@omni/core';
import type { Database } from '@omni/db';
import { chatFollowUpState, chats, instances } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { FollowUpLifecycleService } from '../services/follow-up-lifecycle';
import { describeWithDb, getTestDb } from './db-helper';

const MS_PER_MINUTE = 60_000;

const config = (overrides: Partial<FollowUpSequenceConfig> = {}): FollowUpSequenceConfig => ({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'Check in with {{chatName}}',
  stopOutsideMessagingWindow: false,
  showTypingIndicator: false,
  ...overrides,
});

describeWithDb('FollowUpLifecycleService (integration)', () => {
  let db: Database;
  let service: FollowUpLifecycleService;
  let testInstanceId: string;
  let testChatId: string;
  let publishedEvents: Array<{ type: string; payload: Record<string, unknown> }>;
  let eventBus: EventBus;

  beforeAll(async () => {
    db = getTestDb();
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-lifecycle-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    testInstanceId = instance.id;

    const [chat] = await db
      .insert(chats)
      .values({
        instanceId: testInstanceId,
        externalId: `chat-lifecycle-${Date.now()}`,
        chatType: 'dm' as const,
        channel: 'whatsapp-baileys' as const,
        name: 'Alice Lifecycle',
      })
      .returning();
    testChatId = chat.id;
  });

  beforeEach(() => {
    publishedEvents = [];
    eventBus = {
      connect: async () => {},
      close: async () => {},
      isConnected: () => true,
      publish: mock(async (type: string, payload: Record<string, unknown>) => {
        publishedEvents.push({ type, payload });
        return { id: 'evt', sequence: publishedEvents.length };
      }),
      publishGeneric: mock(async () => ({ id: 'evt', sequence: 0 })),
      subscribe: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
      subscribePattern: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
      subscribeMany: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
      subscribeAll: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
    } as unknown as EventBus;

    service = new FollowUpLifecycleService(db, eventBus);
  });

  afterEach(async () => {
    await db.delete(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
  });

  afterAll(async () => {
    await db.delete(chats).where(eq(chats.id, testChatId));
    await db.delete(instances).where(eq(instances.id, testInstanceId));
  });

  test('armForOutbound creates row with sequenceIndex=0 and emits follow_up.armed', async () => {
    const now = new Date();
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: now,
      config: config(),
    });

    const [row] = await db
      .select()
      .from(chatFollowUpState)
      .where(and(eq(chatFollowUpState.chatId, testChatId), eq(chatFollowUpState.instanceId, testInstanceId)))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.sequenceIndex).toBe(0);
    expect(row.disarmReason).toBeNull();
    const expected = now.getTime() + 3 * MS_PER_MINUTE;
    expect(row.nextFireAt.getTime()).toBe(expected);

    const types = publishedEvents.map((e) => e.type);
    expect(types).toContain('follow_up.armed');
    const armed = publishedEvents.find((e) => e.type === 'follow_up.armed');
    expect(armed?.payload.chatId).toBe(testChatId);
    expect(armed?.payload.instanceId).toBe(testInstanceId);
    expect(armed?.payload.sequenceIndex).toBe(0);
  });

  test('armForOutbound is a no-op when no config resolves', async () => {
    // No config on any scope → resolveConfig returns null → arm skipped.
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
    });

    const rows = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    expect(rows).toHaveLength(0);
    expect(publishedEvents).toHaveLength(0);
  });

  test('armForOutbound is a no-op when passed config has enabled=false', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config({ enabled: false }),
    });

    const rows = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    expect(rows).toHaveLength(0);
    expect(publishedEvents).toHaveLength(0);
  });

  test('re-arming an existing row refreshes it (resets sequenceIndex + nextFireAt)', async () => {
    const first = new Date();
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: first,
      config: config(),
    });

    // Simulate mid-sequence state as if the sweeper had fired once.
    await db.update(chatFollowUpState).set({ sequenceIndex: 2 }).where(eq(chatFollowUpState.chatId, testChatId));
    publishedEvents.length = 0;

    const second = new Date(first.getTime() + 10 * MS_PER_MINUTE);
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: second,
      config: config(),
    });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);

    expect(row.sequenceIndex).toBe(0);
    expect(row.nextFireAt.getTime()).toBe(second.getTime() + 3 * MS_PER_MINUTE);
    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.armed');
  });

  test('disarm(customer_replied) terminates the sequence and emits follow_up.disarmed', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    publishedEvents.length = 0;

    const replyAt = new Date();
    await service.disarm({
      chatId: testChatId,
      instanceId: testInstanceId,
      reason: 'customer_replied',
      lastInboundCustomerMessageAt: replyAt,
    });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);

    expect(row.disarmReason).toBe('customer_replied');
    expect(row.nextFireAt).toBeNull();
    expect(row.disarmedAt).not.toBeNull();
    expect(row.lastInboundCustomerMessageAt).not.toBeNull();

    const types = publishedEvents.map((e) => e.type);
    expect(types).toContain('follow_up.disarmed');
    const disarmed = publishedEvents.find((e) => e.type === 'follow_up.disarmed');
    expect(disarmed?.payload.reason).toBe('customer_replied');
  });

  test('disarm(handoff) sets reason handoff', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('handoff');
  });

  test('disarm(archived) sets reason archived', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'archived' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('archived');
  });

  test('disarm on a missing row is a silent no-op (no event emission)', async () => {
    await service.disarm({
      chatId: testChatId,
      instanceId: testInstanceId,
      reason: 'customer_replied',
    });
    expect(publishedEvents).toHaveLength(0);

    const rows = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    expect(rows).toHaveLength(0);
  });

  test('second disarm on an already-disarmed row is idempotent (no new event)', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    await service.disarm({
      chatId: testChatId,
      instanceId: testInstanceId,
      reason: 'customer_replied',
    });
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });
    expect(publishedEvents).toHaveLength(0);

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    // Original reason preserved — the second disarm must not overwrite.
    expect(row.disarmReason).toBe('customer_replied');
  });

  test('resolveConfig returns null when no scope defines a config (G6 columns absent)', async () => {
    const result = await service.resolveConfig(testChatId, testInstanceId, null);
    // Until G6 adds columns, all reads return undefined → resolver returns null.
    expect(result).toBeNull();
  });
});
