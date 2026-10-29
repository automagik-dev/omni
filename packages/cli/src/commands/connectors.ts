/**
 * Connectors Commands
 *
 * omni connectors list [--provider <id>] [--status connected|error|revoked]
 * omni connectors get <id>
 * omni connectors providers [<provider>]
 * omni connectors create --provider <id> --name <name> --token <token> [--config-json <json>]
 * omni connectors update <id> [--name <name>] [--token <token>] [--config-json <json>]
 * omni connectors delete <id>
 * omni connectors subscriptions list <connector-id>
 * omni connectors subscriptions add <connector-id> --event <key> --automation <id> --secret <secret> [--filters-json <json>]
 * omni connectors subscriptions pause|resume <connector-id> <subscription-id>
 * omni connectors subscriptions rm <connector-id> <subscription-id>
 * omni connectors test <connector-id> <subscription-id> [--payload-json <json>]
 * omni connectors invoke <connector-id> <action> --input-json <json>
 *
 * Secrets passed on the command line are visible in shell history and process
 * lists; prefer a file (`@path`) or the environment where the command supports it.
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

function parseJsonArg(raw: string | undefined, label: string): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  let text = raw;
  if (raw.startsWith('@')) {
    try {
      text = readFileSync(raw.slice(1), 'utf-8');
    } catch (error) {
      output.error(
        `Cannot read ${label} file '${raw.slice(1)}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      output.error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    output.error(`Invalid JSON for ${label}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function createConnectorsCommand(): Command {
  const connectors = new Command('connectors').description(
    'Integration accounts, event subscriptions and typed actions',
  );

  connectors
    .command('list')
    .description('List connectors')
    .option('--provider <id>', 'Filter by provider manifest id')
    .option('--status <status>', 'Filter by status (connected, error, revoked)')
    .option('--limit <n>', 'Page size', Number.parseInt)
    .action(async (options: { provider?: string; status?: 'connected' | 'error' | 'revoked'; limit?: number }) => {
      try {
        const result = await getClient().connectors.list(options);
        output.list(result.items, {
          emptyMessage: 'No connectors found.',
          rawData: result.items,
        });
      } catch (error) {
        output.error(`Failed to list connectors: ${errorMessage(error)}`);
      }
    });

  connectors
    .command('get <id>')
    .description('Get a connector')
    .action(async (id: string) => {
      try {
        output.data(await getClient().connectors.get(id));
      } catch (error) {
        output.error(`Failed to get connector: ${errorMessage(error)}`);
      }
    });

  connectors
    .command('providers [provider]')
    .description('List provider manifests, or show one with its action JSON Schemas')
    .action(async (provider: string | undefined) => {
      try {
        const client = getClient();
        if (provider) output.data(await client.connectors.provider(provider));
        else output.list(await client.connectors.providers(), { emptyMessage: 'No connector providers registered.' });
      } catch (error) {
        output.error(`Failed to load providers: ${errorMessage(error)}`);
      }
    });

  connectors
    .command('create')
    .description('Connect an external account')
    .requiredOption('--provider <id>', 'Provider manifest id')
    .requiredOption('--name <name>', 'Display name (unique per tenant)')
    .option('--token <token>', 'Provider token (visible in shell history; prefer --credentials-json @file)')
    .option('--credentials-json <json>', 'Credential object as JSON, or @path/to/file.json')
    .option('--config-json <json>', 'Non-secret config object as JSON, or @path/to/file.json')
    .action(
      async (options: {
        provider: string;
        name: string;
        token?: string;
        credentialsJson?: string;
        configJson?: string;
      }) => {
        try {
          const credentials =
            options.token !== undefined
              ? { token: options.token }
              : (parseJsonArg(options.credentialsJson, 'credentials') ?? {});
          const config = parseJsonArg(options.configJson, 'config');
          const connector = await getClient().connectors.create({
            provider: options.provider,
            name: options.name,
            credentials: credentials as Record<string, string>,
            ...(config ? { config } : {}),
          });
          output.success(`Connector ${connector.name} is ${connector.status}`, connector);
        } catch (error) {
          output.error(`Failed to create connector: ${errorMessage(error)}`);
        }
      },
    );

  connectors
    .command('update <id>')
    .description('Update a connector (credentials are revalidated when changed)')
    .option('--name <name>', 'New display name')
    .option('--token <token>', 'New provider token (visible in shell history)')
    .option('--credentials-json <json>', 'Credential object as JSON, or @path/to/file.json')
    .option('--config-json <json>', 'Non-secret config object as JSON, or @path/to/file.json')
    .action(
      async (id: string, options: { name?: string; token?: string; credentialsJson?: string; configJson?: string }) => {
        try {
          const credentials =
            options.token !== undefined
              ? { token: options.token }
              : parseJsonArg(options.credentialsJson, 'credentials');
          const config = parseJsonArg(options.configJson, 'config');
          const connector = await getClient().connectors.update(id, {
            ...(options.name ? { name: options.name } : {}),
            ...(credentials ? { credentials: credentials as Record<string, string> } : {}),
            ...(config ? { config } : {}),
          });
          output.success(`Connector ${connector.name} is ${connector.status}`, connector);
        } catch (error) {
          output.error(`Failed to update connector: ${errorMessage(error)}`);
        }
      },
    );

  connectors
    .command('delete <id>')
    .description('Delete a connector (its subscriptions cascade)')
    .action(async (id: string) => {
      try {
        await getClient().connectors.delete(id);
        output.success(`Connector ${id} deleted`);
      } catch (error) {
        output.error(`Failed to delete connector: ${errorMessage(error)}`);
      }
    });

  const subscriptions = connectors.command('subscriptions').description('Event subscriptions');

  subscriptions
    .command('list <connector-id>')
    .description('List a connector’s event subscriptions')
    .action(async (connectorId: string) => {
      try {
        output.list(await getClient().connectors.subscriptions.list(connectorId), {
          emptyMessage: 'No event subscriptions.',
        });
      } catch (error) {
        output.error(`Failed to list subscriptions: ${errorMessage(error)}`);
      }
    });

  subscriptions
    .command('add <connector-id>')
    .description('Create an event subscription')
    .requiredOption('--event <key>', 'Manifest event key (e.g. taskStatusUpdated)')
    .requiredOption('--automation <id>', 'Target automation UUID (triggerEventType connector.event)')
    .requiredOption('--secret <secret>', 'Provider verification secret (write-only; visible in shell history)')
    .option('--filters-json <json>', 'Filter object as JSON, or @path/to/file.json')
    .action(
      async (
        connectorId: string,
        options: { event: string; automation: string; secret: string; filtersJson?: string },
      ) => {
        try {
          const filters = parseJsonArg(options.filtersJson, 'filters');
          const subscription = await getClient().connectors.subscriptions.add(connectorId, {
            eventKey: options.event,
            targetAutomationId: options.automation,
            verificationSecret: options.secret,
            ...(filters ? { filters } : {}),
          });
          output.success(`Subscription created: ${subscription.inboundUrl}`, subscription);
        } catch (error) {
          output.error(`Failed to create subscription: ${errorMessage(error)}`);
        }
      },
    );

  subscriptions
    .command('pause <connector-id> <subscription-id>')
    .description('Pause a subscription (valid deliveries ack 202 ignored)')
    .action(async (connectorId: string, subscriptionId: string) => {
      try {
        output.data(await getClient().connectors.subscriptions.pause(connectorId, subscriptionId));
      } catch (error) {
        output.error(`Failed to pause subscription: ${errorMessage(error)}`);
      }
    });

  subscriptions
    .command('resume <connector-id> <subscription-id>')
    .description('Resume a paused subscription')
    .action(async (connectorId: string, subscriptionId: string) => {
      try {
        output.data(await getClient().connectors.subscriptions.resume(connectorId, subscriptionId));
      } catch (error) {
        output.error(`Failed to resume subscription: ${errorMessage(error)}`);
      }
    });

  subscriptions
    .command('rm <connector-id> <subscription-id>')
    .description('Delete an event subscription')
    .action(async (connectorId: string, subscriptionId: string) => {
      try {
        await getClient().connectors.subscriptions.remove(connectorId, subscriptionId);
        output.success(`Subscription ${subscriptionId} deleted`);
      } catch (error) {
        output.error(`Failed to delete subscription: ${errorMessage(error)}`);
      }
    });

  connectors
    .command('test <connector-id> <subscription-id>')
    .description('Send a real test delivery through the pipeline (signature bypassed)')
    .option('--payload-json <json>', 'Provider payload as JSON, or @path/to/file.json')
    .action(async (connectorId: string, subscriptionId: string, options: { payloadJson?: string }) => {
      try {
        const payload = parseJsonArg(options.payloadJson, 'payload');
        const result = await getClient().connectors.subscriptions.test(connectorId, subscriptionId, payload);
        output.success(`Test delivery journaled as ${result.eventId}`, result);
      } catch (error) {
        output.error(`Failed to send test delivery: ${errorMessage(error)}`);
      }
    });

  connectors
    .command('invoke <connector-id> <action>')
    .description('Invoke a typed provider action')
    .requiredOption('--input-json <json>', 'Action input as JSON, or @path/to/file.json')
    .action(async (connectorId: string, action: string, options: { inputJson: string }) => {
      try {
        const input = parseJsonArg(options.inputJson, 'input') ?? {};
        output.data(await getClient().connectors.invoke(connectorId, action, input));
      } catch (error) {
        output.error(`Failed to invoke ${action}: ${errorMessage(error)}`);
      }
    });

  return connectors;
}
