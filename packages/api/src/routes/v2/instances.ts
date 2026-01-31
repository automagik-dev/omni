/**
 * Instances routes - CRUD operations for channel instances
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelPlugin } from '@omni/channel-sdk';
import { ChannelTypeSchema } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { getQrCode } from '../../plugins/qr-store';
import type { AppVariables } from '../../types';

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

  // Get the channel plugin and trigger connection
  if (channelRegistry) {
    const plugin = channelRegistry.get(data.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        // Trigger plugin connection with forceNewQr for fresh QR code
        await plugin.connect(instance.id, {
          instanceId: instance.id,
          credentials: {},
          options: {
            forceNewQr: true,
          },
        });
        console.log(`[Instances] Triggered connection for instance ${instance.id} via ${data.channel}`);
      } catch (error) {
        console.error(`[Instances] Failed to connect instance ${instance.id}:`, error);
        // Don't fail the request - instance is created, connection can be retried
      }
    } else {
      console.warn(`[Instances] No plugin found for channel: ${data.channel}`);
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
        console.error(`[Instances] Failed to disconnect instance ${id} before delete:`, error);
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

/**
 * POST /instances/:id/connect - Connect instance
 *
 * Query params:
 * - forceNewQr: true - Clear auth state and force fresh QR code (for re-authentication)
 */
instancesRoutes.post('/:id/connect', async (c) => {
  const id = c.req.param('id');
  const forceNewQr = c.req.query('forceNewQr') === 'true';
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Trigger connection via channel plugin
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
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
        console.error(`[Instances] Failed to disconnect instance ${id}:`, error);
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
        console.error(`[Instances] Failed to logout instance ${id}:`, error);
      }
    } else if (plugin) {
      // Fall back to disconnect
      try {
        await plugin.disconnect(id);
      } catch (error) {
        console.error(`[Instances] Failed to disconnect instance ${id} during logout:`, error);
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

/**
 * GET /instances/supported-channels - List supported channel types
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

export { instancesRoutes };
