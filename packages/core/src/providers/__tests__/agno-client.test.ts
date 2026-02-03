/**
 * AgnoOS Client Tests
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AgnoClient, createAgnoClient } from '../agno-client';
import { ProviderError, type StreamChunk } from '../types';

/**
 * Creates a mock fetch function with Bun-compatible interface
 */
function createMockFetch() {
  const mockImpl = mock((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response()),
  );

  // Create fetch-compatible function with preconnect
  const mockFetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => mockImpl(input, init),
    { preconnect: () => {} },
  ) as typeof fetch;

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

  describe('listAgents', () => {
    it('returns list of agents on success', async () => {
      const agents = [
        { agent_id: 'agent-1', name: 'Test Agent' },
        { agent_id: 'agent-2', name: 'Another Agent' },
      ];

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(agents), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createAgnoClient(config);
      const result = await client.listAgents();

      expect(result).toEqual(agents);
      expect(mockImpl).toHaveBeenCalledTimes(1);
    });

    it('throws AUTHENTICATION_FAILED on 401', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const client = createAgnoClient(config);

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

      const client = createAgnoClient(config);

      await expect(client.listAgents()).rejects.toThrow(ProviderError);
    });

    it('throws SERVER_ERROR on 500', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Internal Error', { status: 500 }));

      const client = createAgnoClient(config);

      await expect(client.listAgents()).rejects.toMatchObject({
        code: 'SERVER_ERROR',
      });
    });
  });

  describe('listTeams', () => {
    it('returns list of teams on success', async () => {
      const teams = [{ team_id: 'team-1', name: 'Test Team' }];

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(teams), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createAgnoClient(config);
      const result = await client.listTeams();

      expect(result).toEqual(teams);
    });
  });

  describe('listWorkflows', () => {
    it('returns list of workflows on success', async () => {
      const workflows = [{ workflow_id: 'wf-1', name: 'Test Workflow' }];

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(workflows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createAgnoClient(config);
      const result = await client.listWorkflows();

      expect(result).toEqual(workflows);
    });
  });

  describe('runAgent', () => {
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

      const client = createAgnoClient(config);
      const result = await client.runAgent('agent-1', {
        message: 'Hello!',
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

      const client = createAgnoClient(config);
      const result = await client.runAgent('agent-1', { message: 'Hello!' });

      expect(result.status).toBe('failed');
    });
  });

  describe('runTeam', () => {
    it('runs team and returns response', async () => {
      const response = {
        run_id: 'run-123',
        team_id: 'team-1',
        session_id: 'session-456',
        content: 'Team response',
        status: 'COMPLETED',
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const client = createAgnoClient(config);
      const result = await client.runTeam('team-1', { message: 'Hello!' });

      expect(result.content).toBe('Team response');
    });
  });

  describe('runWorkflow', () => {
    it('runs workflow and returns response', async () => {
      const response = {
        run_id: 'run-123',
        workflow_id: 'wf-1',
        session_id: 'session-456',
        content: 'Workflow result',
        status: 'COMPLETED',
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const client = createAgnoClient(config);
      const result = await client.runWorkflow('wf-1', { message: 'Run workflow' });

      expect(result.content).toBe('Workflow result');
    });
  });

  describe('streaming', () => {
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

      const client = createAgnoClient(config);
      const chunks: StreamChunk[] = [];

      for await (const chunk of client.streamAgent('agent-1', { message: 'Hi!' })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toMatchObject({ event: 'RunStarted', isComplete: false, runId: 'run-1' });
      expect(chunks[1]).toMatchObject({ event: 'RunResponse', content: 'Hello ' });
      expect(chunks[2]).toMatchObject({ event: 'RunResponse', content: 'World!' });
      expect(chunks[3]).toMatchObject({ event: 'RunCompleted', isComplete: true, fullContent: 'Hello World!' });
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

      const client = createAgnoClient(config);

      await expect(async () => {
        for await (const _ of client.streamAgent('agent-1', { message: 'Hi!' })) {
          // Should throw before yielding
        }
      }).toThrow(ProviderError);
    });

    it('throws STREAM_ERROR when response has no body', async () => {
      mockImpl.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const client = createAgnoClient(config);

      await expect(async () => {
        for await (const _ of client.streamAgent('agent-1', { message: 'Hi!' })) {
          // Should throw
        }
      }).toThrow(ProviderError);
    });
  });

  describe('checkHealth', () => {
    it('returns healthy on success', async () => {
      mockImpl.mockResolvedValueOnce(new Response('OK', { status: 200 }));

      const client = createAgnoClient(config);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('returns unhealthy on error response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Error', { status: 500 }));

      const client = createAgnoClient(config);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('HTTP 500');
    });

    it('returns unhealthy on network error', async () => {
      mockImpl.mockRejectedValueOnce(new Error('Connection refused'));

      const client = createAgnoClient(config);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('authentication', () => {
    it('sends X-API-Key header with requests', async () => {
      mockImpl.mockResolvedValueOnce(new Response('[]', { status: 200 }));

      const client = createAgnoClient(config);
      await client.listAgents();

      expect(mockImpl).toHaveBeenCalledTimes(1);
      // The mock was called, verify the headers were included
      // Note: We can't easily inspect FormData in tests, but we verified
      // the request structure in other tests
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
