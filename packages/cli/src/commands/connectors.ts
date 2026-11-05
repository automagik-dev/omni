/**
 * Connectors Commands
 *
 * omni connectors list [--provider <id>] [--status connected|error|revoked]
 * omni connectors get <id>
 * omni connectors providers [<provider>]
 * omni connectors create --provider <id> --name <name> --token <token> [--config-json <json>]
 * omni connectors update <id> [--name <name>] [--token <token>] [--config-json <json>]
 *   create/update: --hook-secret-stdin reads the write-only hook secret from a pipe
 * omni connectors delete <id>
 * omni connectors subscriptions list <connector-id>
 * omni connectors subscriptions add <connector-id> --event <key> --automation <id> --secret <secret> [--filters-json <json>]
 *   --ingress connector: --event connector.<provider>.<name-or-glob>, optional --automation, no --secret
 * omni connectors subscriptions pause|resume <connector-id> <subscription-id>
 * omni connectors subscriptions rm <connector-id> <subscription-id>
 * omni connectors test <connector-id> <subscription-id> [--payload-json <json>]
 * omni connectors invoke <connector-id> <action> --input-json <json>
 *
 * Secrets passed on the command line are visible in shell history and process
 * lists; prefer a file (`@path`) or the environment where the command supports it.
 */

import { readFileSync } from 'node:fs';
import type { Connector, CreateConnectorSubscriptionBody, OmniClient } from '@omni/sdk';
import { Command, Option } from 'commander';
import { z } from 'zod';
import { getClient as getConfiguredClient } from '../client.js';
import { loadConfig } from '../config.js';
import * as output from '../output.js';
import { stripTerminalControls } from '../utils/terminal.js';

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
    return z.record(z.string(), z.unknown()).parse(JSON.parse(text));
  } catch {
    output.error(`Invalid JSON for ${label}`);
  }
}

function errorMessage(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return secret ? message.split(secret).join('[REDACTED]') : message;
}

async function readHookSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('--hook-secret-stdin requires piped stdin');
  return Bun.stdin.text();
}

async function resolveHookSecret(enabled: boolean | undefined, readStdin: () => Promise<string>) {
  if (!enabled) return undefined;
  const parsed = z
    .string()
    .min(8)
    .max(512)
    .safeParse((await readStdin()).replace(/\r?\n$/, ''));
  if (!parsed.success) throw new Error('Hook secret from stdin must contain 8 to 512 characters');
  return parsed.data;
}

function hookUrl(connectorId: string): string {
  const baseUrl = (loadConfig().apiUrl ?? 'http://localhost:8882').replace(/\/+$/, '');
  return `${baseUrl}/api/v2/connectors/hooks/${encodeURIComponent(connectorId)}`;
}

function connectorHookHint(connector: Pick<Connector, 'id' | 'hasHookSecret'>): string {
  return connector.hasHookSecret
    ? `hook URL relative to CLI API URL (provider needs public URL): ${hookUrl(connector.id)}`
    : 'set --hook-secret-stdin to enable connector hooks';
}

function connectorOutput(connector: Connector): Connector {
  const lastEvent = connector.lastUnmatchedEventType;
  return {
    ...connector,
    lastUnmatchedEventType: typeof lastEvent === 'string' ? stripTerminalControls(lastEvent) : lastEvent,
  };
}

interface SubscriptionOptions {
  ingress?: 'subscription' | 'connector';
  event: string;
  automation?: string;
  secret?: string;
  filtersJson?: string;
}

function subscriptionBody(options: SubscriptionOptions): CreateConnectorSubscriptionBody {
  const eventKey = z.string().min(1).max(100).parse(options.event);
  const filters = parseJsonArg(options.filtersJson, 'filters');
  const targetAutomationId = z.string().uuid().optional().parse(options.automation);
  if (options.ingress === 'connector') {
    if (options.secret !== undefined)
      throw new Error('Connector ingress does not accept --secret; set --hook-secret-stdin on the connector');
    return { ingress: 'connector', eventKey, filters, targetAutomationId };
  }
  if (!targetAutomationId || !options.secret)
    throw new Error('Subscription ingress requires --automation and --secret');
  return { ingress: options.ingress, eventKey, filters, targetAutomationId, verificationSecret: options.secret };
}

export function createConnectorsCommand(
  getClient: () => OmniClient = getConfiguredClient,
  readStdin: () => Promise<string> = readHookSecretFromStdin,
): Command {
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
        const items = result.items.map(connectorOutput);
        output.list(items, {
          emptyMessage: 'No connectors found.',
          rawData: items,
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
        output.data(connectorOutput(await getClient().connectors.get(id)));
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
    .option('--hook-secret-stdin', 'Read the write-only connector hook secret from stdin (8-512 characters)')
    .action(
      async (options: {
        provider: string;
        name: string;
        token?: string;
        credentialsJson?: string;
        configJson?: string;
        hookSecretStdin?: boolean;
      }) => {
        let hookSecret: string | undefined;
        try {
          hookSecret = await resolveHookSecret(options.hookSecretStdin, readStdin);
          const credentials =
            options.token !== undefined
              ? { token: options.token }
              : (parseJsonArg(options.credentialsJson, 'credentials') ?? {});
          const config = parseJsonArg(options.configJson, 'config');
          const connector = connectorOutput(
            await getClient().connectors.create({
              provider: options.provider,
              name: options.name,
              credentials: z.record(z.string(), z.string()).parse(credentials),
              ...(hookSecret !== undefined ? { hookSecret } : {}),
              ...(config ? { config } : {}),
            }),
          );
          output.success(
            `Connector ${connector.name} is ${connector.status}; ${connectorHookHint(connector)}`,
            connector,
          );
        } catch (error) {
          output.error(`Failed to create connector: ${errorMessage(error, hookSecret)}`);
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
    .option('--hook-secret-stdin', 'Set or rotate the write-only connector hook secret from stdin')
    .action(
      async (
        id: string,
        options: {
          name?: string;
          token?: string;
          credentialsJson?: string;
          configJson?: string;
          hookSecretStdin?: boolean;
        },
      ) => {
        let hookSecret: string | undefined;
        try {
          hookSecret = await resolveHookSecret(options.hookSecretStdin, readStdin);
          const credentials =
            options.token !== undefined
              ? { token: options.token }
              : parseJsonArg(options.credentialsJson, 'credentials');
          const config = parseJsonArg(options.configJson, 'config');
          const connector = connectorOutput(
            await getClient().connectors.update(id, {
              ...(options.name ? { name: options.name } : {}),
              ...(credentials ? { credentials: z.record(z.string(), z.string()).parse(credentials) } : {}),
              ...(hookSecret !== undefined ? { hookSecret } : {}),
              ...(config ? { config } : {}),
            }),
          );
          output.success(
            `Connector ${connector.name} is ${connector.status}; ${connectorHookHint(connector)}`,
            connector,
          );
        } catch (error) {
          output.error(`Failed to update connector: ${errorMessage(error, hookSecret)}`);
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
    .requiredOption('--event <key>', 'Manifest event key, or connector.<provider>.<name-or-glob> for connector ingress')
    .addOption(
      new Option('--ingress <route>', 'Ingress route (default: subscription)').choices(['subscription', 'connector']),
    )
    .option(
      '--automation <id>',
      'Target automation UUID (required for subscription ingress; exact typed trigger for connector ingress)',
    )
    .option('--secret <secret>', 'Subscription-ingress verification secret (required for subscription ingress only)')
    .option('--filters-json <json>', 'Filter object as JSON, or @path/to/file.json')
    .action(async (connectorId: string, options: SubscriptionOptions) => {
      try {
        const body = subscriptionBody(options);
        const subscription = await getClient().connectors.subscriptions.add(connectorId, body);
        output.success(`Subscription created: ${subscription.inboundUrl}`, subscription);
      } catch (error) {
        output.error(`Failed to create subscription: ${errorMessage(error)}`);
      }
    });

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
