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
 * Track QR code generation attempts per instance
 * Only counts QR codes that expire without being scanned (not connection errors)
 * After MAX_QR_ATTEMPTS expired QRs, we clear auth state and start fresh
 */
const qrCodeAttempts = new Map<string, number>();
const MAX_QR_ATTEMPTS = 3;

/**
 * Track if current QR has been displayed (for expiry counting)
 * We only increment QR counter when a displayed QR expires
 */
const activeQrCodes = new Map<string, { code: string; displayedAt: number }>();

/**
 * Track connection timeouts per instance
 * If QR is scanned but connection hangs, we detect it
 */
const connectionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const CONNECTION_TIMEOUT_MS = 45_000; // 45 seconds after QR to connect

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, config: ReconnectConfig): number {
  const delay = config.baseDelay * 2 ** attempt;
  return Math.min(delay, config.maxDelay);
}

/**
 * Handle QR code event
 * Tracks QR attempts and triggers auth state reset after MAX_QR_ATTEMPTS expired QRs
 *
 * @returns true if this QR should be used, false if auth was cleared (will reconnect)
 */
async function handleQrCode(
  plugin: WhatsAppPlugin,
  instanceId: string,
  qr: string,
  clearAuthAndReconnect: () => Promise<void>,
): Promise<boolean> {
  // Check if previous QR expired (new QR received = previous one expired or wasn't scanned)
  const previousQr = activeQrCodes.get(instanceId);
  if (previousQr) {
    // Previous QR existed and now we got a new one = it expired/failed
    const attempts = (qrCodeAttempts.get(instanceId) || 0) + 1;
    qrCodeAttempts.set(instanceId, attempts);
    console.log(`[WhatsApp] QR code expired, attempt ${attempts}/${MAX_QR_ATTEMPTS} for instance ${instanceId}`);
  } else {
    // First QR code for this connection attempt
    console.log(`[WhatsApp] QR code generated for instance ${instanceId}`);
  }

  // Track this QR as active
  activeQrCodes.set(instanceId, { code: qr, displayedAt: Date.now() });

  const attempts = qrCodeAttempts.get(instanceId) || 0;

  // Check if we've exceeded max attempts
  if (attempts >= MAX_QR_ATTEMPTS) {
    console.log(`[WhatsApp] Max QR attempts reached for ${instanceId}, clearing auth state and restarting...`);
    qrCodeAttempts.delete(instanceId);
    clearConnectionTimeout(instanceId);

    // Clear auth and reconnect fresh
    await clearAuthAndReconnect();
    return false;
  }

  // Emit QR code
  const expiresAt = new Date(Date.now() + 60 * 1000);
  await plugin.handleQrCode(instanceId, qr, expiresAt);

  // Set connection timeout - if not connected within timeout, something is wrong
  setConnectionTimeout(instanceId, plugin, clearAuthAndReconnect);

  return true;
}

/**
 * Set a timeout to detect hung connections after QR scan
 */
function setConnectionTimeout(
  instanceId: string,
  plugin: WhatsAppPlugin,
  clearAuthAndReconnect: () => Promise<void>,
): void {
  // Clear existing timeout
  clearConnectionTimeout(instanceId);

  const timeout = setTimeout(async () => {
    const attempts = qrCodeAttempts.get(instanceId) || 0;
    if (attempts > 0) {
      console.log(`[WhatsApp] Connection timeout for ${instanceId} after QR scan, will generate new QR...`);
      // Don't clear auth yet, just let it retry with a new QR
    }
  }, CONNECTION_TIMEOUT_MS);

  connectionTimeouts.set(instanceId, timeout);
}

/**
 * Clear connection timeout for an instance
 */
function clearConnectionTimeout(instanceId: string): void {
  const timeout = connectionTimeouts.get(instanceId);
  if (timeout) {
    clearTimeout(timeout);
    connectionTimeouts.delete(instanceId);
  }
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

  // Clear active QR - connection error is NOT a QR expiry
  // This prevents counting connection errors as QR failures
  activeQrCodes.delete(instanceId);

  if (!shouldReconnect) {
    reconnectAttempts.delete(instanceId);
    qrCodeAttempts.delete(instanceId);
    await plugin.handleDisconnected(instanceId, 'Logged out from WhatsApp', false);
    return;
  }

  const attempts = reconnectAttempts.get(instanceId) || 0;

  if (attempts >= config.maxRetries) {
    reconnectAttempts.delete(instanceId);
    qrCodeAttempts.delete(instanceId);
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
  // Clear all tracking state on successful connection
  reconnectAttempts.delete(instanceId);
  qrCodeAttempts.delete(instanceId);
  activeQrCodes.delete(instanceId);
  clearConnectionTimeout(instanceId);

  console.log(`[WhatsApp] Connection opened for ${instanceId}`);
  await plugin.handleConnected(instanceId, sock);
}

/**
 * Set up connection event handlers for a Baileys socket
 *
 * @param sock - Baileys WASocket instance
 * @param plugin - WhatsApp plugin instance (for emitting events)
 * @param instanceId - Instance identifier
 * @param onReconnect - Callback to trigger reconnection
 * @param clearAuthAndReconnect - Callback to clear auth state and reconnect fresh
 */
export function setupConnectionHandlers(
  sock: WASocket,
  plugin: WhatsAppPlugin,
  instanceId: string,
  onReconnect: () => Promise<void>,
  clearAuthAndReconnect: () => Promise<void>,
  config: ReconnectConfig = DEFAULT_RECONNECT_CONFIG,
): void {
  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const shouldContinue = await handleQrCode(plugin, instanceId, qr, clearAuthAndReconnect);
      if (!shouldContinue) {
        // Auth was cleared and reconnect triggered, socket will be replaced
        return;
      }
    }

    if (connection === 'close') {
      clearConnectionTimeout(instanceId);
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

/**
 * Reset all connection tracking state for an instance
 * Call this when manually disconnecting or logging out
 */
export function resetConnectionState(instanceId: string): void {
  reconnectAttempts.delete(instanceId);
  qrCodeAttempts.delete(instanceId);
  activeQrCodes.delete(instanceId);
  clearConnectionTimeout(instanceId);
}

/**
 * Get current QR attempt count for an instance
 */
export function getQrAttemptCount(instanceId: string): number {
  return qrCodeAttempts.get(instanceId) || 0;
}
