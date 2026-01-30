/**
 * Connection event handlers for Baileys socket
 *
 * Handles connection lifecycle:
 * - QR code generation and emission
 * - Authentication success/failure
 * - Disconnection and reconnection
 */

import type { Boom } from '@hapi/boom';
import type { ConnectionState, WASocket } from '@whiskeysockets/baileys';
import { DisconnectReason } from '@whiskeysockets/baileys';
import type { WhatsAppPlugin } from '../plugin';

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
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, config: ReconnectConfig): number {
  const delay = config.baseDelay * 2 ** attempt;
  return Math.min(delay, config.maxDelay);
}

/**
 * Handle QR code event
 */
async function handleQrCode(plugin: WhatsAppPlugin, instanceId: string, qr: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 60 * 1000);
  await plugin.handleQrCode(instanceId, qr, expiresAt);
}

/**
 * Schedule a reconnection attempt with backoff
 */
function scheduleReconnect(
  plugin: WhatsAppPlugin,
  instanceId: string,
  attempt: number,
  config: ReconnectConfig,
  onReconnect: () => Promise<void>,
): void {
  const delay = getBackoffDelay(attempt, config);

  setTimeout(async () => {
    try {
      await onReconnect();
    } catch (reconnectError) {
      plugin.handleConnectionError(
        instanceId,
        reconnectError instanceof Error ? reconnectError.message : 'Reconnection failed',
        true,
      );
    }
  }, delay);
}

/**
 * Handle connection close event
 */
async function handleConnectionClose(
  plugin: WhatsAppPlugin,
  instanceId: string,
  lastDisconnect: { error?: Error } | undefined,
  config: ReconnectConfig,
  onReconnect: () => Promise<void>,
): Promise<void> {
  const error = lastDisconnect?.error as Boom | undefined;
  const statusCode = error?.output?.statusCode;
  const reason = error?.output?.payload?.message || 'Unknown error';
  const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

  if (!shouldReconnect) {
    reconnectAttempts.delete(instanceId);
    await plugin.handleDisconnected(instanceId, 'Logged out from WhatsApp', false);
    return;
  }

  const attempts = reconnectAttempts.get(instanceId) || 0;

  if (attempts >= config.maxRetries) {
    reconnectAttempts.delete(instanceId);
    await plugin.handleDisconnected(
      instanceId,
      `Max reconnection attempts (${config.maxRetries}) exceeded: ${reason}`,
      false,
    );
    return;
  }

  reconnectAttempts.set(instanceId, attempts + 1);
  await plugin.handleReconnecting(instanceId, attempts + 1, config.maxRetries);
  scheduleReconnect(plugin, instanceId, attempts, config, onReconnect);
}

/**
 * Handle connection open event
 */
async function handleConnectionOpen(plugin: WhatsAppPlugin, instanceId: string, sock: WASocket): Promise<void> {
  reconnectAttempts.delete(instanceId);
  await plugin.handleConnected(instanceId, sock);
}

/**
 * Set up connection event handlers for a Baileys socket
 *
 * @param sock - Baileys WASocket instance
 * @param plugin - WhatsApp plugin instance (for emitting events)
 * @param instanceId - Instance identifier
 * @param onReconnect - Callback to trigger reconnection
 */
export function setupConnectionHandlers(
  sock: WASocket,
  plugin: WhatsAppPlugin,
  instanceId: string,
  onReconnect: () => Promise<void>,
  config: ReconnectConfig = DEFAULT_RECONNECT_CONFIG,
): void {
  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      await handleQrCode(plugin, instanceId, qr);
    }

    if (connection === 'close') {
      await handleConnectionClose(plugin, instanceId, lastDisconnect, config, onReconnect);
    }

    if (connection === 'open') {
      await handleConnectionOpen(plugin, instanceId, sock);
    }
  });
}

/**
 * Reset reconnection attempts for an instance
 * Call this when manually disconnecting
 */
export function resetReconnectAttempts(instanceId: string): void {
  reconnectAttempts.delete(instanceId);
}
