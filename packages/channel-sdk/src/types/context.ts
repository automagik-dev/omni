/**
 * Plugin context - dependencies provided to channels during initialization
 */

import type { EventBus } from '@omni/core/events';

/**
 * Logger interface for channel plugins
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;

  /** Create a child logger with additional context */
  child(context: Record<string, unknown>): Logger;
}

/**
 * Plugin storage interface for persisting channel-specific data
 */
export interface PluginStorage {
  /**
   * Get a value from storage
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in storage
   */
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;

  /**
   * Delete a value from storage
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * List keys matching a pattern
   */
  keys(pattern?: string): Promise<string[]>;
}

/**
 * Global configuration available to plugins
 */
export interface GlobalConfig {
  /** Environment: development, staging, production */
  env: 'development' | 'staging' | 'production';

  /** Base URL for the API */
  apiBaseUrl: string;

  /** Base URL for webhooks */
  webhookBaseUrl: string;

  /** Media storage configuration */
  mediaStorage: {
    type: 'local' | 's3';
    basePath: string;
  };
}

/**
 * Database interface for plugins
 * Provides scoped access to plugin-specific tables
 */
export interface PluginDatabase {
  /**
   * Execute a raw SQL query (use with caution)
   */
  execute<T>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Get the Drizzle database instance for type-safe queries
   * Note: Channels should primarily use storage, not direct DB access
   */
  getDrizzle(): unknown;
}

/**
 * Ingress idempotency claim for inbound messages (#1032, parity with the
 * webhook path from #958). The host claims the key by inserting the journal
 * row BEFORE the plugin publishes; the `omni_events.idempotency_key` unique
 * index is the dedup authority. A duplicate claim returns null and the
 * publish is skipped, so a double-fired channel handler or a platform
 * redelivery cannot fan the same message out twice.
 */
export type ClaimedEventType = 'message.received' | 'reaction.received' | 'reaction.removed';

export interface IngressClaim {
  /** Returns the claimed event id, or null when the key is already journaled. */
  claim(params: {
    idempotencyKey: string;
    instanceId: string;
    channelType: string;
    externalId: string;
    /** Journal row type for the skeleton row; defaults to `message.received`. */
    eventType?: ClaimedEventType;
  }): Promise<string | null>;
  /** Release a claim whose publish failed, so the retry is not a "duplicate". */
  release(eventId: string): Promise<void>;
}

/**
 * Context provided to channel plugins during initialization
 */
export interface PluginContext {
  /** Event bus for publishing/subscribing to events */
  eventBus: EventBus;

  /** Scoped storage for plugin data */
  storage: PluginStorage;

  /** Logger with plugin context */
  logger: Logger;

  /** Global configuration */
  config: GlobalConfig;

  /** Database access (use sparingly - prefer storage) */
  db: PluginDatabase;

  /** Optional inbound-message idempotency claim (#1032); absent = no dedup. */
  ingressClaim?: IngressClaim;
}
