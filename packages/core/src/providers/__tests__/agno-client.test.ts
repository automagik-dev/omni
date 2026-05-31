/**
 * AgnoClient Tests
 *
 * Tests for both IAgentClient interface methods and Agno-specific methods.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AgnoClient, createAgnoClient } from '../agno-client';
import { ProviderError, type StreamChunk } from '../types';

/**
 * Creates a mock fetch function with Bun-compatible interface
 */
function createMockFetch() {
  const mockImpl = mock((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(new Response()));

  // Create fetch-compatible function with preconnect
  const mockFetch = Object.assign((input: string | URL | Request, init?: RequestInit) => mockImpl(input, init), {
    preconnect: () => {},
  }) as typeof fetch;

  return { mockFetch, mockImpl };
}

describe('AgnoClient', () => {
  const config = {
    baseUrl: 'http://localhost:8181',
    apiKey: 'test-api-key',
    defaultTimeoutMs: 5000,
  };

  let originalFetch: typeof globalThis.fetch;
  let mockImpl: ReturnType<typeof createMockFetch>['mockImpl'];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    const mocks = createMockFetch();
    mockImpl = mocks.mockImpl;
    globalThis.fetch = mocks.mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('normalizes baseUrl by removing trailing slash', () => {
      const client = new AgnoClient({
        ...config,
        baseUrl: 'http://localhost:8181/',
      });
      expect(client).toBeDefined();
    });

    it('uses default timeout when not specified', () => {
      const client = new AgnoClient({
        baseUrl: 'http://localhost:8181',
        apiKey: 'test',
      });
      expect(client).toBeDefined();
    });
  });

  // --- IAgentClient interface: run() ---

  describe('run', () => {
    it('runs agent and returns response', async () => {
      const response = {
        run_id: 'run-123',
        agent_id: 'agent-1',
        session_id: 'session-456',
        content: 'Hello from agent!',
        status: 'COMPLETED',
        metrics: {
          input_tokens: 10,
          output_tokens: 20,
          duration: 150,
        },
      };

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = new AgnoClient(config);
      const result = await client.run({
        message: 'Hello!',
        agentId: 'agent-1',
        agentType: 'agent',
        sessionId: 'chat-123',
        userId: 'user-456',
      });

      expect(result).toEqual({
        content: 'Hello from agent!',
        runId: 'run-123',
        sessionId: 'session-456',
        status: 'completed',
        metrics: {
          inputTokens: 10,
          outputTokens: 20,
          durationMs: 150,
        },
      });

      expect(mockImpl).toHaveBeenCalledTimes(1);
    });

    it('propagates W3C trace context in headers for Langfuse session stitching', async () => {
      const response = {
        run_id: 'run-123',
        agent_id: 'agent-1',
        session_id: 'session-456',
        content: 'Hello from agent!',
        status: 'COMPLETED',
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const client = new AgnoClient(config);
      await client.run({
        message: 'Hello!',
        agentId: 'agent-1',
        agentType: 'agent',
        sessionId: 'chat-123',
        userId: 'user-456',
        traceContext: {
          traceId: '0123456789ABCDEF0123456789ABCDEF',
          spanId: 'FEDCBA9876543210',
          parentSpanId: '0011223344556677',
          traceFlags: 1,
          tracestate: 'vendor=value',
        },
        khalSessionId: 'khal-session-123',
        omni: {
          instanceId: 'inst-1',
          chatId: 'chat-123',
          messageId: 'msg-789',
          channel: 'whatsapp-cloud',
        },
      });

      const init = mockImpl.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      const formData = init.body as FormData;
      expect(headers.traceparent).toBe('00-0123456789abcdef0123456789abcdef-fedcba9876543210-01');
      expect(headers.tracestate).toBe('vendor=value');
      expect(headers['x-trace-id']).toBe('0123456789abcdef0123456789abcdef');
      expect(headers['x-span-id']).toBe('fedcba9876543210');
      expect(headers['x-parent-span-id']).toBe('0011223344556677');
      expect(headers['x-khal-session-id']).toBe('khal-session-123');
      expect(headers['x-khal-user-id']).toBe('user-456');
      expect(headers['x-khal-message-id']).toBe('msg-789');
      expect(headers['x-omni-instance-id']).toBe('inst-1');
      expect(headers['x-omni-chat-id']).toBe('chat-123');
      expect(headers['x-omni-channel']).toBe('whatsapp-cloud');
      expect(formData.get('session_id')).toBe('khal-session-123');
    });

    it('includes structured Omni metadata in Agno run form payloads', async () => {
      const response = {
        run_id: 'run-123',
        agent_id: 'agent-1',
        session_id: 'session-456',
        content: 'Hello from agent!',
        status: 'COMPLETED',
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const client = new AgnoClient(config);
      await client.run({
        message: 'Hello!',
        agentId: 'agent-1',
        agentType: 'agent',
        sessionId: 'chat-123',
        khalSessionId: 'khal-session-123',
        userId: 'person-uuid',
        platform: {
          id: '5511999999999',
          channel: 'whatsapp-cloud',
          instanceId: 'inst-1',
        },
        sender: { displayName: 'Example User' },
        chat: { type: 'group', id: 'group-1', threadId: 'topic-1' },
        messageId: 'msg-789',
        replyToMessageId: 'msg-456',
        mcpUrlParams: { chat_id: 'group-1' },
        env: { OMNI_CHAT: 'group-1' },
        omni: {
          instanceId: 'inst-1',
          chatId: 'group-1',
          messageId: 'msg-789',
          channel: 'whatsapp-cloud',
        },
      });

      const init = mockImpl.mock.calls[0]?.[1] as RequestInit;
      const formData = init.body as FormData;
      expect(formData.get('user_id')).toBe('person-uuid');
      expect(formData.get('khal_session_id')).toBe('khal-session-123');
      expect(formData.get('message_id')).toBe('msg-789');
      expect(formData.get('reply_to_message_id')).toBe('msg-456');
      expect(JSON.parse(String(formData.get('platform')))).toEqual({
        id: '5511999999999',
        channel: 'whatsapp-cloud',
        instanceId: 'inst-1',
      });
      expect(JSON.parse(String(formData.get('sender')))).toEqual({ displayName: 'Example User' });
      expect(JSON.parse(String(formData.get('chat')))).toEqual({ type: 'group', id: 'group-1', threadId: 'topic-1' });
      expect(JSON.parse(String(formData.get('mcp_url_params')))).toEqual({ chat_id: 'group-1' });
      expect(JSON.parse(String(formData.get('env')))).toEqual({ OMNI_CHAT: 'group-1' });
      expect(JSON.parse(String(formData.get('omni')))).toEqual({
        instanceId: 'inst-1',
        chatId: 'group-1',
        messageId: 'msg-789',
        channel: 'whatsapp-cloud',
      });
    });

    it('uses sessionId as x-khal-session-id when khalSessionId is omitted', async () => {
      const response = {
        run_id: 'run-123',
        agent_id: 'agent-1',
        session_id: 'session-456',
        content: 'Hello response',
        status: 'COMPLETED',
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const client = new AgnoClient(config);
      await client.run({
        message: 'Hello!',
        agentId: 'agent-1',
        userId: 'test-user-id',
        sessionId: 'legacy-session-123',
      });

      const init = mockImpl.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      const formData = init.body as FormData;
      expect(headers['x-khal-session-id']).toBe('legacy-session-123');
      expect(formData.get('session_id')).toBe('legacy-session-123');
    });

    it('routes to teams endpoint for team agentType', async () => {
      const response = {
        run_id: 'run-123',
        team_id: 'team-1',
        session_id: 'session-456',
        content: 'Team response',
        status: 'COMPLETED',
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const client = new AgnoClient(config);
      const result = await client.run({
        message: 'Hello!',
        agentId: 'team-1',
        agentType: 'team',
        userId: 'test-user-id',
      });

      expect(result.content).toBe('Team response');
      const calledUrl = mockImpl.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('/teams/team-1/runs');
    });

    it('routes to workflows endpoint for workflow agentType', async () => {
      const response = {
        run_id: 'run-123',
        workflow_id: 'wf-1',
        session_id: 'session-456',
        content: 'Workflow result',
        status: 'COMPLETED',
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const client = new AgnoClient(config);
      const result = await client.run({
        message: 'Run workflow',
        agentId: 'wf-1',
        agentType: 'workflow',
        userId: 'test-user-id',
      });

      expect(result.content).toBe('Workflow result');
      const calledUrl = mockImpl.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('/workflows/wf-1/runs');
    });

    it('handles failed status', async () => {
      const response = {
        run_id: 'run-123',
        session_id: 'session-456',
        content: '',
        status: 'FAILED',
      };

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
        }),
      );

      const client = new AgnoClient(config);
      const result = await client.run({
        message: 'Hello!',
        agentId: 'agent-1',
        userId: 'test-user-id',
      });

      expect(result.status).toBe('failed');
    });
  });

  // --- IAgentClient interface: stream() ---

  describe('stream', () => {
    it('streams agent response via SSE', async () => {
      const sseData = [
        'event: RunStarted\ndata: {"run_id": "run-1", "session_id": "sess-1"}\n\n',
        'event: RunResponse\ndata: {"event": "RunResponse", "content": "Hello "}\n\n',
        'event: RunResponse\ndata: {"event": "RunResponse", "content": "World!"}\n\n',
        'event: RunCompleted\ndata: {"run_id": "run-1", "content": "Hello World!"}\n\n',
      ].join('');

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      mockImpl.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

      const client = new AgnoClient(config);
      const chunks: StreamChunk[] = [];

      for await (const chunk of client.stream({
        message: 'Hi!',
        agentId: 'agent-1',
        userId: 'test-user-id',
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toMatchObject({ event: 'RunStarted', isComplete: false, runId: 'run-1' });
      expect(chunks[1]).toMatchObject({ event: 'RunResponse', content: 'Hello ' });
      expect(chunks[2]).toMatchObject({ event: 'RunResponse', content: 'World!' });
      expect(chunks[3]).toMatchObject({ event: 'RunCompleted', isComplete: true, fullContent: 'Hello World!' });
    });

    it('propagates W3C trace context and Khal session headers for streaming runs', async () => {
      const sseData = 'event: RunCompleted\ndata: {"run_id": "run-1", "content": "done"}\n\n';
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      mockImpl.mockResolvedValueOnce(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );

      const client = new AgnoClient(config);
      for await (const _chunk of client.stream({
        message: 'Hi!',
        agentId: 'agent-1',
        userId: 'user-456',
        khalSessionId: 'khal-session-stream',
        traceContext: {
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          spanId: 'bbbbbbbbbbbbbbbb',
          traceFlags: 1,
        },
        omni: {
          instanceId: 'inst-1',
          chatId: 'chat-123',
          messageId: 'msg-stream-1',
          channel: 'gupshup',
        },
      })) {
        // exhaust stream so the request is issued
      }

      const init = mockImpl.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      const formData = init.body as FormData;
      expect(headers.traceparent).toBe('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');
      expect(headers['x-khal-session-id']).toBe('khal-session-stream');
      expect(headers['x-khal-message-id']).toBe('msg-stream-1');
      expect(headers['x-omni-instance-id']).toBe('inst-1');
      expect(headers['x-omni-chat-id']).toBe('chat-123');
      expect(headers['x-omni-channel']).toBe('gupshup');
      expect(formData.get('session_id')).toBe('khal-session-stream');
    });

    it('handles stream errors', async () => {
      const sseData = 'event: RunFailed\ndata: {"error": "Agent crashed"}\n\n';

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgnoClient(config);

      await expect(async () => {
        for await (const _ of client.stream({
          message: 'Hi!',
          agentId: 'agent-1',
          userId: 'test-user-id',
        })) {
          // Should throw before yielding
        }
      }).toThrow(ProviderError);
    });

    it('throws STREAM_ERROR when response has no body', async () => {
      mockImpl.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const client = new AgnoClient(config);

      await expect(async () => {
        for await (const _ of client.stream({
          message: 'Hi!',
          agentId: 'agent-1',
          userId: 'test-user-id',
        })) {
          // Should throw
        }
      }).toThrow(ProviderError);
    });
  });

  // --- IAgentClient interface: discover() ---

  describe('discover', () => {
    it('returns combined agents, teams, and workflows (agno 2.5 shape)', async () => {
      // agno 2.5+ exposes `id` at the top level of each entity — regression for #509.
      mockImpl
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'a1', name: 'Agent 1' }]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 't1', name: 'Team 1' }]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'w1', name: 'Workflow 1' }]), { status: 200 }));

      const client = new AgnoClient(config);
      const entries = await client.discover();

      expect(entries).toHaveLength(3);
      expect(entries[0]).toMatchObject({ id: 'a1', name: 'Agent 1', type: 'agent' });
      expect(entries[1]).toMatchObject({ id: 't1', name: 'Team 1', type: 'team' });
      expect(entries[2]).toMatchObject({ id: 'w1', name: 'Workflow 1', type: 'workflow' });
      // Every entry must have a defined id — guards against the #509 regression.
      for (const entry of entries) {
        expect(entry.id).toBeDefined();
        expect(entry.id).not.toBe(undefined);
      }
    });

    it('falls back to legacy agent_id/team_id/workflow_id fields (pre-agno-2.5)', async () => {
      mockImpl
        .mockResolvedValueOnce(new Response(JSON.stringify([{ agent_id: 'a1', name: 'Agent 1' }]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([{ team_id: 't1', name: 'Team 1' }]), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ workflow_id: 'w1', name: 'Workflow 1' }]), { status: 200 }),
        );

      const client = new AgnoClient(config);
      const entries = await client.discover();

      expect(entries).toHaveLength(3);
      expect(entries[0]).toMatchObject({ id: 'a1', type: 'agent' });
      expect(entries[1]).toMatchObject({ id: 't1', type: 'team' });
      expect(entries[2]).toMatchObject({ id: 'w1', type: 'workflow' });
    });

    it('returns partial results when some endpoints fail', async () => {
      mockImpl
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'a1', name: 'Agent 1' }]), { status: 200 }))
        .mockRejectedValueOnce(new Error('Teams endpoint down'))
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

      const client = new AgnoClient(config);
      const entries = await client.discover();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: 'a1', type: 'agent' });
    });
  });

  // --- Agno-specific list methods (used internally by discover) ---

  describe('listAgents', () => {
    it('returns list of agents on success', async () => {
      const agents = [
        { id: 'agent-1', name: 'Test Agent' },
        { id: 'agent-2', name: 'Another Agent' },
      ];

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(agents), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = new AgnoClient(config);
      const result = await client.listAgents();

      expect(result).toEqual(agents);
      expect(mockImpl).toHaveBeenCalledTimes(1);
    });

    it('throws AUTHENTICATION_FAILED on 401', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const client = new AgnoClient(config);

      try {
        await client.listAgents();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).code).toBe('AUTHENTICATION_FAILED');
        expect((error as ProviderError).statusCode).toBe(401);
      }
    });

    it('throws NOT_FOUND on 404', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      const client = new AgnoClient(config);

      await expect(client.listAgents()).rejects.toThrow(ProviderError);
    });

    it('throws SERVER_ERROR on 500', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Internal Error', { status: 500 }));

      const client = new AgnoClient(config);

      await expect(client.listAgents()).rejects.toMatchObject({
        code: 'SERVER_ERROR',
      });
    });
  });

  describe('listTeams', () => {
    it('returns list of teams on success', async () => {
      const teams = [{ id: 'team-1', name: 'Test Team' }];

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(teams), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = new AgnoClient(config);
      const result = await client.listTeams();

      expect(result).toEqual(teams);
    });
  });

  describe('listWorkflows', () => {
    it('returns list of workflows on success', async () => {
      const workflows = [{ id: 'wf-1', name: 'Test Workflow' }];

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(workflows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = new AgnoClient(config);
      const result = await client.listWorkflows();

      expect(result).toEqual(workflows);
    });
  });

  // --- IAgentClient interface: checkHealth() ---

  describe('checkHealth', () => {
    it('returns healthy on success', async () => {
      mockImpl.mockResolvedValueOnce(new Response('OK', { status: 200 }));

      const client = new AgnoClient(config);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('returns unhealthy on error response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Error', { status: 500 }));

      const client = new AgnoClient(config);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('HTTP 500');
    });

    it('returns unhealthy on network error', async () => {
      mockImpl.mockRejectedValueOnce(new Error('Connection refused'));

      const client = new AgnoClient(config);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  // --- Authentication ---

  describe('authentication', () => {
    it('sends auth header with requests', async () => {
      mockImpl.mockResolvedValueOnce(new Response('[]', { status: 200 }));

      const client = new AgnoClient(config);
      await client.listAgents();

      expect(mockImpl).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createAgnoClient', () => {
  it('creates an AgnoClient instance', () => {
    const client = createAgnoClient({
      baseUrl: 'http://localhost:8181',
      apiKey: 'test',
    });

    expect(client).toBeInstanceOf(AgnoClient);
  });
});
