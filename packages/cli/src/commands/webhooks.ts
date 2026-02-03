/**
 * Webhooks Commands
 *
 * omni webhooks list [--enabled]
 * omni webhooks get <id>
 * omni webhooks create --name <name> [--description <desc>]
 * omni webhooks update <id> [--name <name>] [--enabled]
 * omni webhooks delete <id>
 * omni webhooks trigger --type <event-type> --payload <json> [--instance <id>]
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createWebhooksCommand(): Command {
  const webhooks = new Command('webhooks').description('Manage webhook sources');

  // omni webhooks list
  webhooks
    .command('list')
    .description('List webhook sources')
    .option('--enabled', 'Show only enabled sources')
    .option('--disabled', 'Show only disabled sources')
    .action(async (options: { enabled?: boolean; disabled?: boolean }) => {
      const client = getClient();

      try {
        let enabledFilter: boolean | undefined;
        if (options.enabled) enabledFilter = true;
        if (options.disabled) enabledFilter = false;

        const result = await client.webhooks.listSources({
          enabled: enabledFilter,
        });

        const items = result.map((w) => ({
          id: w.id,
          name: w.name,
          enabled: w.enabled ? 'yes' : 'no',
          createdAt: w.createdAt,
        }));

        output.list(items, { emptyMessage: 'No webhook sources found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list webhook sources: ${message}`);
      }
    });

  // omni webhooks get <id>
  webhooks
    .command('get <id>')
    .description('Get webhook source details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const source = await client.webhooks.getSource(id);
        output.data(source);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get webhook source: ${message}`);
      }
    });

  // omni webhooks create
  webhooks
    .command('create')
    .description('Create a webhook source')
    .requiredOption('--name <name>', 'Webhook source name')
    .option('--description <desc>', 'Description')
    .option('--disabled', 'Create in disabled state')
    .option('--headers <json>', 'Expected headers as JSON (e.g., \'{"X-Secret": true}\')')
    .action(async (options: { name: string; description?: string; disabled?: boolean; headers?: string }) => {
      const client = getClient();

      try {
        let expectedHeaders: Record<string, boolean> | undefined;
        if (options.headers) {
          try {
            expectedHeaders = JSON.parse(options.headers);
          } catch {
            output.error('Invalid JSON for --headers');
          }
        }

        const source = await client.webhooks.createSource({
          name: options.name,
          description: options.description,
          enabled: !options.disabled,
          expectedHeaders,
        });

        output.success(`Webhook source created: ${source.id}`, {
          id: source.id,
          name: source.name,
          url: `POST /api/v2/webhooks/${source.id}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create webhook source: ${message}`);
      }
    });

  // omni webhooks update <id>
  webhooks
    .command('update <id>')
    .description('Update a webhook source')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--enable', 'Enable the webhook')
    .option('--disable', 'Disable the webhook')
    .action(
      async (id: string, options: { name?: string; description?: string; enable?: boolean; disable?: boolean }) => {
        const client = getClient();

        try {
          const updates: { name?: string; description?: string; enabled?: boolean } = {};
          if (options.name) updates.name = options.name;
          if (options.description) updates.description = options.description;
          if (options.enable) updates.enabled = true;
          if (options.disable) updates.enabled = false;

          const source = await client.webhooks.updateSource(id, updates);
          output.success(`Webhook source updated: ${source.id}`, {
            id: source.id,
            name: source.name,
            enabled: source.enabled,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to update webhook source: ${message}`);
        }
      },
    );

  // omni webhooks delete <id>
  webhooks
    .command('delete <id>')
    .description('Delete a webhook source')
    .action(async (id: string) => {
      const client = getClient();

      try {
        await client.webhooks.deleteSource(id);
        output.success(`Webhook source deleted: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete webhook source: ${message}`);
      }
    });

  // omni webhooks trigger
  webhooks
    .command('trigger')
    .description('Trigger a custom event')
    .requiredOption('--type <type>', 'Event type')
    .requiredOption('--payload <json>', 'Event payload as JSON')
    .option('--instance <id>', 'Instance ID')
    .option('--correlation-id <id>', 'Correlation ID')
    .action(async (options: { type: string; payload: string; instance?: string; correlationId?: string }) => {
      const client = getClient();

      try {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(options.payload);
        } catch {
          output.error('Invalid JSON for --payload');
          return;
        }

        const result = await client.webhooks.trigger({
          eventType: options.type,
          payload,
          instanceId: options.instance,
          correlationId: options.correlationId,
        });

        output.success(`Event triggered: ${result.eventId}`, {
          eventId: result.eventId,
          eventType: result.eventType,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to trigger event: ${message}`);
      }
    });

  return webhooks;
}
