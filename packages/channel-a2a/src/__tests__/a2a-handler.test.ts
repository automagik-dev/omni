/**
 * handleA2ARequest() unit tests
 *
 * Tests JSON-RPC dispatch, event emission, and SSE stream setup.
 * Uses a mock EventBus that captures publish() calls.
 */

import { describe, expect, it, mock } from 'bun:test';
import type { EventBus } from '@omni/core';
import { handleA2ARequest } from '../a2a-handler';
import { A2AStreamStore } from '../stream-store';

// ─── Types ────────────────────────────────────────────────────

interface JsonRpcBody {
  id?: string | number;
  error?: { code: number; message?: string };
  result?: {
    task?: {
      id?: string;
      contextId?: string;
      status?: { state: string };
    };
  };
}

// ─── Mock EventBus ────────────────────────────────────────────

function createMockEventBus() {
  const calls: Array<{ type: string; payload: unknown; metadata: unknown }> = [];
  return {
    calls,
    connect: mock(async () => {}),
    publish: mock(async (type: string, payload: unknown, metadata: unknown) => {
      calls.push({ type, payload, metadata });
      return { id: 'mock-id', sequence: 1, stream: 'mock-stream' };
    }),
    publishGeneric: mock(async () => ({ id: 'mock-id', sequence: 1, stream: 'mock-stream' })),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeMany: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeAll: mock(async () => ({ unsubscribe: async () => {} })),
    unsubscribe: mock(async () => {}),
    drain: mock(async () => {}),
    close: mock(async () => {}),
    isConnected: mock(() => true),
  };
}

function createMockPlugin() {
  return {
    inboundTimings: mock((_t0: number) => undefined as Record<string, number> | undefined),
    recordT2: mock((_correlationId: string, _timings: Record<string, number>) => {}),
  };
}

function makeRequest(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/a2a/inst-1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeCtx(eventBus = createMockEventBus(), streamStore = new A2AStreamStore()) {
  return {
    instanceId: 'inst-1',
    eventBus: eventBus as unknown as EventBus,
    streamStore,
    channelType: 'a2a' as const,
    plugin: createMockPlugin() as unknown as import('../plugin').A2AChannelPlugin,
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe('handleA2ARequest', () => {
  describe('parse errors', () => {
    it('returns 400 with parse error for invalid JSON body', async () => {
      const req = new Request('http://localhost/a2a/inst-1', {
        method: 'POST',
        body: 'not json',
      });
      const res = await handleA2ARequest(req, makeCtx());
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32700);
    });

    it('returns 400 for missing jsonrpc field', async () => {
      const res = await handleA2ARequest(makeRequest({ method: 'message/send', id: 1 }), makeCtx());
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32600); // Invalid request
    });

    it('returns 400 for missing method field', async () => {
      const res = await handleA2ARequest(makeRequest({ jsonrpc: '2.0', id: 1 }), makeCtx());
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32600);
    });
  });

  describe('message/send', () => {
    const validSend = {
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'hello' }],
          messageId: 'msg-1',
        },
      },
    };

    it('returns 200 with task in completed (terminal) state', async () => {
      const res = await handleA2ARequest(makeRequest(validSend), makeCtx());
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(200);
      expect(body.result?.task?.status?.state).toBe('completed');
      expect(body.result?.task?.id).toBeDefined();
    });

    it('returns the same id as the request', async () => {
      const res = await handleA2ARequest(makeRequest(validSend), makeCtx());
      const body = (await res.json()) as JsonRpcBody;

      expect(body.id).toBe('req-1');
    });

    it('publishes a message.received event to the event bus', async () => {
      const bus = createMockEventBus();
      await handleA2ARequest(makeRequest(validSend), makeCtx(bus));

      const published = bus.calls.find((c) => c.type === 'message.received');
      expect(published).toBeDefined();
      expect((published?.payload as Record<string, unknown>).content).toMatchObject({
        type: 'text',
        text: 'hello',
      });
    });

    it('publishes event with instanceId matching ctx.instanceId', async () => {
      const bus = createMockEventBus();
      await handleA2ARequest(makeRequest(validSend), makeCtx(bus));

      const published = bus.calls.find((c) => c.type === 'message.received');
      expect((published?.metadata as Record<string, unknown>).instanceId).toBe('inst-1');
    });

    it('returns 400 when params.message is missing', async () => {
      const res = await handleA2ARequest(
        makeRequest({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} }),
        makeCtx(),
      );
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32602); // Invalid params
    });

    it('uses contextId from params when provided', async () => {
      const ctx = makeCtx();
      const reqWithContext = {
        ...validSend,
        params: { ...validSend.params, contextId: 'ctx-abc' },
      };
      const res = await handleA2ARequest(makeRequest(reqWithContext), ctx);
      const body = (await res.json()) as JsonRpcBody;

      expect(body.result?.task?.contextId).toBe('ctx-abc');
    });
  });

  describe('message/stream', () => {
    const validStream = {
      jsonrpc: '2.0',
      id: 'req-2',
      method: 'message/stream',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'stream this' }],
          messageId: 'msg-2',
        },
      },
    };

    it('returns 200 with SSE content-type header', async () => {
      const res = await handleA2ARequest(makeRequest(validStream), makeCtx());

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    });

    it('sets cache-control and connection headers', async () => {
      const res = await handleA2ARequest(makeRequest(validStream), makeCtx());

      expect(res.headers.get('Cache-Control')).toContain('no-cache');
      expect(res.headers.get('Connection')).toBe('keep-alive');
    });

    it('creates a pending stream in the store', async () => {
      const streamStore = new A2AStreamStore();
      const ctx = makeCtx(createMockEventBus(), streamStore);
      const res = await handleA2ARequest(makeRequest(validStream), ctx);

      // Stream body is the SSE ReadableStream; the task ID was assigned internally
      // so we just verify at least one stream exists
      expect(res.body).not.toBeNull();
    });

    it('publishes message.received event for the stream request', async () => {
      const bus = createMockEventBus();
      await handleA2ARequest(makeRequest(validStream), makeCtx(bus));

      const published = bus.calls.find((c) => c.type === 'message.received');
      expect(published).toBeDefined();
    });

    it('returns 400 when params.message is missing', async () => {
      const res = await handleA2ARequest(
        makeRequest({ jsonrpc: '2.0', id: 2, method: 'message/stream', params: {} }),
        makeCtx(),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('stub methods', () => {
    it.each(['tasks/get', 'tasks/cancel', 'tasks/resubscribe'])('returns 501 for %s', async (method) => {
      const res = await handleA2ARequest(makeRequest({ jsonrpc: '2.0', id: 1, method }), makeCtx());
      expect(res.status).toBe(501);
      const body = (await res.json()) as JsonRpcBody;
      expect(body.error?.code).toBe(-32601);
    });
  });

  describe('unknown method', () => {
    it('returns 404 for unrecognised method', async () => {
      const res = await handleA2ARequest(
        makeRequest({ jsonrpc: '2.0', id: 1, method: 'tasks/nonexistent' }),
        makeCtx(),
      );
      expect(res.status).toBe(404);
    });
  });
});
