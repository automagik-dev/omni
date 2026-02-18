/**
 * Bolt.js client initialization with Socket Mode
 *
 * Handles:
 * - App-Level Token + Bot Token configuration
 * - Health check endpoint
 * - Reconnection handling with structured logging
 * - Rate limiting with exponential backoff
 */

import type { Logger } from '@omni/channel-sdk';
import { App, type AppOptions } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';

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
}

/**
 * Create a Bolt.js App configured for Socket Mode (but NOT started yet).
 *
 * Handlers MUST be registered on the returned app BEFORE calling startBoltConnection().
 * This is required because Bolt.js Socket Mode starts receiving events immediately
 * after start(), and any events arriving before handlers are registered will be dropped.
 */
export function createBoltApp(options: SlackConnectionOptions, logger: Logger): BoltConnection {
  logger.info('Creating Bolt.js app with Socket Mode (not started yet)');

  const appOptions: AppOptions = {
    token: options.botToken,
    appToken: options.appToken,
    socketMode: true,
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
  };
}

/**
 * Start a previously created Bolt.js app (connects via Socket Mode).
 *
 * Call this AFTER all handlers have been registered on the app.
 */
export async function startBoltConnection(connection: BoltConnection, logger: Logger): Promise<BoltConnection> {
  // Start the app (connects via Socket Mode WebSocket)
  try {
    await connection.app.start();
    logger.info('Bolt.js app started successfully in Socket Mode');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start Bolt.js app', { error: message });
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, `Failed to start Slack connection: ${message}`);
  }

  // Get bot info
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
    logger.warn('Failed to resolve bot identity', { error: String(error) });
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
