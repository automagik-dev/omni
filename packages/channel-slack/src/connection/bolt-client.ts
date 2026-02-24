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
import type { WebClient } from '@slack/web-api';
import type { SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';

/** Maximum body size for HTTP mode (1 MB, aligned with OpenClaw) */
const HTTP_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Active Bolt.js App instance wrapper
 */
export interface BoltConnection {
  app: App;
  client: WebClient;
  botToken: string;
  botUserId?: string;
  botName?: string;
  teamId?: string;
  teamName?: string;
  /** Connection mode: 'socket' (default) or 'http' */
  mode?: 'socket' | 'http';
  /**
   * HTTP request handler for HTTP mode.
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
 * For HTTP mode, creates an HTTPReceiver. The returned BoltConnection.httpHandler
 * can be registered with an external HTTP server.
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
    botToken: options.botToken,
    mode: 'http',
    httpHandler,
  };
}

/**
 * Wraps a request listener with a body-size guard.
 * Rejects requests exceeding maxBytes with HTTP 413.
 */
function buildBodyLimitHandler(
  listener: (req: IncomingMessage, res: ServerResponse) => void,
  maxBytes: number,
  logger: Logger,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse): void => {
    // Fast path: reject based on Content-Length header if present
    const contentLength = req.headers['content-length'];
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
      logger.warn('HTTP request rejected: Content-Length exceeds limit', {
        contentLength,
        maxBytes,
      });
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Payload Too Large');
      return;
    }

    // Streaming path: count bytes as they arrive
    let bytesRead = 0;
    let limitExceeded = false;

    const onData = (chunk: Buffer): void => {
      bytesRead += chunk.length;
      if (!limitExceeded && bytesRead > maxBytes) {
        limitExceeded = true;
        logger.warn('HTTP request rejected: body exceeded limit', { bytesRead, maxBytes });
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        req.destroy();
      }
    };

    req.on('data', onData);
    req.once('end', () => req.removeListener('data', onData));
    req.once('error', () => req.removeListener('data', onData));

    if (!limitExceeded) {
      listener(req, res);
    }
  };
}

/**
 * Start a previously created Bolt.js app.
 *
 * - Socket Mode: connects via WebSocket. Call AFTER all handlers are registered.
 * - HTTP mode: resolves bot identity only. The httpHandler is already available
 *   on the BoltConnection and should be registered with an external HTTP server.
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
    // HTTP mode: no WebSocket to start. Events arrive via httpHandler.
    logger.info('Bolt.js HTTP receiver ready (register httpHandler with your HTTP server)');
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
