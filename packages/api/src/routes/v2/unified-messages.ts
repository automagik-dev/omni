/**
 * Unified Messages routes - Message management (source of truth)
 *
 * This is the new message API based on the unified-messages schema.
 * Messages are the source of truth, events are optional audit trail.
 *
 * @see unified-messages wish
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const unifiedMessagesRoutes = new Hono<{ Variables: AppVariables }>();

// Message source schema
const MessageSourceSchema = z.enum(['realtime', 'sync', 'api', 'import']);

// Message type schema
const MessageTypeSchema = z.enum([
  'text',
  'audio',
  'image',
  'video',
  'document',
  'sticker',
  'contact',
  'location',
  'poll',
  'system',
]);

// Message status schema
const MessageStatusSchema = z.enum(['active', 'edited', 'deleted', 'expired']);

// Delivery status schema
const DeliveryStatusSchema = z.enum(['pending', 'sent', 'delivered', 'read', 'failed']);

// List messages query schema
const listQuerySchema = z.object({
  chatId: z.string().uuid().optional(),
  source: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof MessageSourceSchema>[] | undefined),
  messageType: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof MessageTypeSchema>[] | undefined),
  status: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof MessageStatusSchema>[] | undefined),
  hasMedia: z.coerce.boolean().optional(),
  senderPersonId: z.string().uuid().optional(),
  since: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  until: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// Create message body schema
const createMessageSchema = z.object({
  chatId: z.string().uuid(),
  externalId: z.string().min(1),
  source: MessageSourceSchema,
  messageType: MessageTypeSchema,
  textContent: z.string().optional(),
  platformTimestamp: z.string().datetime(),
  // Sender info
  senderPersonId: z.string().uuid().optional(),
  senderPlatformIdentityId: z.string().uuid().optional(),
  senderPlatformUserId: z.string().optional(),
  senderDisplayName: z.string().optional(),
  isFromMe: z.boolean().optional(),
  // Media
  hasMedia: z.boolean().optional(),
  mediaMimeType: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  mediaLocalPath: z.string().optional(),
  mediaMetadata: z.record(z.unknown()).optional(),
  // Pre-processed content
  transcription: z.string().optional(),
  imageDescription: z.string().optional(),
  videoDescription: z.string().optional(),
  documentExtraction: z.string().optional(),
  // Reply/Forward
  replyToMessageId: z.string().uuid().optional(),
  replyToExternalId: z.string().optional(),
  quotedText: z.string().optional(),
  quotedSenderName: z.string().optional(),
  isForwarded: z.boolean().optional(),
  forwardedFromExternalId: z.string().optional(),
  // Raw data
  rawPayload: z.record(z.unknown()).optional(),
  // Event links
  originalEventId: z.string().uuid().optional(),
});

// Update message body schema
const updateMessageSchema = z.object({
  textContent: z.string().optional(),
  transcription: z.string().optional(),
  imageDescription: z.string().optional(),
  videoDescription: z.string().optional(),
  documentExtraction: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  mediaLocalPath: z.string().optional(),
  mediaMetadata: z.record(z.unknown()).optional(),
});

// Record edit body schema
const recordEditSchema = z.object({
  newText: z.string(),
  editedAt: z.string().datetime(),
  editedBy: z.string().optional(),
  latestEventId: z.string().uuid().optional(),
});

// Add reaction body schema
const addReactionSchema = z.object({
  emoji: z.string().min(1),
  platformUserId: z.string().min(1),
  personId: z.string().uuid().optional(),
  displayName: z.string().optional(),
  isCustomEmoji: z.boolean().optional(),
  customEmojiId: z.string().optional(),
  latestEventId: z.string().uuid().optional(),
});

// Remove reaction body schema
const removeReactionSchema = z.object({
  platformUserId: z.string().min(1),
  emoji: z.string().min(1),
  latestEventId: z.string().uuid().optional(),
});

// Update delivery status body schema
const updateDeliveryStatusSchema = z.object({
  status: DeliveryStatusSchema,
  latestEventId: z.string().uuid().optional(),
});

/**
 * GET /unified-messages - List messages
 */
unifiedMessagesRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const services = c.get('services');

  const result = await services.messages.list(query);

  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * POST /unified-messages - Create a message
 */
unifiedMessagesRoutes.post('/', zValidator('json', createMessageSchema), async (c) => {
  const body = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.create({
    ...body,
    platformTimestamp: new Date(body.platformTimestamp),
  });

  return c.json({ data: message }, 201);
});

/**
 * GET /unified-messages/:id - Get message by ID
 */
unifiedMessagesRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const message = await services.messages.getById(id);

  return c.json({ data: message });
});

/**
 * PATCH /unified-messages/:id - Update a message
 */
unifiedMessagesRoutes.patch('/:id', zValidator('json', updateMessageSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.update(id, body);

  return c.json({ data: message });
});

/**
 * POST /unified-messages/:id/edit - Record a message edit
 */
unifiedMessagesRoutes.post('/:id/edit', zValidator('json', recordEditSchema), async (c) => {
  const id = c.req.param('id');
  const { newText, editedAt, editedBy, latestEventId } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.recordEdit(id, newText, new Date(editedAt), editedBy, latestEventId);

  return c.json({ data: message });
});

/**
 * DELETE /unified-messages/:id - Mark message as deleted
 */
unifiedMessagesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const latestEventId = c.req.query('latestEventId');
  const services = c.get('services');

  await services.messages.markDeleted(id, latestEventId ?? undefined);

  return c.json({ success: true });
});

/**
 * POST /unified-messages/:id/reactions - Add a reaction
 */
unifiedMessagesRoutes.post('/:id/reactions', zValidator('json', addReactionSchema), async (c) => {
  const id = c.req.param('id');
  const { latestEventId, ...reaction } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.addReaction(id, reaction, latestEventId);

  return c.json({ data: message });
});

/**
 * DELETE /unified-messages/:id/reactions - Remove a reaction
 */
unifiedMessagesRoutes.delete('/:id/reactions', zValidator('json', removeReactionSchema), async (c) => {
  const id = c.req.param('id');
  const { platformUserId, emoji, latestEventId } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.removeReaction(id, platformUserId, emoji, latestEventId);

  return c.json({ data: message });
});

/**
 * PATCH /unified-messages/:id/delivery-status - Update delivery status
 */
unifiedMessagesRoutes.patch('/:id/delivery-status', zValidator('json', updateDeliveryStatusSchema), async (c) => {
  const id = c.req.param('id');
  const { status, latestEventId } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.updateDeliveryStatus(id, status, latestEventId);

  return c.json({ data: message });
});

/**
 * PATCH /unified-messages/:id/transcription - Update transcription
 */
unifiedMessagesRoutes.patch(
  '/:id/transcription',
  zValidator('json', z.object({ transcription: z.string() })),
  async (c) => {
    const id = c.req.param('id');
    const { transcription } = c.req.valid('json');
    const services = c.get('services');

    const message = await services.messages.updateTranscription(id, transcription);

    return c.json({ data: message });
  },
);

/**
 * PATCH /unified-messages/:id/image-description - Update image description
 */
unifiedMessagesRoutes.patch(
  '/:id/image-description',
  zValidator('json', z.object({ description: z.string() })),
  async (c) => {
    const id = c.req.param('id');
    const { description } = c.req.valid('json');
    const services = c.get('services');

    const message = await services.messages.updateImageDescription(id, description);

    return c.json({ data: message });
  },
);

/**
 * PATCH /unified-messages/:id/video-description - Update video description
 */
unifiedMessagesRoutes.patch(
  '/:id/video-description',
  zValidator('json', z.object({ description: z.string() })),
  async (c) => {
    const id = c.req.param('id');
    const { description } = c.req.valid('json');
    const services = c.get('services');

    const message = await services.messages.updateVideoDescription(id, description);

    return c.json({ data: message });
  },
);

/**
 * PATCH /unified-messages/:id/document-extraction - Update document extraction
 */
unifiedMessagesRoutes.patch(
  '/:id/document-extraction',
  zValidator('json', z.object({ extraction: z.string() })),
  async (c) => {
    const id = c.req.param('id');
    const { extraction } = c.req.valid('json');
    const services = c.get('services');

    const message = await services.messages.updateDocumentExtraction(id, extraction);

    return c.json({ data: message });
  },
);

/**
 * GET /unified-messages/by-external - Find message by external ID
 */
unifiedMessagesRoutes.get('/by-external', async (c) => {
  const chatId = c.req.query('chatId');
  const externalId = c.req.query('externalId');
  const services = c.get('services');

  if (!chatId || !externalId) {
    return c.json({ error: 'chatId and externalId are required' }, 400);
  }

  const message = await services.messages.getByExternalId(chatId, externalId);

  if (!message) {
    return c.json({ data: null });
  }

  return c.json({ data: message });
});

export { unifiedMessagesRoutes };
