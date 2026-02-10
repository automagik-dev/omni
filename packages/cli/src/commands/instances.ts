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
import qrcode from 'qrcode-terminal';
import { getClient } from '../client.js';
import * as output from '../output.js';

const VALID_CHANNELS: Channel[] = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'];
const VALID_SYNC_TYPES = ['profile', 'messages', 'contacts', 'groups', 'all'] as const;

async function resolveBase64Image(options: { base64?: string; url?: string }): Promise<string> {
  if (options.base64) return options.base64;
  if (!options.url) throw new Error('Either --base64 or --url is required');
  const resp = await fetch(options.url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

/** Generic API call helper for direct fetch requests */
async function apiCall(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const baseUrl = process.env.OMNI_API_URL ?? 'http://localhost:8882';
  const apiKey = process.env.OMNI_API_KEY ?? '';
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

        // Fetch status for each instance to get phone/owner
        const statusMap = new Map<string, string>();
        await Promise.allSettled(
          result.items.map(async (i) => {
            try {
              const st = (await client.instances.status(i.id)) as { ownerIdentifier?: string };
              if (st.ownerIdentifier) {
                // Parse phone from JID like "5512982298888:36@s.whatsapp.net" or "5512982298888@s.whatsapp.net"
                const phone = st.ownerIdentifier.includes(':')
                  ? st.ownerIdentifier.split(':')[0]
                  : st.ownerIdentifier.split('@')[0];
                statusMap.set(i.id, phone);
              }
            } catch {
              /* skip if status unavailable */
            }
          }),
        );

        // Simplify output for display
        const items = result.items.map((i) => ({
          id: i.id,
          name: i.name,
          channel: i.channel,
          active: i.isActive ? 'yes' : 'no',
          profileName: i.profileName ?? '-',
          phone: statusMap.get(i.id) ?? '-',
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

  // omni instances whoami <id>
  instances
    .command('whoami <id>')
    .description('Show phone number and identity for an instance')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const status = (await client.instances.status(id)) as {
          state: string;
          isConnected: boolean;
          profileName?: string | null;
          profilePicUrl?: string | null;
          ownerIdentifier?: string;
        };

        const owner = status.ownerIdentifier ?? '-';
        const phone = owner !== '-' ? (owner.includes(':') ? owner.split(':')[0] : owner.split('@')[0]) : '-';

        output.data({
          instanceId: id,
          phone,
          profileName: status.profileName ?? '-',
          ownerIdentifier: owner,
          state: status.state,
          isConnected: status.isConnected,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get identity: ${message}`);
      }
    });

  // omni instances qr <id>
  instances
    .command('qr <id>')
    .description('Get QR code for WhatsApp instances')
    .option('--base64', 'Output raw base64 instead of ASCII')
    .option('--watch', 'Auto-refresh QR until connected')
    .action(async (id: string, options: { base64?: boolean; watch?: boolean }) => {
      const client = getClient();

      const renderQrAscii = async (qrData: string, expiresAt?: string): Promise<void> => {
        return new Promise<void>((resolve) => {
          qrcode.generate(qrData, { small: true }, (qrArt: string) => {
            output.raw(qrArt);
            if (expiresAt) output.dim(`Expires: ${expiresAt}`);
            resolve();
          });
        });
      };

      const outputQrResult = async (result: {
        qr: string | null;
        expiresAt: string | null;
        message: string;
      }): Promise<void> => {
        if (options.base64 || output.getCurrentFormat() === 'json') {
          output.data({ qr: result.qr, expiresAt: result.expiresAt });
        } else if (result.qr) {
          await renderQrAscii(result.qr, result.expiresAt ?? undefined);
        }
      };

      const fetchAndShowQr = async (watch: boolean): Promise<boolean> => {
        const status = await client.instances.status(id);
        if (status.isConnected) {
          output.success('Connected!');
          return true;
        }

        const result = await client.instances.qr(id);
        if (!result.qr) {
          output.warn(result.message || 'No QR available');
          return false;
        }

        // biome-ignore lint/suspicious/noConsole: CLI clear screen
        if (watch) console.clear();
        if (watch) output.info('Scan with WhatsApp (auto-refreshing, Ctrl+C to stop)\n');

        await outputQrResult(result);
        return false;
      };

      const QR_POLL_INTERVAL_MS = 5000;

      if (options.watch) {
        const poll = async (): Promise<void> => {
          try {
            const connected = await fetchAndShowQr(true);
            if (!connected) setTimeout(poll, QR_POLL_INTERVAL_MS);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            output.error(`Failed to get QR code: ${message}`);
          }
        };
        await poll();
      } else {
        try {
          await fetchAndShowQr(false);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to get QR code: ${message}`);
        }
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

  // Helper: update profile name via API (calls WhatsApp directly)
  async function updateProfileName(instanceId: string, name: string): Promise<void> {
    const config = (await import('../config.js')).loadConfig();
    const apiUrl = (config.apiUrl ?? 'http://localhost:8882').replace(/\/$/, '');
    const response = await fetch(`${apiUrl}/api/v2/instances/${instanceId}/profile/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey ?? '' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
    }
  }

  // omni instances update <id>
  instances
    .command('update <id>')
    .description('Update an instance')
    .option('--name <name>', 'New instance name')
    .option('--agent-provider <id>', 'New agent provider ID')
    .option('--agent <id>', 'New agent ID')
    .option('--profile-name <name>', 'Update WhatsApp display name (push name)')
    .action(
      async (id: string, options: { name?: string; agentProvider?: string; agent?: string; profileName?: string }) => {
        const client = getClient();

        try {
          if (options.profileName) {
            await updateProfileName(id, options.profileName);
            output.success(`Profile name updated to "${options.profileName}"`);
          }

          if (options.name || options.agentProvider || options.agent) {
            await client.instances.update(id, {
              name: options.name,
              agentProviderId: options.agentProvider,
              agentId: options.agent,
            });
            output.success(`Instance updated: ${id}`);
          }

          if (!options.profileName && !options.name && !options.agentProvider && !options.agent) {
            output.error('No update options provided. Use --name, --profile-name, --agent-provider, or --agent.');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to update instance: ${message}`);
        }
      },
    );

  // omni instances contacts <id>
  instances
    .command('contacts <id>')
    .description('List contacts for an instance')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10))
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--guild <id>', 'Guild ID (required for Discord)')
    .option('--search <query>', 'Filter contacts by name or phone')
    .option('--no-groups', 'Exclude group contacts')
    .action(
      async (
        id: string,
        options: { limit?: number; cursor?: string; guild?: string; search?: string; groups?: boolean },
      ) => {
        const client = getClient();

        try {
          const result = await client.instances.listContacts(id, {
            limit: options.limit,
            cursor: options.cursor,
            guildId: options.guild,
          });

          let contacts = result.items;

          // Filter out groups if --no-groups
          if (options.groups === false) {
            contacts = contacts.filter((c) => !c.isGroup);
          }

          // Search filter
          if (options.search) {
            const q = options.search.toLowerCase();
            contacts = contacts.filter(
              (c) =>
                (c.displayName ?? '').toLowerCase().includes(q) ||
                (c.phone ?? '').includes(q) ||
                c.platformUserId.includes(q),
            );
          }

          const items = contacts.map((c) => ({
            jid: c.platformUserId,
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
      },
    );

  // omni instances groups <id>
  instances
    .command('groups <id>')
    .description('List groups for an instance')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10))
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--search <query>', 'Filter groups by name')
    .action(async (id: string, options: { limit?: number; cursor?: string; search?: string }) => {
      const client = getClient();

      try {
        const result = await client.instances.listGroups(id, {
          limit: options.limit,
          cursor: options.cursor,
        });

        let groups = result.items;

        // Search filter
        if (options.search) {
          const q = options.search.toLowerCase();
          groups = groups.filter((g) => (g.name ?? '').toLowerCase().includes(q) || (g.externalId ?? '').includes(q));
        }

        const items = groups.map((g) => ({
          jid: g.externalId,
          name: g.name ?? '-',
          members: g.memberCount ?? '-',
          description: g.description
            ? g.description.length > 50
              ? `${g.description.substring(0, 47)}...`
              : g.description
            : '-',
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

  // omni instances check <id> <phone>
  instances
    .command('check <id> <phone>')
    .description('Check if phone number is registered on WhatsApp')
    .action(async (id: string, phone: string) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/check-number`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ phones: [phone] }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        const data = (await resp.json()) as {
          data: { results: Array<{ exists: boolean; jid: string; phone: string }> };
        };
        const result = data.data.results[0];

        if (result?.exists) {
          output.success(`${phone} is registered on WhatsApp`, { jid: result.jid });
        } else {
          output.warn(`${phone} is NOT registered on WhatsApp`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to check number: ${message}`);
      }
    });

  // omni instances update-bio <id> <status>
  instances
    .command('update-bio <id> <status>')
    .description('Update own profile bio/status on WhatsApp')
    .action(async (id: string, status: string) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/profile/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ status }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Bio updated: "${status}"`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update bio: ${message}`);
      }
    });

  // omni instances block <id> <contactId>
  instances
    .command('block <id> <contactId>')
    .description('Block a contact on WhatsApp')
    .action(async (id: string, contactId: string) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/block`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ contactId }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Contact blocked: ${contactId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to block contact: ${message}`);
      }
    });

  // omni instances unblock <id> <contactId>
  instances
    .command('unblock <id> <contactId>')
    .description('Unblock a contact on WhatsApp')
    .action(async (id: string, contactId: string) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/block`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ contactId }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Contact unblocked: ${contactId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unblock contact: ${message}`);
      }
    });

  // omni instances blocklist <id>
  instances
    .command('blocklist <id>')
    .description('List blocked contacts on WhatsApp')
    .action(async (id: string) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/blocklist`, {
          headers: { 'x-api-key': apiKey },
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        const data = (await resp.json()) as { data: { blocklist: string[]; count: number } };
        const { blocklist, count } = data.data;

        if (count === 0) {
          output.info('No blocked contacts.');
          return;
        }

        const items = blocklist.map((jid) => ({ jid }));
        output.list(items, { emptyMessage: 'No blocked contacts.' });
        output.dim(`Total: ${count} blocked`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to fetch blocklist: ${message}`);
      }
    });

  // ============================================================================
  // C2: Profile Picture
  // ============================================================================

  // omni instances update-picture <id>
  instances
    .command('update-picture <id>')
    .description('Update instance profile picture')
    .option('--base64 <data>', 'Base64-encoded image data')
    .option('--url <url>', 'URL to fetch image from')
    .action(async (id: string, options: { base64?: string; url?: string }) => {
      if (!options.base64 && !options.url) {
        output.error('Either --base64 or --url is required');
        return;
      }

      try {
        const base64Data = await resolveBase64Image(options);
        await apiCall(`instances/${id}/profile/picture`, 'PUT', { base64: base64Data });
        output.success('Profile picture updated');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update profile picture: ${message}`);
      }
    });

  // omni instances remove-picture <id>
  instances
    .command('remove-picture <id>')
    .description('Remove instance profile picture')
    .action(async (id: string) => {
      try {
        await apiCall(`instances/${id}/profile/picture`, 'DELETE');
        output.success('Profile picture removed');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to remove profile picture: ${message}`);
      }
    });

  // ============================================================================
  // Group Picture
  // ============================================================================

  // omni instances group-update-picture <id> --group <jid>
  instances
    .command('group-update-picture <id>')
    .description('Update a WhatsApp group profile picture')
    .requiredOption('--group <jid>', 'Group JID (e.g., 120363xxx@g.us)')
    .option('--base64 <data>', 'Base64-encoded image data')
    .option('--url <url>', 'URL to fetch image from')
    .action(async (id: string, options: { group: string; base64?: string; url?: string }) => {
      if (!options.base64 && !options.url) {
        output.error('Either --base64 or --url is required');
        return;
      }

      try {
        const base64Data = await resolveBase64Image(options);
        await apiCall(`instances/${id}/groups/${options.group}/picture`, 'PUT', { base64: base64Data });
        output.success(`Group picture updated for ${options.group}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update group picture: ${message}`);
      }
    });

  // ============================================================================
  // Group Create
  // ============================================================================

  // omni instances group-create <id> --subject "Name" --participants "+55..." "+55..."
  instances
    .command('group-create <id>')
    .description('Create a new WhatsApp group')
    .requiredOption('--subject <name>', 'Group name/subject')
    .requiredOption('--participants <phones...>', 'Phone numbers or JIDs to add (space-separated)')
    .action(async (id: string, opts: { subject: string; participants: string[] }) => {
      try {
        const result = (await apiCall(`instances/${id}/groups`, 'POST', {
          subject: opts.subject,
          participants: opts.participants,
        })) as {
          data: {
            id: string;
            subject: string;
            owner: string | undefined;
            creation: number | undefined;
            participants: Array<{ id: string; admin: string | null }>;
          };
        };
        output.success(`Group created: ${result.data.id}`, result.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        output.error(`Failed to create group: ${msg}`);
      }
    });

  // ============================================================================
  // C3: Group Invite Links
  // ============================================================================

  // omni instances group-invite <id> <groupJid>
  instances
    .command('group-invite <id> <groupJid>')
    .description('Get group invite link')
    .action(async (id: string, groupJid: string) => {
      try {
        const result = (await apiCall(`instances/${id}/groups/${encodeURIComponent(groupJid)}/invite`)) as {
          data: { code: string; inviteLink: string };
        };
        output.data(result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get invite link: ${message}`);
      }
    });

  // omni instances group-revoke-invite <id> <groupJid>
  instances
    .command('group-revoke-invite <id> <groupJid>')
    .description('Revoke group invite link and generate new one')
    .action(async (id: string, groupJid: string) => {
      try {
        const result = (await apiCall(
          `instances/${id}/groups/${encodeURIComponent(groupJid)}/invite/revoke`,
          'POST',
        )) as { data: { code: string; inviteLink: string } };
        output.success('Invite link revoked', result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to revoke invite link: ${message}`);
      }
    });

  // omni instances group-join <id> <code>
  instances
    .command('group-join <id> <code>')
    .description('Join a group via invite code')
    .action(async (id: string, code: string) => {
      try {
        const result = (await apiCall(`instances/${id}/groups/join`, 'POST', { code })) as {
          data: { groupJid: string; joined: boolean };
        };
        output.success(`Joined group: ${result.data.groupJid}`, result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to join group: ${message}`);
      }
    });

  // ============================================================================

  // ============================================================================
  // C5: Privacy Settings
  // ============================================================================

  // omni instances privacy <id>
  instances
    .command('privacy <id>')
    .description('Fetch privacy settings')
    .action(async (id: string) => {
      try {
        const result = (await apiCall(`instances/${id}/privacy`)) as { data: Record<string, unknown> };
        output.data(result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to fetch privacy settings: ${message}`);
      }
    });

  // ============================================================================
  // C6: Reject Incoming Calls
  // ============================================================================

  // omni instances reject-call <id>
  instances
    .command('reject-call <id>')
    .description('Reject an incoming call')
    .requiredOption('--call-id <callId>', 'Call ID from the call event')
    .requiredOption('--from <jid>', 'Caller JID')
    .action(async (id: string, options: { callId: string; from: string }) => {
      try {
        await apiCall(`instances/${id}/calls/reject`, 'POST', {
          callId: options.callId,
          callFrom: options.from,
        });
        output.success(`Call rejected: ${options.callId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to reject call: ${message}`);
      }
    });

  return instances;
}
