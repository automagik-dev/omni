/**
 * Status Utilities for Help Display
 *
 * Fetch live status for display in help text.
 */

import chalk, { Chalk, type ChalkInstance } from 'chalk';
import { describeActiveServer, loadConfig } from './config.js';
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
 * Returns config-based status, always naming the server entry it describes —
 * with a registry of several servers, "configured" alone is ambiguous:
 * - "server=prod, configured (instance-name)" if API key and instance configured
 * - "server=prod, configured (no default instance)" if API key but no instance
 * - "server=prod, not configured" if that entry has no API key
 *
 * Note: For live connection status, use `omni status` command.
 */
export function getInlineStatus(): string {
  const config = loadConfig();
  const server = `server=${describeActiveServer().name}, `;

  if (!config.apiKey) {
    return `${server}${c().dim('not configured')}`;
  }

  const instance = config.defaultInstance;
  if (instance) {
    return `${server}${c().green(`configured (${instance})`)}`;
  }

  return `${server}${c().yellow('configured (no default instance)')}`;
}

/**
 * Get config summary for help footer.
 *
 * Returns: "server=default, instance=name, format=human" or similar
 */
export function getConfigSummary(): string {
  const config = loadConfig();
  const active = describeActiveServer();
  const parts: string[] = [`server=${active.name} (${active.url})`];

  if (config.defaultInstance) {
    parts.push(`instance=${config.defaultInstance}`);
  }

  parts.push(`format=${config.format || 'human'}`);

  return parts.join(', ');
}
