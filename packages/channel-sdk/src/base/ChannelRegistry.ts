/**
 * Channel plugin registry
 *
 * Manages registered channel plugins and their lifecycle.
 */

import type { ChannelType } from '@omni/core/types';
import type { Logger, PluginContext } from '../types/context';
import type { ChannelPlugin, HealthStatus } from '../types/plugin';

/**
 * Registry entry for a plugin
 */
export interface RegistryEntry {
  plugin: ChannelPlugin;
  initialized: boolean;
  registeredAt: Date;
}

/**
 * Registry for managing channel plugins
 */
export class ChannelRegistry {
  private plugins = new Map<ChannelType, RegistryEntry>();
  private logger: Logger | null = null;

  /**
   * Set the logger for the registry
   */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Register a channel plugin
   */
  register(plugin: ChannelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      this.logger?.warn(`Plugin already registered: ${plugin.id}`);
      return;
    }

    this.plugins.set(plugin.id, {
      plugin,
      initialized: false,
      registeredAt: new Date(),
    });

    this.logger?.info(`Registered plugin: ${plugin.id}`, {
      name: plugin.name,
      version: plugin.version,
    });
  }

  /**
   * Unregister a plugin
   */
  async unregister(id: ChannelType): Promise<boolean> {
    const entry = this.plugins.get(id);
    if (!entry) return false;

    if (entry.initialized) {
      try {
        await entry.plugin.destroy();
      } catch (error) {
        this.logger?.error(`Error destroying plugin: ${id}`, { error: String(error) });
      }
    }

    this.plugins.delete(id);
    this.logger?.info(`Unregistered plugin: ${id}`);
    return true;
  }

  /**
   * Get a plugin by ID
   */
  get(id: ChannelType): ChannelPlugin | undefined {
    return this.plugins.get(id)?.plugin;
  }

  /**
   * Check if a plugin is registered
   */
  has(id: ChannelType): boolean {
    return this.plugins.has(id);
  }

  /**
   * Check if a plugin is initialized
   */
  isInitialized(id: ChannelType): boolean {
    return this.plugins.get(id)?.initialized ?? false;
  }

  /**
   * Get all registered plugins
   */
  getAll(): ChannelPlugin[] {
    return Array.from(this.plugins.values()).map((e) => e.plugin);
  }

  /**
   * Get all initialized plugins
   */
  getInitialized(): ChannelPlugin[] {
    return Array.from(this.plugins.values())
      .filter((e) => e.initialized)
      .map((e) => e.plugin);
  }

  /**
   * Get all plugin IDs
   */
  getIds(): ChannelType[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get plugin count
   */
  count(): number {
    return this.plugins.size;
  }

  /**
   * Initialize a specific plugin
   */
  async initialize(id: ChannelType, context: PluginContext): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin not found: ${id}`);
    }

    if (entry.initialized) {
      this.logger?.warn(`Plugin already initialized: ${id}`);
      return;
    }

    try {
      await entry.plugin.initialize(context);
      entry.initialized = true;
      this.logger?.info(`Initialized plugin: ${id}`);
    } catch (error) {
      this.logger?.error(`Failed to initialize plugin: ${id}`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Initialize all registered plugins
   */
  async initializeAll(context: PluginContext): Promise<void> {
    const results = await Promise.allSettled(Array.from(this.plugins.keys()).map((id) => this.initialize(id, context)));

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger?.error(`${failed.length} plugin(s) failed to initialize`);
    }
  }

  /**
   * Destroy all plugins
   */
  async destroyAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.plugins.values())
        .filter((e) => e.initialized)
        .map((e) => e.plugin.destroy()),
    );

    // Mark all as uninitialized
    for (const entry of this.plugins.values()) {
      entry.initialized = false;
    }

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger?.error(`${failed.length} plugin(s) failed to destroy`);
    }
  }

  /**
   * Get health status for all plugins
   */
  async getHealth(): Promise<Map<ChannelType, HealthStatus>> {
    const results = new Map<ChannelType, HealthStatus>();

    await Promise.all(
      Array.from(this.plugins.entries())
        .filter(([, entry]) => entry.initialized)
        .map(async ([id, entry]) => {
          try {
            const health = await entry.plugin.getHealth();
            results.set(id, health);
          } catch (error) {
            results.set(id, {
              status: 'unhealthy',
              message: `Health check error: ${String(error)}`,
              checks: [],
              checkedAt: new Date(),
            });
          }
        }),
    );

    return results;
  }
}

/**
 * Singleton registry instance
 */
export const channelRegistry = new ChannelRegistry();
