/**
 * A2AClient unit tests
 *
 * Tests the IAgentClient interface over the A2A JSON-RPC protocol.
 * Uses mocked fetch to avoid real HTTP calls.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { A2AClient, createA2AClient } from '../a2a-client';
import { OMNI_EXECUTION_CONTEXT_EXTENSION_URI } from '../execution-context';
import { ProviderError, type StreamChunk } from '../types';

// ─── Mock fetch helpers ───────────────────────────────────────

function createMockFetch() {
  const mockImpl = mock((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(new Response()));
  const mockFetch = Object.assign((input: string | URL | Request, init?: RequestInit) => mockImpl(input, init), {
    preconnect: () => {},
  }) as typeof fetch;
  return { mockFetch, mockImpl };
}

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(ev));
      }
      controller.close();
    },
  });
}

const CONFIG = { baseUrl: 'http://a2a.example.com', apiKey: 'tok-abc', defaultTimeoutMs: 5_000 };

describe('A2AClient', () => {
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
    mock.restore();
  });

  // ─── Constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', () => {
      const client = new A2AClient({ ...CONFIG, baseUrl: 'http://a2a.example.com/' });
      expect(client).toBeDefined();
    });

    it('uses default timeout when not specified', () => {
      const client = new A2AClient({ baseUrl: 'http://a2a.example.com' });
      expect(client).toBeDefined();
    });
  });

  // ─── run() ────────────────────────────────────────────────────

  describe('run', () => {
    it('returns ProviderResponse immediately when task is already completed', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 'omni-1',
        result: {
          task: {
            id: 'task-123',
            contextId: 'ctx-456',
            status: { state: 'completed', timestamp: new Date().toISOString() },
            artifacts: [{ artifactId: 'a1', parts: [{ type: 'text', text: 'Hello from A2A!' }] }],
          },
        },
      };

      mockImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(rpcResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = new A2AClient(CONFIG);
      const result = await client.run({ message: 'Hi', userId: 'u-1', agentId: 'test-agent', sessionId: 'sess-1' });

      expect(result.content).toBe('Hello from A2A!');
      expect(result.runId).toBe('task-123');
      expect(result.sessionId).toBe('ctx-456');
      expect(result.status).toBe('completed');
    });

    it('returns failed status when task state is failed', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 'omni-1',
        result: {
          task: {
            id: 'task-fail',
            contextId: 'ctx-1',
            status: { state: 'failed', timestamp: new Date().toISOString() },
            artifacts: [],
          },
        },
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(rpcResponse), { status: 200 }));

      const client = new A2AClient(CONFIG);
      const result = await client.run({ message: 'Fail me', userId: 'u-1', agentId: 'test-agent' });

      expect(result.status).toBe('failed');
    });

    it('throws ProviderError when JSON-RPC response contains error', async () => {
      const errResponse = {
        jsonrpc: '2.0',
        id: 'omni-1',
        error: { code: -32600, message: 'Invalid request' },
      };

      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(errResponse), { status: 200 }));

      const client = new A2AClient(CONFIG);

      await expect(client.run({ message: 'Test', userId: 'u-1', agentId: 'test-agent' })).rejects.toBeInstanceOf(
        ProviderError,
      );
    });

    it('sends SendMessage JSON-RPC method', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 'omni-1',
        result: {
          task: {
            id: 'task-1',
            contextId: 'ctx-1',
            status: { state: 'completed' },
            artifacts: [],
          },
        },
      };
      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(rpcResponse), { status: 200 }));

      const client = new A2AClient(CONFIG);
      await client.run({ message: 'Hello', userId: 'u-1', agentId: 'test-agent' });

      const body = JSON.parse((mockImpl.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.method).toBe('SendMessage');
      expect(body.jsonrpc).toBe('2.0');
      expect(body.params.message.role).toBe('ROLE_USER');
      expect(body.params.message.parts[0].text).toBe('Hello');
    });

    it('includes sessionId as contextId in the request', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        result: { task: { id: 't', contextId: 'ctx', status: { state: 'completed' }, artifacts: [] } },
      };
      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(rpcResponse), { status: 200 }));

      const client = new A2AClient(CONFIG);
      await client.run({ message: 'Hi', userId: 'u-1', agentId: 'test-agent', sessionId: 'my-session' });

      const body = JSON.parse((mockImpl.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.params.contextId).toBe('my-session');
    });

    it('serializes Omni execution context as A2A message metadata', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        result: { task: { id: 't', contextId: 'ctx', status: { state: 'completed' }, artifacts: [] } },
      };
      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(rpcResponse), { status: 200 }));

      const client = new A2AClient(CONFIG);
      await client.run({
        message: 'Hi',
        userId: 'person-111',
        agentId: 'test-agent',
        sessionId: 'session-1',
        executionContext: {
          identity: {
            userId: 'person-111',
            personId: 'person-111',
            platformUserId: 'sender-999',
          },
          source: {
            channel: 'whatsapp-baileys',
            instanceId: 'instance-123',
            chatId: 'chat-456',
            messageId: 'message-789',
          },
          session: { id: 'session-1', strategy: 'per_chat' },
          trace: { id: 'trace-123' },
          customer: { externalUserId: 'usr_123' },
        },
      });

      const body = JSON.parse((mockImpl.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.params.message.extensions).toEqual([OMNI_EXECUTION_CONTEXT_EXTENSION_URI]);
      expect(body.params.message.metadata.omniExecutionContext.identity.userId).toBe('person-111');
      expect(body.params.message.metadata.omniExecutionContext.customer.externalUserId).toBe('usr_123');
    });

    it('throws ProviderError on non-ok HTTP response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const client = new A2AClient(CONFIG);

      await expect(client.run({ message: 'Test', userId: 'u-1', agentId: 'test-agent' })).rejects.toBeInstanceOf(
        ProviderError,
      );
    });

    it('sends Authorization header when apiKey is set', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        result: { task: { id: 't', contextId: 'ctx', status: { state: 'completed' }, artifacts: [] } },
      };
      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify(rpcResponse), { status: 200 }));

      const client = new A2AClient(CONFIG);
      await client.run({ message: 'Auth test', userId: 'u-1', agentId: 'test-agent' });

      const headers = (mockImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok-abc');
    });
  });

  // ─── stream() ─────────────────────────────────────────────────

  describe('stream', () => {
    it('yields artifact chunk for v1 taskArtifactUpdate event', async () => {
      const event = {
        result: {
          taskArtifactUpdate: {
            taskId: 'task-1',
            contextId: 'ctx-1',
            artifact: {
              artifactId: 'a1',
              parts: [{ text: 'streaming part', mediaType: 'text/plain' }],
            },
            index: 0,
          },
        },
      };
      const statusEvent = {
        result: {
          taskStatusUpdate: {
            taskId: 'task-1',
            contextId: 'ctx-1',
            status: { state: 'TASK_STATE_COMPLETED' },
          },
        },
      };

      const stream = sseStream([`data: ${JSON.stringify(event)}\n\n`, `data: ${JSON.stringify(statusEvent)}\n\n`]);

      mockImpl.mockResolvedValueOnce(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );

      const client = new A2AClient(CONFIG);
      const chunks: StreamChunk[] = [];

      for await (const chunk of client.stream({ message: 'Go', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toMatchObject({ event: 'artifact', content: 'streaming part', isComplete: false });
    });

    it('yields final chunk on v1 taskStatusUpdate terminal state', async () => {
      const statusEvent = {
        result: {
          taskStatusUpdate: {
            taskId: 'task-1',
            contextId: 'ctx-1',
            status: { state: 'TASK_STATE_COMPLETED' },
          },
        },
      };

      const stream = sseStream([`data: ${JSON.stringify(statusEvent)}\n\n`]);
      mockImpl.mockResolvedValueOnce(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );

      const client = new A2AClient(CONFIG);
      const chunks: StreamChunk[] = [];

      for await (const chunk of client.stream({ message: 'Go', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ event: 'final', isComplete: true });
    });

    it('ignores unknown SSE event types', async () => {
      const unknownEvent = { type: 'someRandomEvent', data: 'ignored' };
      const statusEvent = {
        type: 'taskStatusUpdateEvent',
        taskId: 'task-1',
        status: { state: 'completed' },
        final: true,
      };

      const stream = sseStream([
        `data: ${JSON.stringify(unknownEvent)}\n\n`,
        `data: ${JSON.stringify(statusEvent)}\n\n`,
      ]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new A2AClient(CONFIG);
      const chunks: StreamChunk[] = [];

      for await (const chunk of client.stream({ message: 'Go', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      // Only the final status event should yield
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.event).toBe('final');
    });

    it('throws ProviderError on non-ok HTTP response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));

      const client = new A2AClient(CONFIG);

      await expect(async () => {
        for await (const _ of client.stream({ message: 'Go', userId: 'u-1', agentId: 'test-agent' })) {
          // should throw before yielding
        }
      }).toThrow(ProviderError);
    });

    it('throws ProviderError when response body is null', async () => {
      mockImpl.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const client = new A2AClient(CONFIG);

      await expect(async () => {
        for await (const _ of client.stream({ message: 'Go', userId: 'u-1', agentId: 'test-agent' })) {
        }
      }).toThrow(ProviderError);
    });

    it('throws ProviderError on network error', async () => {
      mockImpl.mockRejectedValueOnce(new Error('Connection refused'));

      const client = new A2AClient(CONFIG);

      await expect(async () => {
        for await (const _ of client.stream({ message: 'Go', userId: 'u-1', agentId: 'test-agent' })) {
        }
      }).toThrow(ProviderError);
    });

    it('sends SendStreamingMessage JSON-RPC method', async () => {
      const statusEvent = {
        type: 'taskStatusUpdateEvent',
        taskId: 'task-1',
        status: { state: 'completed' },
        final: true,
      };
      const stream = sseStream([`data: ${JSON.stringify(statusEvent)}\n\n`]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new A2AClient(CONFIG);
      for await (const _ of client.stream({ message: 'Go', userId: 'u-1', agentId: 'test-agent' })) {
        // consuming stream to trigger fetch
      }

      const body = JSON.parse((mockImpl.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.method).toBe('SendStreamingMessage');
    });
  });

  // ─── checkHealth() ────────────────────────────────────────────

  describe('checkHealth', () => {
    it('returns healthy=true on successful response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('OK', { status: 200 }));

      const client = new A2AClient(CONFIG);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('treats task-not-found health response as reachable', async () => {
      mockImpl.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: -32001 } }), { status: 404 }));

      const client = new A2AClient(CONFIG);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(true);
    });

    it('returns healthy=false on network error', async () => {
      mockImpl.mockRejectedValueOnce(new Error('DNS lookup failed'));

      const client = new A2AClient(CONFIG);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('DNS lookup failed');
    });
  });
});

describe('createA2AClient', () => {
  it('returns an A2AClient instance', () => {
    const client = createA2AClient({ baseUrl: 'http://example.com' });
    expect(client).toBeInstanceOf(A2AClient);
  });
});
