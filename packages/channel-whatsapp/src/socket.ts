/**
 * Baileys Socket Wrapper
 *
 * Provides a clean interface for creating and managing Baileys WASocket instances.
 * Handles socket configuration, lifecycle, and common operations.
 */

import type { AuthenticationState, GroupMetadata, WASocket } from 'baileys';
import { Browsers, fetchLatestBaileysVersion, default as makeWASocket } from 'baileys';
import NodeCache from 'node-cache';
import pino from 'pino';

/**
 * Socket configuration options
 * All options except 'auth' have sensible defaults and can be overridden per-instance
 */
export interface SocketConfig {
  /** Authentication state from storage (required) */
  auth: AuthenticationState;

  // === Display Options ===
  /** Pino logger level (default: 'warn') */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

  // === Connection Options ===
  /** Browser identification [name, browser, version] (default: ['Omni', 'Chrome', '120.0.0']) */
  browser?: [string, string, string];
  /** Mobile flag for web multi-device (default: false) */
  mobile?: boolean;
  /** Connection timeout in ms (default: 20000) */
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

  // === Performance Options ===
  /**
   * Cached group metadata callback — prevents Baileys from fetching group
   * metadata during the encryption transaction (keys.transaction), which
   * holds ev.buffer() open. Without this, a network round-trip inside the
   * buffer can exceed the 30s auto-flush timeout and corrupt socket state.
   */
  cachedGroupMetadata?: (jid: string) => Promise<GroupMetadata | undefined>;

  /**
   * Callback to dynamically ignore JIDs with broken sessions (#70).
   * When true, Baileys ACKs the message but skips decrypt entirely —
   * no transaction, no mutex contention.
   * Note: for groups, jid = group JID (not participant), so this only
   * helps with broken DM sessions, not broken group participants.
   */
  shouldIgnoreJid?: (jid: string) => boolean;
}

/**
 * Default socket configuration values
 */
export const DEFAULT_SOCKET_CONFIG: Omit<Required<SocketConfig>, 'auth' | 'cachedGroupMetadata' | 'shouldIgnoreJid'> = {
  logLevel: 'warn',
  browser: Browsers.ubuntu('Chrome'),
  mobile: false,
  connectTimeoutMs: 20_000,
  // Baileys default (60s). Previously reduced to 15s to cap mutex hold time (#70),
  // but the write-behind cache now eliminates DB blocking inside the mutex entirely.
  defaultQueryTimeoutMs: 60_000,
  keepAliveIntervalMs: 25_000,
  syncFullHistory: false,
  generateHighQualityLinkPreview: true,
  markOnlineOnConnect: true,
};

/**
 * Create a Pino logger for Baileys with newsletter noise filtered out
 */
/** Baileys log messages to suppress (noisy, non-actionable) */
const SUPPRESSED_LOG_PATTERNS = [
  'mex newsletter notification', // raw byte array dumps (Baileys bug in rc.9)
  'Fetching history for chat', // debug spam during sync
  'loading from store', // high-volume debug noise
  'updated cache',
  'caching in transaction',
  'no mutations in transaction',
  'released buffered events',
];

function isAckError479Log(msg: string, inputArgs: unknown[]): boolean {
  if (!msg.includes('received error in ack')) return false;

  for (const arg of inputArgs) {
    if (!arg || typeof arg !== 'object' || !('attrs' in arg)) continue;
    const attrs = (arg as { attrs?: { error?: unknown } }).attrs;
    if (!attrs) continue;
    if (attrs.error === 479 || attrs.error === '479') return true;
  }

  return false;
}

function createLogger(level: string) {
  return pino({
    level,
    hooks: {
      logMethod(inputArgs, method) {
        const msg = inputArgs.find((a): a is string => typeof a === 'string');
        if (!msg) {
          method.apply(this, inputArgs as Parameters<typeof method>);
          return;
        }
        if (isAckError479Log(msg, inputArgs)) return;
        if (SUPPRESSED_LOG_PATTERNS.some((p) => msg.includes(p))) return;
        method.apply(this, inputArgs as Parameters<typeof method>);
      },
    },
  });
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

  // #70: Skip makeCacheableSignalKeyStore — its single cacheMutex serializes ALL
  // key operations through one async-mutex lock. With PostgreSQL-backed storage
  // (vs Ravi's file-based), each operation holds the mutex for a network RTT,
  // causing the transaction commit after group sends to wait indefinitely.
  // Baileys' addTransactionCapability (applied in socket.js:260) already provides
  // per-key mutexes and transaction-level caching, so the extra global mutex is
  // unnecessary and actively harmful with network-backed stores.

  return makeWASocket({
    version,
    logger,
    auth: {
      creds: config.auth.creds,
      keys: config.auth.keys,
    },
    msgRetryCounterCache,
    // Cached group metadata prevents Baileys from fetching group participants
    // during the encryption transaction — avoids 30s buffer timeout. See #70.
    ...(config.cachedGroupMetadata ? { cachedGroupMetadata: config.cachedGroupMetadata } : {}),
    // All options below are configurable per-instance
    // Note: printQRInTerminal is deprecated in Baileys v7 - we handle QR via connection.update event
    mobile: mergedConfig.mobile,
    browser: mergedConfig.browser,
    generateHighQualityLinkPreview: mergedConfig.generateHighQualityLinkPreview,
    syncFullHistory: mergedConfig.syncFullHistory,
    // Baileys ad5ea81 changed the default to filter out FULL syncs.
    // Override to preserve rc.9 behavior and receive all history sync types.
    shouldSyncHistoryMessage: () => true,
    connectTimeoutMs: mergedConfig.connectTimeoutMs,
    defaultQueryTimeoutMs: mergedConfig.defaultQueryTimeoutMs,
    keepAliveIntervalMs: mergedConfig.keepAliveIntervalMs,
    markOnlineOnConnect: mergedConfig.markOnlineOnConnect,
    // Dynamic JID ignore for broken sessions (#70):
    ...(config.shouldIgnoreJid ? { shouldIgnoreJid: config.shouldIgnoreJid } : {}),
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
