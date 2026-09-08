/**
 * Chatless call_agent dispatch (#1010, RFC #925 G4 runtime half).
 *
 * A chat-less external event (custom.github.push et al.) resolves neither an
 * instance nor a chat from its payload. When the action config names an agent,
 * the action must dispatch it anyway with the FULL OmniEvent envelope as the
 * run's input (the #960 envelope-forwarding shape) and an event-scoped session
 * key (`automation:{automationId}:{correlationId}`) instead of chat ids.
 *
 * Pinned here:
 *   - chatless dispatch fires with the envelope, no chat fields, and the
 *     derived session key;
 *   - session scoping: unrelated events → different keys; a causal chain
 *     (same correlationId) → the same key;
 *   - chat-ful behavior is byte-for-byte unchanged (chatless is a fallback);
 *   - without config.agentId the legacy errors are unchanged;
 *   - promptOverride wins over the envelope in chatless mode;
 *   - envelope-less invocations fall back to the bare payload.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventMetadata } from '../../events/types';
import type { AgentCallContext, AgentRunResult } from '../actions';
import { executeAction } from '../actions';
import type { TemplateContext } from '../templates';
import type { CallAgentActionConfig } from '../types';

function makeAgentResult(): AgentRunResult {
  return {
    parts: ['ok'],
    fullResponse: 'ok',
    metadata: { runId: 'r1', sessionId: 's1', status: 'completed' },
  };
}

/** A chat-less external event context, the way the engine threads it. */
function githubPushContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    payload: {
      source: 'github',
      repository: 'automagik-dev/omni',
      ref: 'refs/heads/main',
      commits: [{ id: 'abc123', message: 'feat: thing' }],
    },
    variables: {},
    env: {},
    event: {
      id: 'evt-100',
      type: 'custom.github.push',
      timestamp: 1757100000000,
      metadata: { correlationId: 'corr-1' },
    },
    automation: { id: 'auto-1', managedByAgentId: 'agent-1' },
    ...overrides,
  };
}

function callAgentMock() {
  return mock(async (_ctx: AgentCallContext, _cfg: CallAgentActionConfig) => makeAgentResult());
}

async function dispatch(config: CallAgentActionConfig, context: TemplateContext) {
  const callAgent = callAgentMock();
  const result = await executeAction({ type: 'call_agent', config }, context, {
    eventBus: null,
    callAgent,
  });
  return { callAgent, result };
}

describe('call_agent — chatless dispatch (#1010)', () => {
  test('an event with no chat fields dispatches chatless with the full envelope', async () => {
    const { callAgent, result } = await dispatch({ agentId: 'agent-1' }, githubPushContext());

    expect(result.status).toBe('success');
    expect(callAgent).toHaveBeenCalledTimes(1);
    const ctx = callAgent.mock.calls[0]?.[0] as AgentCallContext;

    expect(ctx.chatless).toBe(true);
    expect(ctx.agentId).toBe('agent-1');
    expect(ctx.instanceId).toBe('');
    expect(ctx.automationId).toBe('auto-1');
    expect(ctx.sessionKey).toBe('automation:auto-1:corr-1');
    // Synthesized identifiers, never channel-native ids.
    expect(ctx.chatId).toBe('automation:auto-1:corr-1');
    expect(ctx.senderId).toBe('automation:auto-1:corr-1');

    // The run's input is the #960 envelope shape: id, type, payload, metadata, timestamp.
    expect(ctx.messages).toHaveLength(1);
    const envelope = JSON.parse(ctx.messages[0] ?? '{}');
    expect(envelope).toEqual({
      id: 'evt-100',
      type: 'custom.github.push',
      payload: {
        source: 'github',
        repository: 'automagik-dev/omni',
        ref: 'refs/heads/main',
        commits: [{ id: 'abc123', message: 'feat: thing' }],
      },
      metadata: { correlationId: 'corr-1' },
      timestamp: 1757100000000,
    });
  });

  test('session scoping: unrelated events get different keys, a causal chain shares one', async () => {
    const contextA = githubPushContext();
    const contextB = githubPushContext({
      event: { id: 'evt-200', type: 'custom.github.push', timestamp: 2, metadata: { correlationId: 'corr-2' } },
    });
    const contextChain = githubPushContext({
      event: { id: 'evt-300', type: 'custom.github.push', timestamp: 3, metadata: { correlationId: 'corr-1' } },
    });

    const a = await dispatch({ agentId: 'agent-1' }, contextA);
    const b = await dispatch({ agentId: 'agent-1' }, contextB);
    const chain = await dispatch({ agentId: 'agent-1' }, contextChain);

    const keyA = (a.callAgent.mock.calls[0]?.[0] as AgentCallContext).sessionKey;
    const keyB = (b.callAgent.mock.calls[0]?.[0] as AgentCallContext).sessionKey;
    const keyChain = (chain.callAgent.mock.calls[0]?.[0] as AgentCallContext).sessionKey;

    expect(keyA).not.toBe(keyB);
    expect(keyChain).toBe(keyA);
  });

  test('an envelope without correlationId scopes by the event id', async () => {
    // EventMetadata types correlationId as required, but pre-#956 producers
    // and defensive paths can thread an envelope without one — pin the
    // event-id fallback.
    const context = githubPushContext({
      event: { id: 'evt-400', type: 'custom.github.push', timestamp: 4, metadata: {} as EventMetadata },
    });
    const { callAgent } = await dispatch({ agentId: 'agent-1' }, context);
    const ctx = callAgent.mock.calls[0]?.[0] as AgentCallContext;
    expect(ctx.sessionKey).toBe('automation:auto-1:evt-400');
  });

  test('envelope-less invocation (manual execute) sends the bare payload and a fresh scope', async () => {
    const context = githubPushContext({ event: undefined, automation: undefined });
    const { callAgent, result } = await dispatch({ agentId: 'agent-1' }, context);

    expect(result.status).toBe('success');
    const ctx = callAgent.mock.calls[0]?.[0] as AgentCallContext;
    expect(ctx.chatless).toBe(true);
    expect(ctx.automationId).toBe('manual');
    expect(ctx.sessionKey).toMatch(/^automation:manual:.+$/);
    expect(ctx.event).toBeUndefined();
    expect(JSON.parse(ctx.messages[0] ?? '{}')).toEqual(context.payload);
  });

  test('promptOverride replaces the envelope as the chatless input', async () => {
    const { callAgent } = await dispatch(
      { agentId: 'agent-1', promptOverride: 'Push to {{repository}} on {{ref}}' },
      githubPushContext(),
    );
    const ctx = callAgent.mock.calls[0]?.[0] as AgentCallContext;
    expect(ctx.chatless).toBe(true);
    expect(ctx.messages).toEqual(['Push to automagik-dev/omni on refs/heads/main']);
  });

  test('without config.agentId the legacy instanceId error is unchanged', async () => {
    const { callAgent, result } = await dispatch({ agentId: '' }, githubPushContext());
    expect(callAgent).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('instanceId is required (from payload or config.providerId template)');
  });

  test('an event with instanceId but no chat still errors without an agentId', async () => {
    const context = githubPushContext();
    context.payload.instanceId = 'wa-001';
    const { callAgent, result } = await dispatch({ agentId: '' }, context);
    expect(callAgent).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('chatId not found in payload');
  });

  test('the minimal compiled config — call_agent {agentId} — dispatches chatless (#986/#1009 readiness)', async () => {
    // Exactly what the manifest compiler emits: { agentId } and nothing else.
    const { callAgent, result } = await dispatch({ agentId: 'agent-uuid-1' }, githubPushContext());
    expect(result.status).toBe('success');
    expect((callAgent.mock.calls[0]?.[0] as AgentCallContext).chatless).toBe(true);
  });
});

describe('call_agent — chat-ful path unchanged by the chatless fallback', () => {
  test('a chat event produces the exact pre-#1010 context (no chatless fields)', async () => {
    const context: TemplateContext = {
      payload: {
        instanceId: 'wa-001',
        from: { id: 'user-1', name: 'Alice' },
        chatId: 'chat-1',
        content: 'hello there',
      },
      variables: {},
      env: {},
      event: {
        id: 'evt-500',
        type: 'message.received',
        timestamp: 5,
        metadata: { correlationId: 'corr-chat' },
      },
      automation: { id: 'auto-2' },
    };
    const { callAgent, result } = await dispatch({ agentId: 'agent-1' }, context);

    expect(result.status).toBe('success');
    const ctx = callAgent.mock.calls[0]?.[0] as AgentCallContext;
    expect(ctx.chatless).toBeUndefined();
    expect(ctx.sessionKey).toBeUndefined();
    expect(ctx.automationId).toBeUndefined();
    expect(ctx.instanceId).toBe('wa-001');
    expect(ctx.chatId).toBe('chat-1');
    expect(ctx.senderId).toBe('user-1');
    expect(ctx.senderName).toBe('Alice');
    expect(ctx.messages).toEqual(['hello there']);
    expect(ctx.event).toEqual({ id: 'evt-500', type: 'message.received', correlationId: 'corr-chat' });
  });

  test('a chat event with no text content still fails (never silently falls back to chatless)', async () => {
    const context: TemplateContext = {
      payload: { instanceId: 'wa-001', chatId: 'chat-1', from: { id: 'user-1' } },
      variables: {},
      env: {},
    };
    const { callAgent, result } = await dispatch({ agentId: 'agent-1' }, context);
    expect(callAgent).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('message content not found in payload');
  });
});
