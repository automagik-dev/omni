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
import { eq, sql } from 'drizzle-orm';
import { FollowUpLifecycleService } from '../services/follow-up-lifecycle';
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
    // Wire lifecycle so the sweeper's stale-pause re-arm pass (#624) runs.
    // Tests that don't exercise the re-arm path are unaffected — the new
    // pass is a no-op when no `customer_replied` rows match its filters.
    service.setLifecycle(new FollowUpLifecycleService(db, eventBus));
  });

  afterEach(async () => {
    await db.delete(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
    // Defensive cleanup — if a test wrote `settings.agentPaused`, strip only
    // that key. Runs unconditionally so a failed test can't leak paused
    // state into subsequent cases sharing `testChatId`.
    await db
      .update(chats)
      .set({ settings: sql`${chats.settings} - 'agentPaused'` })
      .where(eq(chats.id, testChatId));
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

  test('disarm guard skips terminal-disarmed rows even when nextFireAt is stale (race-condition defense)', async () => {
    // The original "already disarmed rows are not swept" test asserted this
    // for `customer_replied` too — that assumption was the buggy behavior
    // documented in #624. After the fix, terminal disarms (`handoff`,
    // `session_cleared`, `archived`, `window_expired`) still skip both
    // passes; non-terminal `customer_replied` is now eligible for re-arm
    // (covered by the #624 tests below).
    //
    // Why the artificial-looking fixture (nextFireAt: past + disarmReason
    // set): production `disarmActive()` always nulls `nextFireAt` when it
    // disarms, so this combination only arises during the narrow race
    // where the sweeper has SELECTed a row, and a disarm event commits
    // before the sweeper actually fires. The `isNull(disarmReason)` clause
    // in `findAndLockDue` is what protects against a stale fire in that
    // window — without it, a row could be fired AFTER it was disarmed.
    // This test exercises that guard specifically; without an artificial
    // stale `nextFireAt`, the date filter would short-circuit before the
    // disarm guard ran and the test would not catch a regression in the
    // guard.
    const past = new Date(Date.now() - 60_000);

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config(),
      sequenceIndex: 1,
      lastAgentMessageAt: new Date(Date.now() - 60 * MS_PER_MINUTE),
      nextFireAt: past,
      disarmReason: 'handoff',
      disarmedAt: new Date(Date.now() - 30_000),
      lastInboundCustomerMessageAt: new Date(Date.now() - 20 * MS_PER_MINUTE),
    });

    const stats = await service.sweep();
    expect(stats.scanned).toBe(0);
    expect(stats.rearmed).toBe(0);
    expect(publishedEvents).toHaveLength(0);
  });

  test('paused chat (settings.agentPaused=true) is not swept even when armed and due', async () => {
    // Issue #528 — closes the race where the sweeper fires chat.idle_timeout
    // after `/send/handoff` has set agentPaused but before the
    // chat.handoff_activated → follow-up-hooks disarm has committed.
    const past = new Date(Date.now() - 60_000);

    // Merge `agentPaused: true` into `settings` without overwriting other
    // keys. `jsonb_set` + `COALESCE` handles the null-settings case.
    await db
      .update(chats)
      .set({
        settings: sql`jsonb_set(COALESCE(${chats.settings}, '{}'::jsonb), '{agentPaused}', 'true'::jsonb)`,
      })
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
    // Settings cleanup happens in `afterEach` so it runs even on failure.
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
    expect(stats).toEqual({ scanned: 0, fired: 0, disarmed: 0, skipped: 0, rearmed: 0 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // #624 — Stale-pause re-arm tests
  //
  // The fix from #624 adds a sweeper pass that re-arms `customer_replied`
  // rows whose customer-inbound timestamp has aged past the configured first
  // interval. Without this pass, any chat where the agent stops responding
  // after a customer reply stays disarmed indefinitely (~65% of FU-eligible
  // sessions in production observed before the fix).
  //
  // The 5 cases below exercise the boundary conditions:
  //   1. Aged past first interval → re-arm.
  //   2. Aged past max-pause → DO NOT re-arm (lead too cold).
  //   3. Terminal disarm reasons → DO NOT re-arm (terminal-guard wins).
  //   4. Active close-contact state → DO NOT re-arm (gate at lifecycle).
  //   5. agentPaused chat → DO NOT re-arm (parity with #528 race fix).
  // ──────────────────────────────────────────────────────────────────────────

  test('#624 customer_replied row aged past first interval is re-armed by the sweeper', async () => {
    const cfg = config({ schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] } });
    // Inbound 10 min ago — past the 3-min first interval.
    const inboundAt = new Date(Date.now() - 10 * MS_PER_MINUTE);

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: cfg,
      sequenceIndex: 2, // mid-sequence at disarm time
      lastAgentMessageAt: new Date(Date.now() - 30 * MS_PER_MINUTE),
      nextFireAt: null,
      disarmReason: 'customer_replied',
      disarmedAt: inboundAt,
      lastInboundCustomerMessageAt: inboundAt,
    });

    const stats = await service.sweep();
    expect(stats.rearmed).toBe(1);

    // Row was reset: disarm cleared, sequence back to 0, nextFireAt anchored
    // on the inbound timestamp + first interval.
    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBeNull();
    expect(row.disarmedAt).toBeNull();
    expect(row.sequenceIndex).toBe(0);
    expect(row.nextFireAt).not.toBeNull();
    // First fire = inbound + 3 min — already in the past, so the next sweep
    // tick will pick it up via the original fire-due pass.
    const expectedFire = inboundAt.getTime() + 3 * MS_PER_MINUTE;
    expect(row.nextFireAt.getTime()).toBeGreaterThanOrEqual(expectedFire - 2000);
    expect(row.nextFireAt.getTime()).toBeLessThanOrEqual(expectedFire + 2000);

    // follow_up.armed event was emitted by the lifecycle service.
    const types = publishedEvents.map((e) => e.type);
    expect(types).toContain('follow_up.armed');
  });

  test('#624 customer_replied row aged past max-pause (7d) is NOT re-armed', async () => {
    const cfg = config({ schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] } });
    const inboundAt = new Date(Date.now() - 8 * 24 * 60 * MS_PER_MINUTE); // 8 days ago

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: cfg,
      sequenceIndex: 1,
      lastAgentMessageAt: inboundAt,
      nextFireAt: null,
      disarmReason: 'customer_replied',
      disarmedAt: inboundAt,
      lastInboundCustomerMessageAt: inboundAt,
    });

    const stats = await service.sweep();
    expect(stats.rearmed).toBe(0);

    // Row remains disarmed.
    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('customer_replied');
    expect(row.nextFireAt).toBeNull();
  });

  test('#624 terminal disarm reasons are NOT re-armed even when inbound is recent', async () => {
    // Iterate the four terminal reasons; each must stay disarmed after a
    // sweep tick despite an inbound that would re-arm a `customer_replied`.
    const cfg = config({ schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] } });
    const inboundAt = new Date(Date.now() - 10 * MS_PER_MINUTE);

    for (const reason of ['handoff', 'session_cleared', 'archived', 'window_expired'] as const) {
      // Reset between iterations.
      await db.delete(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
      publishedEvents.length = 0;

      await db.insert(chatFollowUpState).values({
        chatId: testChatId,
        instanceId: testInstanceId,
        agentId: null,
        sequenceConfig: cfg,
        sequenceIndex: 1,
        lastAgentMessageAt: inboundAt,
        nextFireAt: null,
        disarmReason: reason,
        disarmedAt: inboundAt,
        lastInboundCustomerMessageAt: inboundAt,
      });

      const stats = await service.sweep();
      expect(stats.rearmed).toBe(0);

      const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
      expect(row.disarmReason).toBe(reason);
    }
  });

  test('#624 chat in active close-contact state is NOT re-armed', async () => {
    const cfg = config({ schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] } });
    const inboundAt = new Date(Date.now() - 10 * MS_PER_MINUTE);

    // Mark chat as deliberately closed via the close-contact mechanism.
    // Mirrors the shape `POST /messages/send/close-contact` writes.
    await db
      .update(chats)
      .set({
        settings: sql`jsonb_set(COALESCE(${chats.settings}, '{}'::jsonb), '{closed}', 'true'::jsonb)`,
      })
      .where(eq(chats.id, testChatId));

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: cfg,
      sequenceIndex: 1,
      lastAgentMessageAt: inboundAt,
      nextFireAt: null,
      disarmReason: 'customer_replied',
      disarmedAt: inboundAt,
      lastInboundCustomerMessageAt: inboundAt,
    });

    const stats = await service.sweep();
    expect(stats.rearmed).toBe(0);

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('customer_replied');
    expect(row.nextFireAt).toBeNull();

    // Cleanup the close-contact marker so subsequent tests get a fresh chat.
    await db
      .update(chats)
      .set({ settings: sql`${chats.settings} - 'closed'` })
      .where(eq(chats.id, testChatId));
  });

  test('#624 agentPaused chat with stale customer_replied is NOT re-armed', async () => {
    // Parity with #528 race fix — `findAndLockDue` skips paused chats and
    // the stale-pause re-arm pass must do the same. Without this filter,
    // we would re-arm a row that the operator just paused, defeating the
    // explicit pause.
    const cfg = config({ schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] } });
    const inboundAt = new Date(Date.now() - 10 * MS_PER_MINUTE);

    await db
      .update(chats)
      .set({
        settings: sql`jsonb_set(COALESCE(${chats.settings}, '{}'::jsonb), '{agentPaused}', 'true'::jsonb)`,
      })
      .where(eq(chats.id, testChatId));

    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: cfg,
      sequenceIndex: 1,
      lastAgentMessageAt: inboundAt,
      nextFireAt: null,
      disarmReason: 'customer_replied',
      disarmedAt: inboundAt,
      lastInboundCustomerMessageAt: inboundAt,
    });

    const stats = await service.sweep();
    expect(stats.rearmed).toBe(0);

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('customer_replied');
    expect(row.nextFireAt).toBeNull();
    // `afterEach` strips agentPaused.
  });
});
