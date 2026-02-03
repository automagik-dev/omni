/**
 * Access Commands
 *
 * omni access list [--instance <id>] [--type allow|deny]
 * omni access create --type <allow|deny> [--instance <id>] [--phone <pattern>] [--user <id>]
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createAccessCommand(): Command {
  const access = new Command('access').description('Manage access control rules');

  // omni access list
  access
    .command('list')
    .description('List access rules')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--type <type>', 'Filter by rule type (allow, deny)')
    .action(async (options: { instance?: string; type?: 'allow' | 'deny' }) => {
      const client = getClient();

      try {
        const rules = await client.access.listRules({
          instanceId: options.instance,
          type: options.type,
        });

        const items = rules.map((r) => ({
          id: r.id,
          type: r.ruleType,
          instance: r.instanceId ?? '*',
          phone: r.phonePattern ?? '-',
          user: r.platformUserId ?? '-',
          priority: r.priority,
        }));

        output.list(items, { emptyMessage: 'No access rules found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list access rules: ${message}`);
      }
    });

  // omni access create
  access
    .command('create')
    .description('Create an access rule')
    .requiredOption('--type <type>', 'Rule type (allow, deny)')
    .option('--instance <id>', 'Instance ID (omit for global rule)')
    .option('--phone <pattern>', 'Phone pattern to match')
    .option('--user <id>', 'Platform user ID to match')
    .option('--priority <n>', 'Rule priority (higher = checked first)', (v) => Number.parseInt(v, 10))
    .action(async (options: { type: string; instance?: string; phone?: string; user?: string; priority?: number }) => {
      if (options.type !== 'allow' && options.type !== 'deny') {
        output.error('Invalid type. Must be "allow" or "deny"');
      }

      if (!options.phone && !options.user) {
        output.error('Must specify --phone or --user');
      }

      const client = getClient();

      try {
        await client.access.createRule({
          ruleType: options.type as 'allow' | 'deny',
          instanceId: options.instance,
          phonePattern: options.phone,
          platformUserId: options.user,
          priority: options.priority,
        });

        output.success('Access rule created');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create access rule: ${message}`);
      }
    });

  return access;
}
