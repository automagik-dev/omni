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
 * All options except 'auth' have sensible defaults and can be overridden per-instance
 */
export interface SocketConfig {
  /** Authentication state from storage (required) */
  auth: AuthenticationState;

  // === Display Options ===
  /** Enable QR code terminal output (default: true in dev) */
  printQRInTerminal?: boolean;
  /** Pino logger level (default: 'warn') */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

  // === Connection Options ===
  /** Browser identification [name, browser, version] (default: ['Omni', 'Chrome', '120.0.0']) */
  browser?: [string, string, string];
  /** Mobile flag for web multi-device (default: false) */
  mobile?: boolean;
  /** Connection timeout in ms (default: 60000) */
  connectTimeoutMs?: number;
  /** Default query timeout in ms (default: 60000) */
  defaultQueryTimeoutMs?: number;
  /** Keep alive interval in ms (default: 25000) */
  keepAliveIntervalMs?: number;

  // === Sync Options ===
  /** Sync full message history on connect (default: true) */
  syncFullHistory?: boolean;
  /** Generate high quality link previews (default: true) */
  generateHighQualityLinkPreview?: boolean;
  /** Mark messages as online when sending read receipts (default: true) */
  markOnlineOnConnect?: boolean;
}

/**
 * Default socket configuration values
 */
export const DEFAULT_SOCKET_CONFIG: Omit<Required<SocketConfig>, 'auth'> = {
  printQRInTerminal: true,
  logLevel: 'warn',
  browser: ['Omni', 'Chrome', '120.0.0'],
  mobile: false,
  connectTimeoutMs: 60_000,
  defaultQueryTimeoutMs: 60_000,
  keepAliveIntervalMs: 25_000,
  syncFullHistory: true,
  generateHighQualityLinkPreview: true,
  markOnlineOnConnect: true,
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
 * @param config - Socket configuration (auth required, others have defaults)
 * @returns Configured WASocket instance
 */
export async function createSocket(config: SocketConfig): Promise<WASocket> {
  // Merge with defaults - user config takes precedence
  const mergedConfig = { ...DEFAULT_SOCKET_CONFIG, ...config };
  const logger = createLogger(mergedConfig.logLevel);

  // Get latest Baileys version for compatibility
  const { version } = await fetchLatestBaileysVersion();

  // Create message retry counter cache
  const msgRetryCounterCache = new NodeCache();

  // Wrap keys with caching layer
  const wrappedKeys = makeCacheableSignalKeyStore(config.auth.keys, logger);

  return makeWASocket({
    version,
    logger,
    auth: {
      creds: config.auth.creds,
      keys: wrappedKeys,
    },
    msgRetryCounterCache,
    // All options below are configurable per-instance
    printQRInTerminal: mergedConfig.printQRInTerminal,
    mobile: mergedConfig.mobile,
    browser: mergedConfig.browser,
    generateHighQualityLinkPreview: mergedConfig.generateHighQualityLinkPreview,
    syncFullHistory: mergedConfig.syncFullHistory,
    connectTimeoutMs: mergedConfig.connectTimeoutMs,
    defaultQueryTimeoutMs: mergedConfig.defaultQueryTimeoutMs,
    keepAliveIntervalMs: mergedConfig.keepAliveIntervalMs,
    markOnlineOnConnect: mergedConfig.markOnlineOnConnect,
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
