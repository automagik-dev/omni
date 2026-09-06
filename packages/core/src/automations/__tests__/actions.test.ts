/**
 * Tests for extractAgentCallContext debounce message handling
 */

import { describe, expect, mock, test } from 'bun:test';
import type { AgentCallContext, AgentRunResult } from '../actions';
import { executeAction, executeActions } from '../actions';
import type { TemplateContext } from '../templates';
import type { CallAgentActionConfig } from '../types';

/**
 * Helper: build a minimal TemplateContext for call_agent tests
 */
function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    payload: {
      instanceId: 'wa-001',
      from: { id: 'user-1', name: 'Alice' },
      chatId: 'chat-1',
      content: 'fallback message',
    },
    variables: {},
    env: {},
    ...overrides,
  };
}

/**
 * Helper: build a successful AgentRunResult
 */
function makeAgentResult(): AgentRunResult {
  return {
    parts: ['ok'],
    fullResponse: 'ok',
    metadata: { runId: 'r1', sessionId: 's1', status: 'completed' },
  };
}

const agentConfig: CallAgentActionConfig = {
  agentId: 'test-agent',
};

describe('extractAgentCallContext — debounce messages', () => {
  test('with debounce context produces multi-message array', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext({
      debounce: {
        messages: [
          { type: 'text', text: 'Hi', timestamp: 1 },
          { type: 'text', text: 'I have a question', timestamp: 2 },
          { type: 'text', text: 'About my order', timestamp: 3 },
        ],
        from: { id: 'user-1', name: 'Alice' },
        instanceId: 'wa-001',
      },
    });

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    expect(callAgent).toHaveBeenCalledTimes(1);

    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.messages).toEqual(['Hi', 'I have a question', 'About my order']);
  });

  test('without debounce context falls back to single message from payload', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext(); // no debounce field

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    expect(callAgent).toHaveBeenCalledTimes(1);

    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.messages).toEqual(['fallback message']);
  });

  test('filters out debounce messages with no text', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext({
      debounce: {
        messages: [
          { type: 'text', text: 'Hello', timestamp: 1 },
          { type: 'image', text: undefined, timestamp: 2 }, // image-only, no text
          { type: 'text', text: 'Order #12345', timestamp: 3 },
        ],
        from: { id: 'user-1', name: 'Alice' },
        instanceId: 'wa-001',
      },
    });

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.messages).toEqual(['Hello', 'Order #12345']);
  });

  test('returns error when all debounce messages lack text', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext({
      debounce: {
        messages: [
          { type: 'image', text: undefined, timestamp: 1 },
          { type: 'audio', text: undefined, timestamp: 2 },
        ],
        from: { id: 'user-1', name: 'Alice' },
        instanceId: 'wa-001',
      },
    });

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('no text content found in debounced messages');
    expect(callAgent).not.toHaveBeenCalled();
  });

  test('empty debounce messages array falls back to payload', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext({
      debounce: {
        messages: [],
        from: { id: 'user-1', name: 'Alice' },
        instanceId: 'wa-001',
      },
    });

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.messages).toEqual(['fallback message']);
  });
});

describe('call_agent — promptOverride', () => {
  test('promptOverride replaces payload-derived message', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext({
      followUp: {
        syntheticPrompt: 'User has been idle',
        minutes: 5,
        sequenceIndex: 1,
        attemptNumber: 2,
        totalAttempts: 3,
        chatName: 'Alice',
      },
    });

    const config: CallAgentActionConfig = {
      agentId: 'test-agent',
      promptOverride: '[synthetic #{{sequenceIndex}}] {{syntheticPrompt}} ({{minutes}}m — {{chatName}})',
    };

    const result = await executeAction({ type: 'call_agent', config }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    expect(callAgent).toHaveBeenCalledTimes(1);
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.messages).toEqual(['[synthetic #1] User has been idle (5m — Alice)']);
    // The payload fallback message must NOT leak through.
    expect(receivedContext.messages).not.toContain('fallback message');
  });

  test('promptOverride takes precedence over debounce messages', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext({
      debounce: {
        messages: [
          { type: 'text', text: 'grouped 1', timestamp: 1 },
          { type: 'text', text: 'grouped 2', timestamp: 2 },
        ],
        from: { id: 'user-1', name: 'Alice' },
        instanceId: 'wa-001',
      },
    });

    const config: CallAgentActionConfig = {
      agentId: 'test-agent',
      promptOverride: 'OVERRIDE',
    };

    const result = await executeAction({ type: 'call_agent', config }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.messages).toEqual(['OVERRIDE']);
  });

  test('promptOverride forwards to callAgent via config (for no-persist invariant)', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext();
    const config: CallAgentActionConfig = {
      agentId: 'test-agent',
      promptOverride: 'Hi',
    };

    await executeAction({ type: 'call_agent', config }, context, {
      eventBus: null,
      callAgent,
    });

    // The config is passed through untouched so the callAgent implementation
    // can inspect `promptOverride` and skip chat-history persistence.
    const receivedConfig = callAgent.mock.calls[0]![1] as CallAgentActionConfig;
    expect(receivedConfig.promptOverride).toBe('Hi');
  });

  test('empty-rendered promptOverride surfaces a clear error', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());

    const context = makeContext();
    const config: CallAgentActionConfig = {
      agentId: 'test-agent',
      // Resolves to '' because `followUp` is not set and the placeholder's
      // fallback lookup also misses.
      promptOverride: '{{syntheticPrompt}}',
    };

    const result = await executeAction({ type: 'call_agent', config }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('promptOverride');
    expect(callAgent).not.toHaveBeenCalled();
  });

  test('regression: call_agent without promptOverride behaves as before', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());
    const context = makeContext();

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.messages).toEqual(['fallback message']);
  });
});

describe('extractAgentCallContext — threadId (per_thread session keys)', () => {
  test('payload.threadId reaches the agent call context', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());
    const context = makeContext({
      payload: {
        instanceId: 'wa-001',
        from: { id: 'user-1', name: 'Alice' },
        chatId: 'chat-1',
        threadId: 'T42',
        content: 'in a thread',
      },
    });

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.threadId).toBe('T42');
  });

  test('falls back to rawPayload.threadId when the payload has none at top level', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());
    const context = makeContext({
      payload: {
        instanceId: 'wa-001',
        from: { id: 'user-1', name: 'Alice' },
        chatId: 'chat-1',
        rawPayload: { threadId: 'T77' },
        content: 'in a thread',
      },
    });

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.threadId).toBe('T77');
  });

  test('stays undefined for threadless events', async () => {
    const callAgent = mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());
    const context = makeContext();

    const result = await executeAction({ type: 'call_agent', config: agentConfig }, context, {
      eventBus: null,
      callAgent,
    });

    expect(result.status).toBe('success');
    const receivedContext = callAgent.mock.calls[0]![0] as AgentCallContext;
    expect(receivedContext.threadId).toBeUndefined();
  });
});

/**
 * emit_event derived-key idempotency (#958): re-running the same automation
 * over the same event claims the same `derived:{event}:{automation}:{index}`
 * key and must not duplicate the emission.
 */
describe('emit_event derived-key idempotency (#958)', () => {
  function makeEmitDeps(claimedKeys: Set<string>, published: string[]) {
    return {
      eventBus: {
        publishGeneric: mock(async (type: string) => {
          published.push(type);
          return { id: 'evt-1', type, timestamp: Date.now(), metadata: {}, payload: {} };
        }),
      } as never,
      claimEmittedEvent: mock(async (claim: { idempotencyKey: string }) => {
        if (claimedKeys.has(claim.idempotencyKey)) return false;
        claimedKeys.add(claim.idempotencyKey);
        return true;
      }),
    };
  }

  const emitAction = { type: 'emit_event', config: { eventType: 'custom.derived.test' } } as Parameters<
    typeof executeActions
  >[0][number];

  test('replaying the same (event, automation) slot emits exactly once', async () => {
    const claimedKeys = new Set<string>();
    const published: string[] = [];
    const deps = makeEmitDeps(claimedKeys, published);
    const provenance = { parentEventId: 'evt-parent', automationId: 'auto-1' };

    const first = await executeActions([emitAction], makeContext(), deps, null, provenance);
    const second = await executeActions([emitAction], makeContext(), deps, null, provenance);

    expect(first[0]?.status).toBe('success');
    expect(second[0]?.status).toBe('success');
    expect((second[0]?.result as { duplicate?: boolean }).duplicate).toBe(true);
    expect(published).toEqual(['custom.derived.test']);
    expect(claimedKeys).toEqual(new Set(['derived:evt-parent:auto-1:0']));
  });

  test('a different parent event claims a different key and emits again', async () => {
    const claimedKeys = new Set<string>();
    const published: string[] = [];
    const deps = makeEmitDeps(claimedKeys, published);

    await executeActions([emitAction], makeContext(), deps, null, {
      parentEventId: 'evt-a',
      automationId: 'auto-1',
    });
    await executeActions([emitAction], makeContext(), deps, null, {
      parentEventId: 'evt-b',
      automationId: 'auto-1',
    });

    expect(published).toEqual(['custom.derived.test', 'custom.derived.test']);
  });

  test('without provenance or claim dep the emission publishes unconditionally', async () => {
    const published: string[] = [];
    const deps = {
      eventBus: {
        publishGeneric: mock(async (type: string) => {
          published.push(type);
          return { id: 'evt-1', type, timestamp: Date.now(), metadata: {}, payload: {} };
        }),
      } as never,
    };

    await executeActions([emitAction], makeContext(), deps);
    await executeActions([emitAction], makeContext(), deps);

    expect(published).toHaveLength(2);
  });

  test('a failed publish releases the claim so the retry can emit', async () => {
    const claimedKeys = new Set<string>();
    const releaseEmittedEventClaim = mock(async (_eventId: string) => {
      // The API implementation deletes the journal row; here we just prove
      // the hook fires. Clearing the key mirrors that delete.
      claimedKeys.clear();
    });
    const deps = {
      eventBus: {
        publishGeneric: mock(async () => {
          throw new Error('NATS down');
        }),
      } as never,
      claimEmittedEvent: mock(async (claim: { idempotencyKey: string }) => {
        if (claimedKeys.has(claim.idempotencyKey)) return false;
        claimedKeys.add(claim.idempotencyKey);
        return true;
      }),
      releaseEmittedEventClaim,
    };

    const result = await executeActions([emitAction], makeContext(), deps, null, {
      parentEventId: 'evt-parent',
      automationId: 'auto-1',
    });

    expect(result[0]?.status).toBe('failed');
    expect(releaseEmittedEventClaim).toHaveBeenCalledTimes(1);
    expect(claimedKeys.size).toBe(0);
  });
});
