/**
 * Channel plugin loader
 *
 * Discovers and loads channel plugins from the packages directory.
 */

import { dirname, resolve } from 'node:path';
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

const logger = createLogger({ module: 'plugin-loader' });

/**
 * Get the monorepo packages directory
 * Resolves from the API package location to the monorepo root packages/
 */
function getMonorepoPackagesDir(): string {
  // This file is at packages/api/src/plugins/loader.ts
  // Going up: plugins -> src -> api -> packages
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '..', '..', '..');
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
