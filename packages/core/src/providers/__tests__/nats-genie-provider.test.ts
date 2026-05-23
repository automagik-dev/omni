/**
 * NatsGenieProvider tests — covers fixes for automagik-dev/omni#361:
 *
 *   - Group 2: resetSession() publishes on omni.session.reset.{instance}.{chat}
 *   - Group 3: subscription uses recursive `>` wildcard so WhatsApp chat_ids
 *     (which contain dots) are routed correctly
 *   - Regression: trigger() returns parts: [] in both fire-and-forget and
 *     turn-based modes so narration text cannot leak through the dispatcher
 *
 * These tests mock the `nats` module so no real NATS broker is required.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock the nats module before importing the provider
// ---------------------------------------------------------------------------

type CapturedPublish = { subject: string; data: string };

const publishCalls: CapturedPublish[] = [];
let lastSubscribedSubject: string | null = null;
const pendingReplies: Array<{ subject: string; data: string }> = [];

const publishSpy = mock((subject: string, data: Uint8Array) => {
  publishCalls.push({ subject, data: new TextDecoder().decode(data) });
});

// A minimal async iterable subscription that yields any pending replies
// that match the subscribed subject.
function createSubscription(subject: string) {
  lastSubscribedSubject = subject;

  const queue: Array<{ subject: string; data: Uint8Array }> = [];

  // Drain any replies that were queued before subscribe() was called
  const drainMatching = () => {
    while (pendingReplies.length > 0) {
      const next = pendingReplies.shift();
      if (!next) break;
      queue.push({ subject: next.subject, data: new TextEncoder().encode(next.data) });
    }
  };
  drainMatching();

  return {
    unsubscribe: mock(() => {}),
    [Symbol.asyncIterator]() {
      return {
        async next() {
          drainMatching();
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          // Wait a tick to let the test push replies, then exit the loop
          await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
          drainMatching();
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

mock.module('nats', () => ({
  AckPolicy: { Explicit: 'explicit' },
  DeliverPolicy: { All: 'all', Last: 'last', New: 'new', StartTime: 'by_start_time' },
  RetentionPolicy: { Limits: 'limits' },
  StringCodec: () => ({
    encode: (s: string) => new TextEncoder().encode(s),
    decode: (b: Uint8Array) => new TextDecoder().decode(b),
  }),
  StorageType: { File: 'file' },
  connect: mock(async () => ({
    publish: publishSpy,
    subscribe: (subject: string) => createSubscription(subject),
    drain: mock(async () => {}),
  })),
}));

// Import AFTER mocks are registered.
//
// We MUST use a dynamic import here, not a static one. Static imports are
// hoisted to the top of the module by the ESM transform, which means
// `import { NatsGenieProvider } from '../nats-genie-provider'` would run
// BEFORE `mock.module('nats', ...)` above. The provider would then bind to
// the real `nats` module. Whether the resulting class still appears to
// "work" depends on whether some other test in the same Bun process has
// already loaded `nats-genie-provider.ts` first — a test-discovery-order
// flake we hit on CI when an unrelated PR perturbed the file order.
//
// Top-level await + dynamic import keeps the load AFTER the mock is in
// place regardless of how the module is reached.
const { NatsGenieProvider } = await import('../nats-genie-provider');
import type { AgentTrigger } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProvider(
  overrides: { onReply?: (chatId: string, content: string, meta: Record<string, unknown>) => Promise<void> } = {},
) {
  return new NatsGenieProvider('prov-1', 'Test NATS Genie', {
    agentName: 'test-agent',
    natsUrl: 'nats://localhost:4222',
    instanceId: 'inst-1',
    onReply: overrides.onReply,
  });
}

function makeTrigger(): AgentTrigger {
  return {
    traceId: 'trace-1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: 'message' as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: {} as any,
    source: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channelType: 'whatsapp' as any,
      instanceId: 'inst-1',
      chatId: '5511999999999@s.whatsapp.net',
      messageId: 'msg-1',
    },
    sender: {
      platformUserId: '5511999999999',
      displayName: 'Alice',
    },
    content: {
      text: 'hello',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  publishCalls.length = 0;
  pendingReplies.length = 0;
  lastSubscribedSubject = null;
  publishSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Group 2: resetSession()
// ---------------------------------------------------------------------------

describe('NatsGenieProvider.resetSession()', () => {
  it('publishes omni.session.reset.{instance}.{chat} with a kill payload', async () => {
    const provider = makeProvider();
    await provider.resetSession('session-abc', '5511999999999@s.whatsapp.net', 'inst-1');

    expect(publishCalls).toHaveLength(1);
    const [call] = publishCalls;
    expect(call!.subject).toBe('omni.session.reset.inst-1.5511999999999@s.whatsapp.net');

    const payload = JSON.parse(call!.data);
    expect(payload).toMatchObject({
      action: 'kill',
      sessionKey: 'session-abc',
      agent: 'test-agent',
      instance_id: 'inst-1',
      chat_id: '5511999999999@s.whatsapp.net',
    });
    expect(typeof payload.timestamp).toBe('string');
  });

  it('falls back to provider config instanceId when instanceId arg is omitted', async () => {
    const provider = makeProvider();
    await provider.resetSession('session-abc', 'chat-42');

    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.subject).toBe('omni.session.reset.inst-1.chat-42');
  });

  it('throws when chatId is missing (dispatcher must supply it)', async () => {
    const provider = makeProvider();
    await expect(provider.resetSession('session-abc')).rejects.toThrow(/chatId is required/i);
    expect(publishCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 3: recursive wildcard subscription
// ---------------------------------------------------------------------------

describe('NatsGenieProvider.startReplySubscription()', () => {
  it('subscribes with the recursive `>` wildcard (required for WhatsApp chat_ids with dots)', async () => {
    const onReply = mock(async () => {});
    const provider = makeProvider({ onReply });

    await provider.startReplySubscription();

    expect(lastSubscribedSubject).toBe('omni.reply.inst-1.>');
  });

  it('delivers replies published to a dotted chat_id subject to the onReply callback', async () => {
    const delivered: Array<{ chatId: string; content: string }> = [];
    const onReply = mock(async (chatId: string, content: string) => {
      delivered.push({ chatId, content });
    });
    const provider = makeProvider({ onReply });

    // Queue a reply that only a recursive wildcard can match
    pendingReplies.push({
      subject: 'omni.reply.inst-1.5511999999999@s.whatsapp.net',
      data: JSON.stringify({
        content: 'hello from agent',
        agent: 'test-agent',
        chat_id: '5511999999999@s.whatsapp.net',
        timestamp: new Date().toISOString(),
      }),
    });

    await provider.startReplySubscription();
    // Let the background loop drain
    await new Promise((r) => setTimeout(r, 20));

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toEqual({
      chatId: '5511999999999@s.whatsapp.net',
      content: 'hello from agent',
    });
  });

  it('does not start the subscription twice (idempotent guard)', async () => {
    const onReply = mock(async () => {});
    const provider = makeProvider({ onReply });

    await provider.startReplySubscription();
    const firstSubject = lastSubscribedSubject;
    lastSubscribedSubject = null;

    await provider.startReplySubscription();

    // Second call must not re-subscribe
    expect(firstSubject).toBe('omni.reply.inst-1.>');
    expect(lastSubscribedSubject).toBeNull();
  });

  it('skips subscription entirely when no onReply callback is provided', async () => {
    const provider = makeProvider();
    await provider.startReplySubscription();
    expect(lastSubscribedSubject).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression: trigger() returns parts: [] in both modes
// ---------------------------------------------------------------------------

describe('NatsGenieProvider.trigger() — parts: [] regression guard', () => {
  it('returns empty parts in fire-and-forget mode', async () => {
    const provider = makeProvider();
    const result = await provider.trigger(makeTrigger());
    expect(result.parts).toEqual([]);
  });

  it('returns empty parts in turn-based mode', async () => {
    const provider = new NatsGenieProvider('prov-2', 'Turn-based', {
      agentName: 'test-agent',
      natsUrl: 'nats://localhost:4222',
      instanceId: 'inst-1',
      mode: 'turn-based',
    });
    const result = await provider.trigger(makeTrigger());
    expect(result.parts).toEqual([]);
  });

  it('returns empty parts when content is empty (early return)', async () => {
    const provider = makeProvider();
    const trigger = makeTrigger();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (trigger as any).content = {};
    const result = await provider.trigger(trigger);
    expect(result.parts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// trigger.env → NATS payload.env pass-through (GENIE_TMUX_SESSION plumbing)
// ---------------------------------------------------------------------------

describe('NatsGenieProvider.trigger() — env pass-through', () => {
  it('propagates GENIE_TMUX_SESSION from trigger.env into the published NATS payload', async () => {
    const provider = makeProvider();
    const trigger = makeTrigger();
    trigger.env = {
      OMNI_INSTANCE: 'inst-1',
      OMNI_CHAT: 'chat-42',
      OMNI_MESSAGE: 'msg-1',
      OMNI_TURN_ID: 'turn-xyz',
      GENIE_TMUX_SESSION: 'whatsapp-scout-12',
    };
    await provider.trigger(trigger);
    expect(publishCalls.length).toBeGreaterThan(0);
    const payload = JSON.parse(publishCalls[publishCalls.length - 1]!.data);
    expect(payload.env).toEqual({
      OMNI_INSTANCE: 'inst-1',
      OMNI_CHAT: 'chat-42',
      OMNI_MESSAGE: 'msg-1',
      OMNI_TURN_ID: 'turn-xyz',
      GENIE_TMUX_SESSION: 'whatsapp-scout-12',
    });
  });

  it('omits GENIE_TMUX_SESSION from payload.env when the dispatcher did not set it', async () => {
    const provider = makeProvider();
    const trigger = makeTrigger();
    trigger.env = {
      OMNI_INSTANCE: 'inst-1',
      OMNI_CHAT: 'chat-42',
      OMNI_MESSAGE: 'msg-1',
      OMNI_TURN_ID: 'turn-xyz',
    };
    await provider.trigger(trigger);
    const payload = JSON.parse(publishCalls[publishCalls.length - 1]!.data);
    expect(payload.env).not.toHaveProperty('GENIE_TMUX_SESSION');
    expect(payload.env.OMNI_INSTANCE).toBe('inst-1');
  });

  it('preserves trigger.env untouched when it has no GENIE_ prefixed keys (backward compat)', async () => {
    const provider = makeProvider();
    const trigger = makeTrigger();
    trigger.env = { OMNI_INSTANCE: 'inst-1', OMNI_CHAT: 'chat-42' };
    await provider.trigger(trigger);
    const payload = JSON.parse(publishCalls[publishCalls.length - 1]!.data);
    expect(payload.env).toEqual({ OMNI_INSTANCE: 'inst-1', OMNI_CHAT: 'chat-42' });
  });
});
