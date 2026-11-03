/**
 * Slack connection identity, socket lifecycle, health and HTTP body-limit helpers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@omni/channel-sdk';
import type { App, SocketModeReceiver } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import type { SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';

/** Maximum body size for HTTP mode (1 MB) */
const HTTP_MAX_BODY_BYTES = 1024 * 1024;

/**
 * How long to wait for the Socket Mode WebSocket to actually be open after
 * `app.start()` resolves before declaring the start failed (#941).
 */
const SOCKET_OPEN_TIMEOUT_MS = 10_000;

/**
 * Liveness watchdog (#1151): an open WebSocket that has carried no frame
 * (Slack server ping or event) for this long is a zombie. Slack pings every
 * few seconds, so minutes of silence cannot be an idle workspace.
 */
const SOCKET_STALE_AFTER_MS = 5 * 60_000;

/**
 * The SocketModeClient managed by Bolt's SocketModeReceiver. Derived from the
 * receiver type so `@slack/socket-mode` does not become a direct dependency.
 */
export type SlackSocketClient = SocketModeReceiver['client'];

/**
 * Socket Mode lifecycle state, tracked from the SocketModeClient's own events.
 * 'pending' until the first hello frame confirms the WebSocket is live.
 */
export type SocketConnectionState = 'pending' | 'connected' | 'reconnecting' | 'disconnected';

/**
 * Build the client used for outbound ACTIONS.
 *
 * In user mode this is a `xoxp` client so posts/edits/reactions land as the
 * authorizing human, whether or not a bot client exists — a one-click OAuth
 * install has none. In bot mode it is the bot client, which bot mode cannot
 * run without.
 */
export function buildActingClients(
  options: SlackConnectionOptions,
  botClient?: WebClient,
): { actingClient: WebClient; userClient?: WebClient } {
  if (options.authMode !== 'user') {
    if (!botClient) {
      throw new SlackError(SlackErrorCode.INVALID_TOKEN, "botToken (xoxb-...) is required unless authMode is 'user'");
    }
    return { actingClient: botClient };
  }
  if (!options.userToken) {
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, "userToken is required when authMode is 'user'");
  }
  const userClient = new WebClient(options.userToken);
  return { actingClient: userClient, userClient };
}

/**
 * Active Bolt.js App instance wrapper
 */
export interface BoltConnection {
  app: App;
  /**
   * Bot-authenticated client. Bolt owns this one and uses it for the socket
   * handshake, so it always exists regardless of authMode.
   */
  client: WebClient;
  /**
   * Client for outbound ACTIONS (#889). Identical to `client` in bot mode; a
   * user-token (`xoxp`) client in user mode, so posts, edits and reactions are
   * attributed to the authorizing human.
   *
   * Kept separate from `client` on purpose: some calls must stay on the bot
   * token (the socket, anything the user token has no scope for), so
   * overwriting `client` would be wrong.
   */
  actingClient: WebClient;
  /** User-token client when authMode is 'user'; undefined otherwise. */
  userClient?: WebClient;
  /**
   * Slack user id of the authorizing human, resolved from the user token at
   * start (#889). Needed for self-filtering: in user mode the identity we post
   * AS is this person, not the bot user.
   */
  actingUserId?: string;
  botToken: string;
  botUserId?: string;
  /** This app's bot id (auth.test `bot_id`) — stamped on everything we post (#1151). */
  botId?: string;
  botName?: string;
  teamId?: string;
  teamName?: string;
  /** Connection mode: 'socket' (default) or 'http' */
  mode?: 'socket' | 'http';
  /**
   * Port for HTTP receiver mode. The shared receiver calls app.start(httpPort)
   * to start Bolt's built-in HTTP server.
   * Defaults to 3001 if not provided.
   */
  httpPort?: number;
  /**
   * HTTP request handler for HTTP mode (kept for external-server integration).
   * Wraps Bolt's requestListener with a 1 MB body-limit guard.
   * Undefined for socket mode.
   */
  httpHandler?: (req: IncomingMessage, res: ServerResponse) => void;
  /**
   * The Socket Mode client behind the receiver (socket mode only). Exposed so
   * the startup assertion and health check can inspect the REAL WebSocket
   * state instead of trusting `app.start()` having resolved (#941).
   */
  socketClient?: SlackSocketClient;
  /** Last observed Socket Mode lifecycle state (socket mode only). */
  socketState?: SocketConnectionState;
  /**
   * Hook invoked on every Socket Mode lifecycle transition. plugin.ts assigns
   * it after a verified start so a socket dying later drives a real instance
   * status change (#941). Cleared by the shared receiver on stop so a deliberate
   * stop is not reported as a lost socket.
   */
  onSocketStateChange?: (state: SocketConnectionState) => void;
  /** Last time the socket carried any frame — ping or event (#1151 watchdog). */
  lastSocketActivityAt?: number;
  /** Silence after which an open socket counts as dead (default 5 min). */
  socketStaleAfterMs?: number;
  /** Bound for the post-start WebSocket verification (default 10s). */
  socketConnectTimeoutMs?: number;
}

/**
 * Forward SocketModeClient lifecycle events onto the connection (#941).
 *
 * Bolt only surfaces middleware errors through app.error(); the
 * SocketModeClient reports a dying WebSocket on its own emitter, which nothing
 * forwarded — a socket that died after a good start was invisible and the
 * instance stayed 'connected' forever. Every transition is logged, mirrored
 * onto connection.socketState, and forwarded to connection.onSocketStateChange
 * once the plugin wires one. (@slack/socket-mode v2 has no
 * `unable_to_socket_mode_start` event; start failures surface via 'error' and
 * the bounded post-start verification in waitForSocketOpen.)
 */
export function watchSocketLifecycle(connection: BoltConnection, logger: Logger): void {
  const socketClient = connection.socketClient;
  if (!socketClient) return;

  const transition = (state: SocketConnectionState): void => {
    connection.socketState = state;
    connection.onSocketStateChange?.(state);
  };

  const touch = (): void => {
    connection.lastSocketActivityAt = Date.now();
  };
  socketClient.on('ws_message', touch);
  socketClient.on('connected', () => {
    logger.info('Slack Socket Mode WebSocket connected');
    touch();
    // Server ping frames never reach the client emitter; listen on the raw ws
    // (recreated on every reconnect) so a quiet-but-alive socket stays fresh.
    const raw = (socketClient.websocket as unknown as { websocket?: { on?: (e: string, fn: () => void) => void } })
      ?.websocket;
    raw?.on?.('ping', touch);
    transition('connected');
  });
  socketClient.on('reconnecting', () => {
    logger.warn('Slack Socket Mode WebSocket reconnecting');
    transition('reconnecting');
  });
  socketClient.on('disconnected', () => {
    logger.warn('Slack Socket Mode WebSocket disconnected');
    transition('disconnected');
  });
  socketClient.on('error', (error: unknown) => {
    logger.error('Slack Socket Mode client error', { error: String(error) });
  });
}

/**
 * Wrap a Slack HTTP request listener with the 1 MB body-limit guard.
 *
 * Used by the pooled receiver in app-receiver.ts. An oversized body is refused
 * with 413 before Bolt buffers it.
 */
export function withBodyLimit(
  listener: (req: IncomingMessage, res: ServerResponse) => void,
  logger: Logger,
): (req: IncomingMessage, res: ServerResponse) => void {
  return buildBodyLimitHandler(listener, HTTP_MAX_BODY_BYTES, logger);
}

/**
 * Wraps a request listener with a body-size guard.
 * Rejects requests exceeding maxBytes with HTTP 413.
 *
 * Guard pattern: the guard's onData handler is registered BEFORE invoking the
 * listener, so it fires first on every chunk. When the limit is tripped:
 *   1. Guard writes 413 (checking !res.headersSent so only one path wins)
 *   2. Guard calls req.destroy() to stop further data and signal the listener
 *   3. Listener errors caused by the destroyed stream are suppressed
 */
function buildBodyLimitHandler(
  listener: (req: IncomingMessage, res: ServerResponse) => void,
  maxBytes: number,
  logger: Logger,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse): void => {
    let tripped = false;
    let disposed = false;
    let totalBytes = 0;

    const cleanupGuard = (): void => {
      if (disposed) return;
      disposed = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };

    const trip = (bytesRead: number): void => {
      if (tripped) return;
      tripped = true;
      cleanupGuard();
      logger.warn('HTTP request rejected: body limit exceeded', { bytesRead, maxBytes });
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
      }
      if (!req.destroyed) {
        // Destroy without an Error arg to avoid triggering an unhandled 'error'
        // event on the stream (Bolt may not have an error listener registered yet).
        req.destroy();
      }
    };

    const onData = (chunk: Buffer | string): void => {
      if (disposed) return;
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk as string);
      if (totalBytes > maxBytes) {
        trip(totalBytes);
      }
    };

    const onEnd = cleanupGuard;
    const onError = cleanupGuard;

    // Check Content-Length synchronously — fast path before any I/O
    const contentLength = req.headers['content-length'];
    if (contentLength) {
      const declared = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > maxBytes) {
        logger.warn('HTTP request rejected: Content-Length exceeds limit', { contentLength, maxBytes });
        trip(declared);
        return; // guard tripped synchronously; do not invoke listener
      }
    }

    // Register guard listeners BEFORE invoking the listener so our onData
    // fires first on every chunk (Node.js emits listeners in registration order).
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);

    // Invoke Bolt's listener concurrently with our guard.
    // If the guard trips (destroys req), Bolt will receive a stream error —
    // that error is expected and suppressed here since the guard already
    // wrote the 413 response.
    void Promise.resolve(listener(req, res)).catch((err: unknown) => {
      if (!tripped) {
        logger.error('HTTP listener error', { error: String(err) });
      }
      // If tripped, the error is a consequence of req.destroy() — suppress it.
    });
  };
}

/**
 * Resolve a workspace's bot identity from a bot-token `WebClient`.
 *
 * The shared receiver (app-receiver.ts) builds its Bolt `App` with `authorize`
 * and no `token`, so `app.client` carries no token. Callers that hold a
 * workspace bot client resolve identity here instead. A partial answer is an
 * error: every field is required by `authorize` (botId, botUserId), by the attachment map (teamId)
 * and by the connected-event metadata (botName).
 */
export async function resolveWorkspaceIdentity(
  botClient: WebClient,
): Promise<{ teamId: string; botId: string; botUserId: string; botName: string }> {
  let authResult: Awaited<ReturnType<WebClient['auth']['test']>>;
  try {
    authResult = await botClient.auth.test();
  } catch (error) {
    if (error instanceof SlackError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SlackError(
      SlackErrorCode.CONNECTION_FAILED,
      `auth.test failed while resolving workspace identity: ${message}`,
    );
  }

  const botUserId = authResult.user_id;
  const botId = authResult.bot_id as string | undefined;
  const botName = authResult.user;
  const teamId = authResult.team_id;

  const missing = [
    ['user_id', botUserId],
    ['bot_id', botId],
    ['user', botName],
    ['team_id', teamId],
  ]
    .filter(([, value]) => !value)
    .map(([field]) => field);
  if (!botUserId || !botId || !botName || !teamId) {
    throw new SlackError(
      SlackErrorCode.CONNECTION_FAILED,
      `auth.test returned an incomplete workspace identity (missing: ${missing.join(', ')})`,
    );
  }

  return { teamId, botId, botUserId, botName };
}

/**
 * The name Slack shows for the authorizing human in user mode (#889).
 *
 * `auth.test` returns the account's username (`user`), which is not the name
 * people see in Slack. `users.info` carries it: the first non-blank of the
 * profile display name, the profile real name and the account real name,
 * trimmed, which is the same precedence the OAuth callback uses for the
 * instance it creates (api/src/lib/slack-oauth.ts). The user token's
 * `users:read` scope covers the call. The username stays the fallback when
 * the lookup fails or every name is blank, so a nicer name can never block a
 * connect.
 */
export async function resolveActingUserName(
  userClient: Pick<WebClient, 'users'>,
  actingUserId: string,
  username: string | undefined,
  logger?: Pick<Logger, 'debug'>,
): Promise<string | undefined> {
  try {
    const { user } = await userClient.users.info({ user: actingUserId });
    const candidates = [user?.profile?.display_name, user?.profile?.real_name, user?.real_name];
    return candidates.find((name) => typeof name === 'string' && name.trim().length > 0)?.trim() ?? username;
  } catch (error) {
    logger?.debug('users.info failed for the acting user; presenting the auth.test username', {
      error: String(error),
    });
    return username;
  }
}

/**
 * Wait (bounded) until the Socket Mode WebSocket is actually open.
 *
 * Resolves immediately when the socket is already open; otherwise waits for
 * the client's 'connected' event up to connection.socketConnectTimeoutMs
 * (default {@link SOCKET_OPEN_TIMEOUT_MS}) and throws a recoverable
 * CONNECTION_FAILED so the caller marks the instance 'error' — the state the
 * instance monitor knows how to recover — instead of a lying 'connected'.
 */
export async function waitForSocketOpen(connection: BoltConnection): Promise<void> {
  const socketClient = connection.socketClient;
  if (!socketClient) {
    throw new SlackError(
      SlackErrorCode.CONNECTION_FAILED,
      'Socket Mode client unavailable after start — cannot verify the WebSocket opened',
    );
  }

  if (isSocketOpen(connection)) return;

  const timeoutMs = connection.socketConnectTimeoutMs ?? SOCKET_OPEN_TIMEOUT_MS;
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      socketClient.removeListener('connected', onConnected);
    };
    const onConnected = (): void => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new SlackError(
          SlackErrorCode.CONNECTION_FAILED,
          `Socket Mode WebSocket did not open within ${timeoutMs}ms of app.start() resolving`,
          true,
        ),
      );
    }, timeoutMs);
    timer.unref?.();
    socketClient.on('connected', onConnected);
  });
}

/**
 * Whether the Socket Mode WebSocket is open right now.
 *
 * Ground truth is the underlying ws readyState (SlackWebSocket.isActive), not
 * the cached instance status and not auth.test() — the Web API answers over
 * HTTPS and is happily ok on a process whose WSS never opened (#941). Falls
 * back to the tracked lifecycle state when the client exposes no websocket
 * (before start(), or with mocked clients). Always true for HTTP mode — there
 * is no socket to inspect.
 */
export function isSocketOpen(connection: BoltConnection): boolean {
  if (connection.mode !== 'socket') return true;
  const socketClient = connection.socketClient;
  if (!socketClient) return false;
  const websocket = socketClient.websocket;
  if (websocket) return websocket.isActive() && !isSocketStale(connection);
  return connection.socketState === 'connected';
}

/**
 * Liveness watchdog (#1151). A socket can stay 'open' while Slack stops
 * delivering anything; readyState never notices. Reporting it as not open
 * routes it through the existing getStatus → instance-monitor rebuild path.
 */
export function isSocketStale(connection: BoltConnection, now = Date.now()): boolean {
  const last = connection.lastSocketActivityAt;
  if (last === undefined) return false;
  return now - last > (connection.socketStaleAfterMs ?? SOCKET_STALE_AFTER_MS);
}
