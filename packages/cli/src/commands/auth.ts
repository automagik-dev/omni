/**
 * Auth Commands
 *
 * omni auth login --api-key <key> [--api-url <url>]
 * omni auth status
 * omni auth logout
 */

import { Command } from 'commander';
import { createOmniClient } from '@omni/sdk';
import { loadConfig, saveConfig, deleteConfigValue, getConfigDir, getConfigPath } from '../config.js';
import * as output from '../output.js';

export function createAuthCommand(): Command {
  const auth = new Command('auth').description('Manage API authentication');

  // omni auth login
  auth
    .command('login')
    .description('Save API credentials')
    .requiredOption('--api-key <key>', 'API key for authentication')
    .option('--api-url <url>', 'API base URL (default: http://localhost:8881)')
    .action(async (options: { apiKey: string; apiUrl?: string }) => {
      const config = loadConfig();
      config.apiKey = options.apiKey;

      if (options.apiUrl) {
        config.apiUrl = options.apiUrl;
      }

      // Validate the key by calling the API
      const client = createOmniClient({
        baseUrl: config.apiUrl ?? 'http://localhost:8881',
        apiKey: config.apiKey,
      });

      try {
        const result = await client.auth.validate();

        if (!result.valid) {
          output.error('API key is invalid', undefined, 2);
        }

        // Save config
        saveConfig(config);

        output.success('Logged in successfully', {
          apiUrl: config.apiUrl,
          keyName: result.keyName,
          keyPrefix: result.keyPrefix,
          scopes: result.scopes,
          configPath: getConfigPath(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to validate API key: ${message}`, undefined, 2);
      }
    });

  // omni auth status
  auth
    .command('status')
    .description('Show current authentication status')
    .action(async () => {
      const config = loadConfig();

      if (!config.apiKey) {
        output.error('Not logged in. Run: omni auth login --api-key <key>', undefined, 2);
      }

      const client = createOmniClient({
        baseUrl: config.apiUrl ?? 'http://localhost:8881',
        apiKey: config.apiKey!,
      });

      try {
        const result = await client.auth.validate();

        if (!result.valid) {
          output.error('API key is invalid or expired', undefined, 2);
        }

        output.data({
          status: 'authenticated',
          apiUrl: config.apiUrl,
          keyName: result.keyName,
          keyPrefix: result.keyPrefix,
          scopes: result.scopes,
          configDir: getConfigDir(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to validate API key: ${message}`, undefined, 2);
      }
    });

  // omni auth logout
  auth
    .command('logout')
    .description('Clear stored credentials')
    .action(() => {
      deleteConfigValue('apiKey');
      output.success('Logged out successfully');
    });

  return auth;
}
