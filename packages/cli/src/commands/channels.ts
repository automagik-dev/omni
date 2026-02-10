/**
 * Channel Commands
 *
 * High-level channel management commands.
 *
 * omni channels list      - Show available channel types + instance counts
 * omni channels add <type> [--token <token>] [--name <name>] - Add a new channel instance
 * omni channels status    - Overview of all channels and connection states
 */

import * as readline from 'node:readline';
import type { Channel } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { loadConfig } from '../config.js';
import * as output from '../output.js';

/** Generic API call helper for direct fetch requests */
async function apiCall(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const config = loadConfig();
  const baseUrl = (config.apiUrl ?? 'http://localhost:8882').replace(/\/$/, '');
  const apiKey = config.apiKey ?? '';
  const headers: Record<string, string> = { 'x-api-key': apiKey };
  if (body) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`${baseUrl}/api/v2/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = (await resp.json()) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
  }
  return resp.json();
}

/** Prompt user for input (for interactive mode) */
function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // Use stderr so stdout stays clean for JSON output
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function createChannelsCommand(): Command {
  const channels = new Command('channels').description('Channel management — list types, add instances, check status');

  // ============================================================================
  // omni channels list
  // ============================================================================
  channels
    .command('list')
    .description('Show available channel types and instance counts')
    .action(async () => {
      const client = getClient();

      try {
        // Fetch supported channels from API
        const supported = (await apiCall('instances/supported-channels')) as {
          items: Array<{
            id: string;
            name: string;
            version?: string;
            loaded: boolean;
            description?: string;
          }>;
        };

        // Fetch all instances to count per channel
        const instanceResult = await client.instances.list({ limit: 100 });
        const instancesByChannel = new Map<string, number>();
        const connectedByChannel = new Map<string, number>();

        for (const inst of instanceResult.items) {
          const ch = inst.channel;
          instancesByChannel.set(ch, (instancesByChannel.get(ch) ?? 0) + 1);
          if (inst.isActive) {
            connectedByChannel.set(ch, (connectedByChannel.get(ch) ?? 0) + 1);
          }
        }

        const items = supported.items.map((ch) => {
          const total = instancesByChannel.get(ch.id) ?? 0;
          const connected = connectedByChannel.get(ch.id) ?? 0;

          return {
            channel: ch.id,
            name: ch.name,
            status: ch.loaded ? 'loaded' : 'not loaded',
            instances: total > 0 ? `${total} (${connected} active)` : '0',
          };
        });

        output.list(items, { emptyMessage: 'No channels available.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list channels: ${message}`);
      }
    });

  // ============================================================================
  // omni channels add <type>
  // ============================================================================
  channels
    .command('add <type>')
    .description('Add a new channel instance (interactive setup)')
    .option('--token <token>', 'Bot token (for Telegram, Discord, Slack)')
    .option('--name <name>', 'Instance name (auto-generated if not provided)')
    .action(async (type: string, options: { token?: string; name?: string }) => {
      const validTypes = ['telegram', 'discord', 'slack', 'whatsapp-baileys', 'whatsapp-cloud'];
      if (!validTypes.includes(type)) {
        output.error(`Unknown channel type: ${type}. Available: ${validTypes.join(', ')}`);
      }

      try {
        // Channel-specific setup
        if (type === 'telegram') {
          await addTelegram(options);
        } else if (type === 'discord') {
          await addTokenChannel('discord', 'Discord', options, 'Get one from https://discord.com/developers');
        } else if (type === 'slack') {
          await addTokenChannel('slack', 'Slack', options, 'Get one from https://api.slack.com/apps');
        } else if (type.startsWith('whatsapp')) {
          await addWhatsApp(type as Channel, options);
        } else {
          output.error(
            `Channel type "${type}" is not yet supported for interactive setup. Use: omni instances create --channel ${type} --name <name>`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to add ${type} channel: ${message}`);
      }
    });

  // ============================================================================
  // omni channels status
  // ============================================================================
  channels
    .command('status')
    .description('Overview of all channels and their connection states')
    .action(async () => {
      const client = getClient();

      try {
        const result = await client.instances.list({ limit: 100 });

        if (result.items.length === 0) {
          output.info('No instances configured. Run: omni channels add <type>');
          return;
        }

        // Group by channel type
        const grouped = new Map<string, typeof result.items>();
        for (const inst of result.items) {
          const group = grouped.get(inst.channel) ?? [];
          group.push(inst);
          grouped.set(inst.channel, group);
        }

        // Build status overview
        const items: Array<{
          channel: string;
          name: string;
          active: string;
          profile: string;
        }> = [];

        for (const [channel, instances] of grouped) {
          for (const inst of instances) {
            items.push({
              channel,
              name: inst.name,
              active: inst.isActive ? 'yes' : 'no',
              profile: inst.profileName ?? '-',
            });
          }
        }

        output.list(items, { emptyMessage: 'No instances found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get channel status: ${message}`);
      }
    });

  return channels;
}

// ============================================================================
// Channel-specific setup flows
// ============================================================================

/**
 * Add a Telegram bot instance
 */
async function addTelegram(options: { token?: string; name?: string }): Promise<void> {
  let token = options.token;

  // Interactive: prompt for token if not provided
  if (!token) {
    if (!process.stdin.isTTY) {
      output.error(
        'Token required. Use: omni channels add telegram --token <token>\nGet one from @BotFather: https://t.me/BotFather',
      );
    }
    output.info('Get a bot token from @BotFather: https://t.me/BotFather\n');
    token = await promptUser('Paste your Telegram bot token: ');
    if (!token) {
      output.error('No token provided. Aborting.');
    }
  }

  // Validate token format (basic check: should be like "123456:ABC-DEF...")
  if (!token.includes(':')) {
    output.error(
      'Invalid token format. Telegram bot tokens look like: 123456789:ABCDefGhIjKlMnOpQrStUvWxYz\nGet one from @BotFather: https://t.me/BotFather',
    );
  }

  // Auto-generate name if not provided
  const name = options.name ?? `telegram-${Date.now().toString(36)}`;

  output.info(`Creating Telegram instance "${name}"...`);

  // Create instance via API (token will be persisted by the API)
  const client = getClient();
  // Token is accepted by the API but not yet in the OpenAPI schema
  const instance = await client.instances.create({
    name,
    channel: 'telegram' as Channel,
    token,
  } as Parameters<typeof client.instances.create>[0]);

  // Wait a moment for connection to establish
  await new Promise((r) => setTimeout(r, 2000));

  // Check status to get bot info
  try {
    const status = (await client.instances.status(instance.id)) as {
      state: string;
      isConnected: boolean;
      profileName?: string | null;
      ownerIdentifier?: string;
      message?: string;
    };

    if (status.isConnected) {
      const botUsername = status.ownerIdentifier ?? status.profileName ?? 'unknown';
      const botName = status.profileName ?? 'unknown';

      output.success(`Connected as ${botUsername} (${botName})`, {
        instanceId: instance.id,
        name: instance.name,
        channel: 'telegram',
        botUsername,
        botName,
      });
    } else {
      // Instance created but not yet connected — still good
      output.success(`Instance created: ${instance.id}`, {
        instanceId: instance.id,
        name: instance.name,
        channel: 'telegram',
        state: status.state,
        message: status.message ?? 'Connecting...',
      });
      output.info(`Connection in progress. Check: omni instances status ${instance.id}`);
    }
  } catch {
    // Status check failed, but instance was created
    output.success(`Instance created: ${instance.id}`, {
      instanceId: instance.id,
      name: instance.name,
      channel: 'telegram',
    });
    output.info(`Check status: omni instances status ${instance.id}`);
  }
}

/**
 * Generic add flow for token-based channels (Discord, Slack)
 */
async function addTokenChannel(
  type: string,
  displayName: string,
  options: { token?: string; name?: string },
  tokenHelp: string,
): Promise<void> {
  let token = options.token;

  if (!token) {
    if (!process.stdin.isTTY) {
      output.error(`Token required. Use: omni channels add ${type} --token <token>\n${tokenHelp}`);
    }
    output.info(`${tokenHelp}\n`);
    token = await promptUser(`Paste your ${displayName} bot token: `);
    if (!token) {
      output.error('No token provided. Aborting.');
    }
  }

  const name = options.name ?? `${type}-${Date.now().toString(36)}`;

  output.info(`Creating ${displayName} instance "${name}"...`);

  const client = getClient();
  // Token is accepted by the API but not yet in the OpenAPI schema
  const instance = await client.instances.create({
    name,
    channel: type as Channel,
    token,
  } as Parameters<typeof client.instances.create>[0]);

  output.success(`Instance created: ${instance.id}`, {
    instanceId: instance.id,
    name: instance.name,
    channel: type,
  });
  output.info(`Check status: omni instances status ${instance.id}`);
}

/**
 * Add a WhatsApp instance (QR code flow, no token needed)
 */
async function addWhatsApp(channel: Channel, options: { name?: string }): Promise<void> {
  const name = options.name ?? `whatsapp-${Date.now().toString(36)}`;

  output.info(`Creating WhatsApp instance "${name}"...`);

  const client = getClient();
  const instance = await client.instances.create({
    name,
    channel,
  });

  output.success(`Instance created: ${instance.id}`, {
    instanceId: instance.id,
    name: instance.name,
    channel,
  });
  output.info(`Scan QR code: omni instances qr ${instance.id} --watch`);
}
