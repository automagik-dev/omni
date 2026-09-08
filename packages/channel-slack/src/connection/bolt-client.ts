/**
 * Bolt.js client initialization with Socket Mode and HTTP Receiver support
 *
 * Handles:
 * - App-Level Token + Bot Token configuration (Socket Mode)
 * - HTTPReceiver with signing secret validation (HTTP mode)
 * - Body-limit guard for HTTP mode (1 MB max)
 * - Health check endpoint
 * - Reconnection handling with structured logging
 * - Rate limiting with exponential backoff
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@omni/channel-sdk';
import { App, type AppOptions, HTTPReceiver, SocketModeReceiver } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import type { SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';

/** Maximum body size for HTTP mode (1 MB, aligned with OpenClaw) */
const HTTP_MAX_BODY_BYTES = 1024 * 1024;

/**
 * How long to wait for the Socket Mode WebSocket to actually be open after
 * `app.start()` resolves before declaring the start failed (#941).
 */
const SOCKET_OPEN_TIMEOUT_MS = 10_000;

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
 * authorizing human; in bot mode it is Bolt's own client. Returned alongside
 * `client` rather than replacing it — the socket and any bot-only scope still
 * need the bot token.
 */
function buildActingClients(
  options: SlackConnectionOptions,
  botClient: WebClient,
): { actingClient: WebClient; userClient?: WebClient } {
  if (options.authMode !== 'user') return { actingClient: botClient };
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
  botName?: string;
  teamId?: string;
  teamName?: string;
  /** Connection mode: 'socket' (default) or 'http' */
  mode?: 'socket' | 'http';
  /**
   * Port for HTTP receiver mode. When mode is 'http', startBoltConnection()
   * calls app.start(httpPort) to start Bolt's built-in HTTP server.
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
   * status change (#941). Cleared by destroyBoltConnection so a deliberate
   * stop is not reported as a lost socket.
   */
  onSocketStateChange?: (state: SocketConnectionState) => void;
  /** Bound for the post-start WebSocket verification (default 10s). */
  socketConnectTimeoutMs?: number;
}

/**
 * Create a Bolt.js App configured for Socket Mode (but NOT started yet).
 *
 * Handlers MUST be registered on the returned app BEFORE calling startBoltConnection().
 * This is required because Bolt.js Socket Mode starts receiving events immediately
 * after start(), and any events arriving before handlers are registered will be dropped.
 *
 * For HTTP mode, creates an HTTPReceiver. After calling startBoltConnection(),
 * Bolt's built-in HTTP server starts on connection.httpPort (default 3001).
 * The returned BoltConnection.httpHandler is also available for external-server integration.
 */
export function createBoltApp(options: SlackConnectionOptions, logger: Logger): BoltConnection {
  const mode = options.mode ?? 'socket';

  if (mode === 'http') {
    return createHttpBoltApp(options, logger);
  }
  return createSocketBoltApp(options, logger);
}

/**
 * Create a Bolt.js App in Socket Mode
 */
function createSocketBoltApp(options: SlackConnectionOptions, logger: Logger): BoltConnection {
  logger.info('Creating Bolt.js app with Socket Mode (not started yet)');

  if (!options.appToken) {
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, 'appToken (xapp-...) is required for Socket Mode');
  }

  // Construct the receiver explicitly (instead of letting `socketMode: true`
  // build one inside App) so the SocketModeClient is reachable in a typed way —
  // the startup assertion and health check need its real WebSocket state (#941).
  const receiver = new SocketModeReceiver({ appToken: options.appToken });

  const appOptions: AppOptions = {
    token: options.botToken,
    receiver,
    socketMode: true,
    clientOptions: {
      retryConfig: {
        retries: options.retryConfig?.retries ?? 2,
        factor: options.retryConfig?.factor ?? 2,
        minTimeout: options.retryConfig?.baseDelayMs ?? 500,
        maxTimeout: options.retryConfig?.maxDelayMs ?? 3000,
        randomize: true,
      },
    },
  };

  const app = new App(appOptions);

  // Register global error handler to surface Socket Mode issues
  app.error(async (error) => {
    logger.error('Bolt.js global error', { error: String(error) });
  });

  const connection: BoltConnection = {
    app,
    client: app.client,
    ...buildActingClients(options, app.client),
    botToken: options.botToken,
    mode: 'socket',
    socketClient: receiver.client,
    socketState: 'pending',
    socketConnectTimeoutMs: options.socketConnectTimeoutMs,
  };

  watchSocketLifecycle(connection, logger);

  return connection;
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

  socketClient.on('connected', () => {
    logger.info('Slack Socket Mode WebSocket connected');
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
 * Create a Bolt.js App in HTTP mode using HTTPReceiver.
 *
 * The receiver handles Slack signing secret verification automatically.
 * The returned BoltConnection.httpHandler wraps the receiver with a 1 MB body-limit guard.
 */
function createHttpBoltApp(options: SlackConnectionOptions, logger: Logger): BoltConnection {
  if (!options.signingSecret) {
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, 'signingSecret is required for HTTP mode');
  }

  logger.info('Creating Bolt.js app with HTTP receiver (not started yet)');

  const receiver = new HTTPReceiver({
    signingSecret: options.signingSecret,
  });

  const clientRetryConfig = {
    retries: options.retryConfig?.retries ?? 2,
    factor: options.retryConfig?.factor ?? 2,
    minTimeout: options.retryConfig?.baseDelayMs ?? 500,
    maxTimeout: options.retryConfig?.maxDelayMs ?? 3000,
    randomize: true,
  };

  const app = new App({
    token: options.botToken,
    receiver,
    clientOptions: { retryConfig: clientRetryConfig },
  });

  app.error(async (error) => {
    logger.error('Bolt.js HTTP receiver error', { error: String(error) });
  });

  // Wrap the receiver's requestListener with a body-limit guard
  const baseListener = receiver.requestListener;
  const httpHandler = buildBodyLimitHandler(baseListener, HTTP_MAX_BODY_BYTES, logger);

  return {
    app,
    client: app.client,
    ...buildActingClients(options, app.client),
    botToken: options.botToken,
    mode: 'http',
    httpPort: options.httpPort,
    httpHandler,
  };
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
 * Start a previously created Bolt.js app.
 *
 * - Socket Mode: connects via WebSocket. Call AFTER all handlers are registered.
 * - HTTP mode: starts Bolt's built-in HTTP server on connection.httpPort (default 3001).
 *   Slack must be configured to send events to that port. The httpHandler field is also
 *   available for external-server integration if preferred.
 */
export async function startBoltConnection(connection: BoltConnection, logger: Logger): Promise<BoltConnection> {
  await resolveIdentities(connection, logger);

  // User mode (#889) MUST NOT start without a resolved acting-user id. Self-
  // filtering compares the human's own typing against actingUserId; when it is
  // undefined the check in shouldSkipMessage silently no-ops and the agent
  // answers the operator's OWN messages. Fail fast rather than start broken.
  if (connection.userClient && !connection.actingUserId) {
    throw new SlackError(
      SlackErrorCode.CONNECTION_FAILED,
      'User mode requires a resolved acting user id, but it could not be determined from the user token. Refusing to start.',
    );
  }

  if (connection.mode === 'http') {
    // HTTP mode: start Bolt's built-in HTTP server so inbound Slack events are received.
    // Bolt's HTTPReceiver listens on the given port and routes requests to registered handlers.
    const port = connection.httpPort ?? 3001;
    try {
      await connection.app.start(port);
      logger.info('Bolt.js HTTP receiver started', { port });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start Bolt.js HTTP receiver', { error: message, port });
      throw new SlackError(
        SlackErrorCode.CONNECTION_FAILED,
        `Failed to start Slack HTTP listener on port ${port}: ${message}`,
      );
    }
    return connection;
  }

  // Socket Mode: connect via WebSocket, then VERIFY the socket really opened.
  // `app.start()` resolving is not proof of a live connection (#941): an
  // instance produced the full success log sequence with zero TCP connections
  // to Slack. Success is only logged once the WebSocket state confirms it.
  try {
    await connection.app.start();
    await waitForSocketOpen(connection);
    logger.info('Bolt.js app started in Socket Mode (WebSocket verified open)');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start Bolt.js app', { error: message });
    if (error instanceof SlackError) throw error;
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, `Failed to start Slack connection: ${message}`);
  }

  return connection;
}

/**
 * Resolve bot identity first to avoid race conditions in Socket Mode where
 * messages can arrive before botUserId is set (self-message filtering requires
 * it). Failures are logged, not thrown — startBoltConnection enforces the one
 * hard invariant (user mode without a resolved acting-user id) itself.
 */
async function resolveIdentities(connection: BoltConnection, logger: Logger): Promise<void> {
  try {
    const authResult = await connection.app.client.auth.test();
    connection.botUserId = authResult.user_id ?? undefined;
    connection.botName = authResult.user ?? undefined;
    connection.teamId = authResult.team_id ?? undefined;
    connection.teamName = authResult.team ?? undefined;
    logger.info('Bot identity resolved', {
      botUserId: connection.botUserId,
      botName: connection.botName,
      teamId: connection.teamId,
      teamName: connection.teamName,
    });

    // In user mode, resolve the authorizing human too (#889). Self-filtering
    // needs it: a message that person types themselves carries no bot_id and
    // their own user id, so comparing only against botUserId would let the
    // agent answer on their behalf in their own conversation.
    if (connection.userClient) {
      const userAuth = await connection.userClient.auth.test();
      connection.actingUserId = (userAuth.user_id as string | undefined) ?? undefined;
      logger.info('Acting user identity resolved', {
        actingUserId: connection.actingUserId,
        actingUser: userAuth.user,
      });
    }
  } catch (error) {
    logger.warn('Failed to resolve bot identity before start — self-message filtering may be unreliable', {
      error: String(error),
    });
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
async function waitForSocketOpen(connection: BoltConnection): Promise<void> {
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
  if (websocket) return websocket.isActive();
  return connection.socketState === 'connected';
}

/**
 * Create and start a Bolt.js App with Socket Mode (legacy convenience wrapper).
 *
 * NOTE: Prefer using createBoltApp() + register handlers + startBoltConnection()
 * to ensure handlers are registered before Socket Mode starts receiving events.
 */
export async function createBoltConnection(options: SlackConnectionOptions, logger: Logger): Promise<BoltConnection> {
  const connection = createBoltApp(options, logger);
  return startBoltConnection(connection, logger);
}

/**
 * Stop and disconnect a Bolt.js App
 */
export async function destroyBoltConnection(connection: BoltConnection, logger: Logger): Promise<void> {
  // A deliberate stop must not be reported as a lost socket (#941).
  connection.onSocketStateChange = undefined;
  try {
    await connection.app.stop();
    logger.info('Bolt.js connection stopped');
  } catch (error) {
    logger.warn('Error stopping Bolt.js connection', { error: String(error) });
  }
}

/**
 * Check if a Bolt.js connection is healthy.
 *
 * auth.test() only proves the Web API (HTTPS) is reachable; in socket mode the
 * events transport is the WSS connection, so a deaf socket must fail the check
 * even while auth.test() succeeds (#941) — otherwise connect() answers
 * 'already connected' and there is no recovery path from the CLI.
 */
export async function checkBoltHealth(connection: BoltConnection): Promise<boolean> {
  if (!isSocketOpen(connection)) return false;
  try {
    const result = await connection.client.auth.test();
    return result.ok === true;
  } catch {
    return false;
  }
}
