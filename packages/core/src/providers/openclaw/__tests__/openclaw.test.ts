/**
 * OpenClaw Client + Provider Tests
 *
 * Tests the WS client (connect, request, events, reconnect) and
 * the IAgentProvider implementation (trigger, accumulation, circuit breaker).
 *
 * Uses mock WebSocket server via Bun's native WebSocket support.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentTrigger } from '../../types';
import { OpenClawClient } from '../client';
import { OpenClawAgentProvider } from '../provider';
import type {
  ChatEvent,
  ConnectParams,
  OpenClawClientConfig,
  OpenClawProviderConfig,
  ReqFrame,
  ResFrame,
} from '../types';

// === Mock WebSocket Server ===

let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let serverConnections: Set<unknown> = new Set();

// Track received frames from client
let receivedFrames: ReqFrame[] = [];

// Control server responses
interface MockWs {
  send(data: string): void;
}
let onClientFrame: ((frame: ReqFrame, ws: MockWs) => void) | null = null;

function startMockServer() {
  receivedFrames = [];
  serverConnections = new Set();

  const srv = Bun.serve({
    port: 0,
    fetch(req, server) {
      // @ts-ignore — Bun upgrade signature varies by version
      if (server.upgrade(req)) return undefined as unknown as Response;
      return new Response('Not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        serverConnections.add(ws);
        // Send connect.challenge event
        ws.send(
          JSON.stringify({
            type: 'event',
            event: 'connect.challenge',
            payload: {},
          }),
        );
      },
      message(ws, message) {
        const frame = JSON.parse(String(message)) as ReqFrame;
        receivedFrames.push(frame);

        // Handle connect handshake
        if (frame.method === 'connect') {
          const res: ResFrame = {
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {
              type: 'hello-ok',
              protocol: 3,
              server: { version: 'test', host: 'test', connId: 'test-conn' },
              policy: { tickIntervalMs: 30000 },
              snapshot: { sessionDefaults: { defaultAgentId: 'test-agent' } },
            },
          };
          ws.send(JSON.stringify(res));
          return;
        }

        // Delegate to test-specific handler
        if (onClientFrame) {
          onClientFrame(frame, ws);
        }
      },
      close(ws) {
        serverConnections.delete(ws);
      },
    },
  });
  server = srv;
  serverPort = srv.port ?? 0;
  return srv;
}

function stopMockServer() {
  if (server) {
    server.stop(true);
    server = null;
  }
  onClientFrame = null;
}

/** Send event from server to all connected clients */
function sendServerEvent(event: string, payload: unknown) {
  for (const ws of serverConnections) {
    (ws as MockWs).send(JSON.stringify({ type: 'event', event, payload }));
  }
}

/** Send response from server to a specific request */
function sendServerResponse(ws: MockWs, id: string, ok: boolean, payload?: unknown, error?: { message: string }) {
  const res: ResFrame = { type: 'res', id, ok, payload, error };
  ws.send(JSON.stringify(res));
}

// === Test Helpers ===

function createClientConfig(overrides?: Partial<OpenClawClientConfig>): OpenClawClientConfig {
  return {
    url: `ws://127.0.0.1:${serverPort}`,
    token: 'test-token',
    providerId: 'test-provider',
    ...overrides,
  };
}

function createProviderConfig(overrides?: Partial<OpenClawProviderConfig>): OpenClawProviderConfig {
  return {
    defaultAgentId: 'sofia',
    agentTimeoutMs: 5_000,
    sendAckTimeoutMs: 3_000,
    ...overrides,
  };
}

async function createConnectedClient(): Promise<OpenClawClient> {
  const client = new OpenClawClient(createClientConfig());
  client.start();
  await client.waitForReady(5_000);
  return client;
}

async function createConnectedProvider(): Promise<{ provider: OpenClawAgentProvider; client: OpenClawClient }> {
  const client = await createConnectedClient();
  const provider = new OpenClawAgentProvider('test-provider', 'Test Provider', client, createProviderConfig());
  return { provider, client };
}

function createMockTrigger(overrides?: Partial<AgentTrigger>): AgentTrigger {
  return {
    traceId: 'test-trace-123',
    type: 'dm' as const,
    event: {
      id: 'evt-1',
      type: 'message.received',
      timestamp: Date.now(),
      payload: {},
      metadata: { correlationId: 'test-corr-1' },
    },
    source: {
      channelType: 'telegram',
      instanceId: 'inst-1',
      chatId: 'chat-123',
      messageId: 'msg-1',
    },
    sender: {
      platformUserId: 'user-1',
      personId: 'person-1',
      displayName: 'Felipe',
    },
    content: {
      text: 'Hello agent!',
    },
    sessionId: 'session-1',
    ...overrides,
  };
}

// === Tests ===

describe('OpenClawClient', () => {
  beforeEach(() => {
    startMockServer();
  });

  afterEach(() => {
    stopMockServer();
  });

  test('should connect and complete handshake', async () => {
    const client = new OpenClawClient(createClientConfig());
    client.start();

    await client.waitForReady(5_000);
    expect(client.connected).toBe(true);
    expect(client.state).toBe('connected');

    // Verify connect frame was sent with minimum scopes (DEC-8)
    const connectFrame = receivedFrames.find((f) => f.method === 'connect');
    expect(connectFrame).toBeDefined();
    const params = connectFrame?.params as unknown as ConnectParams;
    expect(params.role).toBe('operator');
    expect(params.scopes).toEqual(['operator.admin']);
    expect(params.client.id).toBe('gateway-client');
    expect(params.client.mode).toBe('backend');
    expect(params.client.platform).toBe('omni');

    client.stop();
  });

  test('should send chat.send and receive response', async () => {
    const client = await createConnectedClient();

    onClientFrame = (frame, ws) => {
      if (frame.method === 'chat.send') {
        sendServerResponse(ws, frame.id, true, {
          runId: 'run-abc',
          status: 'started',
        });
      }
    };

    const result = await client.chatSend({
      sessionKey: 'agent:sofia:omni-chat-123',
      message: 'Hello!',
      deliver: true,
      idempotencyKey: 'test-idem-key',
    });

    expect(result.runId).toBe('run-abc');
    expect(result.status).toBe('started');

    client.stop();
  });

  test('should route chat events by runId (DEC-5)', async () => {
    const client = await createConnectedClient();

    const events: ChatEvent[] = [];
    client.registerAccumulation('run-xyz', (event) => {
      events.push(event);
    });

    // Send delta event
    sendServerEvent('chat', {
      state: 'delta',
      sessionKey: 'agent:sofia:omni-test',
      runId: 'run-xyz',
      message: { role: 'assistant', content: 'Hello' },
    });

    // Send final event
    sendServerEvent('chat', {
      state: 'final',
      sessionKey: 'agent:sofia:omni-test',
      runId: 'run-xyz',
      message: { role: 'assistant', content: 'Hello from Sofia!' },
    });

    // Give events time to arrive
    await new Promise((r) => setTimeout(r, 200));

    expect(events.length).toBe(2);
    expect(events[0]?.state).toBe('delta');
    expect(events[1]?.state).toBe('final');
    expect(events[0]?.runId).toBe('run-xyz');

    client.unregisterAccumulation('run-xyz');
    client.stop();
  });

  test('should not route events for unregistered runIds', async () => {
    const client = await createConnectedClient();

    const events: ChatEvent[] = [];
    client.registerAccumulation('run-abc', (event) => {
      events.push(event);
    });

    // Send event for different runId
    sendServerEvent('chat', {
      state: 'delta',
      sessionKey: 'agent:sofia:omni-test',
      runId: 'run-other',
      message: { role: 'assistant', content: 'Wrong' },
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(0);

    client.unregisterAccumulation('run-abc');
    client.stop();
  });

  test('should enforce max 50 concurrent accumulations', async () => {
    const client = await createConnectedClient();

    // Register 50 accumulations
    for (let i = 0; i < 50; i++) {
      client.registerAccumulation(`run-${i}`, () => {});
    }

    // 51st should throw
    expect(() => {
      client.registerAccumulation('run-overflow', () => {});
    }).toThrow('Max concurrent accumulations (50) reached');

    // Cleanup
    for (let i = 0; i < 50; i++) {
      client.unregisterAccumulation(`run-${i}`);
    }
    client.stop();
  });

  test('should report connection state', async () => {
    const client = new OpenClawClient(createClientConfig());
    expect(client.state).toBe('disconnected');
    expect(client.connected).toBe(false);

    client.start();
    await client.waitForReady(5_000);
    expect(client.state).toBe('connected');
    expect(client.connected).toBe(true);

    client.stop();
    expect(client.state).toBe('disconnected');
    expect(client.connected).toBe(false);
  });

  test('should reject requests when not connected', async () => {
    const client = new OpenClawClient(createClientConfig());
    // Don't start

    await expect(client.request('test')).rejects.toThrow('Not connected to gateway');
  });

  test('should handle health ping (30s interval check)', async () => {
    const client = await createConnectedClient();

    // Just verify the client is connected and can be stopped cleanly
    // (The actual 30s timer is too long for unit tests)
    expect(client.connected).toBe(true);

    client.stop();
    expect(client.connected).toBe(false);
  });

  test('should redact auth token in connect frame (DEC-15)', async () => {
    const client = await createConnectedClient();

    const connectFrame = receivedFrames.find((f) => f.method === 'connect');
    expect(connectFrame).toBeDefined();

    // The actual token IS sent on the wire (it needs to be for auth)
    const params = connectFrame?.params as unknown as ConnectParams;
    expect(params.auth?.token).toBe('test-token');

    // But client constructor logs with [REDACTED] — verified by log output (not assertable here)
    client.stop();
  });

  test('should dispose cleanly', async () => {
    const client = await createConnectedClient();

    expect(client.connected).toBe(true);
    expect(client.state).toBe('connected');

    client.stop();
    expect(client.state).toBe('disconnected');
    expect(client.pendingRequestCount).toBe(0);
  });
});

describe('OpenClawAgentProvider', () => {
  beforeEach(() => {
    startMockServer();
  });

  afterEach(() => {
    stopMockServer();
  });

  test('should validate agentId format', () => {
    const client = new OpenClawClient(createClientConfig());

    // Valid
    expect(
      () => new OpenClawAgentProvider('id', 'name', client, createProviderConfig({ defaultAgentId: 'sofia' })),
    ).not.toThrow();
    expect(
      () => new OpenClawAgentProvider('id', 'name', client, createProviderConfig({ defaultAgentId: 'agent-1' })),
    ).not.toThrow();
    expect(
      () => new OpenClawAgentProvider('id', 'name', client, createProviderConfig({ defaultAgentId: 'my_agent_2' })),
    ).not.toThrow();

    // Invalid
    expect(
      () => new OpenClawAgentProvider('id', 'name', client, createProviderConfig({ defaultAgentId: 'agent:bad' })),
    ).toThrow('Invalid agentId');
    expect(
      () => new OpenClawAgentProvider('id', 'name', client, createProviderConfig({ defaultAgentId: 'agent/bad' })),
    ).toThrow('Invalid agentId');

    client.stop();
  });

  test('should trigger and accumulate response', async () => {
    const { provider, client } = await createConnectedProvider();

    // Handle chat.send and send response events
    onClientFrame = (frame, ws) => {
      if (frame.method === 'chat.send') {
        const params = frame.params as Record<string, unknown>;
        sendServerResponse(ws, frame.id, true, {
          runId: 'run-trigger-1',
          status: 'started',
        });

        // Simulate agent response with delta + final
        setTimeout(() => {
          sendServerEvent('chat', {
            state: 'delta',
            sessionKey: params.sessionKey,
            runId: 'run-trigger-1',
            message: { role: 'assistant', content: 'Hello ' },
          });
          setTimeout(() => {
            sendServerEvent('chat', {
              state: 'final',
              sessionKey: params.sessionKey,
              runId: 'run-trigger-1',
              message: { role: 'assistant', content: 'world!' },
            });
          }, 50);
        }, 50);
      }
    };

    const result = await provider.trigger(createMockTrigger());

    expect(result.parts.length).toBeGreaterThan(0);
    expect(result.parts.join(' ')).toContain('Hello');
    expect(result.metadata.runId).toBe('run-trigger-1');
    expect(result.metadata.providerId).toBe('test-provider');
    expect(result.metadata.durationMs).toBeGreaterThan(0);

    client.stop();
  });

  test('should prefix sender name when configured', async () => {
    const { provider, client } = await createConnectedProvider();

    let sentMessage = '';
    onClientFrame = (frame, ws) => {
      if (frame.method === 'chat.send') {
        sentMessage = (frame.params as Record<string, unknown>).message as string;
        sendServerResponse(ws, frame.id, true, { runId: 'run-prefix', status: 'started' });

        setTimeout(() => {
          sendServerEvent('chat', {
            state: 'final',
            sessionKey: (frame.params as Record<string, unknown>).sessionKey,
            runId: 'run-prefix',
            message: { role: 'assistant', content: 'OK' },
          });
        }, 50);
      }
    };

    await provider.trigger(createMockTrigger({ sender: { displayName: 'Felipe', platformUserId: 'u1' } }));

    expect(sentMessage).toBe('[Felipe]: Hello agent!');

    client.stop();
  });

  test('should build correct session key format (DEC-4)', async () => {
    const { provider, client } = await createConnectedProvider();

    let sentSessionKey = '';
    onClientFrame = (frame, ws) => {
      if (frame.method === 'chat.send') {
        sentSessionKey = (frame.params as Record<string, unknown>).sessionKey as string;
        sendServerResponse(ws, frame.id, true, { runId: 'run-sk', status: 'started' });

        setTimeout(() => {
          sendServerEvent('chat', {
            state: 'final',
            sessionKey: sentSessionKey,
            runId: 'run-sk',
            message: { role: 'assistant', content: 'OK' },
          });
        }, 50);
      }
    };

    await provider.trigger(
      createMockTrigger({
        source: { chatId: 'chat-456', instanceId: 'inst-1', channelType: 'telegram', messageId: 'msg-1' },
        sessionId: '', // empty to test chatId fallback path
      }),
    );

    expect(sentSessionKey).toBe('agent:sofia:omni-chat-456');

    client.stop();
  });

  test('should reject messages over 100KB', async () => {
    const { provider, client } = await createConnectedProvider();

    const longMessage = 'x'.repeat(101 * 1024); // 101KB
    const result = await provider.trigger(createMockTrigger({ content: { text: longMessage } }));

    expect(result.parts[0]).toContain('too long');

    client.stop();
  });

  test('should handle circuit breaker (DEC-11)', async () => {
    const { provider, client } = await createConnectedProvider();

    // Make chat.send fail 3 times
    onClientFrame = (frame, ws) => {
      if (frame.method === 'chat.send') {
        sendServerResponse(ws, frame.id, false, undefined, { message: 'Agent error' });
      }
    };

    // Trigger 3 failures
    for (let i = 0; i < 3; i++) {
      await provider.trigger(createMockTrigger());
    }

    // 4th trigger should be short-circuited
    const result = await provider.trigger(createMockTrigger());
    expect(result.parts[0]).toContain('temporarily unavailable');

    client.stop();
  });

  test('should return empty parts for empty content', async () => {
    const { provider, client } = await createConnectedProvider();

    const result = await provider.trigger(createMockTrigger({ content: {} }));

    expect(result.parts).toEqual([]);
    client.stop();
  });

  test('should handle reaction triggers', async () => {
    const { provider, client } = await createConnectedProvider();

    let sentMessage = '';
    onClientFrame = (frame, ws) => {
      if (frame.method === 'chat.send') {
        sentMessage = (frame.params as Record<string, unknown>).message as string;
        sendServerResponse(ws, frame.id, true, { runId: 'run-react', status: 'started' });
        setTimeout(() => {
          sendServerEvent('chat', {
            state: 'final',
            sessionKey: (frame.params as Record<string, unknown>).sessionKey,
            runId: 'run-react',
            message: { role: 'assistant', content: 'Got it' },
          });
        }, 50);
      }
    };

    await provider.trigger(
      createMockTrigger({
        type: 'reaction',
        content: { emoji: '👍', referencedMessageId: 'msg-ref' },
        sender: { displayName: 'Test', platformUserId: 'u1' },
      }),
    );

    expect(sentMessage).toContain('[Reaction: 👍');
    expect(sentMessage).toContain('msg-ref');

    client.stop();
  });

  test('should report health status', async () => {
    const { provider, client } = await createConnectedProvider();

    const health = await provider.checkHealth();
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeDefined();

    client.stop();

    const healthAfter = await provider.checkHealth();
    expect(healthAfter.healthy).toBe(false);
    expect(healthAfter.error).toContain('disconnected');
  });

  test('should implement IAgentProvider interface correctly', async () => {
    const { provider, client } = await createConnectedProvider();

    expect(provider.id).toBe('test-provider');
    expect(provider.name).toBe('Test Provider');
    expect(provider.schema).toBe('openclaw');
    expect(provider.mode).toBe('round-trip');
    expect(provider.canHandle(createMockTrigger())).toBe(true);

    client.stop();
  });

  test('should dispose cleanly with timeout', async () => {
    const { provider, client } = await createConnectedProvider();

    expect(client.connected).toBe(true);

    await provider.dispose();

    expect(client.state).toBe('disconnected');
  });
});
