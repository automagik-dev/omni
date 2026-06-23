/**
 * AgnoAgentProvider Tests
 */

import { describe, expect, it, mock } from 'bun:test';
import type { AgentTrigger, IAgentClient, ProviderRequest, ProviderResponse, StreamChunk } from '../types';

// Import the provider through a query-suffixed module id so Bun's process-wide
// mock.module('@omni/core') in API dispatcher tests cannot poison this source-level
// provider test when the entire monorepo suite runs in one process.
// @ts-expect-error Bun test supports query-suffixed imports; TypeScript does not resolve them.
const { AgnoAgentProvider } = await import('../agno-provider.ts?real-agno-provider-test');
// @ts-expect-error Bun test supports query-suffixed imports; TypeScript does not resolve them.
const { SAFE_PROVIDER_ERROR_MESSAGE } = await import('../customer-safe-errors.ts?real-agno-provider-test');

function createTrigger(overrides: Partial<AgentTrigger> = {}): AgentTrigger {
  return {
    traceId: 'trace-1',
    type: 'mention',
    event: {} as AgentTrigger['event'],
    source: {
      channelType: 'whatsapp-cloud',
      instanceId: 'inst-1',
      chatId: 'group-1',
      messageId: 'msg-1',
      threadId: 'thread-1',
    },
    sender: {
      platformUserId: '5511999999999',
      personId: 'person-uuid',
      displayName: 'Example User',
    },
    content: {
      text: 'hello agno',
      referencedMessageId: 'msg-0',
    },
    sessionId: 'session-1',
    traceContext: {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'fedcba9876543210',
      parentSpanId: '0011223344556677',
      traceFlags: 1,
      tracestate: 'vendor=value',
    },
    env: { OMNI_CHAT: 'group-1' },
    ...overrides,
  };
}

function createClient(chunks: StreamChunk[] = []): IAgentClient & { lastRequest?: ProviderRequest } {
  const client: IAgentClient & { lastRequest?: ProviderRequest } = {
    run: mock(async (request: ProviderRequest): Promise<ProviderResponse> => {
      client.lastRequest = request;
      return {
        content: 'done',
        runId: 'run-1',
        sessionId: 'session-1',
        status: 'completed',
      };
    }),
    stream: mock(async function* (request: ProviderRequest): AsyncGenerator<StreamChunk> {
      client.lastRequest = request;
      for (const chunk of chunks) {
        yield chunk;
      }
    }),
    discover: mock(async () => []),
    checkHealth: mock(async () => ({ healthy: true, latencyMs: 1 })),
  };

  return client;
}

function createClientReturning(content: string): IAgentClient & { lastRequest?: ProviderRequest } {
  const client: IAgentClient & { lastRequest?: ProviderRequest } = {
    run: mock(async (request: ProviderRequest): Promise<ProviderResponse> => {
      client.lastRequest = request;
      return {
        content,
        runId: 'run-1',
        sessionId: 'session-1',
        status: 'completed',
      };
    }),
    stream: mock(async function* (request: ProviderRequest): AsyncGenerator<StreamChunk> {
      client.lastRequest = request;
      if (request.agentId === '__never__') {
        yield { event: 'noop', isComplete: true };
      }
    }),
    discover: mock(async () => []),
    checkHealth: mock(async () => ({ healthy: true, latencyMs: 1 })),
  };

  return client;
}

function createThrowingStreamClient(): IAgentClient & { lastRequest?: ProviderRequest } {
  const client: IAgentClient & { lastRequest?: ProviderRequest } = {
    run: mock(async (request: ProviderRequest): Promise<ProviderResponse> => {
      client.lastRequest = request;
      return { content: 'done', runId: 'run-1', sessionId: 'session-1', status: 'completed' };
    }),
    stream: mock(async function* (request: ProviderRequest): AsyncGenerator<StreamChunk> {
      client.lastRequest = request;
      if (request.agentId === 'unreachable') {
        yield { event: 'unreachable', isComplete: false };
      }
      throw new Error('stream exploded');
    }),
    discover: mock(async () => []),
    checkHealth: mock(async () => ({ healthy: true, latencyMs: 1 })),
  };

  return client;
}

async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of stream) {
    results.push(item);
  }
  return results;
}

describe('AgnoAgentProvider', () => {
  it('streams Agno client chunks as provider deltas instead of falling back to trigger()', async () => {
    const client = createClient([
      { event: 'delta', content: 'hel', isComplete: false },
      { event: 'delta', content: 'lo', isComplete: false },
      { event: 'complete', fullContent: 'hello', isComplete: true },
    ]);
    const provider = new AgnoAgentProvider('agno-1', 'Agno', client, {
      agentId: 'agent-1',
      agentType: 'agent',
      timeoutMs: 1234,
    });

    const deltas = await collect(provider.triggerStream(createTrigger()));

    expect(deltas).toEqual([
      { phase: 'content', content: 'hel' },
      { phase: 'content', content: 'lo' },
      { phase: 'final', content: 'hello' },
    ]);
    expect(client.stream).toHaveBeenCalledTimes(1);
    expect(client.run).not.toHaveBeenCalled();
    expect(client.lastRequest).toMatchObject({
      agentId: 'agent-1',
      agentType: 'agent',
      stream: true,
      sessionId: 'session-1',
      userId: 'person-uuid',
      khalSessionId: 'session-1',
      messageId: 'msg-1',
      replyToMessageId: 'msg-0',
      mcpUrlParams: { chat_id: 'group-1' },
      omni: {
        instanceId: 'inst-1',
        chatId: 'group-1',
        messageId: 'msg-1',
        channel: 'whatsapp-cloud',
      },
      platform: {
        id: '5511999999999',
        channel: 'whatsapp-cloud',
        instanceId: 'inst-1',
      },
      sender: { displayName: 'Example User' },
      chat: { type: 'channel', id: 'group-1', threadId: 'thread-1' },
      traceContext: {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: 'fedcba9876543210',
        parentSpanId: '0011223344556677',
        traceFlags: 1,
        tracestate: 'vendor=value',
      },
    });
  });

  it('passes internal person UUID as userId for non-streaming Agno runs', async () => {
    const client = createClient();
    const provider = new AgnoAgentProvider('agno-1', 'Agno', client, {
      agentId: 'agent-1',
      agentType: 'team',
      prefixSenderName: false,
    });

    const result = await provider.trigger(createTrigger());

    expect(result.parts).toEqual(['done']);
    expect(client.lastRequest).toMatchObject({
      message: 'hello agno',
      agentType: 'team',
      stream: false,
      userId: 'person-uuid',
      traceContext: {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: 'fedcba9876543210',
        parentSpanId: '0011223344556677',
        traceFlags: 1,
        tracestate: 'vendor=value',
      },
      platform: { id: '5511999999999' },
    });
  });

  it('replaces raw LiteLLM balance errors before building outbound message parts', async () => {
    const raw =
      'litellm.BadRequestError: AnthropicException - Your credit balance is too low to access the Anthropic API. Available Model Group Fallbacks=None';
    const client = createClientReturning(raw);
    const provider = new AgnoAgentProvider('agno-1', 'Agno', client, {
      agentId: 'agent-1',
      agentType: 'agent',
    });

    const result = await provider.trigger(createTrigger());

    expect(result.parts).toEqual([SAFE_PROVIDER_ERROR_MESSAGE]);
    expect(result.parts.join(' ')).not.toContain('Anthropic');
    expect(result.parts.join(' ')).not.toContain('credit balance');
  });

  it('replaces raw API key errors before building outbound message parts', async () => {
    const raw = 'Authentication Error, Invalid proxy server token passed. Received API Key = ***';
    const client = createClientReturning(raw);
    const provider = new AgnoAgentProvider('agno-1', 'Agno', client, {
      agentId: 'agent-1',
      agentType: 'agent',
    });

    const result = await provider.trigger(createTrigger());

    expect(result.parts).toEqual([SAFE_PROVIDER_ERROR_MESSAGE]);
    expect(result.parts.join(' ')).not.toContain('API Key');
    expect(result.parts.join(' ')).not.toContain('sk-');
  });

  it('derives a W3C trace context from Omni traceId when dispatcher did not provide one', async () => {
    const client = createClient();
    const provider = new AgnoAgentProvider('agno-1', 'Agno', client, {
      agentId: 'agent-1',
      agentType: 'agent',
    });

    await provider.trigger(
      createTrigger({
        traceId: 'trc-homolog-dispatch-1',
        traceContext: undefined,
      }),
    );

    expect(client.lastRequest?.traceContext?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(client.lastRequest?.traceContext?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(client.lastRequest?.traceContext?.traceFlags).toBe(1);
  });

  it('converts Agno stream exceptions into safe error deltas instead of throwing raw errors', async () => {
    const client = createThrowingStreamClient();
    const provider = new AgnoAgentProvider('agno-1', 'Agno', client, {
      agentId: 'agent-1',
      agentType: 'agent',
    });

    const deltas = await collect(provider.triggerStream(createTrigger()));

    expect(deltas).toEqual([{ phase: 'error', error: SAFE_PROVIDER_ERROR_MESSAGE }]);
    expect(client.stream).toHaveBeenCalledTimes(1);
    expect(client.run).not.toHaveBeenCalled();
  });

  it('replaces raw provider errors in stream chunks and final content', async () => {
    const raw = 'Authentication Error, Invalid proxy server token passed. Received API Key = ***';
    const client = createClient([
      { event: 'delta', content: raw, isComplete: false },
      { event: 'complete', fullContent: raw, isComplete: true },
    ]);
    const provider = new AgnoAgentProvider('agno-1', 'Agno', client, {
      agentId: 'agent-1',
      agentType: 'agent',
    });

    const deltas = await collect(provider.triggerStream(createTrigger()));

    expect(deltas).toEqual([
      { phase: 'content', content: SAFE_PROVIDER_ERROR_MESSAGE },
      { phase: 'final', content: SAFE_PROVIDER_ERROR_MESSAGE },
    ]);
  });
});
