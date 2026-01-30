/**
 * Instances routes - CRUD operations for channel instances
 */

import { zValidator } from '@hono/zod-validator';
import { ChannelTypeSchema } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
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

  const instance = await services.instances.create(data);

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

  await services.instances.delete(id);

  return c.json({ success: true });
});

/**
 * GET /instances/:id/status - Get instance connection status
 */
instancesRoutes.get('/:id/status', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  // TODO: Get actual connection status from channel plugin
  return c.json({
    data: {
      instanceId: instance.id,
      isConnected: instance.isActive,
      connectedAt: null,
      profileName: instance.profileName,
      profilePicUrl: instance.profilePicUrl,
      ownerIdentifier: instance.ownerIdentifier,
      lastError: null,
      lastErrorAt: null,
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

  // TODO: Get actual QR from channel plugin
  return c.json({
    data: {
      qr: null,
      expiresAt: null,
      message: 'QR code generation not implemented yet',
    },
  });
});

/**
 * POST /instances/:id/connect - Connect instance
 */
instancesRoutes.post('/:id/connect', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const _instance = await services.instances.getById(id);

  // TODO: Trigger actual connection via channel plugin
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

  const _instance = await services.instances.getById(id);

  // TODO: Trigger actual disconnection via channel plugin
  const _updated = await services.instances.update(id, { isActive: false });

  return c.json({ success: true });
});

/**
 * POST /instances/:id/restart - Restart instance
 */
instancesRoutes.post('/:id/restart', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  // TODO: Trigger actual restart via channel plugin
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

  const _instance = await services.instances.getById(id);

  // TODO: Clear session via channel plugin
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
  return c.json({
    items: [
      {
        id: 'whatsapp-baileys',
        name: 'WhatsApp (Baileys)',
        description: 'Unofficial WhatsApp via Baileys library',
        requiresQr: true,
        supportsOAuth: false,
        capabilities: ['text', 'image', 'audio', 'video', 'document', 'sticker', 'reaction', 'location', 'contact'],
      },
      {
        id: 'whatsapp-cloud',
        name: 'WhatsApp Business Cloud',
        description: 'Official WhatsApp Business API',
        requiresQr: false,
        supportsOAuth: true,
        capabilities: ['text', 'image', 'audio', 'video', 'document', 'sticker', 'reaction', 'location', 'contact'],
      },
      {
        id: 'discord',
        name: 'Discord',
        description: 'Discord bot integration',
        requiresQr: false,
        supportsOAuth: true,
        capabilities: ['text', 'image', 'audio', 'video', 'document', 'reaction'],
      },
      {
        id: 'slack',
        name: 'Slack',
        description: 'Slack bot integration',
        requiresQr: false,
        supportsOAuth: true,
        capabilities: ['text', 'image', 'document', 'reaction'],
      },
      {
        id: 'telegram',
        name: 'Telegram',
        description: 'Telegram bot integration',
        requiresQr: false,
        supportsOAuth: false,
        capabilities: ['text', 'image', 'audio', 'video', 'document', 'sticker', 'reaction', 'location', 'contact'],
      },
    ],
  });
});

export { instancesRoutes };
