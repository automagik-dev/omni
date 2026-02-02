/**
 * Settings Commands
 *
 * omni settings list
 * omni settings get <key>
 * omni settings set <key> <value>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createSettingsCommand(): Command {
  const settings = new Command('settings').description('Manage API settings');

  // omni settings list
  settings
    .command('list')
    .description('List all settings')
    .option('--category <category>', 'Filter by category')
    .action(async (options: { category?: string }) => {
      const client = getClient();

      try {
        const result = await client.settings.list({
          category: options.category,
        });

        const items = result.map((s) => ({
          key: s.key,
          value: s.value,
          category: s.category,
          description: s.description ?? '-',
        }));

        output.list(items, { emptyMessage: 'No settings found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list settings: ${message}`);
      }
    });

  // omni settings get <key>
  settings
    .command('get <key>')
    .description('Get a setting value')
    .action(async (key: string) => {
      const client = getClient();

      try {
        const result = await client.settings.list();
        const setting = result.find((s) => s.key === key);

        if (!setting) {
          output.error(`Setting not found: ${key}`, undefined, 3);
        }

        output.data({
          key: setting?.key,
          value: setting?.value,
          category: setting?.category,
          description: setting?.description,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get setting: ${message}`);
      }
    });

  // omni settings set <key> <value>
  settings
    .command('set <key> <value>')
    .description('Update a setting value')
    .action(async (key: string, value: string) => {
      // Note: The SDK doesn't have a settings.set method yet
      // This is a placeholder for when the API supports it
      output.warn('Settings update via CLI is not yet supported.');
      output.info(`To update setting '${key}' to '${value}', use the API directly or dashboard.`);
    });

  return settings;
}
