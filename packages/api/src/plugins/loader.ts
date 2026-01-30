/**
 * Channel plugin loader
 *
 * Discovers and loads channel plugins from the packages directory.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ChannelPlugin,
  type ChannelRegistry,
  type DiscoveryResult,
  discoverAndRegisterPlugins,
} from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';

import { createPluginContext } from './context';
import { createLogger } from './logger';
import { setStorageDatabase } from './storage';

const logger = createLogger({ module: 'plugin-loader' });

/**
 * Find the monorepo root by walking up until we find turbo.json
 */
function findMonorepoRoot(startDir: string): string | null {
  let current = startDir;
  const root = dirname(current);

  while (current !== root) {
    if (existsSync(join(current, 'turbo.json'))) {
      return current;
    }
    current = dirname(current);
  }

  return null;
}

/**
 * Get the monorepo packages directory
 */
function getMonorepoPackagesDir(): string {
  // Try strategies in order of reliability:
  // 1. Environment variable (explicit)
  // 2. Current working directory (most reliable in practice)
  // 3. Module location (fallback)

  // Strategy 1: Check environment variable
  if (process.env.OMNI_PACKAGES_DIR) {
    return process.env.OMNI_PACKAGES_DIR;
  }

  // Strategy 2: Walk up from current working directory (prefer this)
  let monorepoRoot = findMonorepoRoot(process.cwd());

  // Strategy 3: Walk up from module location (fallback)
  if (!monorepoRoot) {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    monorepoRoot = findMonorepoRoot(moduleDir);
  }

  if (!monorepoRoot) {
    throw new Error(
      'Could not find monorepo root (no turbo.json found). ' +
        'Ensure you run from repo root or set OMNI_PACKAGES_DIR env var.',
    );
  }

  return join(monorepoRoot, 'packages');
}

export interface LoadPluginsOptions {
  /** Directory containing channel-* packages */
  packagesDir?: string;
  /** Event bus for plugins */
  eventBus: EventBus;
  /** Database connection */
  db: Database;
}

export interface LoadPluginsResult {
  /** The registry with loaded plugins */
  registry: ChannelRegistry;
  /** Number of plugins successfully loaded */
  loaded: number;
  /** Number of plugins that failed to load */
  failed: number;
  /** Plugin IDs that were loaded */
  pluginIds: string[];
}

/**
 * Load and initialize all channel plugins
 */
export async function loadChannelPlugins(options: LoadPluginsOptions): Promise<LoadPluginsResult> {
  const { packagesDir = getMonorepoPackagesDir(), eventBus, db } = options;

  // Set database for persistent storage BEFORE creating plugin contexts
  setStorageDatabase(db);

  logger.info('Starting channel plugin discovery', { packagesDir });

  // Discover and register plugins
  const discoveryResult: DiscoveryResult = await discoverAndRegisterPlugins({
    packagesDir,
    logger,
  });

  logger.info('Plugin discovery complete', {
    discovered: discoveryResult.discovered,
    registered: discoveryResult.registered.length,
    failed: discoveryResult.failed.length,
  });

  // Log failures
  for (const failure of discoveryResult.failed) {
    logger.error('Failed to load plugin', { path: failure.path, error: failure.error });
  }

  // Import the singleton registry from channel-sdk
  const { channelRegistry } = await import('@omni/channel-sdk');

  // Initialize all registered plugins with context
  for (const plugin of discoveryResult.registered) {
    try {
      const context = createPluginContext({
        pluginId: plugin.id,
        eventBus,
        db,
      });

      await channelRegistry.initialize(plugin.id, context);
      logger.info(`Initialized channel: ${plugin.id}`, { name: plugin.name, version: plugin.version });
    } catch (error) {
      logger.error(`Failed to initialize channel: ${plugin.id}`, { error: String(error) });
    }
  }

  return {
    registry: channelRegistry,
    loaded: discoveryResult.registered.length,
    failed: discoveryResult.failed.length,
    pluginIds: discoveryResult.registered.map((p) => p.id),
  };
}

/**
 * Get a plugin by ID from the global registry
 */
export async function getPlugin(id: string): Promise<ChannelPlugin | undefined> {
  const { channelRegistry } = await import('@omni/channel-sdk');
  return channelRegistry.get(id as Parameters<typeof channelRegistry.get>[0]);
}

/**
 * Get all loaded plugins from the global registry
 */
export async function getAllPlugins(): Promise<ChannelPlugin[]> {
  const { channelRegistry } = await import('@omni/channel-sdk');
  return channelRegistry.getAll();
}

/**
 * Auto-reconnect previously active instances on startup
 *
 * Queries the database for instances with isActive=true and reconnects them.
 */
export async function autoReconnectInstances(db: Database): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  const { instances } = await import('@omni/db');
  const { eq } = await import('drizzle-orm');
  const { channelRegistry } = await import('@omni/channel-sdk');

  // Find all active instances
  const activeInstances = await db.select().from(instances).where(eq(instances.isActive, true));

  logger.info('Auto-reconnecting instances', { count: activeInstances.length });

  let succeeded = 0;
  let failed = 0;

  for (const instance of activeInstances) {
    try {
      const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
      if (!plugin) {
        logger.warn('No plugin found for instance channel', { instanceId: instance.id, channel: instance.channel });
        failed++;
        continue;
      }

      // Reconnect the instance (uses stored auth state from database)
      await plugin.connect(instance.id, {
        instanceId: instance.id,
        credentials: {}, // Auth state loaded from database storage
        options: {},
      });

      logger.info('Reconnected instance', { instanceId: instance.id, name: instance.name });
      succeeded++;
    } catch (error) {
      logger.error('Failed to reconnect instance', {
        instanceId: instance.id,
        name: instance.name,
        error: String(error),
      });

      // Mark instance as inactive since reconnection failed
      await db.update(instances).set({ isActive: false }).where(eq(instances.id, instance.id));
      failed++;
    }
  }

  return {
    attempted: activeInstances.length,
    succeeded,
    failed,
  };
}
