/**
 * Tests for extractAgentCallContext debounce message handling
 */

import { describe, expect, mock, test } from 'bun:test';
import type { AgentCallContext, AgentRunResult } from '../actions';
import { executeAction } from '../actions';
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
