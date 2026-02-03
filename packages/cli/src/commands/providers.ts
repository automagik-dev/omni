/**
 * Providers Commands
 *
 * omni providers list [--active]
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createProvidersCommand(): Command {
  const providers = new Command('providers').description('Manage AI/agent providers');

  // omni providers list
  providers
    .command('list')
    .description('List available providers')
    .option('--active', 'Show only active providers')
    .action(async (options: { active?: boolean }) => {
      const client = getClient();

      try {
        const result = await client.providers.list({
          active: options.active,
        });

        const items = result.map((p) => ({
          id: p.id,
          name: p.name,
          schema: p.schema,
          active: p.isActive ? 'yes' : 'no',
        }));

        output.list(items, { emptyMessage: 'No providers found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list providers: ${message}`);
      }
    });

  return providers;
}
