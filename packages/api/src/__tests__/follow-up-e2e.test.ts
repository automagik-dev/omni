/**
 * End-to-end integration test for the idle-chat follow-up feature.
 *
 * Exercises the full lifecycle in one test against a real Postgres:
 *   armForOutbound → backdate nextFireAt → sweep() → chat.idle_timeout
 *   → user-space automation (call_agent + send_message with promptOverride)
 *   → disarm on inbound customer reply.
 *
 * Skipped when `ENABLE_DB_TESTS` is unset (see db-helper).
 *
 * Invariants under test:
 *   1. The sweeper fires `chat.idle_timeout` with `syntheticPrompt` + context.
 *   2. A `call_agent` action with `promptOverride` renders the follow-up
 *      placeholders and passes the rendered string as the only message to the
 *      injected `callAgent`.
 *   3. The chained `send_message` emits only the agent's rendered response —
 *      the synthetic prompt is NEVER sent to the customer.
 *   4. An inbound customer reply disarms the sequence with reason
 *      `customer_replied` and emits `follow_up.disarmed`.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

// @ts-nocheck — integration test with dynamic db row shapes
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import type {
  ActionDependencies,
  AgentCallContext,
  AgentRunResult,
  AutomationAction,
  CallAgentActionConfig,
  EventBus,
  FollowUpSequenceConfig,
} from '@omni/core';
import { createTemplateContext, executeActions } from '@omni/core';
import type { Database } from '@omni/db';
import { chatFollowUpState, chats, instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { FollowUpLifecycleService } from '../services/follow-up-lifecycle';
import { FollowUpSweeperService } from '../services/follow-up-sweeper';
import { describeWithDb, getTestDb } from './db-helper';

const MS_PER_MINUTE = 60_000;

const config = (overrides: Partial<FollowUpSequenceConfig> = {}): FollowUpSequenceConfig => ({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'Idle {{minutes}}m — follow-up #{{sequenceIndex}} for {{chatName}}',
  stopOutsideMessagingWindow: false,
  showTypingIndicator: false,
  ...overrides,
});

describeWithDb('Idle-chat follow-up (end-to-end)', () => {
  let db: Database;
  let lifecycle: FollowUpLifecycleService;
  let sweeper: FollowUpSweeperService;
  let testInstanceId: string;
  let testChatId: string;
  let publishedEvents: Array<{ type: string; payload: Record<string, unknown> }>;
  let eventBus: EventBus;

  beforeAll(async () => {
    db = getTestDb();
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-follow-up-e2e-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    testInstanceId = instance.id;

    const [chat] = await db
      .insert(chats)
      .values({
        instanceId: testInstanceId,
        externalId: `chat-e2e-${Date.now()}`,
        chatType: 'dm' as const,
        channel: 'whatsapp-baileys' as const,
        name: 'Alice E2E',
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

    lifecycle = new FollowUpLifecycleService(db, eventBus);
    sweeper = new FollowUpSweeperService(db, eventBus);
  });

  afterEach(async () => {
    await db.delete(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId));
  });

  afterAll(async () => {
    await db.delete(chats).where(eq(chats.id, testChatId));
    await db.delete(instances).where(eq(instances.id, testInstanceId));
  });

  test('arm → sweeper fires → call_agent(promptOverride) → send_message → disarm on reply', async () => {
    // -----------------------------------------------------------------------
    // 1. Arm — simulate the message-pipeline hook firing on an outbound agent
    //    message. Row should be inserted with sequenceIndex=0 and nextFireAt
    //    3 minutes in the future.
    // -----------------------------------------------------------------------
    const armedAt = new Date();
    await lifecycle.armForOutbound({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      lastAgentMessageAt: armedAt,
      config: config(),
    });

    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.armed');

    // -----------------------------------------------------------------------
    // 2. Fast-forward — backdate nextFireAt so the sweeper claims the row on
    //    the next tick without waiting 3 minutes in real time.
    // -----------------------------------------------------------------------
    await db
      .update(chatFollowUpState)
      .set({ nextFireAt: new Date(Date.now() - 60_000) })
      .where(eq(chatFollowUpState.chatId, testChatId));

    // Reset the event log so subsequent assertions only see sweeper + downstream events.
    publishedEvents.length = 0;

    // -----------------------------------------------------------------------
    // 3. Sweep — this is what the scheduler calls every 15s in prod. Expect
    //    chat.idle_timeout + follow_up.fired + follow_up.armed (re-arm for
    //    the next step of the sequence).
    // -----------------------------------------------------------------------
    const stats = await sweeper.sweep();
    expect(stats.scanned).toBe(1);
    expect(stats.fired).toBe(1);
    expect(stats.disarmed).toBe(0);

    const types = publishedEvents.map((e) => e.type);
    expect(types).toContain('chat.idle_timeout');
    expect(types).toContain('follow_up.fired');
    expect(types).toContain('follow_up.armed');

    const idle = publishedEvents.find((e) => e.type === 'chat.idle_timeout');
    expect(idle).toBeDefined();
    expect(idle?.payload.chatId).toBe(testChatId);
    expect(idle?.payload.instanceId).toBe(testInstanceId);
    expect(idle?.payload.sequenceIndex).toBe(0);
    expect(idle?.payload.chatName).toBe('Alice E2E');
    expect(typeof idle?.payload.syntheticPrompt).toBe('string');
    expect(idle?.payload.syntheticPrompt).toContain('Alice E2E');
    expect(idle?.payload.syntheticPrompt).toContain('#0');

    // -----------------------------------------------------------------------
    // 4. User-space automation — mimic `automations-engine.ts` reacting to the
    //    `chat.idle_timeout` event: build a template context from the payload
    //    and execute a `call_agent` + `send_message` sequence. The
    //    `promptOverride` field drives the invariant that the synthetic prompt
    //    is passed to the agent but never written to chat history.
    // -----------------------------------------------------------------------
    const idlePayload = idle!.payload as Record<string, unknown>;
    const context = createTemplateContext(idlePayload);

    const receivedAgentCalls: Array<{ ctx: AgentCallContext; config: CallAgentActionConfig }> = [];
    const receivedSendCalls: Array<{ instanceId: string; to: string; content: string }> = [];

    const mockCallAgent = mock(async (ctx: AgentCallContext, cfg: CallAgentActionConfig): Promise<AgentRunResult> => {
      receivedAgentCalls.push({ ctx, config: cfg });
      // Agent renders a customer-facing message from the synthetic prompt.
      // Its response is the ONLY text the customer should see.
      return {
        parts: ['Hey Alice, just checking in — let me know if you still need help!'],
        fullResponse: 'Hey Alice, just checking in — let me know if you still need help!',
        metadata: { runId: 'run-1', sessionId: 'session-1', status: 'completed' },
      };
    });

    const mockSendMessage = mock(async (instanceId: string, to: string, content: string) => {
      receivedSendCalls.push({ instanceId, to, content });
    });

    const deps: ActionDependencies = {
      eventBus,
      callAgent: mockCallAgent,
      sendMessage: mockSendMessage,
    };

    const actions: AutomationAction[] = [
      {
        type: 'call_agent',
        config: {
          agentId: 'test-agent',
          promptOverride: '{{syntheticPrompt}}',
          responseAs: 'agentResponse',
        },
      },
      {
        type: 'send_message',
        config: {
          instanceId: testInstanceId,
          to: testChatId,
          contentTemplate: '{{agentResponse}}',
        },
      },
    ];

    const results = await executeActions(actions, context, deps);

    // Both actions must succeed.
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('success');

    // Agent was called with the rendered synthetic prompt (NOT the raw template).
    expect(receivedAgentCalls).toHaveLength(1);
    const agentCall = receivedAgentCalls[0];
    expect(agentCall.ctx.messages).toHaveLength(1);
    expect(agentCall.ctx.messages[0]).toContain('Alice E2E');
    expect(agentCall.ctx.messages[0]).toContain('#0');
    expect(agentCall.config.promptOverride).toBe('{{syntheticPrompt}}');

    // send_message fired once with the AGENT'S response, not the synthetic prompt.
    expect(receivedSendCalls).toHaveLength(1);
    expect(receivedSendCalls[0].content).toBe('Hey Alice, just checking in — let me know if you still need help!');
    expect(receivedSendCalls[0].content).not.toContain('#0');
    expect(receivedSendCalls[0].content).not.toContain('Idle');

    // -----------------------------------------------------------------------
    // 5. Inbound customer reply disarms the sequence. In prod the hook listens
    //    for `message.received` — here we call the lifecycle service directly
    //    to isolate the arm/disarm contract under test.
    // -----------------------------------------------------------------------
    publishedEvents.length = 0;

    const replyAt = new Date();
    await lifecycle.disarm({
      chatId: testChatId,
      instanceId: testInstanceId,
      reason: 'customer_replied',
      lastInboundCustomerMessageAt: replyAt,
    });

    expect(publishedEvents.map((e) => e.type)).toContain('follow_up.disarmed');
    const disarmed = publishedEvents.find((e) => e.type === 'follow_up.disarmed');
    expect(disarmed?.payload.reason).toBe('customer_replied');

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);

    expect(row.disarmReason).toBe('customer_replied');
    expect(row.nextFireAt).toBeNull();
    expect(row.disarmedAt).not.toBeNull();
    expect(row.lastInboundCustomerMessageAt).not.toBeNull();

    // -----------------------------------------------------------------------
    // 6. Post-disarm sweep must be a no-op on this row.
    // -----------------------------------------------------------------------
    publishedEvents.length = 0;
    const postStats = await sweeper.sweep();
    expect(postStats.scanned).toBe(0);
    expect(publishedEvents).toHaveLength(0);
  });

  test('final fire disarms with sequence_complete and subsequent sweeps are no-ops', async () => {
    // Seed a row at the penultimate sequenceIndex so the next fire completes.
    await db.insert(chatFollowUpState).values({
      chatId: testChatId,
      instanceId: testInstanceId,
      agentId: null,
      sequenceConfig: config({ maxFollowUps: 3 }),
      sequenceIndex: 2, // last index (0, 1, 2 with maxFollowUps=3)
      lastAgentMessageAt: new Date(Date.now() - 30 * MS_PER_MINUTE),
      nextFireAt: new Date(Date.now() - 60_000),
    });

    const stats = await sweeper.sweep();
    expect(stats.fired).toBe(1);
    expect(stats.disarmed).toBe(1);

    const disarmed = publishedEvents.find((e) => e.type === 'follow_up.disarmed');
    expect(disarmed?.payload.reason).toBe('sequence_complete');

    const [row] = await db.select().from(chatFollowUpState).where(eq(chatFollowUpState.chatId, testChatId)).limit(1);
    expect(row.disarmReason).toBe('sequence_complete');
    expect(row.nextFireAt).toBeNull();

    // A second sweep must not re-fire the completed row.
    publishedEvents.length = 0;
    const postStats = await sweeper.sweep();
    expect(postStats.scanned).toBe(0);
    expect(publishedEvents).toHaveLength(0);
  });
});
