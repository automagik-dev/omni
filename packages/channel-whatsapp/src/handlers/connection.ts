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
  // Connection update handler
  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    // QR code generated - emit for client to display
    if (qr) {
      // QR codes typically expire after 60 seconds
      const expiresAt = new Date(Date.now() + 60 * 1000);
      await plugin.handleQrCode(instanceId, qr, expiresAt);
    }

    // Connection state changed
    if (connection === 'close') {
      const error = lastDisconnect?.error as Boom | undefined;
      const statusCode = error?.output?.statusCode;
      const reason = error?.output?.payload?.message || 'Unknown error';

      // Determine if we should reconnect
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        const attempts = reconnectAttempts.get(instanceId) || 0;

        if (attempts < config.maxRetries) {
          // Schedule reconnection with exponential backoff
          const delay = getBackoffDelay(attempts, config);
          reconnectAttempts.set(instanceId, attempts + 1);

          await plugin.handleReconnecting(instanceId, attempts + 1, config.maxRetries);

          setTimeout(async () => {
            try {
              await onReconnect();
            } catch (reconnectError) {
              // Reconnection failed - will be handled by next connection.update
              plugin.handleConnectionError(
                instanceId,
                reconnectError instanceof Error ? reconnectError.message : 'Reconnection failed',
                true,
              );
            }
          }, delay);
        } else {
          // Max retries exceeded - give up
          reconnectAttempts.delete(instanceId);
          await plugin.handleDisconnected(
            instanceId,
            `Max reconnection attempts (${config.maxRetries}) exceeded: ${reason}`,
            false,
          );
        }
      } else {
        // Logged out - don't reconnect
        reconnectAttempts.delete(instanceId);
        await plugin.handleDisconnected(instanceId, 'Logged out from WhatsApp', false);
      }
    }

    if (connection === 'open') {
      // Successfully connected - reset reconnect counter
      reconnectAttempts.delete(instanceId);
      await plugin.handleConnected(instanceId, sock);
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
