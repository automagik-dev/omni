/**
 * Integration tests for FollowUpSweeperService.
 *
 * Runs against a real Postgres (skipped when ENABLE_DB_TESTS is unset).
 * Seeds rows in `chat_follow_up_state`, runs `sweep()`, and asserts the
 * expected DB state transitions.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

// @ts-nocheck — integration test with dynamic db row shapes
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import type { EventBus, FollowUpSequenceConfig } from '@omni/core';
import type { Database } from '@omni/db';
import { chatFollowUpState, chats, instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { FollowUpSweeperService } from '../services/follow-up-sweeper';
import { describeWithDb, getTestDb } from './db-helper';

const MS_PER_MINUTE = 60_000;

const config = (overrides: Partial<FollowUpSequenceConfig> = {}): FollowUpSequenceConfig => ({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'Check in with {{chatName}} — {{minutes}}m idle, follow-up #{{sequenceIndex}}',
  stopOutsideMessagingWindow: false,
  showTypingIndicator: false,
  ...overrides,
});

describeWithDb('FollowUpSweeperService (integration)', () => {
  let db: Database;
  let service: FollowUpSweeperService;
  let testInstanceId: string;
  let testChatId: string;
  let publishedEvents: Array<{ type: string; payload: Record<string, unknown> }>;
  let eventBus: EventBus;

  beforeAll(async () => {
    db = getTestDb();
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-follow-up-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    testInstanceId = instance.id;

    const [chat] = await db
      .insert(chats)
      .values({
        instanceId: testInstanceId,
        externalId: `chat-${Date.now()}`,
        chatType: 'dm' as const,
        channel: 'whatsapp-baileys' as const,
        name: 'Alice Test',
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

    service = new FollowUpSweeperService(db, eventBus);
  });

  afterEach(async () => {
    await db.delete(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
  });

  afterAll(async () => {
    await db.delete(chats).where(eq(chats.id, testChatId));
    await db.delete(instances).where(eq(instances.id, testInstanceId));
  });

  test('due row fires chat.idle_timeout + follow_up.fired + follow_up.armed and advances the sequence', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60_000); // 1 minute ago
    const armedAt = new Date(now.getTime() - 3 * MS_PER_MINUTE);

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config(),
      sequenceIndex: 0,
      lastAgentMessageAt: armedAt,
      nextFireAt: past,
    });

    const stats = await service.sweep();
    expect(stats.scanned).toBe(1);
    expect(stats.fired).toBe(1);
    expect(stats.disarmed).toBe(0);

    const types = publishedEvents.map((e) => e.type);
    expect(types).toContain('chat.idle_timeout');
    expect(types).toContain('follow_up.fired');
    expect(types).toContain('follow_up.armed');

    const idle = publishedEvents.find((e) => e.type === 'chat.idle_timeout');
    expect(idle?.payload.chatId).toBe(testChatId);
    expect(idle?.payload.instanceId).toBe(testInstanceId);
    expect(idle?.payload.sequenceIndex).toBe(0);
    expect(idle?.payload.syntheticPrompt).toContain('Alice Test');
    expect(idle?.payload.syntheticPrompt).toContain('#0');
    expect(idle?.payload.chatName).toBe('Alice Test');

    // Row advanced: sequenceIndex=1, nextFireAt roughly now + 5min
    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.sequenceIndex).toBe(1);
    expect(row.disarmReason).toBeNull();
    expect(row.nextFireAt).not.toBeNull();
    const expected = Date.now() + 5 * MS_PER_MINUTE;
    expect(row.nextFireAt.getTime()).toBeGreaterThanOrEqual(expected - 2000);
    expect(row.nextFireAt.getTime()).toBeLessThanOrEqual(expected + 2000);
  });

  test('final fire disarms with sequence_complete', async () => {
    const past = new Date(Date.now() - 60_000);
    const armedAt = new Date(Date.now() - 30 * MS_PER_MINUTE);

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config({ maxFollowUps: 3 }),
      sequenceIndex: 2,
      lastAgentMessageAt: armedAt,
      nextFireAt: past,
    });

    const stats = await service.sweep();
    expect(stats.fired).toBe(1);
    expect(stats.disarmed).toBe(1);

    const types = publishedEvents.map((e) => e.type);
    expect(types).toContain('follow_up.disarmed');
    const disarmed = publishedEvents.find((e) => e.type === 'follow_up.disarmed');
    expect(disarmed?.payload.reason).toBe('sequence_complete');

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('sequence_complete');
    expect(row.nextFireAt).toBeNull();
    expect(row.disarmedAt).not.toBeNull();
  });

  test('already disarmed rows are not swept', async () => {
    const past = new Date(Date.now() - 60_000);

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config(),
      sequenceIndex: 1,
      lastAgentMessageAt: new Date(Date.now() - 60 * MS_PER_MINUTE),
      nextFireAt: past,
      disarmReason: 'customer_replied',
      disarmedAt: new Date(Date.now() - 30_000),
    });

    const stats = await service.sweep();
    expect(stats.scanned).toBe(0);
    expect(publishedEvents).toHaveLength(0);
  });

  test('paused chat (settings.agentPaused=true) is not swept even when armed and due', async () => {
    // Issue #528 — closes the race where the sweeper fires chat.idle_timeout
    // after `/send/handoff` has set agentPaused but before the
    // chat.handoff_activated → follow-up-hooks disarm has committed.
    const past = new Date(Date.now() - 60_000);

    await db
      .update(chats)
      .set({ settings: { agentPaused: true } })
      .where(eq(chats.id, testChatId));

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config(),
      sequenceIndex: 0,
      lastAgentMessageAt: new Date(Date.now() - MS_PER_MINUTE),
      nextFireAt: past,
    });

    const stats = await service.sweep();
    expect(stats.scanned).toBe(0);
    expect(publishedEvents).toHaveLength(0);

    // Row remains armed — the sweeper skipped it, it didn't disarm it.
    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBeNull();
    expect(row.sequenceIndex).toBe(0);

    // Reset chat settings for subsequent tests.
    await db.update(chats).set({ settings: {} }).where(eq(chats.id, testChatId));
  });

  test('future-due rows are not swept', async () => {
    const future = new Date(Date.now() + 5 * MS_PER_MINUTE);

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config(),
      sequenceIndex: 0,
      lastAgentMessageAt: new Date(Date.now() - MS_PER_MINUTE),
      nextFireAt: future,
    });

    const stats = await service.sweep();
    expect(stats.scanned).toBe(0);
  });

  test('sweep is a no-op when eventBus is null', async () => {
    const past = new Date(Date.now() - 60_000);
    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config(),
      sequenceIndex: 0,
      lastAgentMessageAt: new Date(Date.now() - MS_PER_MINUTE),
      nextFireAt: past,
    });

    const noBusService = new FollowUpSweeperService(db, null);
    const stats = await noBusService.sweep();
    expect(stats).toEqual({ scanned: 0, fired: 0, disarmed: 0, skipped: 0 });
  });
});
