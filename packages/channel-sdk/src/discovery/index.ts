/**
 * Auto-discovery module for channel plugins
 */

export { scanChannelPackages, getDefaultPackagesDir } from './scanner';
export type { DiscoveredPackage } from './scanner';

export { loadChannelPlugin, loadChannelPlugins } from './loader';
export type { LoadResult } from './loader';

export { validatePluginInterface, isValidChannelType, formatValidationErrors } from './validator';
export type { ValidationResult, ValidationError } from './validator';

// ─────────────────────────────────────────────────────────────
// Convenience function for complete discovery workflow
// ─────────────────────────────────────────────────────────────

import { channelRegistry } from '../base/ChannelRegistry';
import type { Logger } from '../types/context';
import type { ChannelPlugin } from '../types/plugin';
import { loadChannelPlugin } from './loader';
import { type DiscoveredPackage, getDefaultPackagesDir, scanChannelPackages } from './scanner';

/**
 * Discovery and registration result
 */
export interface DiscoveryResult {
  /** Successfully loaded and registered plugins */
  registered: ChannelPlugin[];

  /** Failed loads with error details */
  failed: Array<{ path: string; error: string }>;

  /** Total packages discovered */
  discovered: number;
}

/**
 * Discover and register all channel plugins
 *
 * Scans the packages directory, loads all channel-* packages,
 * and registers valid plugins with the ChannelRegistry.
 *
 * @param options - Discovery options
 * @returns Discovery result with registered plugins and failures
 */
export async function discoverAndRegisterPlugins(options?: {
  packagesDir?: string;
  logger?: Logger;
}): Promise<DiscoveryResult> {
  const packagesDir = options?.packagesDir ?? getDefaultPackagesDir();
  const logger = options?.logger;

  const result: DiscoveryResult = {
    registered: [],
    failed: [],
    discovered: 0,
  };

  // Scan for packages
  let discovered: DiscoveredPackage[];
  try {
    discovered = await scanChannelPackages(packagesDir);
    result.discovered = discovered.length;
  } catch (error) {
    logger?.error('Failed to scan packages directory', { error: String(error) });
    return result;
  }

  if (discovered.length === 0) {
    logger?.info('No channel packages discovered');
    return result;
  }

  logger?.info(`Discovered ${discovered.length} channel package(s)`, {
    packages: discovered.map((p) => p.name),
  });

  // Load and register each plugin
  for (const pkg of discovered) {
    const loadResult = await loadChannelPlugin(pkg.path, logger);

    if (loadResult.success && loadResult.plugin) {
      try {
        channelRegistry.register(loadResult.plugin);
        result.registered.push(loadResult.plugin);
      } catch (error) {
        result.failed.push({
          path: pkg.path,
          error: `Registration failed: ${String(error)}`,
        });
      }
    } else {
      result.failed.push({
        path: pkg.path,
        error: loadResult.error ?? 'Unknown error',
      });
    }
  }

  return result;
}
