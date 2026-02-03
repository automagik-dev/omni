/**
 * Status Command
 *
 * omni status - Show API health and connection info
 */

import { createOmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getOptionalClient } from '../client.js';
import { getConfigDir, hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';

export function createStatusCommand(): Command {
  const status = new Command('status').description('Show API health and connection info').action(async () => {
    const config = loadConfig();
    const isAuthenticated = hasAuth();

    // Create a client just for health check (no auth required)
    const healthClient = createOmniClient({
      baseUrl: config.apiUrl ?? 'http://localhost:8881',
      apiKey: 'dummy', // Health endpoint doesn't need auth
    });

    const statusInfo: Record<string, unknown> = {
      configDir: getConfigDir(),
      apiUrl: config.apiUrl ?? 'http://localhost:8881',
      authenticated: isAuthenticated,
      defaultInstance: config.defaultInstance ?? '-',
      format: config.format ?? 'auto (TTY detection)',
    };

    // Check API health
    try {
      const health = await healthClient.system.health();
      statusInfo.apiStatus = health.status;
      statusInfo.apiVersion = health.version;

      if (health.checks) {
        statusInfo.checks = health.checks;
      }
    } catch (err) {
      statusInfo.apiStatus = 'unreachable';
      statusInfo.apiError = err instanceof Error ? err.message : 'Unknown error';
    }

    // If authenticated, validate the key
    if (isAuthenticated) {
      const client = getOptionalClient();
      if (client) {
        try {
          const auth = await client.auth.validate();
          statusInfo.keyValid = auth.valid;
          statusInfo.keyName = auth.keyName;
          statusInfo.keyPrefix = auth.keyPrefix;
          statusInfo.scopes = auth.scopes;
        } catch {
          statusInfo.keyValid = false;
        }
      }
    }

    output.data(statusInfo);
  });

  return status;
}
