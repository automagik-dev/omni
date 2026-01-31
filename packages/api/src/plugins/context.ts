/**
 * Plugin context factory
 *
 * Creates the PluginContext required by channel plugins during initialization.
 */

import type { PluginContext, PluginDatabase } from '@omni/channel-sdk';
import { type EventBus, createLogger } from '@omni/core';
import type { Database } from '@omni/db';

import { createPluginLogger } from './logger';
import { getPluginStorage } from './storage';

const log = createLogger('api:plugin-context');

/**
 * Create a plugin database adapter
 */
function createPluginDatabase(db: Database): PluginDatabase {
  return {
    async execute<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
      // Note: This is a simplified implementation
      // Drizzle doesn't have a direct execute method for raw SQL
      // Plugins should use getDrizzle() for queries
      log.warn('PluginDatabase execute() is not implemented. Use getDrizzle() for queries.');
      return [];
    },
    getDrizzle(): unknown {
      return db;
    },
  };
}

export interface CreatePluginContextOptions {
  /** The plugin ID for scoped storage/logging */
  pluginId: string;
  /** Event bus for publishing/subscribing */
  eventBus: EventBus;
  /** Database connection */
  db: Database;
}

/**
 * Create a PluginContext for a channel plugin
 */
export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
  const { pluginId, eventBus, db } = options;

  const env = (process.env.NODE_ENV ?? 'development') as 'development' | 'staging' | 'production';
  const apiPort = process.env.API_PORT ?? '8881';
  const apiHost = process.env.API_HOST ?? 'localhost';

  return {
    eventBus,
    storage: getPluginStorage(pluginId),
    logger: createPluginLogger(pluginId),
    config: {
      env,
      apiBaseUrl: `http://${apiHost}:${apiPort}`,
      webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? `http://${apiHost}:${apiPort}/webhooks`,
      mediaStorage: {
        type: 'local',
        basePath: process.env.MEDIA_STORAGE_PATH ?? './data/media',
      },
    },
    db: createPluginDatabase(db),
  };
}
