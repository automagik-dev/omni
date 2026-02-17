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
import type { RetryConfig, SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';

/**
 * Active Bolt.js App instance wrapper
 */
export interface BoltConnection {
  app: App;
  client: WebClient;
  botUserId?: string;
  botName?: string;
  teamId?: string;
  teamName?: string;
}

/**
 * Build Bolt.js retry configuration from our RetryConfig
 */
function buildRetryOptions(config?: RetryConfig) {
  return {
    retries: config?.retries ?? 2,
  };
}

/**
 * Create and start a Bolt.js App with Socket Mode
 */
export async function createBoltConnection(options: SlackConnectionOptions, logger: Logger): Promise<BoltConnection> {
  logger.info('Creating Bolt.js connection with Socket Mode');

  const retryOptions = buildRetryOptions(options.retryConfig);

  const appOptions: AppOptions = {
    token: options.botToken,
    appToken: options.appToken,
    socketMode: true,
    // Disable built-in HTTP listener since we use Socket Mode
    port: 0,
    ...retryOptions,
  };

  if (options.signingSecret) {
    appOptions.signingSecret = options.signingSecret;
  }

  const app = new App(appOptions);

  // Start the app (connects via Socket Mode)
  try {
    await app.start();
    logger.info('Bolt.js app started successfully in Socket Mode');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start Bolt.js app', { error: message });
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, `Failed to start Slack connection: ${message}`);
  }

  // Get bot info
  let botUserId: string | undefined;
  let botName: string | undefined;
  let teamId: string | undefined;
  let teamName: string | undefined;

  try {
    const authResult = await app.client.auth.test();
    botUserId = authResult.user_id ?? undefined;
    botName = authResult.user ?? undefined;
    teamId = authResult.team_id ?? undefined;
    teamName = authResult.team ?? undefined;
    logger.info('Bot identity resolved', { botUserId, botName, teamId, teamName });
  } catch (error) {
    logger.warn('Failed to resolve bot identity', { error: String(error) });
  }

  return {
    app,
    client: app.client,
    botUserId,
    botName,
    teamId,
    teamName,
  };
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
