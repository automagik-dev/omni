/**
 * Instance Commands
 *
 * omni instances list
 * omni instances get <id>
 * omni instances create --name <name> --channel <type>
 * omni instances delete <id>
 * omni instances status <id>
 * omni instances qr <id>
 * omni instances pair <id> --phone <number>
 * omni instances connect <id>
 * omni instances disconnect <id>
 * omni instances restart <id>
 * omni instances logout <id>
 * omni instances sync <id> --type <type>
 * omni instances syncs <id> [job-id]
 */

import type { Channel } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

const VALID_CHANNELS: Channel[] = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'];
const VALID_SYNC_TYPES = ['profile', 'messages', 'contacts', 'groups', 'all'] as const;

export function createInstancesCommand(): Command {
  const instances = new Command('instances').description('Manage channel instances');

  // omni instances list
  instances
    .command('list')
    .description('List all instances')
    .option('--channel <type>', 'Filter by channel type')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Limit results', Number.parseInt)
    .action(async (options: { channel?: string; status?: string; limit?: number }) => {
      const client = getClient();

      try {
        const result = await client.instances.list({
          channel: options.channel,
          status: options.status,
          limit: options.limit,
        });

        // Simplify output for display
        const items = result.items.map((i) => ({
          id: i.id,
          name: i.name,
          channel: i.channel,
          active: i.isActive ? 'yes' : 'no',
          profileName: i.profileName ?? '-',
        }));

        output.list(items, { emptyMessage: 'No instances found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list instances: ${message}`);
      }
    });

  // omni instances get <id>
  instances
    .command('get <id>')
    .description('Get instance details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const instance = await client.instances.get(id);
        output.data(instance);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get instance: ${message}`, undefined, 3);
      }
    });

  // omni instances create
  instances
    .command('create')
    .description('Create a new instance')
    .requiredOption('--name <name>', 'Instance name')
    .requiredOption('--channel <type>', `Channel type (${VALID_CHANNELS.join(', ')})`)
    .option('--agent-provider <id>', 'Agent provider ID')
    .option('--agent <id>', 'Agent ID')
    .action(async (options: { name: string; channel: string; agentProvider?: string; agent?: string }) => {
      if (!VALID_CHANNELS.includes(options.channel as Channel)) {
        output.error(`Invalid channel: ${options.channel}`, {
          validChannels: VALID_CHANNELS,
        });
      }

      const client = getClient();

      try {
        const instance = await client.instances.create({
          name: options.name,
          channel: options.channel as Channel,
          agentProviderId: options.agentProvider,
          agentId: options.agent,
        });

        output.success(`Instance created: ${instance.id}`, {
          id: instance.id,
          name: instance.name,
          channel: instance.channel,
          active: instance.isActive,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create instance: ${message}`);
      }
    });

  // omni instances delete <id>
  instances
    .command('delete <id>')
    .description('Delete an instance')
    .action(async (id: string) => {
      const client = getClient();

      try {
        await client.instances.delete(id);
        output.success(`Instance deleted: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete instance: ${message}`);
      }
    });

  // omni instances status <id>
  instances
    .command('status <id>')
    .description('Get instance connection status')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const status = await client.instances.status(id);
        output.data({
          instanceId: id,
          ...status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get status: ${message}`, undefined, 3);
      }
    });

  // omni instances qr <id>
  instances
    .command('qr <id>')
    .description('Get QR code for WhatsApp instances')
    .option('--base64', 'Output raw base64 instead of ASCII')
    .action(async (id: string, options: { base64?: boolean }) => {
      const client = getClient();

      try {
        const result = await client.instances.qr(id);

        if (!result.qr) {
          output.warn(result.message);
          return;
        }

        if (options.base64 || output.getCurrentFormat() === 'json') {
          output.data({
            qr: result.qr,
            expiresAt: result.expiresAt,
          });
        } else {
          // For terminal, we'd ideally render as ASCII QR
          // For now, just show the data
          output.info('QR Code (base64):');
          output.raw(result.qr);
          if (result.expiresAt) {
            output.dim(`Expires: ${result.expiresAt}`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get QR code: ${message}`);
      }
    });

  // omni instances pair <id> --phone <number>
  instances
    .command('pair <id>')
    .description('Request pairing code (alternative to QR)')
    .requiredOption('--phone <number>', 'Phone number with country code (e.g., +5511999999999)')
    .action(async (id: string, options: { phone: string }) => {
      const client = getClient();

      try {
        const result = await client.instances.pair(id, { phoneNumber: options.phone });
        output.success(`Pairing code: ${result.code}`, {
          code: result.code,
          phoneNumber: result.phoneNumber,
          expiresIn: result.expiresIn,
          message: result.message,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to request pairing code: ${message}`);
      }
    });

  // omni instances connect <id>
  instances
    .command('connect <id>')
    .description('Connect an instance')
    .option('--force-new-qr', 'Force generation of new QR code')
    .option('--token <token>', 'Discord bot token (for Discord instances)')
    .action(async (id: string, options: { forceNewQr?: boolean; token?: string }) => {
      const client = getClient();

      try {
        const result = await client.instances.connect(id, {
          forceNewQr: options.forceNewQr,
          token: options.token,
        });

        output.success(result.message, {
          status: result.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to connect: ${message}`);
      }
    });

  // omni instances disconnect <id>
  instances
    .command('disconnect <id>')
    .description('Disconnect an instance')
    .action(async (id: string) => {
      const client = getClient();

      try {
        await client.instances.disconnect(id);
        output.success(`Instance disconnected: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to disconnect: ${message}`);
      }
    });

  // omni instances restart <id>
  instances
    .command('restart <id>')
    .description('Restart an instance')
    .option('--force-new-qr', 'Force generation of new QR code after restart')
    .action(async (id: string, options: { forceNewQr?: boolean }) => {
      const client = getClient();

      try {
        const result = await client.instances.restart(id, options.forceNewQr);
        output.success(result.message, {
          status: result.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to restart: ${message}`);
      }
    });

  // omni instances logout <id>
  instances
    .command('logout <id>')
    .description('Logout and clear session data')
    .action(async (id: string) => {
      const client = getClient();

      try {
        await client.instances.logout(id);
        output.success(`Instance logged out: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to logout: ${message}`);
      }
    });

  // omni instances sync <id> --type <type>
  instances
    .command('sync <id>')
    .description('Start a sync operation')
    .requiredOption('--type <type>', `Sync type (${VALID_SYNC_TYPES.join(', ')})`)
    .option('--depth <depth>', 'Sync depth (7d, 30d, 90d, 1y, all)')
    .option('--download-media', 'Download media files')
    .action(async (id: string, options: { type: string; depth?: string; downloadMedia?: boolean }) => {
      if (!VALID_SYNC_TYPES.includes(options.type as (typeof VALID_SYNC_TYPES)[number])) {
        output.error(`Invalid sync type: ${options.type}`, {
          validTypes: VALID_SYNC_TYPES,
        });
      }

      const client = getClient();

      try {
        // Profile sync is immediate
        if (options.type === 'profile') {
          const result = await client.instances.syncProfile(id);
          output.success('Profile synced', result);
          return;
        }

        // Other syncs create a job
        const result = await client.instances.startSync(id, {
          type: options.type as (typeof VALID_SYNC_TYPES)[number],
          depth: options.depth as '7d' | '30d' | '90d' | '1y' | 'all' | undefined,
          downloadMedia: options.downloadMedia,
        });

        output.success(result.message, {
          jobId: result.jobId,
          type: result.type,
          status: result.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to start sync: ${message}`);
      }
    });

  // omni instances syncs <id> [job-id]
  instances
    .command('syncs <id> [jobId]')
    .description('List sync jobs or get job status')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Limit results', Number.parseInt)
    .action(async (id: string, jobId?: string, options?: { status?: string; limit?: number }) => {
      const client = getClient();

      try {
        if (jobId) {
          // Get specific job status
          const job = await client.instances.getSyncStatus(id, jobId);
          output.data(job);
        } else {
          // List all jobs
          const result = await client.instances.listSyncs(id, {
            status: options?.status,
            limit: options?.limit,
          });

          output.list(result.items, { emptyMessage: 'No sync jobs found.' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get sync info: ${message}`, undefined, 3);
      }
    });

  // omni instances update <id>
  instances
    .command('update <id>')
    .description('Update an instance')
    .option('--name <name>', 'New instance name')
    .option('--agent-provider <id>', 'New agent provider ID')
    .option('--agent <id>', 'New agent ID')
    .action(async (id: string, options: { name?: string; agentProvider?: string; agent?: string }) => {
      const client = getClient();

      try {
        await client.instances.update(id, {
          name: options.name,
          agentProviderId: options.agentProvider,
          agentId: options.agent,
        });

        output.success(`Instance updated: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update instance: ${message}`);
      }
    });

  // omni instances contacts <id>
  instances
    .command('contacts <id>')
    .description('List contacts for an instance')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10))
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--guild <id>', 'Guild ID (required for Discord)')
    .action(async (id: string, options: { limit?: number; cursor?: string; guild?: string }) => {
      const client = getClient();

      try {
        const result = await client.instances.listContacts(id, {
          limit: options.limit,
          cursor: options.cursor,
          guildId: options.guild,
        });

        const items = result.items.map((c) => ({
          id: c.platformUserId,
          name: c.displayName ?? '-',
          phone: c.phone ?? '-',
          isGroup: c.isGroup ? 'yes' : 'no',
          isBusiness: c.isBusiness ? 'yes' : 'no',
        }));

        output.list(items, { emptyMessage: 'No contacts found.' });

        if (result.meta.hasMore) {
          output.dim(`More results available. Use --cursor ${result.meta.cursor}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list contacts: ${message}`);
      }
    });

  // omni instances groups <id>
  instances
    .command('groups <id>')
    .description('List groups for an instance')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10))
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (id: string, options: { limit?: number; cursor?: string }) => {
      const client = getClient();

      try {
        const result = await client.instances.listGroups(id, {
          limit: options.limit,
          cursor: options.cursor,
        });

        const items = result.items.map((g) => ({
          id: g.externalId,
          name: g.name ?? '-',
          members: g.memberCount ?? '-',
          description: g.description ? g.description.substring(0, 30) : '-',
        }));

        output.list(items, { emptyMessage: 'No groups found.' });

        if (result.meta.hasMore) {
          output.dim(`More results available. Use --cursor ${result.meta.cursor}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list groups: ${message}`);
      }
    });

  // omni instances profile <id> <user-id>
  instances
    .command('profile <id> <userId>')
    .description('Get user profile from the channel')
    .action(async (id: string, userId: string) => {
      const client = getClient();

      try {
        const profile = await client.instances.getUserProfile(id, userId);
        output.data(profile);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get user profile: ${message}`);
      }
    });

  return instances;
}
