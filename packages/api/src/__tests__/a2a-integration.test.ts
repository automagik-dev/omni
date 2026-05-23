/**
 * A2A Integration Test
 *
 * Tests the full HTTP path: Hono app -> auth middleware -> A2AChannelPlugin.handleWebhook()
 *
 * Creates a focused test Hono app that mirrors the A2A route setup from app.ts
 * with mocked auth and a real A2AChannelPlugin backed by a mock EventBus.
 */

import { describe, expect, mock, test } from 'bun:test';
import { A2AChannelPlugin } from '@omni/channel-a2a';
import type { EventBus } from '@omni/core/events';
import { Hono } from 'hono';

// ─── Types ────────────────────────────────────────────────────

interface JsonRpcBody {
  jsonrpc: string;
  id?: string | number | null;
  result?: {
    task?: {
      id?: string;
      contextId?: string;
      status?: { state: string; timestamp?: string };
    };
  };
  error?: { code: number; message: string; data?: unknown };
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
    subscribe: mock(async () => ({ id: 'sub-1', pattern: '*', unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ id: 'sub-2', pattern: '*', unsubscribe: async () => {} })),
    subscribeMany: mock(async () => ({ id: 'sub-3', pattern: '*', unsubscribe: async () => {} })),
    subscribeAll: mock(async () => ({ id: 'sub-4', pattern: '*', unsubscribe: async () => {} })),
    close: mock(async () => {}),
    isConnected: mock(() => true),
  } as unknown as EventBus & { calls: typeof calls };
}

// ─── Test App Factory ─────────────────────────────────────────

function createTestApp(eventBus: EventBus & { calls: Array<{ type: string; payload: unknown; metadata: unknown }> }) {
  const app = new Hono();

  // Create real A2A plugin, inject mocked eventBus
  const a2aPlugin = new A2AChannelPlugin();
  (a2aPlugin as unknown as { eventBus: EventBus }).eventBus = eventBus;

  // Agent Card: GET /.well-known/agent-card.json — no auth required
  app.get('/.well-known/agent-card.json', async (c) => {
    return a2aPlugin.handleWebhook(c.req.raw);
  });

  // Legacy alias.
  app.get('/.well-known/agent.json', async (c) => {
    return a2aPlugin.handleWebhook(c.req.raw);
  });

  // A2A JSON-RPC: POST /a2a/:instanceId — auth middleware (accept 'test-key')
  app.post(
    '/a2a/:instanceId',
    async (c, next) => {
      const apiKey = c.req.header('x-api-key');
      if (!apiKey || apiKey !== 'test-key') {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401);
      }
      await next();
    },
    async (c) => {
      const headers = new Headers(c.req.raw.headers);
      headers.set('x-omni-api-key-id', 'test-key-id');
      return a2aPlugin.handleWebhook(new Request(c.req.raw, { headers }));
    },
  );

  return { app, a2aPlugin };
}

// ─── Helpers ──────────────────────────────────────────────────

const VALID_SEND_BODY = {
  jsonrpc: '2.0',
  id: 'req-1',
  method: 'SendMessage',
  params: {
    message: {
      role: 'ROLE_USER',
      parts: [{ text: 'Hello from A2A client', mediaType: 'text/plain' }],
      messageId: 'msg-1',
    },
    configuration: { returnImmediately: true },
  },
};

const VALID_STREAM_BODY = {
  jsonrpc: '2.0',
  id: 'req-2',
  method: 'SendStreamingMessage',
  params: {
    message: {
      role: 'ROLE_USER',
      parts: [{ text: 'Stream this response', mediaType: 'text/plain' }],
      messageId: 'msg-2',
    },
  },
};

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': 'test-key',
};

// ─── Tests ────────────────────────────────────────────────────

describe('A2A Integration (Hono app)', () => {
  // ── message/send (fire-and-forget) ──────────────────────────

  describe('message/send', () => {
    test('returns 200 with working task for valid JSON-RPC', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify(VALID_SEND_BODY),
      });
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('req-1');
      expect(body.result?.task?.status?.state).toBe('TASK_STATE_WORKING');
      expect(body.result?.task?.id).toBeDefined();
      expect(body.result?.task?.contextId).toBeDefined();
    });

    test('validates params with Zod - missing message returns -32602', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req-bad',
          method: 'SendMessage',
          params: {},
        }),
      });
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32602);
    });

    test('emits message.received event on eventBus', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify(VALID_SEND_BODY),
      });

      const published = eventBus.calls.find((c) => c.type === 'message.received');
      expect(published).toBeDefined();
      expect((published?.payload as Record<string, unknown>).content).toMatchObject({
        type: 'text',
        text: 'Hello from A2A client',
      });
      expect((published?.metadata as Record<string, unknown>).instanceId).toBe('inst-1');
      expect((published?.metadata as Record<string, unknown>).channelType).toBe('a2a');
    });
  });

  // ── SendStreamingMessage (SSE) ───────────────────────────────

  describe('SendStreamingMessage', () => {
    test('returns SSE stream with correct headers', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify(VALID_STREAM_BODY),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      expect(res.headers.get('Cache-Control')).toContain('no-cache');
      expect(res.headers.get('Connection')).toBe('keep-alive');
      expect(res.body).not.toBeNull();
    });
  });

  // ── Error handling ──────────────────────────────────────────

  describe('error handling', () => {
    test('invalid JSON returns parse error -32700', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: 'not valid json{{{',
      });
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32700);
    });

    test('invalid JSON-RPC (missing jsonrpc field) returns -32600', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ method: 'SendMessage', id: 1 }),
      });
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(-32600);
    });

    test('unknown method returns -32601 with 404', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: 'req-unk', method: 'tasks/nonexistent' }),
      });
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(404);
      expect(body.error?.code).toBe(-32601);
    });
  });

  // ── Agent Card ──────────────────────────────────────────────

  describe('agent card', () => {
    test('GET /.well-known/agent-card.json?instanceId=inst-1 returns valid agent card', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/.well-known/agent-card.json?instanceId=inst-1');
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      expect(body.name).toBeDefined();
      expect(body.supportedInterfaces).toBeDefined();
      expect(Array.isArray(body.supportedInterfaces)).toBe(true);
      expect(body.version).toBeDefined();
      expect(body.capabilities).toBeDefined();
      expect(body.skills).toBeDefined();
      expect(Array.isArray(body.skills)).toBe(true);
    });

    test('GET /.well-known/agent-card.json without instanceId returns 400', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/.well-known/agent-card.json');

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBeDefined();
    });
  });

  // ── Security ────────────────────────────────────────────────

  describe('security', () => {
    test('POST /a2a/inst-1 without x-api-key returns 401', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_SEND_BODY),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('POST /a2a/inst-1 with wrong x-api-key returns 401', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key' },
        body: JSON.stringify(VALID_SEND_BODY),
      });

      expect(res.status).toBe(401);
    });

    test('POST /a2a/inst-1 with valid x-api-key succeeds', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify(VALID_SEND_BODY),
      });

      expect(res.status).toBe(200);
    });
  });

  // ── Stub methods ────────────────────────────────────────────

  describe('task methods', () => {
    test('tasks/get returns not-found for unknown task', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: 'req-stub', method: 'GetTask', params: { id: 'task-1' } }),
      });
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(404);
      expect(body.error?.code).toBe(-32001);
      expect(body.error?.message).toContain('Task not found');
    });

    test('tasks/cancel returns not-found for unknown task', async () => {
      const eventBus = createMockEventBus();
      const { app } = createTestApp(eventBus);

      const res = await app.request('/a2a/inst-1', {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: 'req-cancel', method: 'CancelTask', params: { id: 'task-1' } }),
      });
      const body = (await res.json()) as JsonRpcBody;

      expect(res.status).toBe(404);
      expect(body.error?.code).toBe(-32001);
    });
  });
});
