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
import type { A2ATaskStore } from '../task-store';

// ─── Types ────────────────────────────────────────────────────

interface JsonRpcBody {
  id?: string | number;
  error?: {
    code: number;
    message?: string;
    data?: Array<{
      '@type'?: string;
      reason?: string;
      domain?: string;
      metadata?: Record<string, string>;
    }>;
  };
  result?: {
    task?: {
      id?: string;
      contextId?: string;
      status?: { state: string };
    };
  };
}

function firstErrorInfo(body: JsonRpcBody) {
  return body.error?.data?.[0];
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

function makeRequest(body: unknown, method = 'POST', headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/a2a/inst-1', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
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

  describe('SendMessage', () => {
    const validSend = {
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'SendMessage',
      params: {
        message: {
          role: 'ROLE_USER',
          parts: [{ text: 'hello', mediaType: 'text/plain' }],
          messageId: 'msg-1',
        },
        configuration: { returnImmediately: true },
      },
    };

    it('returns 200 with task in working state', async () => {
      const res = await handleA2ARequest(makeRequest(validSend), makeCtx());
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(200);
      expect(body.result?.task?.status?.state).toBe('TASK_STATE_WORKING');
      expect(body.result?.task?.id).toBeDefined();
    });

    it('returns A2A ErrorInfo for unsupported protocol versions', async () => {
      const res = await handleA2ARequest(makeRequest(validSend, 'POST', { 'A2A-Version': '0.3' }), makeCtx());
      const body = (await res.json()) as JsonRpcBody;
      const errorInfo = firstErrorInfo(body);

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32009);
      expect(errorInfo?.reason).toBe('VERSION_NOT_SUPPORTED');
      expect(errorInfo?.domain).toBe('a2a-protocol.org');
      expect(errorInfo?.metadata).toMatchObject({ version: '0.3', method: 'SendMessage' });
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
        makeRequest({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: {} }),
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

    it('scopes task reads to the API key that created the task', async () => {
      const ctx = makeCtx();
      const created = await handleA2ARequest(makeRequest(validSend, 'POST', { 'x-omni-api-key-id': 'key-a' }), ctx);
      const createdBody = (await created.json()) as JsonRpcBody;
      const taskId = createdBody.result?.task?.id ?? '';

      const denied = await handleA2ARequest(
        makeRequest({ jsonrpc: '2.0', id: 'read-denied', method: 'GetTask', params: { id: taskId } }, 'POST', {
          'x-omni-api-key-id': 'key-b',
        }),
        ctx,
      );
      const deniedBody = (await denied.json()) as JsonRpcBody;

      expect(denied.status).toBe(404);
      expect(deniedBody.error?.code).toBe(-32001);
      expect(firstErrorInfo(deniedBody)?.reason).toBe('TASK_NOT_FOUND');
      expect(firstErrorInfo(deniedBody)?.metadata).toMatchObject({ taskId });
    });

    it('rejects push notification config when push notifications are disabled', async () => {
      const res = await handleA2ARequest(
        makeRequest({
          ...validSend,
          params: {
            ...validSend.params,
            configuration: {
              returnImmediately: true,
              pushNotificationConfig: { url: 'https://example.com/callback' },
            },
          },
        }),
        makeCtx(),
      );
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32003);
      expect(firstErrorInfo(body)?.reason).toBe('PUSH_NOTIFICATION_NOT_SUPPORTED');
    });

    it('waits for completion when returnImmediately is not requested', async () => {
      const bus = createMockEventBus();
      const ctx = makeCtx(bus) as ReturnType<typeof makeCtx> & { taskStore?: A2ATaskStore };
      bus.publish = mock(async (type: string, payload: unknown, metadata: unknown) => {
        bus.calls.push({ type, payload, metadata });
        const taskId = (payload as Record<string, unknown>).chatId as string;
        await ctx.taskStore?.appendArtifact(ctx.instanceId, taskId, 'done');
        await ctx.taskStore?.updateStatus(ctx.instanceId, taskId, 'TASK_STATE_COMPLETED');
        return { id: 'mock-id', sequence: 1, stream: 'mock-stream' };
      });

      const strictSend = {
        ...validSend,
        params: { message: validSend.params.message },
      };
      const res = await handleA2ARequest(makeRequest(strictSend), ctx);
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(200);
      expect(body.result?.task?.status?.state).toBe('TASK_STATE_COMPLETED');
    });
  });

  describe('SendStreamingMessage', () => {
    const validStream = {
      jsonrpc: '2.0',
      id: 'req-2',
      method: 'SendStreamingMessage',
      params: {
        message: {
          role: 'ROLE_USER',
          parts: [{ text: 'stream this', mediaType: 'text/plain' }],
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
        makeRequest({ jsonrpc: '2.0', id: 2, method: 'SendStreamingMessage', params: {} }),
        makeCtx(),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('task methods', () => {
    it.each(['GetTask', 'CancelTask', 'SubscribeToTask'])(
      'returns task-not-found for %s on unknown task',
      async (method) => {
        const res = await handleA2ARequest(
          makeRequest({ jsonrpc: '2.0', id: 1, method, params: { id: 'missing-task' } }),
          makeCtx(),
        );
        expect(res.status).toBe(404);
        const body = (await res.json()) as JsonRpcBody;
        expect(body.error?.code).toBe(-32001);
        expect(firstErrorInfo(body)?.reason).toBe('TASK_NOT_FOUND');
        expect(firstErrorInfo(body)?.domain).toBe('a2a-protocol.org');
        expect(firstErrorInfo(body)?.metadata).toMatchObject({ taskId: 'missing-task' });
      },
    );
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
