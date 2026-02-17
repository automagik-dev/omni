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

type ReconnectInstance = {
  id: string;
  name: string;
  channel: string;
  telegramBotToken?: string | null;
  telegramReactionLevel?: string | null;
  discordBotToken?: string | null;
  slackBotToken?: string | null;
  slackAppToken?: string | null;
};

function buildReconnectOptions(instance: ReconnectInstance): {
  credentials: Record<string, unknown>;
  options: Record<string, unknown>;
} {
  const credentials: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};

  switch (instance.channel) {
    case 'telegram': {
      if (instance.telegramBotToken) {
        options.token = instance.telegramBotToken;
      }
      options.telegramReactionLevel = instance.telegramReactionLevel;
      break;
    }
    case 'discord': {
      if (instance.discordBotToken) {
        options.token = instance.discordBotToken;
      }
      break;
    }
    case 'slack': {
      if (instance.slackBotToken) {
        options.botToken = instance.slackBotToken;
        // Keep generic alias for compatibility with old connectors.
        options.token = instance.slackBotToken;
      }
      if (instance.slackAppToken) {
        options.appToken = instance.slackAppToken;
      }
      break;
    }
    default:
      break;
  }

  return { credentials, options };
}

async function markInstanceInactive(db: Database, instanceId: string): Promise<void> {
  const { instances } = await import('@omni/db');
  const { eq } = await import('drizzle-orm');
  await db.update(instances).set({ isActive: false }).where(eq(instances.id, instanceId));
}

async function reconnectInstance(
  plugin: ChannelPlugin,
  instance: ReconnectInstance,
  config: { credentials: Record<string, unknown>; options: Record<string, unknown> },
  db: Database,
): Promise<boolean> {
  try {
    await plugin.connect(instance.id, {
      instanceId: instance.id,
      credentials: config.credentials,
      options: config.options,
    });

    logger.info('Reconnected instance', { instanceId: instance.id, name: instance.name });
    return true;
  } catch (error) {
    logger.error('Failed to reconnect instance', {
      instanceId: instance.id,
      name: instance.name,
      error: String(error),
    });

    await markInstanceInactive(db, instance.id);
    return false;
  }
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
    const reconnectInstanceRecord = instance as ReconnectInstance;
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

    if (!plugin) {
      logger.warn('No plugin found for instance channel', { instanceId: instance.id, channel: instance.channel });
      failed++;
      continue;
    }

    // Hydrate per-guild config overrides into the plugin cache before connecting.
    // This ensures guild configs are available after process restart, not just
    // on manual connect via HTTP routes.
    if ('loadGuildConfigs' in plugin && instance.guildConfigOverrides) {
      (plugin as { loadGuildConfigs: (iId: string, cfg: Record<string, unknown>) => void }).loadGuildConfigs(
        instance.id,
        instance.guildConfigOverrides as Record<string, unknown>,
      );
    }

    const reconnectConfig = buildReconnectOptions(reconnectInstanceRecord);
    const ok = await reconnectInstance(plugin, reconnectInstanceRecord, reconnectConfig, db);
    if (ok) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return {
    attempted: activeInstances.length,
    succeeded,
    failed,
  };
}
