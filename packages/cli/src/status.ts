/**
 * Status Utilities for Help Display
 *
 * Fetch live status for display in help text.
 */

import chalk, { Chalk, type ChalkInstance } from 'chalk';
import { loadConfig } from './config.js';
import { areColorsEnabled } from './output.js';

/** Get chalk instance (respects color setting) */
function c(): ChalkInstance {
  if (areColorsEnabled()) {
    return chalk;
  }
  return new Chalk({ level: 0 });
}

/**
 * Get inline status string for help display (synchronous).
 *
 * Returns config-based status:
 * - "configured (instance-name)" if API key and instance configured
 * - "configured (no default instance)" if API key but no instance
 * - "not configured" if no API key
 *
 * Note: For live connection status, use `omni status` command.
 */
export function getInlineStatus(): string {
  const config = loadConfig();

  if (!config.apiKey) {
    return c().dim('not configured');
  }

  const instance = config.defaultInstance;
  if (instance) {
    return c().green(`configured (${instance})`);
  }

  return c().yellow('configured (no default instance)');
}

/**
 * Get config summary for help footer.
 *
 * Returns: "instance=name, format=human" or similar
 */
export function getConfigSummary(): string {
  const config = loadConfig();
  const parts: string[] = [];

  if (config.defaultInstance) {
    parts.push(`instance=${config.defaultInstance}`);
  }

  parts.push(`format=${config.format || 'human'}`);

  return parts.join(', ');
}
