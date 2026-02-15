/**
 * Status Command
 *
 * omni status - Show API health and connection info
 */

import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getOptionalClient } from '../client.js';
import { getConfigDir, hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';
import { CLI_VERSION_HEADER, SERVER_VERSION_HEADER, VERSION, formatStatusVersionHint } from '../version.js';

/** Check API health and add to status info */
async function checkApiHealth(statusInfo: Record<string, unknown>, apiUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/v2/health`, {
      headers: {
        'Accept-Encoding': 'identity',
        [CLI_VERSION_HEADER]: VERSION,
      },
    });

    const health = (await response.json()) as {
      status?: string;
      version?: string;
      checks?: Record<string, unknown>;
    };

    statusInfo.apiStatus = health.status ?? 'unknown';
    statusInfo.apiVersion = health.version;
    if (health.checks) {
      statusInfo.checks = health.checks;
    }

    return response.headers.get(SERVER_VERSION_HEADER);
  } catch (err) {
    statusInfo.apiStatus = 'unreachable';
    statusInfo.apiError = err instanceof Error ? err.message : 'Unknown error';
    return null;
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

    const serverVersion = await checkApiHealth(statusInfo, apiUrl);

    if (isAuthenticated) {
      const client = getOptionalClient();
      if (client) {
        await validateAuthKey(statusInfo, client);
      }
    }

    output.data(statusInfo);

    if (output.getCurrentFormat() === 'human' && serverVersion) {
      output.raw(formatStatusVersionHint(VERSION, serverVersion));
    }
  });

  return status;
}
