/**
 * Instances routes - CRUD operations for channel instances
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelPlugin } from '@omni/channel-sdk';
import { ChannelTypeSchema, createLogger } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { getQrCode } from '../../plugins/qr-store';
import type { AppVariables } from '../../types';

const log = createLogger('api:instances');

const instancesRoutes = new Hono<{ Variables: AppVariables }>();

// Query params schema for list
const listQuerySchema = z.object({
  channel: z
    .string()
    .optional()
    .transform(
      (v) => v?.split(',') as ('whatsapp-baileys' | 'whatsapp-cloud' | 'discord' | 'slack' | 'telegram')[] | undefined,
    ),
  status: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as ('active' | 'inactive')[] | undefined),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// Create instance schema
const createInstanceSchema = z.object({
  name: z.string().min(1).max(255).describe('Unique name for the instance'),
  channel: ChannelTypeSchema.describe('Channel type (e.g., whatsapp-baileys, discord)'),
  agentProviderId: z.string().uuid().optional().describe('Reference to agent provider'),
  agentId: z.string().max(255).default('default').describe('Agent ID within the provider'),
  agentTimeout: z.number().int().positive().default(60).describe('Agent timeout in seconds'),
  agentStreamMode: z.boolean().default(false).describe('Enable streaming responses'),
  isDefault: z.boolean().default(false).describe('Set as default instance for channel'),
  token: z.string().optional().describe('Bot token for Discord instances (required for Discord)'),
});

// Update instance schema
const updateInstanceSchema = createInstanceSchema.partial();

/**
 * GET /instances - List all instances
 */
instancesRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { channel, status, limit, cursor } = c.req.valid('query');
  const services = c.get('services');

  const result = await services.instances.list({ channel, status, limit, cursor });

  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * GET /instances/supported-channels - List supported channel types
 *
 * NOTE: This route MUST be defined before /:id to avoid being captured by the param
 */
instancesRoutes.get('/supported-channels', async (c) => {
  const channelRegistry = c.get('channelRegistry');

  // Get loaded plugins from registry
  const loadedPlugins = channelRegistry ? channelRegistry.getAll() : [];

  // Build dynamic list from loaded plugins
  const loadedChannels = loadedPlugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    loaded: true as const,
    capabilities: plugin.capabilities,
  }));

  // Add static entries for channels that aren't loaded
  const loadedIds = new Set(loadedPlugins.map((p) => p.id));

  const staticChannels = [
    {
      id: 'whatsapp-cloud' as const,
      name: 'WhatsApp Business Cloud',
      description: 'Official WhatsApp Business API',
      loaded: false as const,
    },
    { id: 'discord' as const, name: 'Discord', description: 'Discord bot integration', loaded: false as const },
    { id: 'slack' as const, name: 'Slack', description: 'Slack bot integration', loaded: false as const },
    { id: 'telegram' as const, name: 'Telegram', description: 'Telegram bot integration', loaded: false as const },
  ];

  const unloadedChannels = staticChannels.filter((ch) => !loadedIds.has(ch.id));

  return c.json({
    items: [...loadedChannels, ...unloadedChannels],
  });
});

/**
 * GET /instances/:id - Get instance by ID
 */
instancesRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  return c.json({ data: instance });
});

/**
 * POST /instances - Create new instance
 */
instancesRoutes.post('/', zValidator('json', createInstanceSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Create the database record first
  const instance = await services.instances.create(data);

  // Build connection options
  const connectionOptions: Record<string, unknown> = { forceNewQr: true };
  if (data.token) {
    connectionOptions.token = data.token;
  }

  // Get the channel plugin and trigger connection
  if (channelRegistry) {
    const plugin = channelRegistry.get(data.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        // Trigger plugin connection
        await plugin.connect(instance.id, {
          instanceId: instance.id,
          credentials: {},
          options: connectionOptions,
        });
        log.info('Triggered connection', { instanceId: instance.id, channel: data.channel });
      } catch (error) {
        log.error('Failed to connect instance', { instanceId: instance.id, error: String(error) });
        // Don't fail the request - instance is created, connection can be retried
      }
    } else {
      log.warn('No plugin found for channel', { channel: data.channel });
    }
  }

  return c.json({ data: instance }, 201);
});

/**
 * PATCH /instances/:id - Update instance
 */
instancesRoutes.patch('/:id', zValidator('json', updateInstanceSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const instance = await services.instances.update(id, data);

  return c.json({ data: instance });
});

/**
 * DELETE /instances/:id - Delete instance
 */
instancesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Disconnect via channel plugin first
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        await plugin.disconnect(id);
      } catch (error) {
        log.error('Failed to disconnect instance before delete', { instanceId: id, error: String(error) });
        // Continue with deletion anyway
      }
    }
  }

  await services.instances.delete(id);

  return c.json({ success: true });
});

/**
 * GET /instances/:id/status - Get instance connection status
 */
instancesRoutes.get('/:id/status', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Get actual connection status from channel plugin
  let connectionState = 'unknown';
  let statusMessage: string | undefined;

  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        const status = await plugin.getStatus(id);
        connectionState = status.state;
        statusMessage = status.message;
      } catch {
        connectionState = 'error';
        statusMessage = 'Failed to get status from plugin';
      }
    }
  }

  return c.json({
    data: {
      instanceId: instance.id,
      state: connectionState,
      isConnected: connectionState === 'connected',
      connectedAt: null,
      profileName: instance.profileName,
      profilePicUrl: instance.profilePicUrl,
      ownerIdentifier: instance.ownerIdentifier,
      message: statusMessage,
    },
  });
});

/**
 * GET /instances/:id/qr - Get QR code for WhatsApp connection
 */
instancesRoutes.get('/:id/qr', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  if (!instance.channel.startsWith('whatsapp')) {
    return c.json(
      { error: { code: 'INVALID_OPERATION', message: 'QR code only available for WhatsApp instances' } },
      400,
    );
  }

  // Get QR code from store
  const stored = getQrCode(id);

  if (!stored) {
    return c.json({
      data: {
        qr: null,
        expiresAt: null,
        message: 'No QR code available. Instance may already be connected or connection not initiated.',
      },
    });
  }

  return c.json({
    data: {
      qr: stored.code,
      expiresAt: stored.expiresAt.toISOString(),
      message: 'Scan with WhatsApp to connect',
    },
  });
});

// Pairing code schema
const pairingCodeSchema = z.object({
  phoneNumber: z.string().min(10).max(20).describe('Phone number in international format (e.g., +5511999999999)'),
});

/**
 * POST /instances/:id/pair - Request pairing code for phone authentication
 *
 * Alternative to QR code scanning. The instance must be connected (in connecting state)
 * before requesting a pairing code.
 */
instancesRoutes.post('/:id/pair', zValidator('json', pairingCodeSchema), async (c) => {
  const id = c.req.param('id');
  const { phoneNumber } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!instance.channel.startsWith('whatsapp')) {
    return c.json(
      { error: { code: 'INVALID_OPERATION', message: 'Pairing code only available for WhatsApp instances' } },
      400,
    );
  }

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  // Check if plugin supports pairing code (WhatsApp specific)
  if (!('requestPairingCode' in plugin)) {
    return c.json({ error: { code: 'NOT_SUPPORTED', message: 'This plugin does not support pairing codes' } }, 400);
  }

  try {
    // Type assertion is safe here - we checked for method existence above
    const code = await (
      plugin as unknown as { requestPairingCode: (id: string, phone: string) => Promise<string> }
    ).requestPairingCode(id, phoneNumber);
    return c.json({
      data: {
        code,
        phoneNumber: phoneNumber.replace(/(\d{4})(\d+)(\d{2})/, '$1****$3'),
        message: 'Enter this code on your WhatsApp mobile app: Settings > Linked Devices > Link with phone number',
        expiresIn: 60, // seconds
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { code: 'PAIRING_FAILED', message } }, 500);
  }
});

// Connect instance schema
const connectInstanceSchema = z.object({
  token: z.string().optional().describe('Bot token for Discord instances'),
  forceNewQr: z.boolean().optional().describe('Force new QR code for WhatsApp (re-authentication)'),
});

/**
 * POST /instances/:id/connect - Connect instance
 *
 * Body (optional):
 * - token: Bot token for Discord instances
 * - forceNewQr: Force new QR code for WhatsApp (re-authentication)
 *
 * Query params (deprecated, use body):
 * - forceNewQr: true - Clear auth state and force fresh QR code
 */
instancesRoutes.post('/:id/connect', zValidator('json', connectInstanceSchema.optional()), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json') ?? {};
  const forceNewQr = body.forceNewQr ?? c.req.query('forceNewQr') === 'true';
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Build connection options
  const connectionOptions: Record<string, unknown> = { forceNewQr };
  if (body.token) {
    connectionOptions.token = body.token;
  }

  // Trigger connection via channel plugin
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        await plugin.connect(id, {
          instanceId: id,
          credentials: {},
          options: connectionOptions,
        });
      } catch (error) {
        return c.json(
          {
            error: {
              code: 'CONNECTION_FAILED',
              message: `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          },
          500,
        );
      }
    } else {
      return c.json(
        { error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } },
        400,
      );
    }
  } else {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  // Update database
  const updated = await services.instances.update(id, { isActive: true });

  return c.json({
    data: {
      instanceId: updated.id,
      status: 'connecting',
      message: 'Connection initiated',
    },
  });
});

/**
 * POST /instances/:id/disconnect - Disconnect instance
 */
instancesRoutes.post('/:id/disconnect', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Trigger disconnection via channel plugin
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        await plugin.disconnect(id);
      } catch (error) {
        log.error('Failed to disconnect instance', { instanceId: id, error: String(error) });
        // Continue anyway - update database state
      }
    }
  }

  // Update database
  await services.instances.update(id, { isActive: false });

  return c.json({ success: true });
});

/**
 * POST /instances/:id/restart - Restart instance
 *
 * Query params:
 * - forceNewQr: true - Clear auth state and force fresh QR code (for re-authentication)
 */
instancesRoutes.post('/:id/restart', async (c) => {
  const id = c.req.param('id');
  const forceNewQr = c.req.query('forceNewQr') === 'true';
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Restart via channel plugin: disconnect then connect
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        // Disconnect first
        await plugin.disconnect(id);
        // Then reconnect
        await plugin.connect(id, {
          instanceId: id,
          credentials: {},
          options: {
            forceNewQr,
          },
        });
      } catch (error) {
        return c.json(
          {
            error: {
              code: 'RESTART_FAILED',
              message: `Failed to restart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          },
          500,
        );
      }
    } else {
      return c.json(
        { error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } },
        400,
      );
    }
  } else {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  return c.json({
    data: {
      instanceId: instance.id,
      status: 'restarting',
      message: 'Restart initiated',
    },
  });
});

/**
 * POST /instances/:id/logout - Logout instance (clear session)
 */
instancesRoutes.post('/:id/logout', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Logout via channel plugin (clears auth state)
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin && 'logout' in plugin && typeof plugin.logout === 'function') {
      try {
        await (plugin as ChannelPlugin & { logout: (id: string) => Promise<void> }).logout(id);
      } catch (error) {
        log.error('Failed to logout instance', { instanceId: id, error: String(error) });
      }
    } else if (plugin) {
      // Fall back to disconnect
      try {
        await plugin.disconnect(id);
      } catch (error) {
        log.error('Failed to disconnect instance during logout', { instanceId: id, error: String(error) });
      }
    }
  }

  // Update database
  await services.instances.update(id, { isActive: false });

  return c.json({
    success: true,
    message: 'Session cleared, re-authentication required',
  });
});

// ============================================================================
// SYNC ENDPOINTS
// ============================================================================

// Sync request schema
const syncRequestSchema = z.object({
  type: z
    .enum(['profile', 'messages', 'contacts', 'groups', 'all'])
    .describe('Type of sync: profile, messages, contacts, groups, or all'),
  depth: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().describe('Sync depth for message history'),
  channelId: z.string().optional().describe('Discord channel ID for channel-specific sync'),
  downloadMedia: z.boolean().optional().describe('Download and store media files'),
});

/** Type for profile sync response */
interface ProfileSyncResult {
  name?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  platformMetadata?: Record<string, unknown> | null;
  syncedAt?: Date | null;
}

/**
 * POST /instances/:id/sync/profile - Sync profile immediately
 */
instancesRoutes.post('/:id/sync/profile', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  // Check if plugin supports profile sync
  if (!('getProfile' in plugin) || typeof plugin.getProfile !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support profile sync` } },
      400,
    );
  }

  try {
    // Get profile from plugin
    type ProfileResult = {
      name?: string;
      avatarUrl?: string;
      bio?: string;
      ownerIdentifier?: string;
      platformMetadata: Record<string, unknown>;
    };
    const profile = await (plugin as { getProfile: (id: string) => Promise<ProfileResult> }).getProfile(id);

    // Update instance with profile info
    const updated = await services.instances.update(id, {
      profileName: profile.name,
      profilePicUrl: profile.avatarUrl,
      profileBio: profile.bio,
      profileMetadata: profile.platformMetadata,
      profileSyncedAt: new Date(),
      ownerIdentifier: profile.ownerIdentifier,
    });

    const result: ProfileSyncResult = {
      name: updated.profileName,
      avatarUrl: updated.profilePicUrl,
      bio: updated.profileBio,
      platformMetadata: updated.profileMetadata as Record<string, unknown> | null,
      syncedAt: updated.profileSyncedAt,
    };

    return c.json({ data: { type: 'profile', status: 'completed', profile: result } });
  } catch (error) {
    const message = `Failed to sync profile: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'SYNC_FAILED', message } }, 500);
  }
});

/**
 * POST /instances/:id/sync - Request a sync operation
 *
 * Creates a sync job for the specified type:
 * - profile: Sync instance profile (redirects to /sync/profile)
 * - messages: Sync message history (with optional depth)
 * - contacts: Sync contacts
 * - groups: Sync groups/guilds
 * - all: Sync everything
 */
instancesRoutes.post('/:id/sync', zValidator('json', syncRequestSchema), async (c) => {
  const id = c.req.param('id');
  const { type, depth, channelId, downloadMedia } = c.req.valid('json');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  // For profile sync, redirect to dedicated endpoint
  if (type === 'profile') {
    // Create internal redirect by calling the profile sync handler directly
    const channelRegistry = c.get('channelRegistry');
    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('getProfile' in plugin)) {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Profile sync not supported' } }, 400);
    }

    type ProfileResult = {
      name?: string;
      avatarUrl?: string;
      bio?: string;
      ownerIdentifier?: string;
      platformMetadata: Record<string, unknown>;
    };
    const profile = await (plugin as { getProfile: (id: string) => Promise<ProfileResult> }).getProfile(id);
    const updated = await services.instances.update(id, {
      profileName: profile.name,
      profilePicUrl: profile.avatarUrl,
      profileBio: profile.bio,
      profileMetadata: profile.platformMetadata,
      profileSyncedAt: new Date(),
      ownerIdentifier: profile.ownerIdentifier,
    });

    return c.json({
      data: {
        type: 'profile',
        status: 'completed',
        profile: {
          name: updated.profileName,
          avatarUrl: updated.profilePicUrl,
          bio: updated.profileBio,
          platformMetadata: updated.profileMetadata,
          syncedAt: updated.profileSyncedAt,
        },
      },
    });
  }

  // For other sync types, check for existing active job
  const hasActiveJob = await services.syncJobs.hasActiveJob(id, type);
  if (hasActiveJob) {
    return c.json({ error: { code: 'JOB_EXISTS', message: `A ${type} sync job is already running` } }, 409);
  }

  // Create sync job
  const job = await services.syncJobs.create({
    instanceId: id,
    type,
    config: { depth: depth ?? '7d', channelId, downloadMedia: downloadMedia ?? instance.downloadMediaOnSync },
  });

  return c.json(
    {
      data: {
        jobId: job.id,
        instanceId: id,
        type,
        status: job.status,
        config: job.config,
        message: 'Sync job created',
      },
    },
    201,
  );
});

/**
 * GET /instances/:id/sync/:jobId - Get sync job status
 */
instancesRoutes.get('/:id/sync/:jobId', async (c) => {
  const id = c.req.param('id');
  const jobId = c.req.param('jobId');
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(id);

  const job = await services.syncJobs.getByIdWithStats(jobId);

  // Verify job belongs to this instance
  if (job.instanceId !== id) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sync job not found' } }, 404);
  }

  return c.json({
    data: {
      jobId: job.id,
      instanceId: job.instanceId,
      type: job.type,
      status: job.status,
      config: job.config,
      progress: job.progress,
      progressPercent: job.progressPercent,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  });
});

/**
 * GET /instances/:id/sync - List sync jobs for instance
 */
instancesRoutes.get('/:id/sync', async (c) => {
  const id = c.req.param('id');
  const status = c.req.query('status')?.split(',') as
    | ('pending' | 'running' | 'completed' | 'failed' | 'cancelled')[]
    | undefined;
  const limit = Number.parseInt(c.req.query('limit') ?? '20', 10);
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(id);

  const result = await services.syncJobs.list({
    instanceId: id,
    status,
    limit,
  });

  return c.json({
    items: result.items.map((job) => ({
      jobId: job.id,
      type: job.type,
      status: job.status,
      progressPercent: job.progressPercent,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    })),
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

export { instancesRoutes };
