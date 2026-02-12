/**
 * Connection event handlers for Baileys socket
 *
 * Handles connection lifecycle:
 * - QR code generation and emission
 * - Authentication success/failure
 * - Disconnection and reconnection
 */

import type { Boom } from '@hapi/boom';
import { createLogger } from '@omni/core';
import type { ConnectionState, WASocket } from '@whiskeysockets/baileys';
import { DisconnectReason } from '@whiskeysockets/baileys';
import type { WhatsAppPlugin } from '../plugin';

const log = createLogger('whatsapp:connection');

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
 * Track QR code generation attempts per instance (within a cycle)
 * Only counts QR codes that expire without being scanned (not connection errors)
 * After MAX_QR_ATTEMPTS expired QRs, we clear auth state and start fresh
 */
const qrCodeAttempts = new Map<string, number>();
const MAX_QR_ATTEMPTS = 3;

/**
 * Track how many "clear auth and restart" cycles we've done
 * After MAX_QR_CYCLES, we STOP completely to prevent infinite loops and OOM
 */
const qrCycleAttempts = new Map<string, number>();
const MAX_QR_CYCLES = 2; // 2 cycles = 6 total QR codes before giving up

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
 * Track if instance has ever been authenticated (had successful connection)
 * If not authenticated, we DON'T auto-reconnect on errors - user needs to scan QR
 *
 * NOTE: This is populated at startup via seedAuthenticated() using ownerIdentifier
 * from the database. Without this, every PM2 restart would treat all instances as
 * "never authenticated", causing them to refuse auto-reconnect on the first
 * disconnect and instead follow the QR-scan path — leading to rapid
 * disconnect→reconnect churn that WhatsApp flags as bot activity.
 */
const authenticatedInstances = new Set<string>();

/**
 * Seed the authenticated set from DB at startup.
 * Call this ONCE during plugin initialization for every instance
 * that has a non-null ownerIdentifier (i.e., was previously paired).
 * This prevents the "auth handshake" false path after PM2 restarts.
 */
export function seedAuthenticated(instanceId: string): void {
  authenticatedInstances.add(instanceId);
}

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
    log.info('QR code expired', { instanceId, attempts, maxAttempts: MAX_QR_ATTEMPTS });
  } else {
    // First QR code for this connection attempt
    log.info('QR code generated', { instanceId });
  }

  // Track this QR as active
  activeQrCodes.set(instanceId, { code: qr, displayedAt: Date.now() });

  const attempts = qrCodeAttempts.get(instanceId) || 0;

  // Check if we've exceeded max attempts within this cycle
  if (attempts >= MAX_QR_ATTEMPTS) {
    const cycles = (qrCycleAttempts.get(instanceId) || 0) + 1;
    qrCycleAttempts.set(instanceId, cycles);

    // Check if we've exceeded max cycles - STOP completely
    if (cycles >= MAX_QR_CYCLES) {
      log.warn('Max QR cycles reached, stopping', {
        instanceId,
        maxCycles: MAX_QR_CYCLES,
        totalExpired: cycles * MAX_QR_ATTEMPTS,
      });
      qrCodeAttempts.delete(instanceId);
      qrCycleAttempts.delete(instanceId);
      activeQrCodes.delete(instanceId);
      clearConnectionTimeout(instanceId);

      // Notify plugin - DO NOT reconnect
      await plugin.handleDisconnected(
        instanceId,
        'QR code expired too many times. Please manually reconnect when ready to scan.',
        false,
      );
      return false;
    }

    log.info('QR cycle complete, clearing auth and retrying', { instanceId, cycle: cycles, maxCycles: MAX_QR_CYCLES });
    qrCodeAttempts.delete(instanceId);
    clearConnectionTimeout(instanceId);

    // Clear auth and reconnect fresh - but only if we haven't hit max cycles
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
  _plugin: WhatsAppPlugin,
  _clearAuthAndReconnect: () => Promise<void>,
): void {
  // Clear existing timeout
  clearConnectionTimeout(instanceId);

  const timeout = setTimeout(async () => {
    const attempts = qrCodeAttempts.get(instanceId) || 0;
    if (attempts > 0) {
      log.info('Connection timeout after QR scan, will generate new QR', { instanceId });
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
  const wasLoggedOut = statusCode === DisconnectReason.loggedOut;

  // DEBUG: Log all disconnect events to diagnose reconnect loop
  log.info('Connection closed', {
    instanceId,
    statusCode,
    reason,
    wasLoggedOut,
    errorMessage: error?.message,
  });

  // Clear active QR - connection error is NOT a QR expiry
  activeQrCodes.delete(instanceId);

  // If logged out, clear everything
  if (wasLoggedOut) {
    reconnectAttempts.delete(instanceId);
    qrCodeAttempts.delete(instanceId);
    qrCycleAttempts.delete(instanceId);
    authenticatedInstances.delete(instanceId);
    await plugin.handleDisconnected(instanceId, 'Logged out from WhatsApp', false);
    return;
  }

  // Check if this instance was ever authenticated
  const wasAuthenticated = authenticatedInstances.has(instanceId);
  const attempts = reconnectAttempts.get(instanceId) || 0;

  // If NEVER authenticated, allow ONE reconnect attempt
  // This is because after QR scan, WhatsApp sends a 515 forcing a reconnect
  // to complete the auth handshake - this is documented Baileys behavior
  if (!wasAuthenticated) {
    if (attempts >= 1) {
      // Already tried once after QR scan, stop now
      log.warn('Connection failed after QR scan', { instanceId, reason });
      log.info('Please try scanning QR again');
      reconnectAttempts.delete(instanceId);
      await plugin.handleDisconnected(instanceId, `Connection closed: ${reason}. Please reconnect manually.`, false);
      return;
    }

    // First 515 after QR - this is the auth handshake, allow ONE reconnect
    // IMPORTANT: Wait 2 seconds before reconnecting to allow credentials to be saved
    // The 515 often fires before creds.update finishes saving
    log.info('Auth handshake, waiting for credentials to save', { instanceId });
    reconnectAttempts.set(instanceId, 1);

    setTimeout(async () => {
      log.info('Reconnecting to complete authentication', { instanceId });
      try {
        await onReconnect();
      } catch (reconnectError) {
        plugin.handleConnectionError(
          instanceId,
          reconnectError instanceof Error ? reconnectError.message : 'Auth handshake reconnection failed',
          false,
        );
      }
    }, 2000);
    return;
  }

  // Instance WAS authenticated before - try to auto-reconnect

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
  qrCycleAttempts.delete(instanceId);
  activeQrCodes.delete(instanceId);
  clearConnectionTimeout(instanceId);

  // Mark as authenticated - now we CAN auto-reconnect if disconnected later
  authenticatedInstances.add(instanceId);

  log.info('Connection opened', { instanceId });
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
  qrCycleAttempts.delete(instanceId);
  activeQrCodes.delete(instanceId);
  authenticatedInstances.delete(instanceId);
  clearConnectionTimeout(instanceId);
}

/**
 * Get current QR attempt count for an instance
 */
export function getQrAttemptCount(instanceId: string): number {
  return qrCodeAttempts.get(instanceId) || 0;
}
