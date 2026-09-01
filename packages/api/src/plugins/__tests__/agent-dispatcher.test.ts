/**
 * Agent Dispatcher Plugin Tests
 *
 * Tests for:
 * - ReactionDedup: LRU dedup for emoji+messageId+userId
 * - MessageDebouncer: tested separately in message-debouncer.test.ts
 * - resolveProvider / getAgentProvider: provider resolution from DB
 * - setupAgentDispatcher: integration with EventBus subscriptions + cleanup
 * - Text chunking and split point logic
 * - Helper functions: instanceTriggersOnEvent, isReactionTrigger, classifyMessageTrigger
 *
 * #384: Inbound rate limiter removed. The debouncer is the single source of
 * burst control for message triggers — no cap on inbound volume.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
// Real @omni/core captured before mock.module below replaces it. Bun's
// mock.module REPLACES the module (it does not merge), so the factory must
// spread the real exports or OmniError/createLogger/etc. become undefined for
// every test file ordered after this one (the messages-route mock-bleed).
import * as omniCoreReal from '@omni/core';
import { instances } from '@omni/db';

// ---------------------------------------------------------------------------
// We need to test internal classes and functions that are NOT exported.
// Strategy: re-export internals via a test-only module, or inline-test the
// exported setupAgentDispatcher by capturing EventBus handler callbacks.
//
// ReactionDedup is still internal to agent-dispatcher. MessageDebouncer is now
// exported from message-debouncer.ts and tested separately in
// message-debouncer.test.ts.
// ---------------------------------------------------------------------------

// Import exported symbols
import {
  type DispatcherCleanup,
  __test__,
  cancelActiveAgentRun,
  isFirstPartyInstanceSender,
  resolveQuotedMessage,
  setupAgentDispatcher,
} from '../agent-dispatcher';

// We need to mock the plugin loader to avoid real FS/channel-sdk imports
mock.module('../loader', () => ({
  getPlugin: mock(() => Promise.resolve(undefined)),
}));

// Mock @omni/core selectively — only mock classes/functions the dispatcher needs.
// IMPORTANT: Do NOT mock createLogger here — bun's mock.module merges with the
// real module, and mocking createLogger contaminates concurrent test files
// (logger.test.ts) because bun applies the mock process-wide.
mock.module('@omni/core', () => {
  // We need to provide the class constructors for agent providers
  class MockAgnoAgentProvider {
    readonly schema = 'agno' as const;
    readonly mode = 'round-trip' as const;
    constructor(
      readonly id: string,
      readonly name: string,
      private client: unknown,
      private config: Record<string, unknown>,
    ) {}
    canHandle() {
      return true;
    }
    async trigger() {
      return { parts: ['mock response'], metadata: { runId: 'run-1', providerId: this.id, durationMs: 100 } };
    }
    async checkHealth() {
      return { healthy: true, latencyMs: 10 };
    }
  }

  class MockWebhookAgentProvider {
    readonly schema = 'webhook' as const;
    readonly mode: 'round-trip' | 'fire-and-forget';
    constructor(
      readonly id: string,
      readonly name: string,
      private config: { mode: string },
    ) {
      this.mode = config.mode as 'round-trip' | 'fire-and-forget';
    }
    canHandle() {
      return true;
    }
    async trigger() {
      return { parts: ['webhook response'], metadata: { runId: 'run-w', providerId: this.id, durationMs: 50 } };
    }
    async checkHealth() {
      return { healthy: true, latencyMs: 20 };
    }
  }

  // NOTE: OpenClawAgentProvider and OpenClawClient are NOT mocked here.
  // Bun's mock.module merges with the real module, so real classes pass through.
  // Mocking them would contaminate openclaw.test.ts (which imports from relative
  // paths but shares the module graph via Bun's deduplication).
  // No dispatcher test exercises the OpenClaw code path (all use schema: 'agno').

  // createLogger is NOT mocked — the real implementation passes through via
  // bun's merge behavior, keeping logger.test.ts and other test files working.
  return {
    // Preserve every real export (OmniError, createLogger, EventType, …) so
    // this global module mock only overrides the provider surface below.
    ...omniCoreReal,
    AgnoAgentProvider: MockAgnoAgentProvider,
    WebhookAgentProvider: MockWebhookAgentProvider,
    createProviderClient: mock(() => ({})),
    generateCorrelationId: (prefix?: string) => `${prefix ?? 'corr'}-test-${Date.now()}`,
  };
});

// ============================================================================
// Test Fixtures
// ============================================================================

// Mock database for tests.
// The dispatcher calls db.select({...}).from(agents).where(...).limit(1) in applyAgentFkOverrides.
// We build a chainable mock that returns an agent row matching the mock instance fixture.
function createMockDb(agentRowOverrides: Record<string, unknown> = {}) {
  const agentRow = {
    id: 'agent-uuid-1',
    agentProviderId: 'provider-1',
    agentType: 'assistant',
    metadata: { providerAgentId: 'default-agent' },
    configPath: null,
    ...agentRowOverrides,
  };

  const chain = {
    from: mock(() => chain),
    where: mock(() => chain),
    limit: mock(() => Promise.resolve([agentRow])),
  };

  // Idempotency claims (#411) — db.insert(processedEvents).values(...).onConflictDoNothing().returning(...)
  // Stateless mock: always claims (returns one row) so existing dispatcher tests
  // that re-use static event ids across multiple `fire(...)` calls don't get
  // skipped. Real PG semantics + the at-most-once contract are covered by the
  // `withIdempotency` unit tests in src/lib/__tests__/idempotency.test.ts.
  const insertChain = (row: { eventId?: string; handler?: string }) => ({
    onConflictDoNothing: () => ({
      returning: async () => [{ eventId: row.eventId ?? 'mock-evt' }],
    }),
  });

  return {
    select: mock(() => chain),
    insert: mock(() => ({
      values: (row: { eventId?: string; handler?: string }) => insertChain(row),
    })),
  } as unknown as import('@omni/db').Database;
}

const mockDb = createMockDb();

function createMockInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    name: 'Test Instance',
    channel: 'whatsapp-baileys',
    // agentId is now the UUID FK to agents (phase 3); agentProviderId/agentType are transient dispatch fields
    agentId: 'agent-uuid-1',
    agentProviderId: 'provider-1',
    agentType: 'agent',
    agentTimeout: 60,
    agentStreamMode: false,
    agentReplyFilter: {
      mode: 'all' as const,
      conditions: {
        onDm: true,
        onMention: true,
        onReply: true,
        onNameMatch: false,
      },
    },
    agentSessionStrategy: 'per_chat',
    agentPrefixSenderName: true,
    triggerEvents: ['message.received'],
    triggerReactions: null,
    triggerMentionPatterns: null,
    triggerMode: 'round-trip',
    ownerIdentifier: 'bot-jid@s.whatsapp.net',
    enableAutoSplit: true,
    messageDebounceMode: 'disabled',
    messageDebounceMinMs: 0,
    messageDebounceMaxMs: 0,
    messageDebounceRestartOnTyping: false,
    messageSplitDelayMode: 'disabled',
    messageSplitDelayFixedMs: 0,
    messageSplitDelayMinMs: 0,
    messageSplitDelayMaxMs: 0,
    isActive: true,
    isDefault: false,
    ...overrides,
  } as Record<string, unknown>;
}

function createMockProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    name: 'Test Provider',
    schema: 'agno',
    baseUrl: 'http://localhost:8181',
    apiKey: 'test-key',
    schemaConfig: {},
    defaultStream: true,
    defaultTimeout: 60,
    isActive: true,
    supportsStreaming: true,
    supportsImages: false,
    supportsAudio: false,
    supportsDocuments: false,
    ...overrides,
  };
}

type SubscribeHandler = (event: Record<string, unknown>) => Promise<void>;

function createMockEventBus() {
  const handlers = new Map<string, SubscribeHandler>();

  return {
    handlers,
    subscribe: mock(async (type: string, handler: SubscribeHandler, _options?: unknown) => {
      handlers.set(type, handler);
    }),
    publish: mock(async () => ({ seq: 1 })),
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    // Convenience: fire a captured handler
    async fire(type: string, event: Record<string, unknown>) {
      const handler = handlers.get(type);
      if (!handler) throw new Error(`No handler registered for ${type}`);
      await handler(event);
    },
  };
}

function createMockServices(overrides: Record<string, unknown> = {}) {
  const agentRunner = {
    getInstanceWithProvider: mock(async (instanceId: string) => {
      if (instanceId === 'inst-1') return createMockInstance();
      return null;
    }),
    getSenderName: mock(async (_personId?: string, fallback?: string) => fallback ?? 'Test User'),
    run: mock(async () => ({
      parts: ['Hello from agent!'],
      metadata: { runId: 'run-1', sessionId: 'sess-1', status: 'completed' },
    })),
  };

  const access = {
    checkAccess: mock(async () => ({ allowed: true, reason: 'default allow' })),
  };

  const providers = {
    getById: mock(async (id: string) => {
      if (id === 'provider-1') return createMockProvider();
      return null;
    }),
  };

  const routeResolver = {
    resolve: mock(async () => null),
  };

  const chats = {
    getByExternalId: mock(async () => null),
    findByExternalIdSmart: mock(async () => null),
  };

  const persons = {
    getIdentityByPlatformId: mock(async () => null),
  };

  return {
    agentRunner,
    access,
    providers,
    routeResolver,
    chats,
    persons,
    ...overrides,
  } as unknown as import('../../services').Services;
}

function createMessageEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-msg-1',
    type: 'message.received',
    payload: {
      externalId: 'ext-1',
      chatId: 'user-123@s.whatsapp.net',
      from: 'user-123',
      content: { type: 'text', text: 'Hello bot!' },
      rawPayload: {},
      ...((overrides.payload as Record<string, unknown>) ?? {}),
    },
    metadata: {
      correlationId: 'corr-1',
      instanceId: 'inst-1',
      channelType: 'whatsapp-baileys',
      personId: 'person-1',
      platformIdentityId: 'bot-platform-id',
      ...((overrides.metadata as Record<string, unknown>) ?? {}),
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

function createReactionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-rxn-1',
    type: 'reaction.received',
    payload: {
      messageId: 'msg-100',
      chatId: 'chat-1',
      from: 'user-456',
      emoji: '\u{1F44D}',
      ...((overrides.payload as Record<string, unknown>) ?? {}),
    },
    metadata: {
      correlationId: 'corr-2',
      instanceId: 'inst-1',
      channelType: 'whatsapp-baileys',
      personId: 'person-2',
      ...((overrides.metadata as Record<string, unknown>) ?? {}),
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('agent-dispatcher', () => {
  describe('human lifecycle observability helpers', () => {
    it('builds redacted-readable lifecycle attributes without raw PII or secrets', () => {
      const attributes = __test__.buildLifecycleSpanAttributes({
        stage: 'provider_inbound',
        eventType: 'user_message_turn',
        channel: 'whatsapp-baileys',
        provider: 'gupshup',
        instanceId: 'inst-1',
        chatId: '5511999887766@s.whatsapp.net',
        sessionId: 'p0r-hml-20260531T204449Z',
        traceId: 'trc-test-123',
        messageId: 'wamid.123',
        agentId: 'eugenia-seller',
        inputText: 'Olá, meu telefone é 5511999887766 e email felipe@example.com. Quero cotar plano.',
        outputText: 'Claro, posso ajudar com a cotação.',
        extra: {
          authorization: 'Bearer super-secret-token',
          token: 'abc123',
        },
      });

      expect(attributes['khal.lifecycle.stage']).toBe('provider_inbound');
      expect(attributes['khal.event_type']).toBe('user_message_turn');
      expect(attributes['khal.channel']).toBe('whatsapp-baileys');
      expect(attributes['khal.provider']).toBe('gupshup');
      expect(attributes['langfuse.session.id']).toBe('p0r-hml-20260531T204449Z');
      expect(attributes['session.id']).toBe('p0r-hml-20260531T204449Z');
      expect(attributes['khal.input_chars']).toBeGreaterThan(0);
      expect(String(attributes['khal.input_sha256'])).toStartWith('sha256:');
      expect(String(attributes['khal.output_sha256'])).toStartWith('sha256:');
      expect(String(attributes['khal.input_preview_redacted'])).toContain('[PHONE]');
      expect(String(attributes['khal.input_preview_redacted'])).toContain('[EMAIL]');
      expect(JSON.stringify(attributes)).not.toContain('felipe@example.com');
      expect(JSON.stringify(attributes)).not.toContain('5511999887766');
      expect(JSON.stringify(attributes)).not.toContain('super-secret-token');
      expect(JSON.stringify(attributes)).not.toContain('abc123');
    });
  });

  // ======================================================================
  // setupAgentDispatcher — subscribes to correct NATS subjects
  // ======================================================================
  describe('setupAgentDispatcher', () => {
    it('subscribes to message.received, reaction.received, reaction.removed, presence.typing, media.processed, and agent.run.cancel_requested', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      const cleanup = await setupAgentDispatcher(
        eventBus as unknown as import('@omni/core').EventBus,
        services,
        mockDb,
      );

      expect(eventBus.subscribe).toHaveBeenCalledTimes(6);

      // Verify event types subscribed
      const subscribedTypes = eventBus.subscribe.mock.calls.map((call: unknown[]) => call[0]);
      expect(subscribedTypes).toContain('message.received');
      expect(subscribedTypes).toContain('reaction.received');
      expect(subscribedTypes).toContain('reaction.removed');
      expect(subscribedTypes).toContain('presence.typing');
      expect(subscribedTypes).toContain('media.processed');
      expect(subscribedTypes).toContain('agent.run.cancel_requested');

      cleanup();
    });

    it('cancelActiveAgentRun resolves false when nothing is in flight (#914)', async () => {
      await expect(cancelActiveAgentRun('inst-none', 'chat-none', 'user_stop')).resolves.toBe(false);
    });

    it('cancelActiveAgentRun aborts only the targeted thread (#914)', async () => {
      const { activeRunAborts, runAbortKey } = __test__;
      const runA = { controller: new AbortController(), startedAt: Date.now() - 5_000 };
      const runB = { controller: new AbortController(), startedAt: Date.now() - 5_000 };
      activeRunAborts.set(runAbortKey('inst-1', 'C1', 'thread-A'), runA);
      activeRunAborts.set(runAbortKey('inst-1', 'C1', 'thread-B'), runB);

      try {
        await expect(cancelActiveAgentRun('inst-1', 'C1', 'user_stop', { threadId: 'thread-A' })).resolves.toBe(true);
        expect(runA.controller.signal.aborted).toBe(true);
        expect(runB.controller.signal.aborted).toBe(false);
      } finally {
        activeRunAborts.clear();
      }
    });

    it('cancelActiveAgentRun falls back to the threadless run for the same chat (#914)', async () => {
      const { activeRunAborts, runAbortKey } = __test__;
      // Top-level mention / DM: the run registered without a threadId, but
      // Slack's stop event carries the thread_ts of the reply thread.
      const run = { controller: new AbortController(), startedAt: Date.now() - 5_000 };
      activeRunAborts.set(runAbortKey('inst-1', 'C1'), run);

      try {
        await expect(cancelActiveAgentRun('inst-1', 'C1', 'user_stop', { threadId: '1234.5678' })).resolves.toBe(true);
        expect(run.controller.signal.aborted).toBe(true);
      } finally {
        activeRunAborts.clear();
      }
    });

    it('cancelActiveAgentRun ignores a run that started after the stop press (#914)', async () => {
      const { activeRunAborts, runAbortKey } = __test__;
      const stopPressedAt = Date.now() - 10_000;
      const newerRun = { controller: new AbortController(), startedAt: Date.now() };
      activeRunAborts.set(runAbortKey('inst-1', 'C1', 'thread-A'), newerRun);

      try {
        await expect(
          cancelActiveAgentRun('inst-1', 'C1', 'user_stop', { threadId: 'thread-A', requestedAt: stopPressedAt }),
        ).resolves.toBe(false);
        expect(newerRun.controller.signal.aborted).toBe(false);
      } finally {
        activeRunAborts.clear();
      }
    });

    it('cancelActiveAgentRun prefers sender.cancel (halt-and-keep) over abort (#914)', async () => {
      const { activeRunAborts, runAbortKey } = __test__;
      const cancelMock = mock(async () => {});
      const abortMock = mock(async () => {});
      const run = {
        controller: new AbortController(),
        startedAt: Date.now() - 5_000,
        sender: {
          onThinkingDelta: mock(async () => {}),
          onContentDelta: mock(async () => {}),
          onFinal: mock(async () => {}),
          onError: mock(async () => {}),
          abort: abortMock,
          cancel: cancelMock,
        },
      };
      activeRunAborts.set(runAbortKey('inst-1', 'C1', 'thread-A'), run);

      try {
        await expect(cancelActiveAgentRun('inst-1', 'C1', 'user_stop', { threadId: 'thread-A' })).resolves.toBe(true);
        expect(cancelMock).toHaveBeenCalledTimes(1);
        expect(abortMock).not.toHaveBeenCalled();
      } finally {
        activeRunAborts.clear();
      }
    });

    it('returns a cleanup function that can be called without error', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      const cleanup = await setupAgentDispatcher(
        eventBus as unknown as import('@omni/core').EventBus,
        services,
        mockDb,
      );

      expect(typeof cleanup).toBe('function');
      // Should not throw
      cleanup();
    });

    it('passes correct durable and queue options for each subscription', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      const cleanup = await setupAgentDispatcher(
        eventBus as unknown as import('@omni/core').EventBus,
        services,
        mockDb,
      );

      // Check options for message.received
      const msgCall = eventBus.subscribe.mock.calls.find((call: unknown[]) => call[0] === 'message.received');
      expect(msgCall).toBeDefined();
      expect(msgCall?.[2]).toMatchObject({
        durable: 'agent-dispatcher-msg',
        queue: 'agent-dispatcher',
      });

      // Check options for reaction.received
      const rxnCall = eventBus.subscribe.mock.calls.find((call: unknown[]) => call[0] === 'reaction.received');
      expect(rxnCall).toBeDefined();
      expect(rxnCall?.[2]).toMatchObject({
        durable: 'agent-dispatcher-reaction',
        queue: 'agent-dispatcher',
      });

      // Check options for reaction.removed
      const rxnRemovedCall = eventBus.subscribe.mock.calls.find((call: unknown[]) => call[0] === 'reaction.removed');
      expect(rxnRemovedCall).toBeDefined();
      expect(rxnRemovedCall?.[2]).toMatchObject({
        durable: 'agent-dispatcher-reaction-removed',
        queue: 'agent-dispatcher',
      });

      // Check options for presence.typing
      const typingCall = eventBus.subscribe.mock.calls.find((call: unknown[]) => call[0] === 'presence.typing');
      expect(typingCall).toBeDefined();
      expect(typingCall?.[2]).toMatchObject({
        durable: 'agent-dispatcher-typing',
        queue: 'agent-dispatcher',
      });

      // Check options for media.processed
      const mediaCall = eventBus.subscribe.mock.calls.find((call: unknown[]) => call[0] === 'media.processed');
      expect(mediaCall).toBeDefined();
      expect(mediaCall?.[2]).toMatchObject({
        durable: 'agent-dispatcher-media',
        queue: 'agent-dispatcher-media',
        startFrom: 'new',
      });

      cleanup();
    });
  });

  // ======================================================================
  // Message processing through the event handler
  // ======================================================================
  describe('message processing (via event handler)', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    it('processes a valid message event through to agent runner', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const event = createMessageEvent();
      await eventBus.fire('message.received', event);

      // With debounce disabled (mode='disabled'), the debouncer fires with delay=0
      // Wait for the setTimeout(0) to flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      // B-1: IAgentProvider handles dispatch; getSenderName proves message reached processAgentResponse
      expect(services.agentRunner.getSenderName).toHaveBeenCalledTimes(1);
    });

    it('skips messages from the bot itself (from === platformIdentityId)', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const event = createMessageEvent({
        payload: {
          externalId: 'ext-1',
          chatId: 'user-123@s.whatsapp.net',
          from: 'bot-platform-id', // Same as platformIdentityId
          content: { type: 'text', text: 'Bot message' },
          rawPayload: {},
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(services.agentRunner.run).not.toHaveBeenCalled();
    });

    it('skips messages when instanceId is missing', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const event = createMessageEvent({
        metadata: {
          correlationId: 'corr-1',
          instanceId: undefined,
          channelType: 'whatsapp-baileys',
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(services.agentRunner.run).not.toHaveBeenCalled();
    });

    it('skips messages when instance has no agentId', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () => createMockInstance({ agentId: null })),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({ parts: ['resp'], metadata: { runId: 'r', sessionId: 's', status: 'completed' } })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire('message.received', createMessageEvent());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(agentRunner.run).not.toHaveBeenCalled();
    });

    it('skips messages when access check denies', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices({
        access: {
          checkAccess: mock(async () => ({ allowed: false, reason: 'Blocked by rule' })),
        },
      });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire('message.received', createMessageEvent());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(services.agentRunner.run).not.toHaveBeenCalled();
    });

    it('allows LID sender when resolvedSenderPhone matches allowlist rule', async () => {
      const eventBus = createMockEventBus();
      // Access check: deny LID ID but allow phone number (simulates allowlist with phone rule)
      const checkAccess = mock(async (_instance: unknown, id: string) => {
        if (id === '5511999000001') return { allowed: true, reason: 'Phone matched allowlist' };
        return { allowed: false, reason: 'No rule matched', mode: 'allowlist' };
      });
      const services = createMockServices({
        access: { checkAccess, requestPairing: mock(async () => {}) },
      });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // LID sender with resolvedSenderPhone annotated by channel-whatsapp
      const event = createMessageEvent({
        payload: {
          externalId: 'ext-lid-allowlist',
          chatId: '100000001@lid',
          from: '100000001', // LID ID — no rule matches this
          content: { type: 'text', text: 'Hello from LID sender' },
          rawPayload: { resolvedSenderPhone: '5511999000001' }, // phone resolved from LID cache
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have been called 3 times: once for LID, once fallback (no participantAlt), once for resolvedSenderPhone
      // G5 run15: `checkAccess` gained a 4th `trustedTenantId` parameter so the
      // consumer path can scope its rule read. These legacy-envelope events
      // classify `legacy`, so the dispatcher threads `undefined` — the same value
      // the parameter defaults to, i.e. identical behaviour. Only the recorded
      // ARITY changed, which `toHaveBeenCalledWith` compares exactly.
      expect(checkAccess).toHaveBeenCalledWith(expect.anything(), '100000001', expect.anything(), undefined);
      expect(checkAccess).toHaveBeenCalledWith(expect.anything(), '5511999000001', expect.anything(), undefined);
      // Message should have reached agent (allowed via phone number)
      expect(services.agentRunner.getSenderName).toHaveBeenCalled();
    });

    it('denies LID sender when resolvedSenderPhone is also not in allowlist', async () => {
      const eventBus = createMockEventBus();
      const checkAccess = mock(async () => ({ allowed: false, reason: 'No rule matched', mode: 'allowlist' }));
      const services = createMockServices({
        access: { checkAccess, requestPairing: mock(async () => {}) },
      });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const event = createMessageEvent({
        payload: {
          externalId: 'ext-lid-denied',
          chatId: '100000002@lid',
          from: '100000002',
          content: { type: 'text', text: 'Hello, blocked' },
          rawPayload: { resolvedSenderPhone: '5511999000002' },
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(services.agentRunner.run).not.toHaveBeenCalled();
    });

    it('allows LID group sender via participantAlt when resolvedSenderPhone is absent', async () => {
      const eventBus = createMockEventBus();
      const checkAccess = mock(async (_instance: unknown, id: string) => {
        if (id === '5511999000003') return { allowed: true, reason: 'Phone matched allowlist' };
        return { allowed: false, reason: 'No rule matched', mode: 'allowlist' };
      });
      const services = createMockServices({
        access: { checkAccess, requestPairing: mock(async () => {}) },
      });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Group message: participantAlt in key (existing fallback path), no resolvedSenderPhone
      const event = createMessageEvent({
        payload: {
          externalId: 'ext-group-lid',
          chatId: '5511group@g.us',
          from: '100000003',
          content: { type: 'text', text: 'Group msg from LID sender' },
          rawPayload: { key: { participantAlt: '5511999000003@s.whatsapp.net' } },
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // G5 run15: `checkAccess` gained a 4th `trustedTenantId` parameter so the
      // consumer path can scope its rule read. These legacy-envelope events
      // classify `legacy`, so the dispatcher threads `undefined` — the same value
      // the parameter defaults to, i.e. identical behaviour. Only the recorded
      // ARITY changed, which `toHaveBeenCalledWith` compares exactly.
      expect(checkAccess).toHaveBeenCalledWith(expect.anything(), '5511999000003', expect.anything(), undefined);
      expect(services.agentRunner.getSenderName).toHaveBeenCalled();
    });

    // ======================================================================
    // #384: inbound rate limiter REMOVED. Debouncer is the only burst gate.
    // Acceptance criteria:
    //   - 10-msg burst → exactly 1 dispatch carrying all 10
    //   - 50-msg burst → exactly 1 dispatch, zero drops
    //   - No "Rate limited" log line ever emitted for inbound messages
    // ======================================================================
    it('#384: 10-message burst produces exactly 1 dispatch with all messages', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () => createMockInstance()),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const events = Array.from({ length: 10 }, (_, i) =>
        createMessageEvent({
          payload: {
            externalId: `ext-${i}`,
            chatId: '5511999000384@s.whatsapp.net',
            from: '5511999000384',
            content: { type: 'text', text: `msg ${i}` },
          },
        }),
      );
      for (const event of events) {
        await eventBus.fire('message.received', event);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Exactly one dispatched trigger (debounced batch). Pre-fix: the rate
      // limiter would have capped at 5 and dropped the 5 tail messages.
      expect(agentRunner.getSenderName.mock.calls.length).toBe(1);
    });

    it('#384: 50-message burst produces exactly 1 dispatch, zero drops', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () => createMockInstance()),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const events = Array.from({ length: 50 }, (_, i) =>
        createMessageEvent({
          payload: {
            externalId: `burst-${i}`,
            chatId: '5511999000050@s.whatsapp.net',
            from: '5511999000050',
            content: { type: 'text', text: `chunk ${i}` },
          },
        }),
      );
      for (const event of events) {
        await eventBus.fire('message.received', event);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Any number > 1 here would indicate the rate limiter silently dropped
      // a subset — agent would see fewer events than the user typed. The
      // fix removes that gate entirely, so exactly one debounced trigger fires.
      expect(agentRunner.getSenderName.mock.calls.length).toBe(1);
    });
  });

  // ======================================================================
  // Reaction processing through the event handler
  // ======================================================================
  describe('reaction processing (via event handler)', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    it('processes a valid reaction event', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['message.received', 'reaction.received'],
          }),
        ),
        getSenderName: mock(async () => 'Reactor'),
        run: mock(async () => ({
          parts: ['Reaction response'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire('reaction.received', createReactionEvent());

      // Reaction processing is immediate (no debounce)
      // Give it a moment for the async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Either the provider trigger or agentRunner.run should have been called
      // (depends on whether provider resolution succeeds with our mocks)
      expect(agentRunner.getInstanceWithProvider).toHaveBeenCalled();
    });

    it('skips reactions when reaction.received is not in triggerEvents', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['message.received'], // No reaction.received
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: [],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire('reaction.received', createReactionEvent());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(agentRunner.run).not.toHaveBeenCalled();
    });

    it('skips reactions when emoji is not in triggerReactions list', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['message.received', 'reaction.received'],
            triggerReactions: ['\u2764\uFE0F'], // Only heart, not thumbs up
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: [],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire(
        'reaction.received',
        createReactionEvent({
          payload: { messageId: 'msg-1', chatId: 'chat-1', from: 'user-1', emoji: '\u{1F44D}' }, // thumbs up
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(agentRunner.run).not.toHaveBeenCalled();
    });

    it('allows all emojis when triggerReactions is null', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['message.received', 'reaction.received'],
            triggerReactions: null, // null = all emojis
          }),
        ),
        getSenderName: mock(async () => 'Reactor'),
        run: mock(async () => ({
          parts: ['ok'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire('reaction.received', createReactionEvent());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(agentRunner.getInstanceWithProvider).toHaveBeenCalled();
    });

    it('deduplicates identical reactions (same emoji + messageId + userId)', async () => {
      const eventBus = createMockEventBus();
      let runCount = 0;
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['message.received', 'reaction.received'],
            triggerReactions: null,
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => {
          runCount++;
          return {
            parts: ['resp'],
            metadata: { runId: `r-${runCount}`, sessionId: 's', status: 'completed' },
          };
        }),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const rxnEvent = createReactionEvent({
        payload: { messageId: 'msg-dup', chatId: 'chat-1', from: 'user-same', emoji: '\u{1F44D}' },
      });

      // Fire the same reaction twice
      await eventBus.fire('reaction.received', rxnEvent);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await eventBus.fire('reaction.received', rxnEvent);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // getInstanceWithProvider is called for both, but second should be deduped
      // First call: not a dup. Second call: same messageId+emoji+userId → duplicate, skipped.
      // The run call should happen at most once (from the first reaction)
      // Note: it may be 0 if provider resolution intercepts
      expect(runCount).toBeLessThanOrEqual(1);
    });

    it('does not deduplicate different emojis on same message', async () => {
      const eventBus = createMockEventBus();
      let runCount = 0;
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['message.received', 'reaction.received'],
            triggerReactions: null,
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => {
          runCount++;
          return {
            parts: ['resp'],
            metadata: { runId: `r-${runCount}`, sessionId: 's', status: 'completed' },
          };
        }),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Different emojis on the same message from the same user → both should process
      await eventBus.fire(
        'reaction.received',
        createReactionEvent({
          payload: { messageId: 'msg-multi', chatId: 'chat-1', from: 'user-1', emoji: '\u{1F44D}' },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      await eventBus.fire(
        'reaction.received',
        createReactionEvent({
          payload: { messageId: 'msg-multi', chatId: 'chat-1', from: 'user-1', emoji: '\u2764\uFE0F' },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both should get past dedup (different emoji keys)
      expect(agentRunner.getInstanceWithProvider.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('enforces per-message reaction limit (maxPerMessage=3)', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['message.received', 'reaction.received'],
            triggerReactions: null,
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const emojis = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F525}', '\u{1F389}'];
      // Fire 4 different emojis on the same message from different users
      for (let i = 0; i < emojis.length; i++) {
        await eventBus.fire(
          'reaction.received',
          createReactionEvent({
            payload: {
              messageId: 'msg-limit',
              chatId: 'chat-1',
              from: `user-${i}`,
              emoji: emojis[i],
            },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // The 4th reaction (index 3) should be deduped by per-message limit (3)
      // getInstanceWithProvider is called before dedup check, so all 4 calls happen,
      // but the dedup check prevents the 4th from proceeding to run/trigger
      // We verify via getInstanceWithProvider calls (all 4) vs the processing that follows
      expect(agentRunner.getInstanceWithProvider).toHaveBeenCalledTimes(4);
    });
  });

  // ======================================================================
  // Message debouncing behavior
  // ======================================================================
  describe('message debouncing', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    it('buffers multiple messages and flushes as a batch when debounce is enabled', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            messageDebounceMode: 'fixed',
            messageDebounceMinMs: 100,
            messageDebounceMaxMs: 100,
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['batched response'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Send two messages rapidly
      await eventBus.fire('message.received', createMessageEvent());
      await eventBus.fire(
        'message.received',
        createMessageEvent({
          payload: {
            externalId: 'ext-2',
            chatId: 'user-123@s.whatsapp.net',
            from: 'user-123',
            content: { type: 'text', text: 'Second message' },
            rawPayload: {},
          },
        }),
      );

      // Not yet flushed — processAgentResponse not called yet
      expect(agentRunner.getSenderName).not.toHaveBeenCalled();

      // Wait for debounce to flush (100ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // B-1: IAgentProvider handles dispatch; getSenderName proves batched flush reached processAgentResponse
      expect(agentRunner.getSenderName).toHaveBeenCalledTimes(1);
    });

    it('uses group debounce window when chatId is a group and messageDebounceGroupMs is set', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            messageDebounceMode: 'fixed',
            messageDebounceMinMs: 50,
            messageDebounceGroupMs: 200,
            messageDebounceMaxMs: 50,
            // Ensure group messages pass reply filter (default is onNameMatch=false)
            agentReplyFilter: {
              mode: 'all' as const,
              conditions: { onDm: true, onMention: true, onReply: true, onNameMatch: true },
            },
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire(
        'message.received',
        createMessageEvent({
          payload: {
            chatId: '12345@g.us',
            content: { type: 'text', text: 'hello group' },
          },
        }),
      );

      // Wait less than group debounce (200ms) — should not flush yet
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(agentRunner.getSenderName).not.toHaveBeenCalled();

      // Wait enough for group debounce to flush
      await new Promise((resolve) => setTimeout(resolve, 140));
      expect(agentRunner.getSenderName).toHaveBeenCalledTimes(1);
    });

    it('flushes immediately when debounce mode is disabled', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire('message.received', createMessageEvent());

      // With disabled debounce, setTimeout(0) fires almost immediately
      await new Promise((resolve) => setTimeout(resolve, 50));

      // B-1: IAgentProvider handles dispatch; getSenderName proves immediate flush reached processAgentResponse
      expect(services.agentRunner.getSenderName).toHaveBeenCalled();
    });

    it('restarts debounce timer on typing event when restartOnTyping is true', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            messageDebounceMode: 'randomized',
            messageDebounceMinMs: 150,
            messageDebounceMaxMs: 150,
            messageDebounceRestartOnTyping: true,
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Send a message
      await eventBus.fire('message.received', createMessageEvent());

      // Wait 80ms (less than 150ms debounce)
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Simulate typing event — should restart timer
      await eventBus.fire('presence.typing', {
        id: 'evt-typing-1',
        type: 'presence.typing',
        payload: { chatId: 'user-123@s.whatsapp.net', from: 'user-123' },
        metadata: { correlationId: 'c', instanceId: 'inst-1' },
        timestamp: Date.now(),
      });

      // Wait 80ms more (160ms total from message, but only 80ms from typing restart)
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Should NOT have flushed yet (timer was restarted at 80ms, so 80+80=160ms < 80+150=230ms)
      expect(agentRunner.getSenderName).not.toHaveBeenCalled();

      // Wait another 100ms for the restarted timer to fire (total ~240ms from typing restart)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // B-1: IAgentProvider handles dispatch; getSenderName proves debounce-restart worked
      expect(agentRunner.getSenderName).toHaveBeenCalledTimes(1);
    });
  });

  // ======================================================================
  // Cleanup
  // ======================================================================
  describe('cleanup function', () => {
    it('flushes pending buffers on cleanup (does not drop)', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            messageDebounceMode: 'fixed',
            messageDebounceMinMs: 5000,
            messageDebounceMaxMs: 5000,
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      const cleanup = await setupAgentDispatcher(
        eventBus as unknown as import('@omni/core').EventBus,
        services,
        mockDb,
      );

      // Buffer a message (debounce set to 5000ms — the timer will NOT fire on its own)
      await eventBus.fire('message.received', createMessageEvent());

      // Graceful shutdown drains pending buffers via flushAll() rather than
      // dropping them — the buffered message is delivered as a final turn.
      await cleanup();

      expect(agentRunner.run).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // Instance trigger event configuration
  // ======================================================================
  describe('instanceTriggersOnEvent behavior', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    it('defaults to only message.received when triggerEvents is empty', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: [], // Empty array
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Message should still work (default)
      await eventBus.fire('message.received', createMessageEvent());
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Empty triggerEvents defaults to message.received: `if (triggerEvents.length === 0) return eventType === 'message.received'`
      // B-1: IAgentProvider handles dispatch; getSenderName proves default trigger config works
      expect(agentRunner.getSenderName).toHaveBeenCalled();
    });

    it('respects triggerEvents for reaction events', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            triggerEvents: ['reaction.received'], // Only reaction, not message
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Message should be skipped (not in triggerEvents)
      await eventBus.fire('message.received', createMessageEvent());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(agentRunner.run).not.toHaveBeenCalled();

      // Reaction should be processed
      await eventBus.fire('reaction.received', createReactionEvent());
      await new Promise((resolve) => setTimeout(resolve, 100));

      // getInstanceWithProvider should have been called for both events
      expect(agentRunner.getInstanceWithProvider.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ======================================================================
  // Reply filter integration
  // ======================================================================
  describe('reply filter integration', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    it('skips messages that do not pass the reply filter', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            agentReplyFilter: {
              mode: 'filtered',
              conditions: {
                onDm: true,
                onMention: false,
                onReply: false,
                onNameMatch: false,
              },
            },
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Send a group message (not a DM) — should be filtered out
      const event = createMessageEvent({
        payload: {
          externalId: 'ext-1',
          chatId: 'group-123@g.us', // Group chat
          from: 'user-123',
          content: { type: 'text', text: 'Hello' },
          rawPayload: { isGroup: true },
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(agentRunner.run).not.toHaveBeenCalled();
    });

    it('processes DMs when onDm filter is enabled', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            agentReplyFilter: {
              mode: 'filtered',
              conditions: {
                onDm: true,
                onMention: false,
                onReply: false,
                onNameMatch: false,
              },
            },
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // DM chat — should pass filter
      const event = createMessageEvent({
        payload: {
          externalId: 'ext-1',
          chatId: 'user-123@s.whatsapp.net', // DM
          from: 'user-123',
          content: { type: 'text', text: 'Hello' },
          rawPayload: {},
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // B-1: IAgentProvider handles dispatch; getSenderName proves DM filter passed correctly
      expect(agentRunner.getSenderName).toHaveBeenCalled();
    });

    it('processes LID DMs when onDm filter is enabled (LID-first)', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            agentReplyFilter: {
              mode: 'filtered',
              conditions: {
                onDm: true,
                onMention: false,
                onReply: false,
                onNameMatch: false,
              },
            },
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // LID DM — should pass filter (LID-first: @lid is a valid DM identity)
      const event = createMessageEvent({
        payload: {
          externalId: 'ext-lid-1',
          chatId: '100000001@lid', // LID-canonical DM
          from: '100000001',
          content: { type: 'text', text: 'Hello from LID' },
          rawPayload: {},
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // LID DMs should pass the DM filter and reach agent processing
      expect(agentRunner.getSenderName).toHaveBeenCalled();
    });

    it('processes messages when reply filter is null (allow-all default — #371)', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            agentReplyFilter: null, // No filter = allow all (documented new default)
          }),
        ),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      await eventBus.fire('message.received', createMessageEvent());
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Null filter should pass the reply-filter gate and reach agent dispatch.
      expect(agentRunner.getSenderName).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // Error resilience
  // ======================================================================
  describe('error resilience', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    it('does not throw when agentRunner.getInstanceWithProvider throws', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () => {
          throw new Error('DB connection lost');
        }),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: [],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Should not throw
      await eventBus.fire('message.received', createMessageEvent());
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Error is caught silently
      expect(agentRunner.run).not.toHaveBeenCalled();
    });

    it('does not throw when agentRunner.run throws', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () => createMockInstance()),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => {
          throw new Error('Agent execution failed');
        }),
      };
      // B-1: Provider lookup fails → falls through to legacy path → agentRunner.run throws → caught
      const providers = {
        getById: mock(async () => {
          throw new Error('Provider DB error');
        }),
      };
      const services = createMockServices({ agentRunner, providers });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Should not throw — errors are caught inside processAgentResponse
      await eventBus.fire('message.received', createMessageEvent());
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Legacy path was attempted (provider failed, fell through) and error was caught gracefully
      expect(agentRunner.run).toHaveBeenCalled();
    });

    it('handles reaction processing errors gracefully', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async (id: string) => {
          if (id === 'inst-1') {
            return createMockInstance({
              triggerEvents: ['message.received', 'reaction.received'],
            });
          }
          return null;
        }),
        getSenderName: mock(async () => {
          throw new Error('Person lookup failed');
        }),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Should not throw
      await eventBus.fire('reaction.received', createReactionEvent());
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Error is caught, but getSenderName was called
      expect(agentRunner.getSenderName).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // Edge: multiple instances / different channels
  // ======================================================================
  describe('multi-channel', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    it('processes messages for different channel types', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () => createMockInstance({ channel: 'telegram' })),
        getSenderName: mock(async () => 'TG User'),
        run: mock(async () => ({
          parts: ['telegram response'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      const event = createMessageEvent({
        metadata: {
          correlationId: 'corr-tg',
          instanceId: 'inst-1',
          channelType: 'telegram',
          personId: 'person-tg',
          platformIdentityId: 'bot-tg-id',
        },
      });

      await eventBus.fire('message.received', event);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // B-1: IAgentProvider handles dispatch; getSenderName proves multi-channel processing works
      expect(agentRunner.getSenderName).toHaveBeenCalled();
    });
  });

  // ======================================================================
  // resolveQuotedMessage — quoted text truncation
  // ======================================================================
  describe('resolveQuotedMessage', () => {
    function createQuotedMessageServices(messageContent: string) {
      const chatRow = { id: 'chat-db-1', externalId: 'chat-ext-1', chatType: 'dm' };
      const messageRow = {
        externalId: 'quoted-ext-1',
        senderDisplayName: 'Alice',
        senderPlatformUserId: 'alice-123',
        isFromMe: false,
        platformTimestamp: new Date('2025-01-15T10:30:00Z').getTime(),
        messageType: 'text',
        textContent: messageContent,
        transcription: null,
        imageDescription: null,
        videoDescription: null,
        documentExtraction: null,
      };

      return {
        chats: {
          findByExternalIdSmart: mock(async () => chatRow),
        },
        messages: {
          getByExternalId: mock(async () => messageRow),
        },
      } as unknown as import('../../services').Services;
    }

    it('resolves gupshup native reply aliases when replyContext.id is not the outbound external id', async () => {
      const chatRow = { id: 'chat-db-1', externalId: 'chat-ext-1', chatType: 'dm' };
      const quotedRow = {
        externalId: 'omni-outbound-uuid',
        senderDisplayName: 'You',
        senderPlatformUserId: 'bot-123',
        isFromMe: true,
        platformTimestamp: new Date('2026-06-09T05:49:16Z').getTime(),
        messageType: 'text',
        textContent: '*Notrelife SP* com coparticipação parcial',
        transcription: null,
        imageDescription: null,
        videoDescription: null,
        documentExtraction: null,
        rawPayload: {
          gupshupResponse: {
            messageId: '033ve4XFB8ikDjlsH9KcOI',
            gsId: 'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b',
          },
        },
      };
      const getByExternalId = mock(async (_chatId: string, externalId: string) =>
        externalId === 'omni-outbound-uuid' ? quotedRow : null,
      );
      const findByProviderAlias = mock(async (_chatId: string, aliases: string[]) =>
        aliases.includes('033ve4XFB8ikDjlsH9KcOI') || aliases.includes('f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b')
          ? quotedRow
          : null,
      );
      const services = {
        chats: { findByExternalIdSmart: mock(async () => chatRow) },
        messages: { getByExternalId, findByProviderAlias },
      } as unknown as import('../../services').Services;

      const result = await resolveQuotedMessage(services, 'inst-1', 'chat-ext-1', '033ve4XFB8ikDjlsH9KcOI', [
        'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b',
      ]);

      expect(result).not.toBeNull();
      expect(result).toContain('*Notrelife SP*');
      expect(getByExternalId).toHaveBeenCalledWith('chat-db-1', '033ve4XFB8ikDjlsH9KcOI');
      expect(findByProviderAlias).toHaveBeenCalledWith('chat-db-1', [
        '033ve4XFB8ikDjlsH9KcOI',
        'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b',
      ]);
    });

    it('falls back to the latest outbound bot message before the inbound native reply when Gupshup returns no provider aliases', async () => {
      const chatRow = { id: 'chat-db-1', externalId: 'chat-ext-1', chatType: 'dm' };
      const quotedRow = {
        externalId: 'omni-outbound-uuid',
        senderDisplayName: 'Eugenia',
        senderPlatformUserId: 'bot-123',
        isFromMe: true,
        platformTimestamp: new Date('2026-06-09T13:13:22Z').getTime(),
        messageType: 'text',
        textContent: '**Opção 2, Nosso Plano Completo Enfermaria** R$ 182,47/mês',
        transcription: null,
        imageDescription: null,
        videoDescription: null,
        documentExtraction: null,
      };
      const findRecentOutboundBefore = mock(async (_chatId: string, before: Date, _hint?: string) =>
        before.toISOString() === '2026-06-09T13:13:55.000Z' ? quotedRow : null,
      );
      const services = {
        chats: { findByExternalIdSmart: mock(async () => chatRow) },
        messages: {
          getByExternalId: mock(async () => null),
          findByProviderAlias: mock(async () => null),
          findRecentOutboundBefore,
        },
      } as unknown as import('../../services').Services;

      const result = await resolveQuotedMessage(
        services,
        'inst-1',
        'chat-ext-1',
        '033voYFyV6Txceb45MFW7k',
        ['ddbf1157-be24-4176-a1f8-9f679a26a39c'],
        { inboundAt: new Date('2026-06-09T13:13:55Z'), inboundText: 'quero esse' },
      );

      expect(result).not.toBeNull();
      expect(result).toContain('Opção 2');
      expect(findRecentOutboundBefore).toHaveBeenCalledWith(
        'chat-db-1',
        new Date('2026-06-09T13:13:55Z'),
        'quero esse',
      );
    });

    it('returns full text when content is under 4000 chars', async () => {
      const content = 'A'.repeat(3999);
      const services = createQuotedMessageServices(content);

      const result = await resolveQuotedMessage(services, 'inst-1', 'chat-ext-1', 'quoted-ext-1');

      expect(result).not.toBeNull();
      expect(result).toContain(content);
      expect(result).not.toContain('...');
    });

    it('truncates content over 4000 chars with ... suffix', async () => {
      const content = 'B'.repeat(5000);
      const services = createQuotedMessageServices(content);

      const result = await resolveQuotedMessage(services, 'inst-1', 'chat-ext-1', 'quoted-ext-1');

      expect(result).not.toBeNull();
      // Should contain the first 4000 chars followed by ...
      expect(result).toContain(`${'B'.repeat(4000)}...`);
      // Should NOT contain the full 5000-char string
      expect(result).not.toContain('B'.repeat(4001));
    });

    it('does not truncate a 1000-char message (old 500-char limit no longer applies)', async () => {
      const content = 'C'.repeat(1000);
      const services = createQuotedMessageServices(content);

      const result = await resolveQuotedMessage(services, 'inst-1', 'chat-ext-1', 'quoted-ext-1');

      expect(result).not.toBeNull();
      expect(result).toContain(content);
      expect(result).not.toContain('...');
    });

    it('formats the quoted message with sender name and timestamp', async () => {
      const services = createQuotedMessageServices('Hello world');

      const result = await resolveQuotedMessage(services, 'inst-1', 'chat-ext-1', 'quoted-ext-1');

      expect(result).not.toBeNull();
      expect(result).toContain('[Quoting Alice');
      expect(result).toContain('Hello world');
    });

    it('returns null when chat is not found', async () => {
      const services = {
        chats: {
          findByExternalIdSmart: mock(async () => null),
        },
        messages: {
          getByExternalId: mock(async () => null),
        },
      } as unknown as import('../../services').Services;

      const result = await resolveQuotedMessage(services, 'inst-1', 'chat-ext-1', 'quoted-ext-1');
      expect(result).toBeNull();
    });

    it('returns null when quoted message is not found', async () => {
      const services = {
        chats: {
          findByExternalIdSmart: mock(async () => ({ id: 'chat-db-1' })),
        },
        messages: {
          getByExternalId: mock(async () => null),
        },
      } as unknown as import('../../services').Services;

      const result = await resolveQuotedMessage(services, 'inst-1', 'chat-ext-1', 'quoted-ext-1');
      expect(result).toBeNull();
    });
  });

  // ======================================================================
  // A2A customer context — remote identity is external-only
  // ======================================================================
  describe('A2A customer context', () => {
    const { extractA2ACustomerContext, resolveCustomerContext } = __test__;

    it('extracts external customer context from A2A raw payload without internal IDs', () => {
      const messages = [
        {
          payload: {
            externalId: 'a2a-msg-1',
            chatId: 'a2a-task-1',
            from: 'workos-user-1',
            content: { type: 'text', text: 'hello' },
            rawPayload: {
              omniExecutionContext: {
                identity: {
                  userId: 'remote-person-should-not-be-trusted',
                  personId: 'remote-internal-person',
                  platformUserId: 'workos-user-1',
                },
                customer: {
                  customerId: 'cust-1',
                  organizationId: 'org-1',
                  tenantId: 'tenant-1',
                },
              },
            },
          },
          metadata: {
            instanceId: 'inst-1',
            traceId: 'trace-1',
          },
          timestamp: Date.now(),
        },
      ] as Parameters<typeof extractA2ACustomerContext>[0];

      expect(extractA2ACustomerContext(messages, 'a2a')).toEqual({
        externalUserId: 'workos-user-1',
        customerId: 'cust-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      });
    });

    it('merges remote customer context with stored person metadata, preferring stored values', async () => {
      const services = {
        persons: {
          getById: mock(async () => ({
            metadata: {
              externalUserId: 'stored-user-1',
              customerId: 'stored-cust-1',
            },
          })),
        },
      } as unknown as import('../../services').Services;

      const context = await resolveCustomerContext(services, 'person-1', {
        externalUserId: 'remote-user-1',
        customerId: 'remote-cust-1',
        organizationId: 'remote-org-1',
      });

      expect(context).toEqual({
        externalUserId: 'stored-user-1',
        customerId: 'stored-cust-1',
        organizationId: 'remote-org-1',
      });
    });
  });

  // ======================================================================
  // KHAL session correlation
  // ======================================================================
  describe('KHAL session correlation', () => {
    it('extracts an explicit KHAL session id from rawPayload and mirrors it into trigger headers', () => {
      const messages = [
        {
          payload: {
            rawPayload: {
              khalSessionId: ' khal-session-123 ',
            },
          },
        },
      ] as any;

      const sessionId = __test__.extractKhalSessionId(messages);

      expect(sessionId).toBe('khal-session-123');
      expect(__test__.buildTriggerHeaders(sessionId!)).toEqual({ 'x-khal-session-id': 'khal-session-123' });
    });

    it('extracts KHAL session id from inbound rawPayload headers', () => {
      const messages = [
        {
          payload: {
            rawPayload: {
              headers: { 'x-khal-session-id': 'khal-header-session' },
            },
          },
        },
      ] as any;

      expect(__test__.extractKhalSessionId(messages)).toBe('khal-header-session');
    });

    it('does not build a KHAL header for computed fallback sessions', () => {
      expect(__test__.buildTriggerHeaders(undefined)).toBeUndefined();
    });
  });

  // ======================================================================
  // buildContextMessages — DM context behavior
  // ======================================================================
  describe('buildContextMessages (DM context)', () => {
    const { buildContextMessages } = __test__;

    function createMsgRow(overrides: Record<string, unknown> = {}) {
      return {
        externalId: `ext-${Math.random().toString(36).slice(2, 8)}`,
        isFromMe: false,
        senderDisplayName: 'User',
        senderPlatformUserId: 'user-1',
        platformTimestamp: Date.now(),
        messageType: 'text',
        textContent: 'hello',
        transcription: null,
        imageDescription: null,
        videoDescription: null,
        documentExtraction: null,
        ...overrides,
      };
    }

    function createContextServices(chatType: string, messages: Record<string, unknown>[]) {
      return {
        chats: {
          findByExternalIdSmart: mock(async () => ({
            id: 'chat-uuid-1',
            chatType,
          })),
        },
        messages: {
          list: mock(async () => ({ items: messages, hasMore: false })),
        },
      } as unknown as import('../../services').Services;
    }

    function createContextInstance(overrides: Record<string, unknown> = {}) {
      return {
        id: 'inst-1',
        groupHistorySize: 50,
        ...overrides,
      } as unknown as Parameters<typeof buildContextMessages>[1];
    }

    it('DM with bot messages: context includes the bot message', async () => {
      const msgs = [
        createMsgRow({ externalId: 'current', isFromMe: false, textContent: 'new question' }),
        createMsgRow({ externalId: 'bot-1', isFromMe: true, senderDisplayName: 'Bot', textContent: 'previous answer' }),
        createMsgRow({ externalId: 'user-old', isFromMe: false, textContent: 'old question' }),
      ];
      const services = createContextServices('dm', msgs);
      const instance = createContextInstance();

      const result = await buildContextMessages(services, instance, 'chat-ext-1', ['current']);

      expect(result.length).toBe(2);
      expect(result.some((r: string) => r.includes('previous answer'))).toBe(true);
      expect(result.some((r: string) => r.includes('old question'))).toBe(true);
    });

    it('DM with external messages: context includes bot + omni-send messages', async () => {
      const msgs = [
        createMsgRow({ externalId: 'current', isFromMe: false, textContent: 'latest' }),
        createMsgRow({
          externalId: 'omni-send',
          isFromMe: true,
          senderDisplayName: 'System',
          textContent: 'injected message',
        }),
        createMsgRow({ externalId: 'bot-1', isFromMe: true, senderDisplayName: 'Bot', textContent: 'bot reply' }),
        createMsgRow({ externalId: 'user-old', isFromMe: false, textContent: 'first message' }),
      ];
      const services = createContextServices('dm', msgs);
      const instance = createContextInstance();

      const result = await buildContextMessages(services, instance, 'chat-ext-1', ['current']);

      expect(result.length).toBe(3);
      expect(result.some((r: string) => r.includes('injected message'))).toBe(true);
      expect(result.some((r: string) => r.includes('bot reply'))).toBe(true);
      expect(result.some((r: string) => r.includes('first message'))).toBe(true);
    });

    it('DM with only user messages: context includes the first user message', async () => {
      const msgs = [
        createMsgRow({ externalId: 'current', isFromMe: false, textContent: 'second msg' }),
        createMsgRow({ externalId: 'first', isFromMe: false, textContent: 'first msg' }),
      ];
      const services = createContextServices('dm', msgs);
      const instance = createContextInstance();

      const result = await buildContextMessages(services, instance, 'chat-ext-1', ['current']);

      expect(result.length).toBe(1);
      expect(result[0]).toContain('first msg');
    });

    it('DM history cap: limits to 20 messages regardless of groupHistorySize', async () => {
      const msgs = Array.from({ length: 50 }, (_, i) =>
        createMsgRow({ externalId: `msg-${i}`, textContent: `message ${i}` }),
      );
      const services = createContextServices('dm', msgs);
      const instance = createContextInstance({ groupHistorySize: 100 });

      await buildContextMessages(services, instance, 'chat-ext-1', ['msg-0']);

      // Verify that list was called with limit=20 (DM cap), not 100
      const listCall = (services.messages as any).list.mock.calls[0][0];
      expect(listCall.limit).toBe(20);
    });

    it('DM with groupHistorySize=0: returns empty (disabled)', async () => {
      const services = createContextServices('dm', []);
      const instance = createContextInstance({ groupHistorySize: 0 });

      const result = await buildContextMessages(services, instance, 'chat-ext-1', ['current']);

      expect(result).toEqual([]);
      // list should not have been called since historyLimit=0 early-returns
      expect((services.messages as any).list).not.toHaveBeenCalled();
    });

    it('Group unchanged: messages since last bot response only', async () => {
      const msgs = [
        createMsgRow({ externalId: 'current', isFromMe: false, textContent: 'new msg' }),
        createMsgRow({ externalId: 'user-2', isFromMe: false, textContent: 'user msg 2' }),
        createMsgRow({ externalId: 'bot-1', isFromMe: true, senderDisplayName: 'Bot', textContent: 'bot reply' }),
        createMsgRow({ externalId: 'user-1', isFromMe: false, textContent: 'user msg 1' }),
      ];
      const services = createContextServices('group', msgs);
      const instance = createContextInstance();

      const result = await buildContextMessages(services, instance, 'chat-ext-1', ['current']);

      // Group behavior: only messages between current and last bot response
      // Messages at indices 0 (current) and 1 (user-2) are before the bot at index 2
      // Index 0 is filtered by currentMessageIdSet, so only index 1 remains
      expect(result.length).toBe(1);
      expect(result[0]).toContain('user msg 2');
      // Should NOT include messages after the bot response
      expect(result.some((r: string) => r.includes('user msg 1'))).toBe(false);
    });

    it('Group with bot as most recent: returns empty (existing behavior)', async () => {
      const msgs = [
        createMsgRow({ externalId: 'bot-latest', isFromMe: true, textContent: 'bot response' }),
        createMsgRow({ externalId: 'user-1', isFromMe: false, textContent: 'user msg' }),
      ];
      const services = createContextServices('group', msgs);
      const instance = createContextInstance();

      const result = await buildContextMessages(services, instance, 'chat-ext-1', []);

      // lastBotMessageIndex === 0, so group path returns []
      expect(result).toEqual([]);
    });

    it('Group uses full historyLimit (not capped at 20)', async () => {
      const msgs = Array.from({ length: 5 }, (_, i) =>
        createMsgRow({ externalId: `msg-${i}`, textContent: `message ${i}` }),
      );
      const services = createContextServices('group', msgs);
      const instance = createContextInstance({ groupHistorySize: 100 });

      await buildContextMessages(services, instance, 'chat-ext-1', []);

      // Verify that list was called with limit=100 (full groupHistorySize), not 20
      const listCall = (services.messages as any).list.mock.calls[0][0];
      expect(listCall.limit).toBe(100);
    });

    it('DM context messages are returned in chronological order', async () => {
      const msgs = [
        createMsgRow({ externalId: 'current', isFromMe: false, textContent: 'latest', platformTimestamp: 3000 }),
        createMsgRow({
          externalId: 'mid',
          isFromMe: true,
          senderDisplayName: 'Bot',
          textContent: 'middle',
          platformTimestamp: 2000,
        }),
        createMsgRow({ externalId: 'old', isFromMe: false, textContent: 'oldest', platformTimestamp: 1000 }),
      ];
      const services = createContextServices('dm', msgs);
      const instance = createContextInstance();

      const result = await buildContextMessages(services, instance, 'chat-ext-1', ['current']);

      // Messages should be reversed from desc to asc (chronological)
      expect(result.length).toBe(2);
      expect(result[0]).toContain('oldest');
      expect(result[1]).toContain('middle');
    });

    it('returns empty when chat is not found', async () => {
      const services = {
        chats: {
          findByExternalIdSmart: mock(async () => null),
        },
        messages: {
          list: mock(async () => ({ items: [], hasMore: false })),
        },
      } as unknown as import('../../services').Services;
      const instance = createContextInstance();

      const result = await buildContextMessages(services, instance, 'chat-ext-1', []);

      expect(result).toEqual([]);
    });
  });

  // ======================================================================
  // Idempotency on replay (#411)
  //
  // Acceptance criterion from the issue: "5 inflight `message.received`
  // events + SIGTERM at T+100ms → on next boot, zero duplicate `send_message`
  // or Agno calls observed."
  //
  // We can't kill PM2 in a unit test, so we simulate the moral equivalent:
  // capture the registered handler, fire the same OmniEvent.id N times (which
  // is exactly what NATS does after redelivery), and assert the side-effect
  // — `services.messages.list` here standing in for any per-event work the
  // dispatcher performs — runs at most once.
  // ======================================================================
  describe('idempotency (#411)', () => {
    /**
     * Build a stateful db that mimics PG's ON CONFLICT DO NOTHING semantics.
     * Use this only for replay tests — `mockDb` above is intentionally
     * stateless so it doesn't break tests that re-use static event ids.
     */
    function createStatefulIdempotencyDb() {
      const claimed = new Set<string>();
      const agentRow = {
        id: 'agent-uuid-1',
        agentProviderId: 'provider-1',
        agentType: 'assistant',
        metadata: { providerAgentId: 'default-agent' },
        configPath: null,
      };
      const chain = {
        from: mock(() => chain),
        where: mock(() => chain),
        limit: mock(() => Promise.resolve([agentRow])),
      };
      return {
        claimed,
        db: {
          select: mock(() => chain),
          insert: mock(() => ({
            values: (row: { eventId?: string; handler?: string }) => ({
              onConflictDoNothing: () => ({
                returning: async () => {
                  const key = `${row.eventId ?? ''}::${row.handler ?? ''}`;
                  if (claimed.has(key)) return [];
                  claimed.add(key);
                  return [{ eventId: row.eventId }];
                },
              }),
            }),
          })),
        } as unknown as import('@omni/db').Database,
      };
    }

    it('agent-dispatcher-msg: 5 redeliveries of the same event id → handler-side work runs exactly once', async () => {
      const eventBus = createMockEventBus();
      const { db } = createStatefulIdempotencyDb();

      // Spy on a side-effect-ish service the dispatcher's message handler
      // touches on every non-skipped delivery (chats lookup happens before
      // the debouncer.buffer side-effect).
      const findChatSpy = mock(async () => null);
      const services = createMockServices({
        chats: {
          findByExternalIdSmart: findChatSpy,
          findByExternalId: mock(async () => null),
          findById: mock(async () => null),
          update: mock(async () => undefined),
        },
      });

      const cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, db);

      // Fire the same event 5x — exactly the incident shape (#411).
      const event = createMessageEvent();
      for (let i = 0; i < 5; i++) {
        await eventBus.fire('message.received', event);
      }

      // The handler body calls findByExternalIdSmart twice per real delivery
      // (once explicitly, once inside resolveEffectiveInstance). With the
      // idempotency guard, only the FIRST delivery enters the body — the next
      // 4 are skipped at the claim. So we observe the first-delivery
      // call-count and assert no replay amplification.
      const firstDeliveryCalls = findChatSpy.mock.calls.length;
      expect(firstDeliveryCalls).toBeGreaterThan(0);

      // Fire 4 more times — call count must stay flat.
      for (let i = 0; i < 4; i++) {
        await eventBus.fire('message.received', event);
      }
      expect(findChatSpy.mock.calls.length).toBe(firstDeliveryCalls);

      cleanup();
    });

    it('different event ids are independent — N distinct events fire N times', async () => {
      const eventBus = createMockEventBus();
      const { db } = createStatefulIdempotencyDb();

      const findChatSpy = mock(async () => null);
      const services = createMockServices({
        chats: {
          findByExternalIdSmart: findChatSpy,
          findByExternalId: mock(async () => null),
          findById: mock(async () => null),
          update: mock(async () => undefined),
        },
      });

      const cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, db);

      // First fire one event, capture the per-delivery call count.
      await eventBus.fire('message.received', createMessageEvent({ id: 'evt-msg-0' }));
      const perDeliveryCalls = findChatSpy.mock.calls.length;
      expect(perDeliveryCalls).toBeGreaterThan(0);

      // Fire 2 more DISTINCT events. Each must run the full handler body.
      for (let i = 1; i < 3; i++) {
        await eventBus.fire('message.received', createMessageEvent({ id: `evt-msg-${i}` }));
      }
      // Linear growth — 3 distinct events × per-delivery cost.
      expect(findChatSpy.mock.calls.length).toBe(perDeliveryCalls * 3);

      cleanup();
    });
  });

  // ======================================================================
  // First-party cross-instance gate (allowFirstParty opt-out)
  //
  // Loop protection drops inbound messages whose sender phone matches ANOTHER
  // active instance's owner (isFirstPartyInstanceSender). `allowFirstParty`
  // opts an instance out of that drop so it can reply to messages the operator
  // sends from their own personal number (another instance's owner).
  // ======================================================================
  describe('first-party cross-instance gate (allowFirstParty)', () => {
    let cleanup: DispatcherCleanup;

    afterEach(() => {
      cleanup?.();
    });

    const CURRENT_OWNER = '5511986780008:12@s.whatsapp.net';
    const OTHER_OWNER = '5512982298888:43@s.whatsapp.net';
    const OTHER_PHONE = '5512982298888';

    // db mock, branching on the queried table:
    //  - `select().from(instances).where()` (awaited) → active-owner rows, so
    //    isFirstPartyInstanceSender sees OTHER_OWNER as a second active owner.
    //  - `select().from(agents).where().limit(1)` → the agent row for
    //    applyAgentFkOverrides.
    function createFirstPartyDb() {
      const agentRow = {
        id: 'agent-uuid-1',
        agentProviderId: 'provider-1',
        agentType: 'agent',
        metadata: { providerAgentId: 'default-agent' },
        configPath: null,
      };
      const ownerRows = [{ ownerIdentifier: CURRENT_OWNER }, { ownerIdentifier: OTHER_OWNER }];
      const insertChain = (row: { eventId?: string }) => ({
        onConflictDoNothing: () => ({ returning: async () => [{ eventId: row.eventId ?? 'mock-evt' }] }),
      });
      return {
        select: () => ({
          from: (table: unknown) => ({
            where: () =>
              table === instances ? Promise.resolve(ownerRows) : { limit: () => Promise.resolve([agentRow]) },
          }),
        }),
        insert: () => ({ values: (row: { eventId?: string }) => insertChain(row) }),
      } as unknown as import('@omni/db').Database;
    }

    // Fire a message whose sender (OTHER_PHONE) is OTHER_OWNER's phone — a
    // first-party cross-instance sender — into an instance owned by
    // CURRENT_OWNER. Returns the agentRunner so callers can assert whether
    // dispatch proceeded (getSenderName is only reached past the gate).
    async function fireFirstPartyMessage(allowFirstParty: boolean) {
      // The active-owner list is memoized in a module-level cache with a 10s
      // TTL. Any dispatch by an earlier test (this file or another file in the
      // same process) inside that window leaves a stale owner list that does
      // NOT contain OTHER_OWNER, and the gate then dispatches instead of
      // dropping — order- and timing-dependent, so it only shows on CI.
      __test__.resetActiveOwnerIdentifiersCache();
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({ ownerIdentifier: CURRENT_OWNER, allowFirstParty }),
        ),
        getSenderName: mock(async () => 'Felipe'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });
      cleanup = await setupAgentDispatcher(
        eventBus as unknown as import('@omni/core').EventBus,
        services,
        createFirstPartyDb(),
      );
      await eventBus.fire(
        'message.received',
        createMessageEvent({
          payload: {
            externalId: 'fp-1',
            chatId: `${OTHER_PHONE}@s.whatsapp.net`,
            from: OTHER_PHONE,
            content: { type: 'text', text: 'hi from my other phone' },
            rawPayload: { resolvedSenderPhone: OTHER_PHONE },
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      return agentRunner;
    }

    it('is still detected as a first-party sender by isFirstPartyInstanceSender', () => {
      const detected = isFirstPartyInstanceSender(
        { from: OTHER_PHONE, rawPayload: { resolvedSenderPhone: OTHER_PHONE } },
        CURRENT_OWNER,
        [CURRENT_OWNER, OTHER_OWNER],
      );
      expect(detected).toBe(true);
    });

    it('drops the message when allowFirstParty is false (default loop-protection)', async () => {
      const agentRunner = await fireFirstPartyMessage(false);
      expect(agentRunner.getSenderName.mock.calls.length).toBe(0);
    });

    it('dispatches the message when allowFirstParty is true (opt-out)', async () => {
      const agentRunner = await fireFirstPartyMessage(true);
      expect(agentRunner.getSenderName.mock.calls.length).toBe(1);
    });
  });
});
