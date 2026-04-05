/**
 * Integration test — createNatsGenieProviderInstance + real startReplySubscription
 *
 * Regression guard for issue #340: after PR #333, the new nats-genie provider
 * stopped delivering agent replies because (a) the onReply callback was never
 * wired in createNatsGenieProviderInstance and (b) startReplySubscription()
 * was never called. This test publishes to the NATS reply subject and asserts
 * that sendTextMessage is invoked end-to-end.
 *
 * Unlike the sibling unit test (agent-dispatcher-nats-genie.test.ts) which
 * mocks NatsGenieProvider itself, this test uses the REAL NatsGenieProvider
 * from @omni/core and only mocks the 'nats' library with an in-memory broker.
 * It therefore exercises the real startReplySubscription code path, including
 * the async iterator loop that decodes NATS messages and invokes onReply.
 *
 * Before the fix, this test FAILS at the final assertion because the
 * subscription never fires — verified manually on the pre-fix dev branch.
 *
 * Deterministic: no real NATS server, no network, no timers beyond short
 * awaits used to let the provider's async subscription loop drain.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// In-memory NATS broker — mirrors just enough of nats.js to drive
// NatsGenieProvider.startReplySubscription to completion.
// ---------------------------------------------------------------------------

type FakeMsg = { subject: string; data: Uint8Array };

class FakeSubscription implements AsyncIterable<FakeMsg> {
  private queue: FakeMsg[] = [];
  private waiters: Array<(r: IteratorResult<FakeMsg>) => void> = [];
  private closed = false;

  constructor(readonly pattern: string) {}

  push(msg: FakeMsg): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: msg, done: false });
      return;
    }
    this.queue.push(msg);
  }

  unsubscribe(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined as unknown as FakeMsg, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<FakeMsg> {
    return {
      next: (): Promise<IteratorResult<FakeMsg>> => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as unknown as FakeMsg, done: true });
        return new Promise<IteratorResult<FakeMsg>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

class FakeNatsConnection {
  private subs: FakeSubscription[] = [];

  subscribe(pattern: string): FakeSubscription {
    const sub = new FakeSubscription(pattern);
    this.subs.push(sub);
    return sub;
  }

  publish(subject: string, data: Uint8Array): void {
    for (const sub of this.subs) {
      if (matchesPattern(sub.pattern, subject)) {
        sub.push({ subject, data });
      }
    }
  }

  async drain(): Promise<void> {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs = [];
  }

  async close(): Promise<void> {
    await this.drain();
  }
}

/** NATS subject wildcard matching: '*' = single token, '>' = tail. */
function matchesPattern(pattern: string, subject: string): boolean {
  const pTok = pattern.split('.');
  const sTok = subject.split('.');
  for (let i = 0; i < pTok.length; i++) {
    const p = pTok[i];
    if (p === '>') return true;
    if (p === '*') {
      if (sTok[i] === undefined) return false;
      continue;
    }
    if (p !== sTok[i]) return false;
  }
  return pTok.length === sTok.length;
}

const fakeBroker = new FakeNatsConnection();

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing agent-dispatcher.ts
// ---------------------------------------------------------------------------

// Mock only the 'nats' module's connect + StringCodec. Everything else
// (enums, types, JetStream helpers) passes through from real nats via
// bun's mock.module merge semantics, so the rest of @omni/core (including
// events/nats/*) keeps working.
mock.module('nats', () => ({
  connect: async () => fakeBroker,
  StringCodec: () => ({
    encode: (s: string) => new TextEncoder().encode(s),
    decode: (u: Uint8Array) => new TextDecoder().decode(u),
  }),
}));

// Spy on the channel plugin sendMessage — this is the end-of-chain target
// that the onReply callback reaches via sendTextMessage().
const sendMessageSpy = mock(async (_instanceId: string, _msg: Record<string, unknown>) => {});
const getPluginSpy = mock(async (_channel: string) => ({ sendMessage: sendMessageSpy }));

mock.module('../loader', () => ({
  getPlugin: getPluginSpy,
}));

// Import SUT AFTER mocks are registered. This must use the real
// NatsGenieProvider from @omni/core — we intentionally do NOT mock @omni/core
// in this file, so the real class is loaded with the mocked 'nats' module.
import { __test__ } from '../agent-dispatcher';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createFakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-nats-genie-integ-1',
    name: 'Integration NATS Genie',
    schema: 'nats-genie',
    baseUrl: null,
    apiKey: null,
    schemaConfig: {
      agentName: 'integration-agent',
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
    id: 'inst-integ-1',
    name: 'Integration Instance',
    channel: 'whatsapp-baileys',
    agentId: 'agent-uuid-integ',
    agentProviderId: 'provider-nats-genie-integ-1',
    agentPrefixSenderName: true,
    isActive: true,
    ...overrides,
  } as unknown as Parameters<typeof __test__.createNatsGenieProviderInstance>[1];
}

async function waitForSpy(spy: typeof sendMessageSpy, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (spy.mock.calls.length === 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createNatsGenieProviderInstance — integration (issue #340)', () => {
  beforeEach(() => {
    sendMessageSpy.mockClear();
    getPluginSpy.mockClear();
  });

  it('publishing to omni.reply.{instance}.{chat} drives sendTextMessage end-to-end', async () => {
    const provider = createFakeProvider();
    const instance = createFakeInstance();

    // This triggers the real startReplySubscription() — which connects to the
    // (fake) NATS broker, opens a subscription on omni.reply.inst-integ-1.*,
    // and begins its async-iterator drain loop.
    const natsProvider = __test__.createNatsGenieProviderInstance(provider, instance);
    expect(natsProvider).not.toBeNull();

    // Give the fire-and-forget startReplySubscription() a tick to install
    // its subscription with the broker before we publish.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // NATS uses '.' as subject separator, so chat IDs carried in the trailing
    // token cannot contain dots. Genie publishes with the chat id flattened
    // into a single token (e.g. 5511999999999@s_whatsapp_net).
    const chatId = '5511999999999@user';
    const replyPayload = JSON.stringify({
      content: 'Hello from the agent — integration test',
      agent: 'integration-agent',
      chat_id: chatId,
      instance_id: 'inst-integ-1',
      timestamp: new Date().toISOString(),
    });

    fakeBroker.publish(`omni.reply.inst-integ-1.${chatId}`, new TextEncoder().encode(replyPayload));

    // Wait for the subscription loop to decode + invoke onReply + reach
    // plugin.sendMessage via sendTextMessage.
    await waitForSpy(sendMessageSpy);

    expect(getPluginSpy).toHaveBeenCalledWith('whatsapp-baileys');
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);

    const [calledInstanceId, calledMessage] = sendMessageSpy.mock.calls[0] as [
      string,
      { to: string; content: { type: string; text: string } },
    ];
    expect(calledInstanceId).toBe('inst-integ-1');
    expect(calledMessage.to).toBe(chatId);
    expect(calledMessage.content).toEqual({
      type: 'text',
      text: 'Hello from the agent — integration test',
    });
  });

  it('falls back to the subject tail when the payload omits chat_id', async () => {
    const provider = createFakeProvider({ id: 'provider-nats-genie-integ-2' });
    const instance = createFakeInstance({ id: 'inst-integ-2' });

    __test__.createNatsGenieProviderInstance(provider, instance);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // chat_id intentionally absent — NatsGenieProvider extracts it from the
    // subject's last token per nats-genie-provider.ts:169.
    const replyPayload = JSON.stringify({
      content: 'Subject-derived chatId',
      agent: 'integration-agent',
      timestamp: new Date().toISOString(),
    });

    fakeBroker.publish('omni.reply.inst-integ-2.tail-chat-id', new TextEncoder().encode(replyPayload));

    await waitForSpy(sendMessageSpy);

    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const [, msg] = sendMessageSpy.mock.calls[0] as [string, { to: string; content: { type: string; text: string } }];
    expect(msg.to).toBe('tail-chat-id');
    expect(msg.content.text).toBe('Subject-derived chatId');
  });

  it('malformed reply payloads do not crash the subscription loop', async () => {
    const provider = createFakeProvider({ id: 'provider-nats-genie-integ-3' });
    const instance = createFakeInstance({ id: 'inst-integ-3' });

    __test__.createNatsGenieProviderInstance(provider, instance);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Bad JSON — should be caught by the try/catch inside the for-await loop
    // and NOT terminate the subscription. A follow-up valid message must
    // still reach sendTextMessage.
    fakeBroker.publish('omni.reply.inst-integ-3.user-x', new TextEncoder().encode('not-json'));

    const goodPayload = JSON.stringify({
      content: 'After the bad one',
      chat_id: 'user-x',
      agent: 'integration-agent',
      timestamp: new Date().toISOString(),
    });
    fakeBroker.publish('omni.reply.inst-integ-3.user-x', new TextEncoder().encode(goodPayload));

    await waitForSpy(sendMessageSpy);

    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const [, msg] = sendMessageSpy.mock.calls[0] as [string, { to: string; content: { type: string; text: string } }];
    expect(msg.content.text).toBe('After the bad one');
  });
});
