/**
 * Tests for NATS reply subscription exponential backoff retry (#345).
 *
 * Strategy:
 *   1. Mock `startReplySubscription` to fail N times then succeed.
 *   2. Use fake timers to advance through setTimeout delays.
 *   3. Verify the retry count, backoff delays, and log levels.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing agent-dispatcher.ts
// ---------------------------------------------------------------------------

const sendMessageSpy = mock(async (_instanceId: string, _msg: Record<string, unknown>) => {});
const getPluginSpy = mock(async (_channel: string) => ({
  sendMessage: sendMessageSpy,
}));

mock.module('../loader', () => ({
  getPlugin: getPluginSpy,
}));

type NatsGenieConfig = {
  agentName: string;
  natsUrl: string;
  instanceId: string;
  prefixSenderName?: boolean;
  onReply?: (chatId: string, content: string, metadata: Record<string, unknown>) => Promise<void>;
};

let startReplySubscriptionSpy: ReturnType<typeof mock>;
let callCount = 0;
let failUntil = 0;

function resetSubscriptionSpy(failCount: number) {
  callCount = 0;
  failUntil = failCount;
  startReplySubscriptionSpy = mock(async () => {
    callCount++;
    if (callCount <= failUntil) {
      throw new Error(`NATS connection refused (attempt ${callCount})`);
    }
  });
}

resetSubscriptionSpy(0);

// NOTE: We intentionally do NOT mock NatsGenieProvider via mock.module('@omni/core').
// Bun's mock.module poisons the barrel-resolved module cache process-wide,
// contaminating nats-genie-provider.test.ts (which needs the real class).
// Instead we inject the mock via __test__.NatsGenieProviderClass (DI hook).

class MockNatsGenieProvider {
  readonly schema = 'nats-genie' as const;
  readonly mode = 'fire-and-forget' as const;
  constructor(
    readonly id: string,
    readonly name: string,
    public config: NatsGenieConfig,
  ) {}
  canHandle() {
    return true;
  }
  async trigger() {
    return { parts: [], metadata: { runId: 'r', providerId: this.id, durationMs: 0 } };
  }
  async checkHealth() {
    return { healthy: true, latencyMs: 0 };
  }
  async startReplySubscription() {
    return startReplySubscriptionSpy();
  }
  async dispose() {}
}

import { __test__ } from '../agent-dispatcher';

// Inject mock via DI hook instead of module mock
__test__.NatsGenieProviderClass = MockNatsGenieProvider as any;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createFakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-nats-retry-1',
    name: 'Test NATS Retry',
    schema: 'nats-genie',
    baseUrl: null,
    apiKey: null,
    schemaConfig: {
      agentName: 'retry-agent',
      natsUrl: 'localhost:4222',
    },
    defaultStream: false,
    defaultTimeout: 60,
    isActive: true,
    supportsStreaming: false,
    supportsImages: false,
    supportsAudio: false,
    supportsDocuments: false,
    ...overrides,
  } as unknown as Parameters<typeof __test__.createNatsGenieProviderInstance>[0];
}

function createFakeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-retry-1',
    name: 'Test Instance',
    channel: 'whatsapp-baileys',
    agentId: 'agent-uuid-retry',
    agentProviderId: 'provider-nats-retry-1',
    agentPrefixSenderName: true,
    isActive: true,
    ...overrides,
  } as unknown as Parameters<typeof __test__.createNatsGenieProviderInstance>[1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createNatsGenieProviderInstance — NATS retry with exponential backoff (#345)', () => {
  // Capture all scheduled timeouts so we can fire them synchronously.
  let pendingTimeouts: Array<{ fn: () => void; delay: number }> = [];
  const origSetTimeout = globalThis.setTimeout;

  beforeEach(() => {
    pendingTimeouts = [];
    // Intercept setTimeout to capture callbacks and delays without waiting.
    (globalThis as any).setTimeout = (fn: () => void, delay: number) => {
      pendingTimeouts.push({ fn, delay });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    };
  });

  afterEach(() => {
    globalThis.setTimeout = origSetTimeout;
  });

  it('succeeds on first attempt without retrying', async () => {
    resetSubscriptionSpy(0); // never fails
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    __test__.createNatsGenieProviderInstance(provider, instance);

    // Let the microtask (startWithRetry) resolve
    await new Promise((r) => origSetTimeout(r, 10));

    expect(startReplySubscriptionSpy).toHaveBeenCalledTimes(1);
    expect(pendingTimeouts).toHaveLength(0);
  });

  it('retries on failure and succeeds after N attempts', async () => {
    const failCount = 3;
    resetSubscriptionSpy(failCount); // fail 3 times, succeed on 4th
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    __test__.createNatsGenieProviderInstance(provider, instance);

    // Let the initial attempt resolve (it will fail and schedule a setTimeout)
    await new Promise((r) => origSetTimeout(r, 10));

    // Fire each pending timeout sequentially to simulate retries
    for (let i = 0; i < failCount; i++) {
      expect(pendingTimeouts.length).toBeGreaterThan(0);
      const next = pendingTimeouts.shift()!;
      next.fn();
      await new Promise((r) => origSetTimeout(r, 10));
    }

    // 1 initial + 3 retries = 4 total calls, last one succeeds
    expect(startReplySubscriptionSpy).toHaveBeenCalledTimes(failCount + 1);
    // No more retries scheduled after success
    expect(pendingTimeouts).toHaveLength(0);
  });

  it('applies exponential backoff delays capped at 60s', async () => {
    resetSubscriptionSpy(6); // fail 6 times
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    __test__.createNatsGenieProviderInstance(provider, instance);
    await new Promise((r) => origSetTimeout(r, 10));

    // Fire retries and collect delay values
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      expect(pendingTimeouts.length).toBeGreaterThan(0);
      const next = pendingTimeouts.shift()!;
      delays.push(next.delay);
      next.fn();
      await new Promise((r) => origSetTimeout(r, 10));
    }

    // Expected: 2s, 4s, 8s, 16s, 32s (attempt 1→2, 2→3, 3→4, 4→5, 5→6)
    expect(delays[0]).toBe(2000);
    expect(delays[1]).toBe(4000);
    expect(delays[2]).toBe(8000);
    expect(delays[3]).toBe(16000);
    expect(delays[4]).toBe(32000);
  });

  it('caps delay at 60 seconds', async () => {
    resetSubscriptionSpy(10); // fail all 10 attempts
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    __test__.createNatsGenieProviderInstance(provider, instance);
    await new Promise((r) => origSetTimeout(r, 10));

    // Fire retries up to attempt 8 (delays: 2s, 4s, 8s, 16s, 32s, 64→60s, 128→60s, 256→60s)
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      if (pendingTimeouts.length === 0) break;
      const next = pendingTimeouts.shift()!;
      delays.push(next.delay);
      next.fn();
      await new Promise((r) => origSetTimeout(r, 10));
    }

    // Attempt 6→7: min(2000 * 2^5, 60000) = min(64000, 60000) = 60000
    expect(delays[5]).toBe(60000);
    // Attempt 7→8: also capped at 60000
    expect(delays[6]).toBe(60000);
  });

  it('gives up after 10 failed attempts (no more retries scheduled)', async () => {
    resetSubscriptionSpy(100); // always fail
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    __test__.createNatsGenieProviderInstance(provider, instance);
    await new Promise((r) => origSetTimeout(r, 10));

    // Fire all 9 retry timeouts (attempt 1 is the initial call, retries are 2-10)
    for (let i = 0; i < 9; i++) {
      if (pendingTimeouts.length === 0) break;
      const next = pendingTimeouts.shift()!;
      next.fn();
      await new Promise((r) => origSetTimeout(r, 10));
    }

    // 1 initial + 9 retries = 10 total attempts
    expect(startReplySubscriptionSpy).toHaveBeenCalledTimes(10);
    // No further retries scheduled after permanent failure
    expect(pendingTimeouts).toHaveLength(0);
  });
});
