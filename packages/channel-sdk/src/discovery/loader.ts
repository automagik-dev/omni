/**
 * Dynamic plugin loader
 *
 * Loads channel plugins from discovered packages
 */

import type { Logger } from '../types/context';
import type { ChannelPlugin } from '../types/plugin';
import { formatValidationErrors, validatePluginInterface } from './validator';

/**
 * Load result for a plugin
 */
export interface LoadResult {
  /** Whether loading was successful */
  success: boolean;

  /** The loaded plugin (if successful) */
  plugin?: ChannelPlugin;

  /** Error message (if failed) */
  error?: string;

  /** Path that was loaded */
  path: string;
}

/**
 * Console logger fallback
 */
const consoleLogger: Logger = {
  debug: (msg, data) => console.debug(msg, data ?? ''),
  info: (msg, data) => console.info(msg, data ?? ''),
  warn: (msg, data) => console.warn(msg, data ?? ''),
  error: (msg, data) => console.error(msg, data ?? ''),
  child: () => consoleLogger,
};

/**
 * Load a channel plugin from a package path
 *
 * Supports:
 * - Default export: `export default plugin` or `export default PluginClass`
 * - Named export: `export const plugin = ...`
 *
 * @param path - Path to the package (directory or entry file)
 * @param logger - Logger for diagnostic messages
 * @returns Load result with plugin or error
 */
export async function loadChannelPlugin(path: string, logger: Logger = consoleLogger): Promise<LoadResult> {
  try {
    // Resolve the actual entry point
    let entryPath: string = path;

    // If path is a directory, try to find the entry point
    if (!path.endsWith('.ts') && !path.endsWith('.js')) {
      // Default to src/index.ts for directory paths
      entryPath = `${path}/src/index.ts`;
      logger.debug(`Resolving plugin entry point from directory`, { path, entryPath });
    }

    // Import the module
    const module = await import(entryPath);

    // Try to find the plugin export
    let plugin: unknown;

    // Check for default export first
    if (module.default) {
      plugin = module.default;
    } else if (module.plugin) {
      // Check for named 'plugin' export
      plugin = module.plugin;
    } else if (module.Plugin) {
      // Check for named 'Plugin' class export
      plugin = module.Plugin;
    } else {
      // No recognizable export
      return {
        success: false,
        path,
        error: 'No plugin export found. Export a default plugin or named "plugin" export.',
      };
    }

    // If it's a class/function, instantiate it
    if (typeof plugin === 'function') {
      try {
        plugin = new (plugin as new () => ChannelPlugin)();
      } catch (instantiateError) {
        return {
          success: false,
          path,
          error: `Failed to instantiate plugin class: ${String(instantiateError)}`,
        };
      }
    }

    // Validate the plugin interface
    const validation = validatePluginInterface(plugin);
    if (!validation.valid) {
      return {
        success: false,
        path,
        error: `Invalid plugin interface:\n${formatValidationErrors(validation.errors)}`,
      };
    }

    const validatedPlugin = plugin as ChannelPlugin;
    logger.info(`Loaded plugin: ${validatedPlugin.id}`, {
      name: validatedPlugin.name,
      version: validatedPlugin.version,
    });

    return {
      success: true,
      path,
      plugin: validatedPlugin,
    };
  } catch (error) {
    return {
      success: false,
      path,
      error: `Failed to load plugin: ${String(error)}`,
    };
  }
}

/**
 * Load multiple plugins from paths
 *
 * @param paths - Paths to load plugins from
 * @param logger - Logger for diagnostic messages
 * @returns Array of load results
 */
export async function loadChannelPlugins(paths: string[], logger: Logger = consoleLogger): Promise<LoadResult[]> {
  return Promise.all(paths.map((path) => loadChannelPlugin(path, logger)));
}
