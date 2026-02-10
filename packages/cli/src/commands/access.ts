/**
 * Access Commands
 *
 * omni access list [--instance <id>] [--type allow|deny]
 * omni access create --type <allow|deny> [--instance <id>] [--phone <pattern>] [--user <id>]
 * omni access delete <id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createAccessCommand(): Command {
  const access = new Command('access').description('Manage access control rules (allow/deny lists)');

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
          scope: r.instanceId ? 'instance' : 'global',
          phone: r.phonePattern ?? '-',
          user: r.platformUserId ?? '-',
          priority: r.priority,
          action: r.action ?? 'block',
          enabled: r.enabled ? 'yes' : 'no',
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
    .requiredOption('--type <type>', 'Rule type: allow or deny')
    .option('--instance <id>', 'Instance ID (omit for global rule)')
    .option('--phone <pattern>', 'Phone pattern (supports * wildcard, e.g., +55*)')
    .option('--user <id>', 'Platform user ID (Discord ID, etc.)')
    .option('--priority <n>', 'Rule priority (higher = checked first)', (v) => Number.parseInt(v, 10))
    .option('--action <action>', 'Action: block, silent_block, or allow', 'block')
    .option('--reason <text>', 'Human-readable reason for the rule')
    .option('--message <text>', 'Custom message to send when blocked')
    .option('--disabled', 'Create rule in disabled state')
    .action(
      async (options: {
        type: string;
        instance?: string;
        phone?: string;
        user?: string;
        priority?: number;
        action?: string;
        reason?: string;
        message?: string;
        disabled?: boolean;
      }) => {
        if (options.type !== 'allow' && options.type !== 'deny') {
          output.error('Invalid type. Must be "allow" or "deny"');
          return;
        }

        if (!options.phone && !options.user) {
          output.error('Must specify --phone or --user');
          return;
        }

        const validActions = ['block', 'silent_block', 'allow'];
        if (options.action && !validActions.includes(options.action)) {
          output.error(`Invalid action. Must be one of: ${validActions.join(', ')}`);
          return;
        }

        const client = getClient();

        try {
          await client.access.createRule({
            ruleType: options.type as 'allow' | 'deny',
            instanceId: options.instance,
            phonePattern: options.phone,
            platformUserId: options.user,
            priority: options.priority,
            action: options.action as 'block' | 'silent_block' | 'allow',
            reason: options.reason,
            blockMessage: options.message,
            enabled: !options.disabled,
          });

          output.success('Access rule created');
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to create access rule: ${message}`);
        }
      },
    );

  // omni access delete <id>
  access
    .command('delete <id>')
    .description('Delete an access rule')
    .action(async (id: string) => {
      const client = getClient();

      try {
        await client.access.deleteRule(id);
        output.success('Access rule deleted');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete access rule: ${message}`);
      }
    });

  // omni access mode <instance-id> [disabled|blocklist|allowlist]
  access
    .command('mode <instanceId> [mode]')
    .description('Get or set access control mode for an instance')
    .action(async (instanceId: string, mode?: string) => {
      const client = getClient();

      try {
        if (!mode) {
          // Display current mode
          const instance = await client.instances.get(instanceId);
          const currentMode = (instance as Record<string, unknown>).accessMode ?? 'blocklist';
          output.success(`Access mode: ${currentMode}`);
        } else {
          const validModes = ['disabled', 'blocklist', 'allowlist'];
          if (!validModes.includes(mode)) {
            output.error(`Invalid mode. Must be one of: ${validModes.join(', ')}`);
            return;
          }
          await client.instances.update(instanceId, { accessMode: mode } as Record<string, unknown>);
          output.success(`Access mode set to: ${mode}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to ${mode ? 'set' : 'get'} access mode: ${message}`);
      }
    });

  // omni access check
  access
    .command('check')
    .description('Check if a user has access')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--user <id>', 'Platform user ID to check')
    .option('--channel <type>', 'Channel type', 'discord')
    .action(async (options: { instance: string; user: string; channel: string }) => {
      const client = getClient();

      try {
        const result = await client.access.checkAccess({
          instanceId: options.instance,
          platformUserId: options.user,
          channel: options.channel,
        });

        if (result.allowed) {
          output.success(`Access ALLOWED${result.reason ? `: ${result.reason}` : ''}`);
        } else {
          output.error(`Access DENIED${result.reason ? `: ${result.reason}` : ''}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to check access: ${message}`);
      }
    });

  return access;
}
