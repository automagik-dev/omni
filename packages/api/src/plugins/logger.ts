/**
 * Logger factory for plugins
 *
 * Re-exports the unified logger from @omni/core.
 * This module exists for backwards compatibility with code that imports from here.
 */

import { type Logger, createLogger as coreCreateLogger } from '@omni/core';

// Re-export the Logger type
export type { Logger };

/**
 * Create a logger for a plugin with given module name
 *
 * @param module - Module name or context object
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * // Create a module logger
 * const logger = createPluginLogger('whatsapp:plugin');
 *
 * // Or with context for backwards compatibility
 * const logger = createPluginLogger({ plugin: 'whatsapp' });
 * ```
 */
export function createPluginLogger(module: string | Record<string, unknown>): Logger {
  // Handle legacy context object format
  if (typeof module === 'object') {
    const moduleName = String(module.plugin ?? module.module ?? 'plugin');
    return coreCreateLogger(moduleName);
  }

  return coreCreateLogger(module);
}

/**
 * @deprecated Use createPluginLogger instead
 */
export const createLogger = createPluginLogger;
