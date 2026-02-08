/**
 * Chats routes - Unified chat/conversation management
 *
 * @see unified-messages wish
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelRegistry } from '@omni/channel-sdk';
import { ChannelTypeSchema, ERROR_CODES, OmniError } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Services } from '../../services';
import type { AppVariables } from '../../types';

const chatsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Get validated plugin for an instance with capability check
 */
async function getPluginForInstance(
  services: Services,
  channelRegistry: ChannelRegistry | null | undefined,
  instanceId: string,
  requiredCapability?: 'canReceiveReadReceipts',
) {
  const instance = await services.instances.getById(instanceId);

  if (!channelRegistry) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: 'Channel registry not available',
      recoverable: false,
    });
  }

  const plugin = channelRegistry.get(instance.channel as ChannelType);
  if (!plugin) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: `No plugin found for channel: ${instance.channel}`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  if (requiredCapability && !plugin.capabilities[requiredCapability]) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support read receipts`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  return { instance, plugin };
}

// Chat type schema
const ChatTypeSchema = z.enum([
  'dm',
  'group',
  'channel',
  'thread',
  'forum',
  'voice',
  'broadcast',
  'community',
  'announcement',
  'stage',
]);

// List chats query schema
const listQuerySchema = z.object({
  instanceId: z.string().uuid().optional(),
  channel: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof ChannelTypeSchema>[] | undefined),
  chatType: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof ChatTypeSchema>[] | undefined),
  search: z.string().optional(),
  includeArchived: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// Create chat body schema
const createChatSchema = z.object({
  instanceId: z.string().uuid(),
  externalId: z.string().min(1),
  chatType: ChatTypeSchema,
  channel: ChannelTypeSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  canonicalId: z.string().optional(),
  parentChatId: z.string().uuid().optional(),
  settings: z.record(z.unknown()).optional(),
  platformMetadata: z.record(z.unknown()).optional(),
});

// Update chat body schema
const updateChatSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  avatarUrl: z.string().url().optional().nullable(),
  canonicalId: z.string().optional().nullable(),
  settings: z.record(z.unknown()).optional().nullable(),
  platformMetadata: z.record(z.unknown()).optional().nullable(),
});

// Add participant body schema
const addParticipantSchema = z.object({
  platformUserId: z.string().min(1),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  role: z.string().optional(),
  personId: z.string().uuid().optional(),
  platformIdentityId: z.string().uuid().optional(),
  platformMetadata: z.record(z.unknown()).optional(),
});

// Update participant role body schema
const updateParticipantRoleSchema = z.object({
  role: z.string().min(1),
});

/**
 * GET /chats - List chats
 */
chatsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const services = c.get('services');

  const result = await services.chats.list(query);

  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * POST /chats - Create a chat
 */
chatsRoutes.post('/', zValidator('json', createChatSchema), async (c) => {
  const body = c.req.valid('json');
  const services = c.get('services');

  const chat = await services.chats.create(body);

  return c.json({ data: chat }, 201);
});

/**
 * GET /chats/:id - Get chat by ID
 */
chatsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const chat = await services.chats.getById(id);

  return c.json({ data: chat });
});

/**
 * PATCH /chats/:id - Update a chat
 */
chatsRoutes.patch('/:id', zValidator('json', updateChatSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const services = c.get('services');

  const chat = await services.chats.update(id, body);

  return c.json({ data: chat });
});

/**
 * DELETE /chats/:id - Delete a chat (soft delete)
 */
chatsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  await services.chats.delete(id);

  return c.json({ success: true });
});

// Chat channel-level action body schema (optional instanceId to also apply on platform)
const chatChannelActionSchema = z
  .object({
    instanceId: z.string().uuid().optional().describe('Instance ID to also apply action on the channel'),
  })
  .optional();

// Mute action body schema
const muteActionSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  duration: z.number().int().positive().optional().describe('Mute duration in milliseconds (default: 8 hours)'),
});

/**
 * Apply a chat modification action on the channel plugin (if instanceId provided)
 */
async function applyChatModifyOnChannel(
  services: Services,
  channelRegistry: ChannelRegistry | null | undefined,
  instanceId: string,
  chatExternalId: string,
  action: string,
  value?: number,
): Promise<void> {
  if (!channelRegistry) return;
  const instance = await services.instances.getById(instanceId);
  const plugin = channelRegistry.get(instance.channel as ChannelType);
  if (!plugin) return;
  if ('chatModifyAction' in plugin && typeof plugin.chatModifyAction === 'function') {
    await (
      plugin as {
        chatModifyAction: (instanceId: string, chatId: string, action: string, value?: number) => Promise<void>;
      }
    ).chatModifyAction(instanceId, chatExternalId, action, value);
  }
}

/**
 * POST /chats/:id/archive - Archive a chat
 */
chatsRoutes.post('/:id/archive', zValidator('json', chatChannelActionSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const chat = await services.chats.archive(id);

  // Also apply on channel if instanceId provided
  if (body?.instanceId) {
    await applyChatModifyOnChannel(services, channelRegistry, body.instanceId, chat.externalId, 'archive');
  }

  return c.json({ data: chat });
});

/**
 * POST /chats/:id/unarchive - Unarchive a chat
 */
chatsRoutes.post('/:id/unarchive', zValidator('json', chatChannelActionSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const chat = await services.chats.unarchive(id);

  if (body?.instanceId) {
    await applyChatModifyOnChannel(services, channelRegistry, body.instanceId, chat.externalId, 'unarchive');
  }

  return c.json({ data: chat });
});

/**
 * POST /chats/:id/pin - Pin a chat on the channel
 */
chatsRoutes.post('/:id/pin', zValidator('json', z.object({ instanceId: z.string().uuid() })), async (c) => {
  const id = c.req.param('id');
  const { instanceId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const chat = await services.chats.getById(id);
  await applyChatModifyOnChannel(services, channelRegistry, instanceId, chat.externalId, 'pin');

  return c.json({ success: true, data: { chatId: id, action: 'pin' } });
});

/**
 * POST /chats/:id/unpin - Unpin a chat on the channel
 */
chatsRoutes.post('/:id/unpin', zValidator('json', z.object({ instanceId: z.string().uuid() })), async (c) => {
  const id = c.req.param('id');
  const { instanceId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const chat = await services.chats.getById(id);
  await applyChatModifyOnChannel(services, channelRegistry, instanceId, chat.externalId, 'unpin');

  return c.json({ success: true, data: { chatId: id, action: 'unpin' } });
});

/**
 * POST /chats/:id/mute - Mute a chat on the channel
 */
chatsRoutes.post('/:id/mute', zValidator('json', muteActionSchema), async (c) => {
  const id = c.req.param('id');
  const { instanceId, duration } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const chat = await services.chats.getById(id);
  await applyChatModifyOnChannel(services, channelRegistry, instanceId, chat.externalId, 'mute', duration);

  return c.json({ success: true, data: { chatId: id, action: 'mute', duration } });
});

/**
 * POST /chats/:id/unmute - Unmute a chat on the channel
 */
chatsRoutes.post('/:id/unmute', zValidator('json', z.object({ instanceId: z.string().uuid() })), async (c) => {
  const id = c.req.param('id');
  const { instanceId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const chat = await services.chats.getById(id);
  await applyChatModifyOnChannel(services, channelRegistry, instanceId, chat.externalId, 'unmute');

  return c.json({ success: true, data: { chatId: id, action: 'unmute' } });
});

/**
 * GET /chats/:id/participants - Get chat participants
 */
chatsRoutes.get('/:id/participants', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const participants = await services.chats.getParticipants(id);

  return c.json({ items: participants });
});

/**
 * POST /chats/:id/participants - Add a participant
 */
chatsRoutes.post('/:id/participants', zValidator('json', addParticipantSchema), async (c) => {
  const chatId = c.req.param('id');
  const body = c.req.valid('json');
  const services = c.get('services');

  const participant = await services.chats.addParticipant({
    chatId,
    ...body,
  });

  return c.json({ data: participant }, 201);
});

/**
 * DELETE /chats/:id/participants/:platformUserId - Remove a participant
 */
chatsRoutes.delete('/:id/participants/:platformUserId', async (c) => {
  const chatId = c.req.param('id');
  const platformUserId = c.req.param('platformUserId');
  const services = c.get('services');

  await services.chats.removeParticipant(chatId, platformUserId);

  return c.json({ success: true });
});

/**
 * PATCH /chats/:id/participants/:platformUserId/role - Update participant role
 */
chatsRoutes.patch(
  '/:id/participants/:platformUserId/role',
  zValidator('json', updateParticipantRoleSchema),
  async (c) => {
    const chatId = c.req.param('id');
    const platformUserId = c.req.param('platformUserId');
    const { role } = c.req.valid('json');
    const services = c.get('services');

    const participant = await services.chats.updateParticipantRole(chatId, platformUserId, role);

    return c.json({ data: participant });
  },
);

/**
 * GET /chats/:id/messages - Get messages for a chat
 */
chatsRoutes.get('/:id/messages', async (c) => {
  const chatId = c.req.param('id');
  const limit = Number.parseInt(c.req.query('limit') ?? '100', 10);
  const before = c.req.query('before');
  const after = c.req.query('after');
  const services = c.get('services');

  const messages = await services.messages.getChatMessages(chatId, {
    limit,
    before: before ? new Date(before) : undefined,
    after: after ? new Date(after) : undefined,
  });

  return c.json({ items: messages });
});

/**
 * GET /chats/by-external - Find chat by external ID
 */
chatsRoutes.get('/by-external', async (c) => {
  const instanceId = c.req.query('instanceId');
  const externalId = c.req.query('externalId');
  const services = c.get('services');

  if (!instanceId || !externalId) {
    return c.json({ error: 'instanceId and externalId are required' }, 400);
  }

  const chat = await services.chats.getByExternalId(instanceId, externalId);

  if (!chat) {
    return c.json({ data: null });
  }

  return c.json({ data: chat });
});

// Mark chat as read schema
const markChatReadSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
});

/**
 * POST /chats/:id/read - Mark entire chat as read
 *
 * Sends read receipt for all unread messages in the chat.
 * This is a convenience endpoint that marks the entire chat as read at once.
 *
 * Note: For WhatsApp, this uses presence update to mark all messages read.
 * For channels that don't support this, returns an error.
 */
chatsRoutes.post('/:id/read', zValidator('json', markChatReadSchema), async (c) => {
  const chatId = c.req.param('id');
  const { instanceId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Get chat from our database
  const chat = await services.chats.getById(chatId);

  // Verify instance matches
  if (chat.instanceId !== instanceId) {
    throw new OmniError({
      code: ERROR_CODES.VALIDATION,
      message: "Instance ID does not match the chat's instance",
      context: { instanceId, chatInstanceId: chat.instanceId },
      recoverable: false,
    });
  }

  const { instance, plugin } = await getPluginForInstance(
    services,
    channelRegistry,
    instanceId,
    'canReceiveReadReceipts',
  );

  // Check if plugin has markChatAsRead method (preferred) or markAsRead
  if ('markChatAsRead' in plugin && typeof plugin.markChatAsRead === 'function') {
    await (plugin as { markChatAsRead: (instanceId: string, chatId: string) => Promise<void> }).markChatAsRead(
      instanceId,
      chat.externalId,
    );
  } else if ('markAsRead' in plugin && typeof plugin.markAsRead === 'function') {
    // Fall back to markAsRead with 'all' marker (WhatsApp style)
    await (
      plugin as { markAsRead: (instanceId: string, chatId: string, messageIds: string[]) => Promise<void> }
    ).markAsRead(instanceId, chat.externalId, ['all']);
  } else {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement markAsRead or markChatAsRead`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  return c.json({
    success: true,
    data: {
      chatId,
      externalChatId: chat.externalId,
      instanceId,
    },
  });
});

export { chatsRoutes };
