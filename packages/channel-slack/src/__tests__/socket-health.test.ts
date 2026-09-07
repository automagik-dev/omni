/**
 * Socket Mode health & recovery (#941).
 *
 * The failure this guards against: `app.start()` resolved, the plugin logged
 * 'started successfully in Socket Mode' and cached 'connected', yet no
 * WebSocket to Slack existed — the instance was deaf, `checkBoltHealth`
 * (auth.test over HTTPS) said healthy, `instances connect` answered 'already
 * connected', and the instance monitor never saw anything to fix.
 *
 * Four layers, each tested here with fake Bolt objects (no real Slack):
 *  1. startup assertion — start resolves but the socket never opens → throw
 *  2. runtime detection — a socket dying after a good start drives status
 *  3. socket-aware health — checkBoltHealth false while auth.test is ok
 *  4. getStatus override — cached 'connected' + closed socket → 'error'
 */

import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ConnectionStatus, InstanceConfig, PluginContext } from '@omni/channel-sdk';
import type { BoltConnection, SlackSocketClient, SocketConnectionState } from '../connection/bolt-client';
import {
  checkBoltHealth,
  destroyBoltConnection,
  isSocketOpen,
  startBoltConnection,
  watchSocketLifecycle,
} from '../connection/bolt-client';
import { SlackPlugin } from '../plugin';
import { SlackError, SlackErrorCode } from '../types';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

// ─────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────

interface FakeSocketClient {
  client: SlackSocketClient;
  emitter: EventEmitter;
  setActive: (active: boolean) => void;
}

/** EventEmitter standing in for the SocketModeClient, with a togglable WebSocket. */
function makeSocketClient(active: boolean): FakeSocketClient {
  let isActive = active;
  const emitter = Object.assign(new EventEmitter(), {
    websocket: { isActive: () => isActive },
  });
  return {
    client: emitter as unknown as SlackSocketClient,
    emitter,
    setActive: (a: boolean) => {
      isActive = a;
    },
  };
}

/** Minimal socket-mode BoltConnection with observable app.start/app.stop. */
function makeConnection(overrides: Partial<BoltConnection> = {}): {
  conn: BoltConnection;
  counts: { start: number; stop: number };
} {
  const counts = { start: 0, stop: 0 };
  const conn = {
    app: {
      client: {
        auth: { test: async () => ({ ok: true, user_id: 'U0BOT', user: 'bot', team_id: 'T1', team: 'team' }) },
      },
      start: async () => {
        counts.start++;
      },
      stop: async () => {
        counts.stop++;
      },
    },
    client: { auth: { test: async () => ({ ok: true }) } },
    actingClient: {},
    botToken: 'xoxb-fake',
    mode: 'socket',
    socketState: 'pending',
    ...overrides,
  } as unknown as BoltConnection;
  return { conn, counts };
}

function makePluginContext(): PluginContext {
  return {
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger: noopLogger,
    config: {},
    db: {},
  } as unknown as PluginContext;
}

/** Typed access to the plugin internals the tests must seed/inspect. */
interface PluginInternals {
  connections: Map<string, BoltConnection>;
  watchSocketState(instanceId: string, config: InstanceConfig, connection: BoltConnection): void;
  updateInstanceStatus(instanceId: string, config: InstanceConfig, status: ConnectionStatus): Promise<void>;
}

async function makePlugin(): Promise<{ plugin: SlackPlugin; internals: PluginInternals }> {
  const plugin = new SlackPlugin();
  await plugin.initialize(makePluginContext());
  return { plugin, internals: plugin as unknown as PluginInternals };
}

const INSTANCE = 'inst-941';
const CONFIG: InstanceConfig = { instanceId: INSTANCE, credentials: {}, options: {} };

// ─────────────────────────────────────────────────────────────
// 1. Startup assertion — startBoltConnection
// ─────────────────────────────────────────────────────────────

describe('startBoltConnection — post-start socket verification (#941)', () => {
  it('resolves when the WebSocket is already open after start()', async () => {
    const socket = makeSocketClient(true);
    const { conn, counts } = makeConnection({ socketClient: socket.client });

    await startBoltConnection(conn, noopLogger as never);
    expect(counts.start).toBe(1);
  });

  it('resolves when the socket opens shortly after start() (connected event)', async () => {
    const socket = makeSocketClient(false);
    const { conn } = makeConnection({ socketClient: socket.client, socketConnectTimeoutMs: 500 });

    setTimeout(() => {
      socket.setActive(true);
      socket.emitter.emit('connected');
    }, 5);

    await startBoltConnection(conn, noopLogger as never);
    expect(isSocketOpen(conn)).toBe(true);
  });

  it('throws CONNECTION_FAILED when start() resolves but the socket never opens', async () => {
    const socket = makeSocketClient(false);
    const { conn, counts } = makeConnection({ socketClient: socket.client, socketConnectTimeoutMs: 30 });

    const err = await startBoltConnection(conn, noopLogger as never).then(
      () => null,
      (e: unknown) => e,
    );

    expect(counts.start).toBe(1); // start() DID resolve — the lie the assertion catches
    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).channelCode).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect((err as SlackError).recoverable).toBe(true);
  });

  it('throws (never logs silent success) when a socket-mode connection has no socket client', async () => {
    const { conn } = makeConnection(); // no socketClient at all

    const err = await startBoltConnection(conn, noopLogger as never).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).channelCode).toBe(SlackErrorCode.CONNECTION_FAILED);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Runtime detection — watchSocketLifecycle
// ─────────────────────────────────────────────────────────────

describe('watchSocketLifecycle — socket events become connection state (#941)', () => {
  it('tracks connected / reconnecting / disconnected transitions', () => {
    const socket = makeSocketClient(false);
    const { conn } = makeConnection({ socketClient: socket.client });
    const seen: SocketConnectionState[] = [];
    watchSocketLifecycle(conn, noopLogger as never);
    conn.onSocketStateChange = (state) => seen.push(state);

    socket.emitter.emit('connected');
    expect(conn.socketState).toBe('connected');

    socket.emitter.emit('reconnecting');
    expect(conn.socketState).toBe('reconnecting');

    socket.emitter.emit('disconnected');
    expect(conn.socketState).toBe('disconnected');

    expect(seen).toEqual(['connected', 'reconnecting', 'disconnected']);
  });

  it('destroyBoltConnection clears the state-change hook (deliberate stop ≠ lost socket)', async () => {
    const socket = makeSocketClient(true);
    const { conn, counts } = makeConnection({ socketClient: socket.client });
    watchSocketLifecycle(conn, noopLogger as never);
    conn.onSocketStateChange = () => {
      throw new Error('must not fire after destroy');
    };

    await destroyBoltConnection(conn, noopLogger as never);

    expect(counts.stop).toBe(1);
    expect(conn.onSocketStateChange).toBeUndefined();
    socket.emitter.emit('disconnected'); // state still tracked, but no hook fired
    expect(conn.socketState).toBe('disconnected');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Socket-aware health — checkBoltHealth / isSocketOpen
// ─────────────────────────────────────────────────────────────

describe('checkBoltHealth — socket state included for socket mode (#941)', () => {
  it('is false when the socket is closed even though auth.test succeeds', async () => {
    const socket = makeSocketClient(false);
    const { conn } = makeConnection({ socketClient: socket.client });

    // auth.test (HTTPS) is ok — exactly the deaf-instance shape from the issue
    expect(await checkBoltHealth(conn)).toBe(false);
  });

  it('is true when the socket is open and auth.test succeeds', async () => {
    const socket = makeSocketClient(true);
    const { conn } = makeConnection({ socketClient: socket.client });

    expect(await checkBoltHealth(conn)).toBe(true);
  });

  it('is false when the socket is open but auth.test fails', async () => {
    const socket = makeSocketClient(true);
    const { conn } = makeConnection({
      socketClient: socket.client,
      client: {
        auth: {
          test: async () => {
            throw new Error('invalid_auth');
          },
        },
      } as unknown as BoltConnection['client'],
    });

    expect(await checkBoltHealth(conn)).toBe(false);
  });

  it('keeps auth.test as the sole criterion for HTTP mode', async () => {
    const { conn } = makeConnection({ mode: 'http' });
    expect(await checkBoltHealth(conn)).toBe(true);
  });

  it('isSocketOpen falls back to the tracked lifecycle state without a websocket handle', () => {
    const emitter = new EventEmitter(); // no .websocket property
    const { conn } = makeConnection({
      socketClient: emitter as unknown as SlackSocketClient,
      socketState: 'connected',
    });
    expect(isSocketOpen(conn)).toBe(true);

    conn.socketState = 'disconnected';
    expect(isSocketOpen(conn)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Plugin — getStatus override
// ─────────────────────────────────────────────────────────────

describe('SlackPlugin.getStatus — reports the real socket, not the cache (#941)', () => {
  it('turns a cached connected status into a retryable error when the socket is closed', async () => {
    const { plugin, internals } = await makePlugin();
    const socket = makeSocketClient(false);
    const { conn } = makeConnection({ socketClient: socket.client });

    internals.connections.set(INSTANCE, conn);
    await internals.updateInstanceStatus(INSTANCE, CONFIG, { state: 'connected', since: new Date() });

    const status = await plugin.getStatus(INSTANCE);
    expect(status.state).toBe('error');
    expect(status.error?.code).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect(status.error?.retryable).toBe(true);
  });

  it('passes the cached connected status through when the socket is open', async () => {
    const { plugin, internals } = await makePlugin();
    const socket = makeSocketClient(true);
    const { conn } = makeConnection({ socketClient: socket.client });

    internals.connections.set(INSTANCE, conn);
    await internals.updateInstanceStatus(INSTANCE, CONFIG, { state: 'connected', since: new Date() });

    const status = await plugin.getStatus(INSTANCE);
    expect(status.state).toBe('connected');
  });

  it('leaves non-connected cached states untouched', async () => {
    const { plugin, internals } = await makePlugin();
    await internals.updateInstanceStatus(INSTANCE, CONFIG, { state: 'connecting', since: new Date() });

    const status = await plugin.getStatus(INSTANCE);
    expect(status.state).toBe('connecting');
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Plugin — socket death after a good start drives status
// ─────────────────────────────────────────────────────────────

describe('SlackPlugin — socket dying post-start transitions instance status (#941)', () => {
  async function wire(): Promise<{
    plugin: SlackPlugin;
    internals: PluginInternals;
    socket: FakeSocketClient;
    conn: BoltConnection;
  }> {
    const { plugin, internals } = await makePlugin();
    const socket = makeSocketClient(true);
    const { conn } = makeConnection({ socketClient: socket.client });
    watchSocketLifecycle(conn, noopLogger as never);

    internals.connections.set(INSTANCE, conn);
    await internals.updateInstanceStatus(INSTANCE, CONFIG, { state: 'connected', since: new Date() });
    internals.watchSocketState(INSTANCE, CONFIG, conn);
    return { plugin, internals, socket, conn };
  }

  it('disconnected → status error (retryable), reconnecting → status reconnecting', async () => {
    const { plugin, socket } = await wire();

    socket.setActive(false);
    socket.emitter.emit('disconnected');
    const afterDeath = await plugin.getStatus(INSTANCE);
    expect(afterDeath.state).toBe('error');
    expect(afterDeath.error?.retryable).toBe(true);

    socket.emitter.emit('reconnecting');
    const whileRetrying = await plugin.getStatus(INSTANCE);
    expect(whileRetrying.state).toBe('reconnecting');
  });

  it('a recovered socket transitions the instance back to connected', async () => {
    const { plugin, socket } = await wire();

    socket.setActive(false);
    socket.emitter.emit('disconnected');
    expect((await plugin.getStatus(INSTANCE)).state).toBe('error');

    socket.setActive(true);
    socket.emitter.emit('connected');
    expect((await plugin.getStatus(INSTANCE)).state).toBe('connected');
  });

  it('transitions from a replaced (stale) connection are ignored', async () => {
    const { plugin, internals, socket } = await wire();

    // Instance was rebuilt: the map now holds a NEW healthy connection
    const fresh = makeConnection({ socketClient: makeSocketClient(true).client }).conn;
    internals.connections.set(INSTANCE, fresh);

    socket.emitter.emit('disconnected'); // old connection's event
    expect((await plugin.getStatus(INSTANCE)).state).toBe('connected');
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Plugin — connect() on a deaf instance rebuilds
// ─────────────────────────────────────────────────────────────

describe('SlackPlugin.connect — deaf instance rebuilds instead of "already connected" (#941)', () => {
  it('returns early (no teardown) when the existing connection is genuinely healthy', async () => {
    const { plugin, internals } = await makePlugin();
    const socket = makeSocketClient(true);
    const { conn, counts } = makeConnection({ socketClient: socket.client });
    internals.connections.set(INSTANCE, conn);

    await plugin.connect(INSTANCE, CONFIG);

    expect(counts.stop).toBe(0);
    expect(internals.connections.get(INSTANCE)).toBe(conn);
  });

  it('tears the deaf connection down and attempts a rebuild', async () => {
    const { plugin, internals } = await makePlugin();
    const socket = makeSocketClient(false); // socket dead, auth.test still ok
    const { conn, counts } = makeConnection({ socketClient: socket.client });
    internals.connections.set(INSTANCE, conn);

    // Empty config makes the rebuild fail fast at token resolution — the
    // point is that connect() gets PAST the 'already connected' dead-end.
    const err = await plugin.connect(INSTANCE, CONFIG).then(
      () => null,
      (e: unknown) => e,
    );

    expect(counts.stop).toBe(1); // stale connection destroyed
    expect(internals.connections.get(INSTANCE)).toBeUndefined();
    expect(err).toBeInstanceOf(SlackError);
    expect((await plugin.getStatus(INSTANCE)).state).toBe('error');
  });
});
