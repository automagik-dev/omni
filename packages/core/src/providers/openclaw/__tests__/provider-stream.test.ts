import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentTrigger, StreamDelta } from '../../types';
import { OpenClawClient } from '../client';
import { OpenClawAgentProvider } from '../provider';
import type { AgentEventPayload, OpenClawClientConfig, OpenClawProviderConfig, ReqFrame, ResFrame } from '../types';

let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let serverConnections: Set<unknown> = new Set();

interface MockWs {
  send(data: string): void;
}

let onClientFrame: ((frame: ReqFrame, ws: MockWs) => void) | null = null;

function startMockServer() {
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

        if (frame.method === 'connect') {
          const res: ResFrame = {
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {
              type: 'hello-ok',
              protocol: 3,
              snapshot: { sessionDefaults: { defaultAgentId: 'test-agent' } },
            },
          };
          ws.send(JSON.stringify(res));
          return;
        }

        if (onClientFrame) onClientFrame(frame, ws);
      },
      close(ws) {
        serverConnections.delete(ws);
      },
    },
  });

  server = srv;
  serverPort = srv.port ?? 0;
}

function stopMockServer() {
  if (server) {
    server.stop(true);
    server = null;
  }
  onClientFrame = null;
}

function sendServerResponse(ws: MockWs, id: string, ok: boolean, payload?: unknown, error?: { message: string }) {
  const res: ResFrame = { type: 'res', id, ok, payload, error };
  ws.send(JSON.stringify(res));
}

function sendAgentEvent(payload: AgentEventPayload) {
  for (const ws of serverConnections) {
    (ws as MockWs).send(
      JSON.stringify({
        type: 'event',
        event: 'agent',
        payload,
      }),
    );
  }
}

function createClientConfig(overrides?: Partial<OpenClawClientConfig>): OpenClawClientConfig {
  return {
    url: `ws://127.0.0.1:${serverPort}`,
    token: 'test-token',
    providerId: 'stream-provider',
    ...overrides,
  };
}

function createProviderConfig(overrides?: Partial<OpenClawProviderConfig>): OpenClawProviderConfig {
  return {
    defaultAgentId: 'sofia',
    agentTimeoutMs: 500,
    sendAckTimeoutMs: 500,
    ...overrides,
  };
}

async function createConnectedProvider(
  overrides?: Partial<OpenClawProviderConfig>,
): Promise<{ provider: OpenClawAgentProvider; client: OpenClawClient }> {
  const client = new OpenClawClient(createClientConfig());
  client.start();
  await client.waitForReady(5_000);
  const provider = new OpenClawAgentProvider(
    'stream-provider',
    'Stream Provider',
    client,
    createProviderConfig(overrides),
  );
  return { provider, client };
}

function createMockTrigger(overrides?: Partial<AgentTrigger>): AgentTrigger {
  return {
    traceId: 'trace-stream-1',
    type: 'dm',
    event: {
      id: 'evt-1',
      type: 'message.received',
      timestamp: Date.now(),
      payload: {},
      metadata: { correlationId: 'corr-1' },
    },
    source: {
      channelType: 'telegram',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      messageId: 'msg-1',
    },
    sender: {
      platformUserId: 'u-1',
      personId: 'p-1',
      displayName: 'Felipe',
    },
    content: {
      text: 'hello',
    },
    sessionId: 'session-1',
    ...overrides,
  };
}

async function collectDeltas(stream: AsyncGenerator<StreamDelta>): Promise<StreamDelta[]> {
  const out: StreamDelta[] = [];
  for await (const delta of stream) out.push(delta);
  return out;
}

describe('OpenClawAgentProvider triggerStream', () => {
  beforeEach(() => {
    startMockServer();
  });

  afterEach(() => {
    stopMockServer();
  });

  test('basic thinking → content → final sequence', async () => {
    const { provider, client } = await createConnectedProvider();

    onClientFrame = (frame, ws) => {
      if (frame.method !== 'chat.send') return;

      sendServerResponse(ws, frame.id, true, {
        runId: 'run-stream-1',
        status: 'started',
      });

      setTimeout(() => {
        sendAgentEvent({
          runId: 'run-stream-1',
          seq: 1,
          stream: 'thinking',
          ts: Date.now(),
          data: { text: 'thinking...' },
        });

        setTimeout(() => {
          sendAgentEvent({
            runId: 'run-stream-1',
            seq: 2,
            stream: 'assistant',
            ts: Date.now(),
            data: { text: 'Hello world' },
          });

          setTimeout(() => {
            sendAgentEvent({
              runId: 'run-stream-1',
              seq: 3,
              stream: 'lifecycle',
              ts: Date.now(),
              data: { phase: 'end' },
            });
          }, 10);
        }, 10);
      }, 10);
    };

    const deltas = await collectDeltas(provider.triggerStream(createMockTrigger()));

    expect(deltas.length).toBe(3);
    expect(deltas[0]).toMatchObject({ phase: 'thinking', thinking: 'thinking...' });
    expect(deltas[1]).toMatchObject({ phase: 'content', content: 'Hello world', thinking: 'thinking...' });
    expect(deltas[2]).toMatchObject({ phase: 'final', content: 'Hello world', thinking: 'thinking...' });

    client.stop();
  });

  test('timeout produces error delta', async () => {
    const { provider, client } = await createConnectedProvider({ agentTimeoutMs: 60 });

    onClientFrame = (frame, ws) => {
      if (frame.method !== 'chat.send') return;
      sendServerResponse(ws, frame.id, true, {
        runId: 'run-stream-timeout',
        status: 'started',
      });
      // intentionally do not send any agent events
    };

    const deltas = await collectDeltas(provider.triggerStream(createMockTrigger()));

    expect(deltas.length).toBe(1);
    expect(deltas[0]).toEqual({
      phase: 'error',
      error: 'The assistant is taking longer than expected. Please try again in a moment.',
    });

    client.stop();
  });

  test('circuit breaker produces error delta', async () => {
    const { provider, client } = await createConnectedProvider();

    (provider as unknown as { circuitOpenUntil: number }).circuitOpenUntil = Date.now() + 60_000;

    const deltas = await collectDeltas(provider.triggerStream(createMockTrigger()));

    expect(deltas).toEqual([
      { phase: 'error', error: 'The assistant is temporarily unavailable. Please try again in a moment.' },
    ]);

    client.stop();
  });

  test('cleanup unregisters callback', async () => {
    const { provider, client } = await createConnectedProvider();

    const unregistered: string[] = [];
    const originalUnregister = client.unregisterAgentAccumulation.bind(client);
    client.unregisterAgentAccumulation = ((runId: string) => {
      unregistered.push(runId);
      originalUnregister(runId);
    }) as typeof client.unregisterAgentAccumulation;

    onClientFrame = (frame, ws) => {
      if (frame.method !== 'chat.send') return;
      sendServerResponse(ws, frame.id, true, {
        runId: 'run-stream-cleanup',
        status: 'started',
      });

      setTimeout(() => {
        sendAgentEvent({
          runId: 'run-stream-cleanup',
          seq: 1,
          stream: 'assistant',
          ts: Date.now(),
          data: { text: 'done' },
        });
        sendAgentEvent({
          runId: 'run-stream-cleanup',
          seq: 2,
          stream: 'lifecycle',
          ts: Date.now(),
          data: { phase: 'end' },
        });
      }, 10);
    };

    const deltas = await collectDeltas(provider.triggerStream(createMockTrigger()));

    expect(deltas[deltas.length - 1]).toMatchObject({ phase: 'final', content: 'done' });
    expect(unregistered).toContain('run-stream-cleanup');

    client.stop();
  });

  test('generator.return unregisters callback on consumer abort', async () => {
    const { provider, client } = await createConnectedProvider();

    const unregistered: string[] = [];
    const originalUnregister = client.unregisterAgentAccumulation.bind(client);
    client.unregisterAgentAccumulation = ((runId: string) => {
      unregistered.push(runId);
      originalUnregister(runId);
    }) as typeof client.unregisterAgentAccumulation;

    onClientFrame = (frame, ws) => {
      if (frame.method !== 'chat.send') return;
      sendServerResponse(ws, frame.id, true, {
        runId: 'run-stream-return',
        status: 'started',
      });

      setTimeout(() => {
        sendAgentEvent({
          runId: 'run-stream-return',
          seq: 1,
          stream: 'thinking',
          ts: Date.now(),
          data: { text: 'thinking...' },
        });
      }, 10);
    };

    const generator = provider.triggerStream(createMockTrigger());
    const first = await generator.next();

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ phase: 'thinking', thinking: 'thinking...' });

    await generator.return(undefined);

    expect(unregistered).toContain('run-stream-return');

    client.stop();
  });
});
