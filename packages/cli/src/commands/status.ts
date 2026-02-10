/**
 * Status Command
 *
 * omni status - Show API health and connection info
 */

import { createOmniClient } from '@omni/sdk';
import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getOptionalClient } from '../client.js';
import { getConfigDir, hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';

/** Check API health and add to status info */
async function checkApiHealth(statusInfo: Record<string, unknown>, apiUrl: string): Promise<void> {
  const healthClient = createOmniClient({
    baseUrl: apiUrl,
    apiKey: 'dummy',
  });

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
}

/** Validate auth key and add to status info */
async function validateAuthKey(statusInfo: Record<string, unknown>, client: OmniClient): Promise<void> {
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

export function createStatusCommand(): Command {
  const status = new Command('status').description('Show API health and connection info').action(async () => {
    const config = loadConfig();
    const isAuthenticated = hasAuth();
    const apiUrl = config.apiUrl ?? 'http://localhost:8882';

    const statusInfo: Record<string, unknown> = {
      configDir: getConfigDir(),
      apiUrl,
      authenticated: isAuthenticated,
      defaultInstance: config.defaultInstance ?? '-',
      format: config.format ?? 'auto (TTY detection)',
    };

    await checkApiHealth(statusInfo, apiUrl);

    if (isAuthenticated) {
      const client = getOptionalClient();
      if (client) {
        await validateAuthKey(statusInfo, client);
      }
    }

    output.data(statusInfo);
  });

  return status;
}
