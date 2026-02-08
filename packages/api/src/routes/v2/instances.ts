/**
 * Instances routes - CRUD operations for channel instances
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelPlugin } from '@omni/channel-sdk';
import { ChannelTypeSchema, createLogger } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { filterByInstanceAccess, requireInstanceAccess } from '../../middleware/auth';
import { getQrCode } from '../../plugins/qr-store';
import type { AppVariables } from '../../types';

const log = createLogger('api:instances');

const instancesRoutes = new Hono<{ Variables: AppVariables }>();

// Instance access middleware for :id routes
const instanceAccess = requireInstanceAccess((c) => c.req.param('id'));

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

// Reply filter schema
const agentReplyFilterSchema = z.object({
  mode: z.enum(['all', 'filtered']).describe('Reply mode: all = reply to everything, filtered = check conditions'),
  conditions: z
    .object({
      onDm: z.boolean().default(true).describe('Reply if message is a DM'),
      onMention: z.boolean().default(true).describe('Reply if bot is @mentioned'),
      onReply: z.boolean().default(true).describe('Reply if message is a reply to bot'),
      onNameMatch: z.boolean().default(false).describe('Reply if bot name appears in text'),
      namePatterns: z.array(z.string()).optional().describe('Custom patterns for name matching'),
    })
    .default({ onDm: true, onMention: true, onReply: true, onNameMatch: false }),
});

// Create instance schema
const createInstanceSchema = z.object({
  name: z.string().min(1).max(255).describe('Unique name for the instance'),
  channel: ChannelTypeSchema.describe('Channel type (e.g., whatsapp-baileys, discord)'),
  agentProviderId: z.string().uuid().optional().nullable().describe('Reference to agent provider'),
  agentId: z.string().max(255).default('default').describe('Agent ID within the provider'),
  agentType: z.enum(['agent', 'team', 'workflow']).default('agent').describe('Agent type (agent, team, or workflow)'),
  agentTimeout: z.number().int().positive().default(60).describe('Agent timeout in seconds'),
  agentStreamMode: z.boolean().default(false).describe('Enable streaming responses'),
  agentReplyFilter: agentReplyFilterSchema.optional().nullable().describe('When agent should reply'),
  agentSessionStrategy: z
    .enum(['per_user', 'per_chat', 'per_user_per_chat'])
    .default('per_user_per_chat')
    .describe('Session strategy for agent memory'),
  agentPrefixSenderName: z.boolean().default(true).describe('Prefix messages with sender name'),
  enableAutoSplit: z.boolean().default(true).describe('Split responses on double newlines'),
  isDefault: z.boolean().default(false).describe('Set as default instance for channel'),
  token: z.string().optional().describe('Bot token for Discord instances (required for Discord)'),
  ttsVoiceId: z.string().optional().nullable().describe('Default ElevenLabs voice ID for this instance'),
  ttsModelId: z.string().optional().nullable().describe('Default ElevenLabs model for this instance'),
});

// Update instance schema
const updateInstanceSchema = createInstanceSchema.partial();

/**
 * GET /instances - List all instances
 */
instancesRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { channel, status, limit, cursor } = c.req.valid('query');
  const services = c.get('services');
  const apiKey = c.get('apiKey');

  const result = await services.instances.list({ channel, status, limit, cursor });

  // Filter by API key's allowed instanceIds
  const items = apiKey ? filterByInstanceAccess(result.items, (item) => item.id, apiKey) : result.items;

  return c.json({
    items,
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
instancesRoutes.get('/:id', instanceAccess, async (c) => {
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
instancesRoutes.patch('/:id', instanceAccess, zValidator('json', updateInstanceSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const instance = await services.instances.update(id, data);

  return c.json({ data: instance });
});

/**
 * DELETE /instances/:id - Delete instance
 */
instancesRoutes.delete('/:id', instanceAccess, async (c) => {
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
instancesRoutes.get('/:id/status', instanceAccess, async (c) => {
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
instancesRoutes.get('/:id/qr', instanceAccess, async (c) => {
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
instancesRoutes.post('/:id/pair', instanceAccess, zValidator('json', pairingCodeSchema), async (c) => {
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

    // Format code as XXXX-XXXX for readability
    const formattedCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

    return c.json({
      data: {
        code: formattedCode,
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
instancesRoutes.post(
  '/:id/connect',
  instanceAccess,
  zValidator('json', connectInstanceSchema.optional()),
  async (c) => {
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
  },
);

/**
 * POST /instances/:id/disconnect - Disconnect instance
 */
instancesRoutes.post('/:id/disconnect', instanceAccess, async (c) => {
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
instancesRoutes.post('/:id/restart', instanceAccess, async (c) => {
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
instancesRoutes.post('/:id/logout', instanceAccess, async (c) => {
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
instancesRoutes.post('/:id/sync/profile', instanceAccess, async (c) => {
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

// ============================================================================
// Profile Name Update
// ============================================================================

/**
 * PUT /instances/:id/profile/name - Update profile display name
 */
instancesRoutes.put(
  '/:id/profile/name',
  instanceAccess,
  zValidator('json', z.object({ name: z.string().min(1).max(25) })),
  async (c) => {
    const id = c.req.param('id');
    const { name } = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(id);

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('updateProfileName' in plugin) || typeof plugin.updateProfileName !== 'function') {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support profile name update' } }, 400);
    }

    try {
      await (plugin as { updateProfileName: (instanceId: string, name: string) => Promise<void> }).updateProfileName(
        id,
        name,
      );

      // Update local DB too
      await services.instances.update(id, { profileName: name });

      return c.json({ success: true, data: { instanceId: id, action: 'profile_name_updated', name } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: { code: 'UPDATE_FAILED', message } }, 500);
    }
  },
);

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
instancesRoutes.post('/:id/sync', instanceAccess, zValidator('json', syncRequestSchema), async (c) => {
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

  // Create sync job with channelType for proper event routing
  const job = await services.syncJobs.create({
    instanceId: id,
    channelType: instance.channel,
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
instancesRoutes.get('/:id/sync/:jobId', instanceAccess, async (c) => {
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
instancesRoutes.get('/:id/sync', instanceAccess, async (c) => {
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

// ============================================================================
// PROFILE & CONTACTS ENDPOINTS
// ============================================================================

/**
 * GET /instances/:id/users/:userId/profile - Fetch user profile
 *
 * Fetches profile information for a specific user on this channel.
 * Useful for getting profile pics, bios, business info etc.
 */
instancesRoutes.get('/:id/users/:userId/profile', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const userId = c.req.param('userId');
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

  // Check if plugin supports user profile fetching
  if (!('fetchUserProfile' in plugin) || typeof plugin.fetchUserProfile !== 'function') {
    return c.json(
      {
        error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support user profile fetching` },
      },
      400,
    );
  }

  try {
    type ProfileResult = {
      displayName?: string;
      avatarUrl?: string;
      bio?: string;
      phone?: string;
      platformData?: Record<string, unknown>;
    };

    const profile = await (
      plugin as { fetchUserProfile: (instanceId: string, userId: string) => Promise<ProfileResult> }
    ).fetchUserProfile(id, userId);

    return c.json({
      data: {
        platformUserId: userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        phone: profile.phone,
        platformMetadata: profile.platformData,
      },
    });
  } catch (error) {
    const message = `Failed to fetch user profile: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'PROFILE_FETCH_FAILED', message } }, 500);
  }
});

// List contacts query schema
const listContactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
  guildId: z.string().optional().describe('Guild ID (required for Discord)'),
});

/**
 * GET /instances/:id/contacts - List contacts for an instance
 *
 * Returns cached contacts from the channel plugin.
 * For Discord, requires guildId query parameter.
 */
instancesRoutes.get('/:id/contacts', instanceAccess, zValidator('query', listContactsQuerySchema), async (c) => {
  const id = c.req.param('id');
  const { limit, guildId } = c.req.valid('query');
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

  // Check if plugin supports contacts fetching
  if (!('fetchContacts' in plugin) || typeof plugin.fetchContacts !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support contacts fetching` } },
      400,
    );
  }

  try {
    type Contact = {
      platformUserId: string;
      name?: string;
      phone?: string;
      profilePicUrl?: string;
      isGroup: boolean;
      isBusiness?: boolean;
      metadata?: Record<string, unknown>;
    };

    type FetchContactsResult = {
      totalFetched: number;
      contacts: Contact[];
    };

    // Build options based on channel type
    const fetchOptions: Record<string, unknown> = {};
    if (instance.channel === 'discord') {
      if (!guildId) {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'guildId is required for Discord instances' } },
          400,
        );
      }
      fetchOptions.guildId = guildId;
      fetchOptions.limit = limit;
    }

    const result = await (
      plugin as {
        fetchContacts: (instanceId: string, options: Record<string, unknown>) => Promise<FetchContactsResult>;
      }
    ).fetchContacts(id, fetchOptions);

    // If plugin returns contacts, use them
    if (result.contacts.length > 0) {
      const contacts = result.contacts.slice(0, limit);

      return c.json({
        items: contacts.map((contact) => ({
          platformUserId: contact.platformUserId,
          displayName: contact.name,
          phone: contact.phone,
          avatarUrl: contact.profilePicUrl,
          isGroup: contact.isGroup,
          isBusiness: contact.isBusiness,
          platformMetadata: contact.metadata,
        })),
        meta: {
          totalFetched: result.totalFetched,
          hasMore: contacts.length < result.contacts.length,
          cursor: undefined,
        },
      });
    }

    // Fallback: get contacts from stored platform identities
    const identitiesResult = await services.persons.listIdentitiesByInstance(id, { limit });

    return c.json({
      items: identitiesResult.items.map((identity) => ({
        platformUserId: identity.platformUserId,
        displayName: identity.platformUsername,
        phone: identity.platformUserId.includes('@s.whatsapp.net') ? identity.platformUserId.split('@')[0] : undefined,
        avatarUrl: identity.profilePicUrl,
        isGroup: identity.platformUserId.includes('@g.us'),
        isBusiness: undefined,
        platformMetadata: identity.profileData as Record<string, unknown> | undefined,
      })),
      meta: {
        totalFetched: identitiesResult.items.length,
        hasMore: identitiesResult.hasMore,
        cursor: identitiesResult.cursor,
      },
    });
  } catch (error) {
    const message = `Failed to fetch contacts: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'CONTACTS_FETCH_FAILED', message } }, 500);
  }
});

// List groups query schema
const listGroupsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
});

/**
 * GET /instances/:id/groups - List groups for an instance
 *
 * Returns groups the instance is participating in.
 */
instancesRoutes.get('/:id/groups', instanceAccess, zValidator('query', listGroupsQuerySchema), async (c) => {
  const id = c.req.param('id');
  const { limit } = c.req.valid('query');
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

  // Check if plugin supports groups fetching
  if (!('fetchGroups' in plugin) || typeof plugin.fetchGroups !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support groups fetching` } },
      400,
    );
  }

  try {
    type Group = {
      externalId: string;
      name?: string;
      description?: string;
      memberCount?: number;
      createdAt?: Date;
      createdBy?: string;
      isReadOnly?: boolean;
      metadata?: Record<string, unknown>;
    };

    type FetchGroupsResult = {
      totalFetched: number;
      groups: Group[];
    };

    const result = await (
      plugin as { fetchGroups: (instanceId: string, options: Record<string, unknown>) => Promise<FetchGroupsResult> }
    ).fetchGroups(id, {});

    // Apply limit
    const groups = result.groups.slice(0, limit);

    return c.json({
      items: groups.map((group) => ({
        externalId: group.externalId,
        name: group.name,
        description: group.description,
        memberCount: group.memberCount,
        createdAt: group.createdAt?.toISOString(),
        createdBy: group.createdBy,
        isReadOnly: group.isReadOnly,
        platformMetadata: group.metadata,
      })),
      meta: {
        totalFetched: result.totalFetched,
        hasMore: groups.length < result.groups.length,
        cursor: undefined, // TODO: implement pagination cursor
      },
    });
  } catch (error) {
    const message = `Failed to fetch groups: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'GROUPS_FETCH_FAILED', message } }, 500);
  }
});

// ============================================================================
// B2: CHECK NUMBER ON WHATSAPP
// ============================================================================

const checkNumberSchema = z.object({
  phones: z.array(z.string().min(1)).min(1).max(100).describe('Phone numbers to check (e.g., ["+5511999999999"])'),
});

/**
 * POST /instances/:id/check-number - Check if phone numbers are on WhatsApp
 */
instancesRoutes.post('/:id/check-number', instanceAccess, zValidator('json', checkNumberSchema), async (c) => {
  const id = c.req.param('id');
  const { phones } = c.req.valid('json');
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

  if (!('checkNumber' in plugin) || typeof plugin.checkNumber !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support number checking` } },
      400,
    );
  }

  try {
    type CheckResult = { exists: boolean; jid: string; phone: string };
    const results = await (
      plugin as { checkNumber: (id: string, phones: string[]) => Promise<CheckResult[]> }
    ).checkNumber(id, phones);

    return c.json({ data: { results } });
  } catch (error) {
    const message = `Failed to check numbers: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'CHECK_FAILED', message } }, 500);
  }
});

// ============================================================================
// B3: UPDATE OWN BIO/STATUS
// ============================================================================

const updateBioSchema = z.object({
  status: z.string().min(1).max(500).describe('New profile bio/status text'),
});

/**
 * PUT /instances/:id/profile/status - Update own bio/status
 */
instancesRoutes.put('/:id/profile/status', instanceAccess, zValidator('json', updateBioSchema), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
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

  if (!('updateBio' in plugin) || typeof plugin.updateBio !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support bio updates` } },
      400,
    );
  }

  try {
    await (plugin as { updateBio: (id: string, status: string) => Promise<void> }).updateBio(id, status);
    return c.json({ success: true, data: { status } });
  } catch (error) {
    const message = `Failed to update bio: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'UPDATE_FAILED', message } }, 500);
  }
});

// ============================================================================
// B4: BLOCK / UNBLOCK / BLOCKLIST
// ============================================================================

const blockContactSchema = z.object({
  contactId: z.string().min(1).describe('Contact JID or phone number to block'),
});

/**
 * POST /instances/:id/block - Block a contact
 */
instancesRoutes.post('/:id/block', instanceAccess, zValidator('json', blockContactSchema), async (c) => {
  const id = c.req.param('id');
  const { contactId } = c.req.valid('json');
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

  if (!('blockContact' in plugin) || typeof plugin.blockContact !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support blocking` } },
      400,
    );
  }

  try {
    await (plugin as { blockContact: (id: string, contactId: string) => Promise<void> }).blockContact(id, contactId);
    return c.json({ success: true, data: { contactId, action: 'blocked' } });
  } catch (error) {
    const message = `Failed to block contact: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'BLOCK_FAILED', message } }, 500);
  }
});

/**
 * DELETE /instances/:id/block - Unblock a contact
 */
instancesRoutes.delete('/:id/block', instanceAccess, zValidator('json', blockContactSchema), async (c) => {
  const id = c.req.param('id');
  const { contactId } = c.req.valid('json');
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

  if (!('unblockContact' in plugin) || typeof plugin.unblockContact !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support unblocking` } },
      400,
    );
  }

  try {
    await (plugin as { unblockContact: (id: string, contactId: string) => Promise<void> }).unblockContact(
      id,
      contactId,
    );
    return c.json({ success: true, data: { contactId, action: 'unblocked' } });
  } catch (error) {
    const message = `Failed to unblock contact: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'UNBLOCK_FAILED', message } }, 500);
  }
});

/**
 * GET /instances/:id/blocklist - Get blocked contacts list
 */
instancesRoutes.get('/:id/blocklist', instanceAccess, async (c) => {
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

  if (!('fetchBlocklist' in plugin) || typeof plugin.fetchBlocklist !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support blocklist` } },
      400,
    );
  }

  try {
    const blocklist = await (plugin as { fetchBlocklist: (id: string) => Promise<string[]> }).fetchBlocklist(id);
    return c.json({ data: { blocklist, count: blocklist.length } });
  } catch (error) {
    const message = `Failed to fetch blocklist: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'BLOCKLIST_FAILED', message } }, 500);
  }
});

export { instancesRoutes };
