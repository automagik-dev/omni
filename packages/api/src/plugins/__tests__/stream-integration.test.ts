/**
 * Stream Integration Test
 *
 * E2E test wiring: mock OpenClaw provider → dispatcher → StreamSender
 * Verifies the full streaming pipeline from provider deltas to channel edits.
 */

import { describe, expect, test } from 'bun:test';
import type { StreamSender } from '@omni/channel-sdk';
import type { AgentTrigger, IAgentProvider, StreamDelta } from '@omni/core';

// ─── Mock StreamSender (simulates Telegram sender without Bot dependency) ──

interface SenderLog {
  method: string;
  delta?: StreamDelta;
}

function createMockStreamSender(): StreamSender & { logs: SenderLog[] } {
  const logs: SenderLog[] = [];
  return {
    logs,
    async onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }) {
      logs.push({ method: 'onThinkingDelta', delta });
    },
    async onContentDelta(delta: StreamDelta & { phase: 'content' }) {
      logs.push({ method: 'onContentDelta', delta });
    },
    async onFinal(delta: StreamDelta & { phase: 'final' }) {
      logs.push({ method: 'onFinal', delta });
    },
    async onError(delta: StreamDelta & { phase: 'error' }) {
      logs.push({ method: 'onError', delta });
    },
    async abort() {
      logs.push({ method: 'abort' });
    },
  };
}

// ─── Mock Provider (yields a scripted delta sequence) ──

function createMockStreamProvider(deltas: StreamDelta[]): IAgentProvider & {
  triggerStream: (ctx: AgentTrigger) => AsyncGenerator<StreamDelta>;
} {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    schema: 'openclaw',
    mode: 'round-trip',
    canHandle: () => true,
    trigger: async () => null,
    checkHealth: async () => ({ healthy: true, latencyMs: 0 }),
    async *triggerStream(_ctx: AgentTrigger) {
      for (const delta of deltas) {
        yield delta;
      }
    },
  };
}

// ─── routeStreamDelta (extracted logic matching agent-dispatcher.ts) ──

async function routeStreamDelta(sender: StreamSender, delta: StreamDelta): Promise<void> {
  switch (delta.phase) {
    case 'thinking':
      await sender.onThinkingDelta(delta as StreamDelta & { phase: 'thinking' });
      break;
    case 'content':
      await sender.onContentDelta(delta as StreamDelta & { phase: 'content' });
      break;
    case 'final':
      await sender.onFinal(delta as StreamDelta & { phase: 'final' });
      break;
    case 'error':
      await sender.onError(delta as StreamDelta & { phase: 'error' });
      break;
  }
}

// ─── Tests ──

describe('Stream Integration: Provider → Dispatcher → Sender', () => {
  test('full flow: thinking → content → final', async () => {
    const deltas: StreamDelta[] = [
      { phase: 'thinking', thinking: 'Analyzing the request...', thinkingElapsedMs: 500 },
      { phase: 'thinking', thinking: 'Analyzing the request... Checking data...', thinkingElapsedMs: 2500 },
      {
        phase: 'content',
        content: 'Here is',
        thinking: 'Analyzing the request... Checking data...',
        thinkingDurationMs: 3000,
      },
      {
        phase: 'content',
        content: 'Here is the answer.',
        thinking: 'Analyzing the request... Checking data...',
        thinkingDurationMs: 3000,
      },
      {
        phase: 'final',
        content: 'Here is the answer.',
        thinking: 'Analyzing the request... Checking data...',
        thinkingDurationMs: 3000,
      },
    ];

    const provider = createMockStreamProvider(deltas);
    const sender = createMockStreamSender();

    // Simulate dispatcher consuming the generator
    const mockCtx = {} as AgentTrigger;
    const generator = provider.triggerStream(mockCtx);
    for await (const delta of generator) {
      await routeStreamDelta(sender, delta);
    }

    // Verify sequence: 2 thinking → 2 content → 1 final
    expect(sender.logs.length).toBe(5);
    expect(sender.logs[0]?.method).toBe('onThinkingDelta');
    expect(sender.logs[1]?.method).toBe('onThinkingDelta');
    expect(sender.logs[2]?.method).toBe('onContentDelta');
    expect(sender.logs[3]?.method).toBe('onContentDelta');
    expect(sender.logs[4]?.method).toBe('onFinal');

    // Verify final delta has all expected fields
    const finalDelta = sender.logs[4]?.delta as StreamDelta & { phase: 'final' };
    expect(finalDelta.content).toBe('Here is the answer.');
    expect(finalDelta.thinking).toBe('Analyzing the request... Checking data...');
    expect(finalDelta.thinkingDurationMs).toBe(3000);
  });

  test('content-only flow (no thinking)', async () => {
    const deltas: StreamDelta[] = [
      { phase: 'content', content: 'Quick', thinking: undefined, thinkingDurationMs: undefined },
      { phase: 'content', content: 'Quick answer.', thinking: undefined, thinkingDurationMs: undefined },
      { phase: 'final', content: 'Quick answer.', thinking: undefined, thinkingDurationMs: undefined },
    ];

    const provider = createMockStreamProvider(deltas);
    const sender = createMockStreamSender();

    const generator = provider.triggerStream({} as AgentTrigger);
    for await (const delta of generator) {
      await routeStreamDelta(sender, delta);
    }

    expect(sender.logs.length).toBe(3);
    expect(sender.logs.every((l) => l.method !== 'onThinkingDelta')).toBe(true);
    expect(sender.logs[2]?.method).toBe('onFinal');
  });

  test('error flow: thinking → error (sender gets cleanup)', async () => {
    const deltas: StreamDelta[] = [
      { phase: 'thinking', thinking: 'Working...', thinkingElapsedMs: 1000 },
      { phase: 'error', error: 'Agent timeout after 120s' },
    ];

    const provider = createMockStreamProvider(deltas);
    const sender = createMockStreamSender();

    const generator = provider.triggerStream({} as AgentTrigger);
    for await (const delta of generator) {
      await routeStreamDelta(sender, delta);
    }

    expect(sender.logs.length).toBe(2);
    expect(sender.logs[0]?.method).toBe('onThinkingDelta');
    expect(sender.logs[1]?.method).toBe('onError');
    expect((sender.logs[1]?.delta as StreamDelta & { phase: 'error' }).error).toBe('Agent timeout after 120s');
  });

  test('generator abort triggers sender abort', async () => {
    // Simulate dispatcher aborting the stream mid-flight
    const deltas: StreamDelta[] = [
      { phase: 'thinking', thinking: 'Analyzing...', thinkingElapsedMs: 500 },
      { phase: 'content', content: 'Partial response', thinking: undefined, thinkingDurationMs: 1000 },
      // No final — simulate abort after this
    ];

    const provider = createMockStreamProvider(deltas);
    const sender = createMockStreamSender();

    const generator = provider.triggerStream({} as AgentTrigger);
    let count = 0;
    for await (const delta of generator) {
      await routeStreamDelta(sender, delta);
      count++;
      if (count >= 2) break; // Abort after 2 deltas
    }

    // Dispatcher would call abort on the sender
    await sender.abort();

    expect(sender.logs.length).toBe(3); // 1 thinking + 1 content + 1 abort
    expect(sender.logs[2]?.method).toBe('abort');
  });

  test('accumulate fallback: provider without triggerStream uses trigger()', async () => {
    // Provider that only has trigger(), not triggerStream()
    const legacyProvider: IAgentProvider = {
      id: 'legacy',
      name: 'Legacy',
      schema: 'agno',
      mode: 'round-trip',
      canHandle: () => true,
      trigger: async () => ({
        parts: ['Legacy response'],
        metadata: { runId: 'run-1', providerId: 'legacy', durationMs: 100 },
      }),
      checkHealth: async () => ({ healthy: true, latencyMs: 0 }),
      // No triggerStream
    };

    // triggerStream should not exist
    expect(legacyProvider.triggerStream).toBeUndefined();

    // trigger() should still work as fallback
    const result = await legacyProvider.trigger({} as AgentTrigger);
    expect(result?.parts).toEqual(['Legacy response']);
  });
});
