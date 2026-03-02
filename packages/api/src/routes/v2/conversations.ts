/**
 * Conversations routes - Cross-channel conversation continuity
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const conversationsRoutes = new Hono<{ Variables: AppVariables }>();

// List query schema
const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Create conversation schema
const createConversationSchema = z.object({
  title: z.string().max(500).nullable().optional(),
  summary: z.string().nullable().optional(),
  state: z.record(z.string(), z.unknown()).nullable().optional(),
});

const updateConversationSchema = createConversationSchema.partial();

/**
 * GET /conversations - List conversations
 */
conversationsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { limit } = c.req.valid('query');
  const services = c.get('services');

  const items = await services.conversations.list({ limit });

  return c.json({ items });
});

/**
 * POST /conversations - Create conversation
 */
conversationsRoutes.post('/', zValidator('json', createConversationSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const conversation = await services.conversations.create(data);

  return c.json({ data: conversation }, 201);
});

/**
 * GET /conversations/:id - Get conversation by ID
 */
conversationsRoutes.get('/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');

  const conversation = await services.conversations.getById(id);

  return c.json({ data: conversation });
});

/**
 * PATCH /conversations/:id - Update conversation
 */
conversationsRoutes.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateConversationSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const services = c.get('services');

    const conversation = await services.conversations.update(id, data);

    return c.json({ data: conversation });
  },
);

/**
 * DELETE /conversations/:id - Delete conversation
 */
conversationsRoutes.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');

  await services.conversations.delete(id);

  return c.json({ success: true });
});

/**
 * GET /conversations/:id/chats - Get chats in conversation
 */
conversationsRoutes.get('/:id/chats', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');

  // Ensure conversation exists
  await services.conversations.getById(id);

  const items = await services.conversations.getChats(id);

  return c.json({ items });
});

export { conversationsRoutes };
