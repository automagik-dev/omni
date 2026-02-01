/**
 * Connection event handlers for Discord client
 *
 * Handles connection lifecycle:
 * - Ready (connected)
 * - Disconnected (error/manual)
 * - Reconnection
 */

import { createLogger } from '@omni/core';
import type { Client } from 'discord.js';
import type { DiscordPlugin } from '../plugin';

const log = createLogger('discord:connection');

/**
 * Reconnection configuration
 */
export interface ReconnectConfig {
  /** Maximum number of reconnection attempts */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
};

/**
 * Track reconnection state per instance
 */
const reconnectAttempts = new Map<string, number>();

/**
 * Track connected instances
 */
const connectedInstances = new Set<string>();

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, config: ReconnectConfig): number {
  const delay = config.baseDelay * 2 ** attempt;
  return Math.min(delay, config.maxDelay);
}

/**
 * Handle client ready event
 */
async function handleReady(plugin: DiscordPlugin, instanceId: string, client: Client): Promise<void> {
  // Clear reconnection attempts on successful connection
  reconnectAttempts.delete(instanceId);
  connectedInstances.add(instanceId);

  const user = client.user;
  log.info('Discord client ready', {
    instanceId,
    botId: user?.id,
    botTag: user?.tag,
    guilds: client.guilds.cache.size,
  });

  await plugin.handleConnected(instanceId, client);
}

/**
 * Handle client error event
 */
function handleError(plugin: DiscordPlugin, instanceId: string, error: Error): void {
  log.error('Discord client error', { instanceId, error: error.message });
  plugin.handleConnectionError(instanceId, error.message, true);
}

/**
 * Handle client warn event
 */
function handleWarn(_plugin: DiscordPlugin, instanceId: string, message: string): void {
  log.warn('Discord client warning', { instanceId, message });
}

/**
 * Handle shard disconnect event
 */
async function handleDisconnect(
  plugin: DiscordPlugin,
  instanceId: string,
  _closeEvent: unknown,
  config: ReconnectConfig,
  onReconnect: () => Promise<void>,
): Promise<void> {
  const wasConnected = connectedInstances.has(instanceId);
  connectedInstances.delete(instanceId);

  const attempts = reconnectAttempts.get(instanceId) || 0;

  // Only try to reconnect if we were previously connected
  if (!wasConnected) {
    log.info('Discord client disconnected (was not connected)', { instanceId });
    await plugin.handleDisconnected(instanceId, 'Connection failed', false);
    return;
  }

  if (attempts >= config.maxRetries) {
    log.warn('Max reconnection attempts reached', { instanceId, attempts: config.maxRetries });
    reconnectAttempts.delete(instanceId);
    await plugin.handleDisconnected(instanceId, `Max reconnection attempts (${config.maxRetries}) exceeded`, false);
    return;
  }

  // Schedule reconnection
  const delay = getBackoffDelay(attempts, config);
  reconnectAttempts.set(instanceId, attempts + 1);

  log.info('Scheduling reconnection', {
    instanceId,
    attempt: attempts + 1,
    maxAttempts: config.maxRetries,
    delayMs: delay,
  });

  await plugin.handleReconnecting(instanceId, attempts + 1, config.maxRetries);

  setTimeout(async () => {
    try {
      await onReconnect();
    } catch (error) {
      log.error('Reconnection failed', { instanceId, error: error instanceof Error ? error.message : String(error) });
    }
  }, delay);
}

/**
 * Handle shard resume event
 */
function handleResume(_plugin: DiscordPlugin, instanceId: string): void {
  log.info('Discord client resumed', { instanceId });
  // Clear reconnection attempts on successful resume
  reconnectAttempts.delete(instanceId);
  connectedInstances.add(instanceId);
}

/**
 * Handle invalidated event (token invalidated)
 */
async function handleInvalidated(plugin: DiscordPlugin, instanceId: string): Promise<void> {
  log.error('Discord client invalidated (token may be invalid)', { instanceId });
  connectedInstances.delete(instanceId);
  reconnectAttempts.delete(instanceId);
  await plugin.handleDisconnected(instanceId, 'Token invalidated - please reconnect with a valid token', false);
}

/**
 * Set up connection event handlers for a Discord client
 *
 * @param client - Discord.js Client instance
 * @param plugin - Discord plugin instance (for emitting events)
 * @param instanceId - Instance identifier
 * @param onReconnect - Callback to trigger reconnection
 * @param config - Reconnection configuration
 */
export function setupConnectionHandlers(
  client: Client,
  plugin: DiscordPlugin,
  instanceId: string,
  onReconnect: () => Promise<void>,
  config: ReconnectConfig = DEFAULT_RECONNECT_CONFIG,
): void {
  // Ready - bot is connected and ready
  // Note: 'clientReady' replaces deprecated 'ready' event (discord.js v15+)
  client.once('clientReady', async () => {
    await handleReady(plugin, instanceId, client);
  });

  // Error - something went wrong
  client.on('error', (error) => {
    handleError(plugin, instanceId, error);
  });

  // Warn - non-critical warning
  client.on('warn', (message) => {
    handleWarn(plugin, instanceId, message);
  });

  // Shard disconnect - connection lost
  client.on('shardDisconnect', async (closeEvent) => {
    await handleDisconnect(plugin, instanceId, closeEvent, config, onReconnect);
  });

  // Shard resume - connection restored
  client.on('shardResume', () => {
    handleResume(plugin, instanceId);
  });

  // Invalidated - token invalidated, can't reconnect
  client.on('invalidated', async () => {
    await handleInvalidated(plugin, instanceId);
  });

  // Debug - verbose logging (only in development)
  if (process.env.DEBUG_DISCORD === 'true') {
    client.on('debug', (message) => {
      log.debug('Discord debug', { instanceId, message });
    });
  }
}

/**
 * Reset reconnection state for an instance
 */
export function resetReconnectState(instanceId: string): void {
  reconnectAttempts.delete(instanceId);
}

/**
 * Reset all connection state for an instance
 */
export function resetConnectionState(instanceId: string): void {
  reconnectAttempts.delete(instanceId);
  connectedInstances.delete(instanceId);
}

/**
 * Check if an instance is connected
 */
export function isConnected(instanceId: string): boolean {
  return connectedInstances.has(instanceId);
}
