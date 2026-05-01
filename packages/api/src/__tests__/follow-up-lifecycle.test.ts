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

  test('second non-terminal disarm on an already-disarmed row is idempotent (no new event)', async () => {
    // Non-terminal disarms remain strictly idempotent. Terminal overrides
    // (#542) are exercised by the dedicated tests below.
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

    // sequence_complete is non-terminal → respects the existing
    // customer_replied row.
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'sequence_complete' });
    expect(publishedEvents).toHaveLength(0);

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    // Original reason preserved — non-terminal second disarm must not overwrite.
    expect(row.disarmReason).toBe('customer_replied');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // #542 — every terminal disarm reason must override non-terminal prior
  // reasons so the terminal-disarm guard in armForOutbound blocks re-arming
  // on tail streams. The "Mario leak" pattern is not specific to handoff —
  // archived / session_cleared / window_expired share the same race.
  // ──────────────────────────────────────────────────────────────────────────

  test('#542 disarm(handoff) overrides existing customer_replied row', async () => {
    const armAt = new Date();
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: armAt,
      config: config(),
    });
    const replyAt = new Date(armAt.getTime() + 30_000);
    await service.disarm({
      chatId: testChatId,
      instanceId: testInstanceId,
      reason: 'customer_replied',
      lastInboundCustomerMessageAt: replyAt,
    });
    publishedEvents.length = 0;

    // Operator initiates handoff while row is sitting in customer_replied.
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('handoff');
    expect(row.nextFireAt).toBeNull();
    expect(row.disarmedAt).not.toBeNull();
    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.disarmed');
    const evt = publishedEvents.find((e) => e.type === 'follow_up.disarmed');
    expect(evt?.payload.reason).toBe('handoff');
  });

  test('#542 disarm(handoff) overrides existing sequence_complete row', async () => {
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
      reason: 'sequence_complete',
    });
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('handoff');
    expect(row.nextFireAt).toBeNull();
  });

  test('#542 disarm(handoff) does NOT downgrade an already-terminal session_cleared row', async () => {
    // Strong reasons in TERMINAL_OVERRIDE_PROTECTED win — preserving the
    // semantically-stronger label and the original disarmedAt timestamp.
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'session_cleared' });
    const [before] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('session_cleared');
    expect(row.disarmedAt?.getTime()).toBe(before.disarmedAt?.getTime());
    expect(publishedEvents.map((e) => e.type)).not.toContain('follow_up.disarmed');
  });

  test('#542 disarm(handoff) does NOT downgrade a contact_closed row', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'contact_closed' });
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('contact_closed');
    expect(publishedEvents.map((e) => e.type)).not.toContain('follow_up.disarmed');
  });

  test('#542 disarm(handoff) on a fresh armed row arms-down to handoff (NULL → handoff)', async () => {
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
    expect(row.nextFireAt).toBeNull();
    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.disarmed');
  });

  test('#542 re-applying handoff to a handoff row stays idempotent (no duplicate event)', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });
    const [before] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('handoff');
    expect(row.disarmedAt?.getTime()).toBe(before.disarmedAt?.getTime());
    expect(publishedEvents).toHaveLength(0);
  });

  test('#542 disarm(archived) overrides existing customer_replied row', async () => {
    // gemini review: the Mario leak applies to every terminal reason, not
    // just handoff. Archive on a customer_replied row must advance the
    // disarm to `archived` so the terminal-disarm guard in armForOutbound
    // refuses a tail message.sent.
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

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'archived' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('archived');
    expect(row.nextFireAt).toBeNull();
    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.disarmed');
  });

  test('#542 disarm(session_cleared) overrides existing customer_replied row', async () => {
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

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'session_cleared' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('session_cleared');
  });

  test('#542 disarm(window_expired) overrides existing sequence_complete row', async () => {
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
      reason: 'sequence_complete',
    });
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'window_expired' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('window_expired');
  });

  test('#542 disarm(archived) does NOT downgrade a contact_closed row', async () => {
    // contact_closed is in TERMINAL_OVERRIDE_PROTECTED — even another
    // terminal reason cannot rewrite the audit label.
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'contact_closed' });
    publishedEvents.length = 0;

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'archived' });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('contact_closed');
  });

  test('#542 production scenario: customer_replied → handoff disarm → tail message.sent does NOT re-arm', async () => {
    // Reproduces production case 5594992438493 from 2026-04-26: lead replied,
    // operator handed off, but the row was sitting in customer_replied so the
    // synchronous disarm was a no-op and a tail message.sent re-armed the
    // sequence — a follow-up fired ~16 min later. Post-fix the row advances
    // to handoff and the terminal-disarm guard refuses the re-arm.
    //
    // Real-world ordering: customer reply lands first (replyAt ≤ wall-clock),
    // then handoff fires later. lastInboundCustomerMessageAt must therefore
    // sit BEFORE both disarmedAt timestamps so the terminal-disarm guard
    // ("customer hasn't returned since the disarm") fires correctly.
    const replyAt = new Date(Date.now() - 30_000);
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(replyAt.getTime() - 60_000),
      config: config(),
    });
    await service.disarm({
      chatId: testChatId,
      instanceId: testInstanceId,
      reason: 'customer_replied',
      lastInboundCustomerMessageAt: replyAt,
    });
    // Operator handoff fires after the customer reply — wall-clock now.
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'handoff' });
    publishedEvents.length = 0;

    // Tail-stream chunk lands after the handoff — message.sent fires armForOutbound.
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('handoff');
    expect(row.nextFireAt).toBeNull();
    expect(publishedEvents.map((e) => e.type)).not.toContain('follow_up.armed');
  });

  test('resolveConfig returns null when no scope defines a config (G6 columns absent)', async () => {
    const result = await service.resolveConfig(testChatId, testInstanceId, null);
    // Until G6 adds columns, all reads return undefined → resolver returns null.
    expect(result).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Terminal-disarm guard (#419) — tail agent messages after a user-intent
  // disarm must not re-arm the sequence until the customer returns.
  // ──────────────────────────────────────────────────────────────────────────

  test('#419 refuses re-arm after session_cleared when customer has not returned', async () => {
    const armAt = new Date();
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: armAt,
      config: config(),
    });

    // User clears the session → terminal disarm.
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'session_cleared' });
    publishedEvents.length = 0;

    // Tail stream chunk / redelivered message.sent fires armForOutbound.
    // Wall-clock timestamp after the disarm, but the customer has NOT sent
    // a message since — the sequence must stay disarmed.
    const tailAt = new Date(armAt.getTime() + 2_000);
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: tailAt,
      config: config(),
    });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('session_cleared');
    expect(row.nextFireAt).toBeNull();
    expect(publishedEvents.map((e) => e.type)).not.toContain('follow_up.armed');
  });

  test('#419 allows re-arm after session_cleared once customer returns', async () => {
    const armAt = new Date();
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: armAt,
      config: config(),
    });

    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'session_cleared' });

    // Customer returns with a new message.
    const customerReturnAt = new Date(armAt.getTime() + 60_000);
    await service.touchInboundTimestamp({
      chatId: testChatId,
      instanceId: testInstanceId,
      at: customerReturnAt,
    });

    publishedEvents.length = 0;

    // Agent replies to the returning customer — should arm fresh.
    const newAgentReplyAt = new Date(customerReturnAt.getTime() + 1_000);
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: newAgentReplyAt,
      config: config(),
    });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBeNull();
    expect(row.nextFireAt).not.toBeNull();
    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.armed');
  });

  test('#419 refuses re-arm after handoff / archived / window_expired (symmetric)', async () => {
    for (const reason of ['handoff', 'archived', 'window_expired'] as const) {
      await db.delete(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));

      const armAt = new Date();
      await service.armForOutbound({
        chatId: testChatId,
        instanceId: testInstanceId,
        agentId: null,
        lastAgentMessageAt: armAt,
        config: config(),
      });
      await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason });
      publishedEvents.length = 0;

      await service.armForOutbound({
        chatId: testChatId,
        instanceId: testInstanceId,
        agentId: null,
        lastAgentMessageAt: new Date(armAt.getTime() + 2_000),
        config: config(),
      });

      const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
      expect(row.disarmReason).toBe(reason);
      expect(publishedEvents.map((e) => e.type)).not.toContain('follow_up.armed');
    }
  });

  test('#419 customer_replied is NOT terminal — next agent message re-arms normally', async () => {
    const armAt = new Date();
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: armAt,
      config: config(),
    });
    // Normal customer reply flow: follow-up-hooks disarm + touchInbound.
    const replyAt = new Date(armAt.getTime() + 30_000);
    await service.disarm({
      chatId: testChatId,
      instanceId: testInstanceId,
      reason: 'customer_replied',
      lastInboundCustomerMessageAt: replyAt,
    });
    publishedEvents.length = 0;

    // Agent replies to the customer — should arm a fresh sequence even
    // without `touchInboundTimestamp` (customer_replied already set
    // lastInboundCustomerMessageAt to replyAt).
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(replyAt.getTime() + 1_000),
      config: config(),
    });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBeNull();
    expect(row.nextFireAt).not.toBeNull();
    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.armed');
  });

  test('touchInboundTimestamp updates lastInboundCustomerMessageAt even on terminally-disarmed rows', async () => {
    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
      config: config(),
    });
    await service.disarm({ chatId: testChatId, instanceId: testInstanceId, reason: 'session_cleared' });

    const returnAt = new Date(Date.now() + 60_000);
    await service.touchInboundTimestamp({ chatId: testChatId, instanceId: testInstanceId, at: returnAt });

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.lastInboundCustomerMessageAt?.getTime()).toBe(returnAt.getTime());
    // Row stays terminally disarmed — touch must not clear the disarm reason.
    expect(row.disarmReason).toBe('session_cleared');
  });

  test('touchInboundTimestamp on a missing row is a silent no-op', async () => {
    await service.touchInboundTimestamp({
      chatId: testChatId,
      instanceId: testInstanceId,
      at: new Date(),
    });
    const rows = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    expect(rows).toHaveLength(0);
  });

  test('close-contact guard: hard terminal (closed=true) refuses to arm', async () => {
    // won/lost outcomes flip closed=true and the dispatcher gate skip is
    // permanent. The follow-up arm path must also refuse for these so a
    // tail-stream chunk or NATS redelivery cannot resurrect a sequence.
    await db
      .update(chats)
      .set({ settings: { followUpConfig: config(), closed: true, closeOutcome: 'lost' } })
      .where(eq(chats.id, testChatId));

    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
    });

    const rows = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    expect(rows).toHaveLength(0);
  });

  test('close-contact guard: soft cooldown still in window refuses to arm', async () => {
    // redirected_sac (and other soft outcomes) set closeUntil=now+24h. The
    // reactive agent stays open per #575, but proactive follow-up nudges
    // must stay off until the cooldown expires.
    const closeUntilFuture = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // +6h
    await db
      .update(chats)
      .set({
        settings: {
          followUpConfig: config(),
          closeUntil: closeUntilFuture,
          closeOutcome: 'redirected_sac',
        },
      })
      .where(eq(chats.id, testChatId));

    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
    });

    const rows = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    expect(rows).toHaveLength(0);
  });

  test('close-contact guard: expired cooldown allows arm even with leftover closeOutcome', async () => {
    // Once the dispatcher gate observes closeUntil expired it clears the
    // field; closeOutcome stays as audit data. A customer return after that
    // is a legitimate new conversation — Eugenia answering it should arm
    // follow-up like any other reply. The original (closeOutcome-based) check
    // would have permanently silenced follow-ups on every Hapvida client who
    // ever hit redirected_sac, even months later when they came back wanting
    // to buy a brand-new plan.
    await db
      .update(chats)
      .set({
        settings: {
          followUpConfig: config(),
          closed: false,
          closeUntil: null,
          closeOutcome: 'redirected_sac', // audit only — predicate ignores this
        },
      })
      .where(eq(chats.id, testChatId));

    await service.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: new Date(),
    });

    const rows = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    expect(rows).toHaveLength(1);
    expect(rows[0].disarmReason).toBeNull();
  });
});
