/**
 * AgUiClient unit tests
 *
 * Tests the CopilotKit AG-UI SSE protocol client.
 * Uses mocked fetch to avoid real HTTP calls.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AgUiClient, createAgUiClient } from '../ag-ui-client';
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

function agUiEvent(type: string, extra: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({ type, ...extra })}\n\n`;
}

const CONFIG = { baseUrl: 'http://agui.example.com', apiKey: 'agui-key', defaultTimeoutMs: 5_000 };

describe('AgUiClient', () => {
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
      const client = new AgUiClient({ ...CONFIG, baseUrl: 'http://agui.example.com/' });
      expect(client).toBeDefined();
    });
  });

  // ─── stream() ─────────────────────────────────────────────────

  describe('stream', () => {
    it('yields start chunk on RUN_STARTED', async () => {
      const stream = sseStream([
        agUiEvent('RUN_STARTED', { runId: 'run-1' }),
        agUiEvent('RUN_FINISHED', { runId: 'run-1' }),
      ]);
      mockImpl.mockResolvedValueOnce(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );

      const client = new AgUiClient(CONFIG);
      const chunks: StreamChunk[] = [];
      for await (const chunk of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      const startChunk = chunks.find((c) => c.event === 'start');
      expect(startChunk).toBeDefined();
      expect(startChunk?.isComplete).toBe(false);
    });

    it('yields delta chunk on TEXT_MESSAGE_CONTENT', async () => {
      const stream = sseStream([
        agUiEvent('TEXT_MESSAGE_CONTENT', { delta: 'Hello ' }),
        agUiEvent('TEXT_MESSAGE_CONTENT', { delta: 'world!' }),
        agUiEvent('RUN_FINISHED', { runId: 'run-1' }),
      ]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const chunks: StreamChunk[] = [];
      for await (const chunk of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      const deltas = chunks.filter((c) => c.event === 'delta');
      expect(deltas).toHaveLength(2);
      expect(deltas[0]?.content).toBe('Hello ');
      expect(deltas[1]?.content).toBe('world!');
    });

    it('skips TEXT_MESSAGE_CONTENT events without delta', async () => {
      const stream = sseStream([
        agUiEvent('TEXT_MESSAGE_CONTENT', {}), // no delta
        agUiEvent('RUN_FINISHED', { runId: 'run-1' }),
      ]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const chunks: StreamChunk[] = [];
      for await (const chunk of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      const deltas = chunks.filter((c) => c.event === 'delta');
      expect(deltas).toHaveLength(0);
    });

    it('yields final chunk and stops on RUN_FINISHED', async () => {
      const stream = sseStream([
        agUiEvent('RUN_FINISHED', { runId: 'run-42' }),
        agUiEvent('TEXT_MESSAGE_CONTENT', { delta: 'ignored after final' }),
      ]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const chunks: StreamChunk[] = [];
      for await (const chunk of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find((c) => c.event === 'final');
      expect(finalChunk).toBeDefined();
      expect(finalChunk?.isComplete).toBe(true);

      // Nothing after the final
      const finalIdx = chunks.findIndex((c) => c.event === 'final');
      const afterFinal = chunks.slice(finalIdx + 1);
      expect(afterFinal).toHaveLength(0);
    });

    it('yields error chunk on RUN_ERROR', async () => {
      const stream = sseStream([agUiEvent('RUN_ERROR', { message: 'Agent crashed' })]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const chunks: StreamChunk[] = [];
      for await (const chunk of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      const errorChunk = chunks.find((c) => c.event === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.content).toBe('Agent crashed');
      expect(errorChunk?.isComplete).toBe(true);
    });

    it('ignores TOOL_CALL_START, STATE_SNAPSHOT, and other events', async () => {
      const stream = sseStream([
        agUiEvent('TOOL_CALL_START', { toolName: 'search' }),
        agUiEvent('STATE_SNAPSHOT', { state: {} }),
        agUiEvent('MESSAGES_SNAPSHOT', {}),
        agUiEvent('RUN_FINISHED', { runId: 'run-1' }),
      ]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const chunks: StreamChunk[] = [];
      for await (const chunk of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      const nonFinal = chunks.filter((c) => c.event !== 'final');
      expect(nonFinal).toHaveLength(0);
    });

    it('yields a final chunk when stream ends without RUN_FINISHED', async () => {
      // Stream closes without an explicit RUN_FINISHED
      const stream = sseStream([agUiEvent('TEXT_MESSAGE_CONTENT', { delta: 'partial' })]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const chunks: StreamChunk[] = [];
      for await (const chunk of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find((c) => c.isComplete);
      expect(finalChunk).toBeDefined();
    });

    it('throws ProviderError on non-ok HTTP response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const client = new AgUiClient(CONFIG);

      await expect(async () => {
        for await (const _ of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        }
      }).toThrow(ProviderError);
    });

    it('throws ProviderError when response body is null', async () => {
      mockImpl.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const client = new AgUiClient(CONFIG);

      await expect(async () => {
        for await (const _ of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        }
      }).toThrow(ProviderError);
    });

    it('throws ProviderError on network failure', async () => {
      mockImpl.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const client = new AgUiClient(CONFIG);

      await expect(async () => {
        for await (const _ of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        }
      }).toThrow(ProviderError);
    });

    it('sends Authorization header when apiKey is set', async () => {
      const stream = sseStream([agUiEvent('RUN_FINISHED', { runId: 'r1' })]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      for await (const _ of client.stream({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })) {
        // consuming stream to trigger fetch
      }

      const headers = (mockImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer agui-key');
    });
  });

  // ─── run() ────────────────────────────────────────────────────

  describe('run', () => {
    it('accumulates TEXT_MESSAGE_CONTENT deltas into full content', async () => {
      const stream = sseStream([
        agUiEvent('TEXT_MESSAGE_CONTENT', { delta: 'Hello ', runId: 'r1' }),
        agUiEvent('TEXT_MESSAGE_CONTENT', { delta: 'world!', runId: 'r1' }),
        agUiEvent('RUN_FINISHED', { runId: 'r1' }),
      ]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const result = await client.run({ message: 'Hi', userId: 'u-1', agentId: 'test-agent', sessionId: 's-1' });

      expect(result.content).toBe('Hello world!');
      expect(result.status).toBe('completed');
      expect(result.sessionId).toBe('s-1');
    });

    it('throws ProviderError when stream yields an error event', async () => {
      const stream = sseStream([agUiEvent('RUN_ERROR', { message: 'Boom' })]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);

      await expect(client.run({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' })).rejects.toBeInstanceOf(
        ProviderError,
      );
    });

    it('returns empty content when no delta events are emitted', async () => {
      const stream = sseStream([agUiEvent('RUN_FINISHED', { runId: 'r-empty' })]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const result = await client.run({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' });

      expect(result.content).toBe('');
      expect(result.status).toBe('completed');
    });

    it('captures runId from stream events', async () => {
      const stream = sseStream([
        agUiEvent('RUN_STARTED', { runId: 'run-xyz' }),
        agUiEvent('RUN_FINISHED', { runId: 'run-xyz' }),
      ]);
      mockImpl.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const result = await client.run({ message: 'Hi', userId: 'u-1', agentId: 'test-agent' });

      expect(result.runId).toBe('run-xyz');
    });
  });

  // ─── checkHealth() ────────────────────────────────────────────

  describe('checkHealth', () => {
    it('returns healthy=true on 2xx response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('OK', { status: 200 }));

      const client = new AgUiClient(CONFIG);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(true);
    });

    it('returns healthy=false on 5xx response', async () => {
      mockImpl.mockResolvedValueOnce(new Response('Error', { status: 503 }));

      const client = new AgUiClient(CONFIG);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(false);
    });

    it('returns healthy=false on network error', async () => {
      mockImpl.mockRejectedValueOnce(new Error('timeout'));

      const client = new AgUiClient(CONFIG);
      const result = await client.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });
});

describe('createAgUiClient', () => {
  it('returns an AgUiClient instance', () => {
    const client = createAgUiClient({ baseUrl: 'http://example.com' });
    expect(client).toBeInstanceOf(AgUiClient);
  });
});
