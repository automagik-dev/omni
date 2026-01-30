/**
 * Baileys Socket Wrapper
 *
 * Provides a clean interface for creating and managing Baileys WASocket instances.
 * Handles socket configuration, lifecycle, and common operations.
 */

import type { AuthenticationState, WASocket } from '@whiskeysockets/baileys';
// Use default import with fallback for different module systems
import baiLeysModule from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import pino from 'pino';

// Extract exports with fallback for different bundlers/runtimes
const makeWASocket = (baiLeysModule as any).default || (baiLeysModule as any).makeWASocket;
const { fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = baiLeysModule as any;

/**
 * Socket configuration options
 */
export interface SocketConfig {
  /** Authentication state from storage */
  auth: AuthenticationState;
  /** Enable QR code terminal output (development only) */
  printQRInTerminal?: boolean;
  /** Pino logger level */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  /** Browser identification [name, browser, version] */
  browser?: [string, string, string];
  /** Mobile flag for web multi-device */
  mobile?: boolean;
}

/**
 * Default socket configuration
 */
const DEFAULT_CONFIG: Partial<SocketConfig> = {
  printQRInTerminal: true,
  logLevel: 'debug',
  browser: ['Omni', 'Chrome', '120.0.0'],
  mobile: false,
};

/**
 * Create a Pino logger for Baileys
 */
function createLogger(level: string) {
  return pino({ level });
}

/**
 * Create a new Baileys WASocket with the given configuration
 *
 * @param config - Socket configuration
 * @returns Configured WASocket instance
 */
export async function createSocket(config: SocketConfig): Promise<WASocket> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const logger = createLogger(mergedConfig.logLevel || 'warn');

  // Get latest Baileys version for compatibility
  const { version } = await fetchLatestBaileysVersion();

  // Create message retry counter cache
  const msgRetryCounterCache = new NodeCache();

  // Wrap keys with caching layer
  const wrappedKeys = makeCacheableSignalKeyStore(mergedConfig.auth.keys, logger);

  return makeWASocket({
    version,
    logger,
    auth: {
      creds: mergedConfig.auth.creds,
      keys: wrappedKeys,
    },
    msgRetryCounterCache,
    printQRInTerminal: mergedConfig.printQRInTerminal,
    mobile: mergedConfig.mobile,
    browser: mergedConfig.browser,
    generateHighQualityLinkPreview: true,
    // Fix for "Stream Errored (conflict)" - https://github.com/WhiskeySockets/Baileys/issues/2094
    syncFullHistory: false,
    // Increase timeouts to prevent premature disconnects
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    // Keep connection alive
    keepAliveIntervalMs: 25_000,
  });
}

/**
 * Gracefully close a socket connection
 *
 * @param sock - WASocket to close
 * @param logout - Whether to logout before closing
 */
export async function closeSocket(sock: WASocket, logout = false): Promise<void> {
  if (logout) {
    try {
      await sock.logout();
    } catch {
      // Ignore logout errors - socket might already be closed
    }
  }

  sock.end(undefined);
}

/**
 * Check if a socket is connected
 *
 * @param sock - WASocket to check
 * @returns True if socket has a user (connected)
 */
export function isSocketConnected(sock: WASocket): boolean {
  return !!sock.user;
}

/**
 * Get the authenticated user JID from a socket
 *
 * @param sock - WASocket
 * @returns User JID or undefined if not connected
 */
export function getSocketUser(sock: WASocket): string | undefined {
  return sock.user?.id;
}

/**
 * Get the authenticated user name from a socket
 *
 * @param sock - WASocket
 * @returns User name or undefined if not connected
 */
export function getSocketUserName(sock: WASocket): string | undefined {
  return sock.user?.name;
}

/**
 * Socket manager for handling multiple socket instances
 */
export class SocketManager {
  private sockets = new Map<string, WASocket>();

  /**
   * Create and store a socket for an instance
   */
  async create(instanceId: string, config: SocketConfig): Promise<WASocket> {
    const sock = await createSocket(config);
    this.sockets.set(instanceId, sock);
    return sock;
  }

  /**
   * Get a socket by instance ID
   */
  get(instanceId: string): WASocket | undefined {
    return this.sockets.get(instanceId);
  }

  /**
   * Check if an instance has a socket
   */
  has(instanceId: string): boolean {
    return this.sockets.has(instanceId);
  }

  /**
   * Remove a socket from management (does not close it)
   */
  remove(instanceId: string): boolean {
    return this.sockets.delete(instanceId);
  }

  /**
   * Close and remove a socket
   */
  async close(instanceId: string, logout = false): Promise<void> {
    const sock = this.sockets.get(instanceId);
    if (sock) {
      await closeSocket(sock, logout);
      this.sockets.delete(instanceId);
    }
  }

  /**
   * Close all sockets
   */
  async closeAll(logout = false): Promise<void> {
    const closePromises = Array.from(this.sockets.entries()).map(async ([id, sock]) => {
      await closeSocket(sock, logout);
      this.sockets.delete(id);
    });
    await Promise.all(closePromises);
  }

  /**
   * Get all instance IDs
   */
  getInstanceIds(): string[] {
    return Array.from(this.sockets.keys());
  }

  /**
   * Get the number of active sockets
   */
  get size(): number {
    return this.sockets.size;
  }
}
