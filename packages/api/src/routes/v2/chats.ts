/**
 * Chats routes - Unified chat/conversation management
 *
 * @see unified-messages wish
 */

import { zValidator } from '@hono/zod-validator';
import { ChannelTypeSchema } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const chatsRoutes = new Hono<{ Variables: AppVariables }>();

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

/**
 * POST /chats/:id/archive - Archive a chat
 */
chatsRoutes.post('/:id/archive', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const chat = await services.chats.archive(id);

  return c.json({ data: chat });
});

/**
 * POST /chats/:id/unarchive - Unarchive a chat
 */
chatsRoutes.post('/:id/unarchive', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const chat = await services.chats.unarchive(id);

  return c.json({ data: chat });
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

export { chatsRoutes };
