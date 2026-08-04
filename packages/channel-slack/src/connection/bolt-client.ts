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
import { App, type AppOptions, HTTPReceiver } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import type { SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';

/** Maximum body size for HTTP mode (1 MB, aligned with OpenClaw) */
const HTTP_MAX_BODY_BYTES = 1024 * 1024;

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

  const appOptions: AppOptions = {
    token: options.botToken,
    appToken: options.appToken,
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

  if (options.signingSecret) {
    appOptions.signingSecret = options.signingSecret;
  }

  const app = new App(appOptions);

  // Register global error handler to surface Socket Mode issues
  app.error(async (error) => {
    logger.error('Bolt.js global error', { error: String(error) });
  });

  return {
    app,
    client: app.client,
    ...buildActingClients(options, app.client),
    botToken: options.botToken,
    mode: 'socket',
  };
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
  // Resolve bot identity first to avoid race conditions in Socket Mode where
  // messages can arrive before botUserId is set (self-message filtering requires it).
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
  } catch (error) {
    logger.warn('Failed to resolve bot identity before start — self-message filtering may be unreliable', {
      error: String(error),
    });
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

  // Socket Mode: connect via WebSocket
  try {
    await connection.app.start();
    logger.info('Bolt.js app started successfully in Socket Mode');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start Bolt.js app', { error: message });
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, `Failed to start Slack connection: ${message}`);
  }

  return connection;
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
  try {
    await connection.app.stop();
    logger.info('Bolt.js connection stopped');
  } catch (error) {
    logger.warn('Error stopping Bolt.js connection', { error: String(error) });
  }
}

/**
 * Check if a Bolt.js connection is healthy
 */
export async function checkBoltHealth(connection: BoltConnection): Promise<boolean> {
  try {
    const result = await connection.client.auth.test();
    return result.ok === true;
  } catch {
    return false;
  }
}
