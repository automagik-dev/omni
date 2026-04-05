/**
 * Tests for createNatsGenieProviderInstance — specifically the onReply wiring
 * that was missing after PR #333 and caused agent replies to be silently dropped
 * (issue #340).
 *
 * Strategy:
 *   1. Mock `../loader` so `getPlugin` returns a stub plugin whose sendMessage
 *      we can spy on. This exercises the real `sendTextMessage` code path.
 *   2. Mock `@omni/core`'s NatsGenieProvider as a lightweight class that
 *      captures the constructor config (so we can pull out the `onReply`
 *      callback the factory wired in) and makes `startReplySubscription` a
 *      no-op (no real NATS connection).
 *   3. Invoke `createNatsGenieProviderInstance`, grab the captured `onReply`,
 *      fire it, and assert `plugin.sendMessage` was called with the channel,
 *      instance id, chat id, and content.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

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

const capturedConfigs: NatsGenieConfig[] = [];
const startReplySubscriptionSpy = mock(async () => {});

mock.module('@omni/core', () => {
  class MockNatsGenieProvider {
    readonly schema = 'nats-genie' as const;
    readonly mode = 'fire-and-forget' as const;
    constructor(
      readonly id: string,
      readonly name: string,
      public config: NatsGenieConfig,
    ) {
      capturedConfigs.push(config);
    }
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

  // Minimal stubs for the other exports agent-dispatcher imports.
  // bun's mock.module merges with the real module, so anything we don't stub
  // here passes through from the real @omni/core.
  return {
    NatsGenieProvider: MockNatsGenieProvider,
  };
});

// Import __test__ AFTER the mocks are registered.
import { __test__ } from '../agent-dispatcher';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createFakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-nats-genie-1',
    name: 'Test NATS Genie',
    schema: 'nats-genie',
    baseUrl: null,
    apiKey: null,
    schemaConfig: {
      agentName: 'test-agent',
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
    id: 'inst-nats-1',
    name: 'Test Instance',
    channel: 'whatsapp-baileys',
    agentId: 'agent-uuid-1',
    agentProviderId: 'provider-nats-genie-1',
    agentPrefixSenderName: true,
    isActive: true,
    ...overrides,
  } as unknown as Parameters<typeof __test__.createNatsGenieProviderInstance>[1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createNatsGenieProviderInstance — reply subscription wiring (issue #340)', () => {
  beforeEach(() => {
    capturedConfigs.length = 0;
    sendMessageSpy.mockClear();
    getPluginSpy.mockClear();
    startReplySubscriptionSpy.mockClear();
  });

  it('wires onReply so agent replies are delivered through the channel plugin', async () => {
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    const result = __test__.createNatsGenieProviderInstance(provider, instance);

    expect(result).not.toBeNull();
    expect(capturedConfigs).toHaveLength(1);

    const cfg = capturedConfigs[0];
    expect(cfg).toBeDefined();
    expect(cfg?.agentName).toBe('test-agent');
    expect(cfg?.natsUrl).toBe('localhost:4222');
    expect(cfg?.instanceId).toBe('inst-nats-1');
    expect(cfg?.onReply).toBeDefined();
    expect(typeof cfg?.onReply).toBe('function');

    // Invoke the wired onReply callback directly — this is the critical path
    // that was missing before the fix for #340.
    await cfg?.onReply?.('user-42@s.whatsapp.net', 'Hello from agent', {
      agent: 'test-agent',
      timestamp: new Date().toISOString(),
    });

    // The callback must resolve the channel plugin for the instance's channel
    // and call sendMessage with the chatId + content.
    expect(getPluginSpy).toHaveBeenCalledWith('whatsapp-baileys');
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);

    const [calledInstanceId, calledMessage] = sendMessageSpy.mock.calls[0] as [
      string,
      { to: string; content: { type: string; text: string } },
    ];
    expect(calledInstanceId).toBe('inst-nats-1');
    expect(calledMessage.to).toBe('user-42@s.whatsapp.net');
    expect(calledMessage.content).toEqual({ type: 'text', text: 'Hello from agent' });
  });

  it('calls startReplySubscription after construction', () => {
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    __test__.createNatsGenieProviderInstance(provider, instance);

    expect(startReplySubscriptionSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when sendTextMessage fails — errors are logged, not propagated', async () => {
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    // Force the plugin send to throw
    sendMessageSpy.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    __test__.createNatsGenieProviderInstance(provider, instance);
    const cfg = capturedConfigs[0];
    expect(cfg?.onReply).toBeDefined();

    // onReply must swallow errors so a single failed reply never crashes the
    // NATS subscription loop.
    const resolved = await cfg?.onReply?.('user-99@s.whatsapp.net', 'will-fail', {});
    expect(resolved).toBeUndefined();
  });

  it('returns null when agentName is missing from schemaConfig', () => {
    const provider = createFakeProvider({ schemaConfig: { natsUrl: 'localhost:4222' } });
    const instance = createFakeInstance();

    const result = __test__.createNatsGenieProviderInstance(provider, instance);

    expect(result).toBeNull();
    expect(capturedConfigs).toHaveLength(0);
  });
});
