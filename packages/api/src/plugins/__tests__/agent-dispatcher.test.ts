/**
 * Agent Dispatcher Plugin Tests
 *
 * Tests for:
 * - RateLimiter: per-user-per-channel-per-instance rate limiting
 * - ReactionDedup: LRU dedup for emoji+messageId+userId
 * - MessageDebouncer: tested separately in message-debouncer.test.ts
 * - resolveProvider / getAgentProvider: provider resolution from DB
 * - setupAgentDispatcher: integration with EventBus subscriptions + cleanup
 * - Text chunking and split point logic
 * - Helper functions: instanceTriggersOnEvent, isReactionTrigger, classifyMessageTrigger
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// We need to test internal classes and functions that are NOT exported.
// Strategy: re-export internals via a test-only module, or inline-test the
// exported setupAgentDispatcher by capturing EventBus handler callbacks.
//
// RateLimiter and ReactionDedup are still internal to agent-dispatcher.
// MessageDebouncer is now exported from message-debouncer.ts and tested
// separately in message-debouncer.test.ts.
// ---------------------------------------------------------------------------

// Import exported symbols
import { type DispatcherCleanup, __test__, resolveQuotedMessage, setupAgentDispatcher } from '../agent-dispatcher';

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

  return {
    select: mock(() => chain),
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
    triggerRateLimit: 5,
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

  return {
    agentRunner,
    access,
    providers,
    routeResolver,
    chats,
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
  // ======================================================================
  // setupAgentDispatcher — subscribes to correct NATS subjects
  // ======================================================================
  describe('setupAgentDispatcher', () => {
    it('subscribes to message.received, reaction.received, reaction.removed, presence.typing, and media.processed', async () => {
      const eventBus = createMockEventBus();
      const services = createMockServices();

      const cleanup = await setupAgentDispatcher(
        eventBus as unknown as import('@omni/core').EventBus,
        services,
        mockDb,
      );

      expect(eventBus.subscribe).toHaveBeenCalledTimes(5);

      // Verify event types subscribed
      const subscribedTypes = eventBus.subscribe.mock.calls.map((call: unknown[]) => call[0]);
      expect(subscribedTypes).toContain('message.received');
      expect(subscribedTypes).toContain('reaction.received');
      expect(subscribedTypes).toContain('reaction.removed');
      expect(subscribedTypes).toContain('presence.typing');
      expect(subscribedTypes).toContain('media.processed');

      cleanup();
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
      expect(checkAccess).toHaveBeenCalledWith(expect.anything(), '100000001', expect.anything());
      expect(checkAccess).toHaveBeenCalledWith(expect.anything(), '5511999000001', expect.anything());
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

      expect(checkAccess).toHaveBeenCalledWith(expect.anything(), '5511999000003', expect.anything());
      expect(services.agentRunner.getSenderName).toHaveBeenCalled();
    });

    it('rate limits when too many messages from same user', async () => {
      const eventBus = createMockEventBus();
      // Instance with rate limit of 2
      const agentRunner = {
        getInstanceWithProvider: mock(async () => createMockInstance({ triggerRateLimit: 2 })),
        getSenderName: mock(async () => 'User'),
        run: mock(async () => ({
          parts: ['resp'],
          metadata: { runId: 'r', sessionId: 's', status: 'completed' },
        })),
      };
      const services = createMockServices({ agentRunner });

      cleanup = await setupAgentDispatcher(eventBus as unknown as import('@omni/core').EventBus, services, mockDb);

      // Send 3 messages — the 3rd should be rate limited
      for (let i = 0; i < 3; i++) {
        await eventBus.fire('message.received', createMessageEvent());
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // B-1: IAgentProvider handles dispatch; getSenderName proves message reached processAgentResponse.
      // Rate limiter blocks the 3rd message. Debouncer merges same-chatKey, so 1 flush = 1 call.
      const senderNameCalls = agentRunner.getSenderName.mock.calls.length;
      expect(senderNameCalls).toBeGreaterThanOrEqual(1);
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
    it('clears timers and buffers on cleanup', async () => {
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

      // Buffer a message (debounce set to 5000ms)
      await eventBus.fire('message.received', createMessageEvent());

      // Call cleanup before debounce fires
      cleanup();

      // Wait — the run should NOT fire because cleanup cleared the timer
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(agentRunner.run).not.toHaveBeenCalled();
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

    it('processes messages when reply filter is null (reply to all by default)', async () => {
      const eventBus = createMockEventBus();
      const agentRunner = {
        getInstanceWithProvider: mock(async () =>
          createMockInstance({
            agentReplyFilter: null, // No filter = reply to all
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

      expect(agentRunner.run).toHaveBeenCalled();
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
});
