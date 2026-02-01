/**
 * Messages routes - Message CRUD and sending operations
 *
 * API structure:
 * - GET    /messages              - List messages
 * - GET    /messages/:id          - Get message by ID
 * - POST   /messages              - Create message record
 * - PATCH  /messages/:id          - Update message
 * - DELETE /messages/:id          - Mark message as deleted
 * - GET    /messages/by-external  - Find by external ID
 *
 * Message operations:
 * - POST   /messages/:id/edit            - Record edit
 * - POST   /messages/:id/reactions       - Add reaction
 * - DELETE /messages/:id/reactions       - Remove reaction
 * - PATCH  /messages/:id/delivery-status - Update delivery status
 * - PATCH  /messages/:id/transcription   - Update transcription
 * - PATCH  /messages/:id/image-description
 * - PATCH  /messages/:id/video-description
 * - PATCH  /messages/:id/document-extraction
 *
 * Send operations (via channel plugins):
 * - POST /messages/send          - Send text message
 * - POST /messages/send/media    - Send media message
 * - POST /messages/send/reaction - Send reaction
 * - POST /messages/send/sticker  - Send sticker
 * - POST /messages/send/contact  - Send contact card
 * - POST /messages/send/location - Send location
 *
 * @see unified-messages wish
 */

import { zValidator } from '@hono/zod-validator';
import type { OutgoingContent, OutgoingMessage } from '@omni/channel-sdk';
import { ERROR_CODES, OmniError } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Services } from '../../services';
import type { AppVariables } from '../../types';

const messagesRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * UUID v4 regex pattern
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a UUID (likely an Omni person ID)
 */
function isUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Resolve recipient - handles both Omni person IDs and platform IDs
 *
 * Per DEC-1: Auto-detect recipient format (UUID = person, otherwise = platform ID)
 * Per DEC-2: If person has multiple identities on channel, use most recently active
 *
 * @param to - Recipient identifier (UUID or platform ID)
 * @param channelType - The channel type to resolve for
 * @param services - Service container
 * @returns The platform-specific user ID
 */
async function resolveRecipient(to: string, channelType: string, services: Services): Promise<string> {
  // If not a UUID, treat as platform-specific ID directly
  if (!isUUID(to)) {
    return to;
  }

  // It's a UUID - resolve person to platform identity
  const identity = await services.persons.getIdentityForChannel(to, channelType);

  if (!identity) {
    throw new OmniError({
      code: ERROR_CODES.RECIPIENT_NOT_ON_CHANNEL,
      message: `Person ${to} has no identity on ${channelType}`,
      context: { personId: to, channelType },
      recoverable: false,
    });
  }

  return identity.platformUserId;
}

// ============================================================================
// Schemas
// ============================================================================

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

// Send text message schema
const sendTextSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Recipient (phone number or platform ID)'),
  text: z.string().min(1).describe('Message text'),
  replyTo: z.string().optional().describe('Message ID to reply to'),
});

// Send media schema
const sendMediaSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Recipient'),
  type: z.enum(['image', 'audio', 'video', 'document']).describe('Media type'),
  url: z.string().url().optional().describe('Media URL'),
  base64: z.string().optional().describe('Base64 encoded media'),
  filename: z.string().optional().describe('Filename for documents'),
  caption: z.string().optional().describe('Caption for media'),
  voiceNote: z.boolean().optional().describe('Send audio as voice note'),
});

// Send reaction schema
const sendReactionSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Chat ID'),
  messageId: z.string().min(1).describe('Message ID to react to'),
  emoji: z.string().min(1).describe('Emoji to react with'),
});

// Send sticker schema
const sendStickerSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Recipient'),
  url: z.string().url().optional().describe('Sticker URL'),
  base64: z.string().optional().describe('Base64 encoded sticker'),
});

// Send contact schema
const sendContactSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Recipient'),
  contact: z.object({
    name: z.string().min(1).describe('Contact name'),
    phone: z.string().optional().describe('Phone number'),
    email: z.string().email().optional().describe('Email address'),
    organization: z.string().optional().describe('Organization'),
  }),
});

// Send location schema
const sendLocationSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Recipient'),
  latitude: z.number().describe('Latitude'),
  longitude: z.number().describe('Longitude'),
  name: z.string().optional().describe('Location name'),
  address: z.string().optional().describe('Address'),
});

// ============================================================================
// Message CRUD Routes
// ============================================================================

/**
 * GET /messages - List messages
 */
messagesRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
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
 * GET /messages/by-external - Find message by external ID
 * NOTE: Must be before /:id to avoid route conflict
 */
messagesRoutes.get('/by-external', async (c) => {
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

/**
 * POST /messages - Create a message record
 */
messagesRoutes.post('/', zValidator('json', createMessageSchema), async (c) => {
  const body = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.create({
    ...body,
    platformTimestamp: new Date(body.platformTimestamp),
  });

  return c.json({ data: message }, 201);
});

/**
 * GET /messages/:id - Get message by ID
 */
messagesRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const message = await services.messages.getById(id);

  return c.json({ data: message });
});

/**
 * PATCH /messages/:id - Update a message
 */
messagesRoutes.patch('/:id', zValidator('json', updateMessageSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.update(id, body);

  return c.json({ data: message });
});

/**
 * DELETE /messages/:id - Mark message as deleted
 */
messagesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const latestEventId = c.req.query('latestEventId');
  const services = c.get('services');

  await services.messages.markDeleted(id, latestEventId ?? undefined);

  return c.json({ success: true });
});

// ============================================================================
// Message Operation Routes
// ============================================================================

/**
 * POST /messages/:id/edit - Record a message edit
 */
messagesRoutes.post('/:id/edit', zValidator('json', recordEditSchema), async (c) => {
  const id = c.req.param('id');
  const { newText, editedAt, editedBy, latestEventId } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.recordEdit(id, newText, new Date(editedAt), editedBy, latestEventId);

  return c.json({ data: message });
});

/**
 * POST /messages/:id/reactions - Add a reaction
 */
messagesRoutes.post('/:id/reactions', zValidator('json', addReactionSchema), async (c) => {
  const id = c.req.param('id');
  const { latestEventId, ...reaction } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.addReaction(id, reaction, latestEventId);

  return c.json({ data: message });
});

/**
 * DELETE /messages/:id/reactions - Remove a reaction
 */
messagesRoutes.delete('/:id/reactions', zValidator('json', removeReactionSchema), async (c) => {
  const id = c.req.param('id');
  const { platformUserId, emoji, latestEventId } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.removeReaction(id, platformUserId, emoji, latestEventId);

  return c.json({ data: message });
});

/**
 * PATCH /messages/:id/delivery-status - Update delivery status
 */
messagesRoutes.patch('/:id/delivery-status', zValidator('json', updateDeliveryStatusSchema), async (c) => {
  const id = c.req.param('id');
  const { status, latestEventId } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.updateDeliveryStatus(id, status, latestEventId);

  return c.json({ data: message });
});

/**
 * PATCH /messages/:id/transcription - Update transcription
 */
messagesRoutes.patch('/:id/transcription', zValidator('json', z.object({ transcription: z.string() })), async (c) => {
  const id = c.req.param('id');
  const { transcription } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.updateTranscription(id, transcription);

  return c.json({ data: message });
});

/**
 * PATCH /messages/:id/image-description - Update image description
 */
messagesRoutes.patch('/:id/image-description', zValidator('json', z.object({ description: z.string() })), async (c) => {
  const id = c.req.param('id');
  const { description } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.updateImageDescription(id, description);

  return c.json({ data: message });
});

/**
 * PATCH /messages/:id/video-description - Update video description
 */
messagesRoutes.patch('/:id/video-description', zValidator('json', z.object({ description: z.string() })), async (c) => {
  const id = c.req.param('id');
  const { description } = c.req.valid('json');
  const services = c.get('services');

  const message = await services.messages.updateVideoDescription(id, description);

  return c.json({ data: message });
});

/**
 * PATCH /messages/:id/document-extraction - Update document extraction
 */
messagesRoutes.patch(
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

// ============================================================================
// Send Routes (via channel plugins)
// ============================================================================

/**
 * POST /messages/send - Send text message
 */
messagesRoutes.post('/send', zValidator('json', sendTextSchema), async (c) => {
  const { instanceId, to, text, replyTo } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Verify instance exists
  const instance = await services.instances.getById(instanceId);

  // Get channel plugin
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

  // Check if plugin supports text messaging
  if (!plugin.capabilities.canSendText) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support sending text messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Resolve recipient (handles person ID to platform ID resolution)
  const resolvedTo = await resolveRecipient(to, instance.channel, services);

  // Build outgoing message
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'text',
      text,
    } as OutgoingContent,
    replyTo,
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send message',
      context: {
        channelType: instance.channel,
        instanceId,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      recoverable: result.retryable ?? false,
    });
  }

  return c.json(
    {
      data: {
        messageId: result.messageId,
        externalMessageId: result.messageId,
        status: 'sent',
        instanceId: instance.id,
        to,
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

/**
 * POST /messages/send/media - Send media message
 */
messagesRoutes.post('/send/media', zValidator('json', sendMediaSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Verify instance exists
  const instance = await services.instances.getById(data.instanceId);

  // Validate that either url or base64 is provided
  if (!data.url && !data.base64) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Either url or base64 must be provided' } }, 400);
  }

  // Get channel plugin
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

  // Check if plugin supports media messaging
  if (!plugin.capabilities.canSendMedia) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support sending media`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Resolve recipient (handles person ID to platform ID resolution)
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Build outgoing message
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: data.type,
      mediaUrl: data.url,
      caption: data.caption,
      filename: data.filename,
    } as OutgoingContent,
    metadata: {
      base64: data.base64,
      voiceNote: data.voiceNote,
    },
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(data.instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send media',
      context: {
        channelType: instance.channel,
        instanceId: data.instanceId,
        mediaType: data.type,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      recoverable: result.retryable ?? false,
    });
  }

  return c.json(
    {
      data: {
        messageId: result.messageId,
        externalMessageId: result.messageId,
        status: 'sent',
        instanceId: instance.id,
        to: data.to,
        mediaType: data.type,
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

/**
 * POST /messages/send/reaction - Send reaction
 */
messagesRoutes.post('/send/reaction', zValidator('json', sendReactionSchema), async (c) => {
  const { instanceId, to, messageId, emoji } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Verify instance exists
  const instance = await services.instances.getById(instanceId);

  // Get channel plugin
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

  // Check if plugin supports reactions
  if (!plugin.capabilities.canSendReaction) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support sending reactions`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Resolve recipient (handles person ID to platform ID resolution)
  // Note: For reactions, 'to' is typically a chat ID, but we support person ID resolution too
  const resolvedTo = await resolveRecipient(to, instance.channel, services);

  // Build outgoing message for reaction
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'reaction',
      emoji,
      targetMessageId: messageId,
    } as OutgoingContent,
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send reaction',
      context: {
        channelType: instance.channel,
        instanceId,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      recoverable: result.retryable ?? false,
    });
  }

  return c.json({
    success: true,
    data: {
      messageId: result.messageId,
      timestamp: result.timestamp,
    },
  });
});

/**
 * POST /messages/send/sticker - Send sticker
 */
messagesRoutes.post('/send/sticker', zValidator('json', sendStickerSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Verify instance exists
  const instance = await services.instances.getById(data.instanceId);

  // Validate that either url or base64 is provided
  if (!data.url && !data.base64) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Either url or base64 must be provided' } }, 400);
  }

  // Get channel plugin
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

  // Check if plugin supports stickers
  if (!plugin.capabilities.canSendSticker) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support sending stickers`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Resolve recipient (handles person ID to platform ID resolution)
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Build outgoing message for sticker
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'sticker',
      mediaUrl: data.url,
    } as OutgoingContent,
    metadata: {
      base64: data.base64,
    },
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(data.instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send sticker',
      context: {
        channelType: instance.channel,
        instanceId: data.instanceId,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      recoverable: result.retryable ?? false,
    });
  }

  return c.json(
    {
      data: {
        messageId: result.messageId,
        externalMessageId: result.messageId,
        status: 'sent',
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

/**
 * POST /messages/send/contact - Send contact card
 */
messagesRoutes.post('/send/contact', zValidator('json', sendContactSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Verify instance exists
  const instance = await services.instances.getById(data.instanceId);

  // Get channel plugin
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

  // Check if plugin supports contacts
  if (!plugin.capabilities.canSendContact) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support sending contacts`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Resolve recipient (handles person ID to platform ID resolution)
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Build outgoing message for contact
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'contact',
      contact: data.contact,
    } as OutgoingContent,
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(data.instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send contact',
      context: {
        channelType: instance.channel,
        instanceId: data.instanceId,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      recoverable: result.retryable ?? false,
    });
  }

  return c.json(
    {
      data: {
        messageId: result.messageId,
        externalMessageId: result.messageId,
        status: 'sent',
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

/**
 * POST /messages/send/location - Send location
 */
messagesRoutes.post('/send/location', zValidator('json', sendLocationSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  // Verify instance exists
  const instance = await services.instances.getById(data.instanceId);

  // Get channel plugin
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

  // Check if plugin supports locations
  if (!plugin.capabilities.canSendLocation) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support sending locations`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Resolve recipient (handles person ID to platform ID resolution)
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Build outgoing message for location
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'location',
      location: {
        latitude: data.latitude,
        longitude: data.longitude,
        name: data.name,
        address: data.address,
      },
    } as OutgoingContent,
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(data.instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send location',
      context: {
        channelType: instance.channel,
        instanceId: data.instanceId,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      recoverable: result.retryable ?? false,
    });
  }

  return c.json(
    {
      data: {
        messageId: result.messageId,
        externalMessageId: result.messageId,
        status: 'sent',
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

export { messagesRoutes };
