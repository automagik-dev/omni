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
 * - POST /messages/send/tts      - Send TTS voice note (ElevenLabs)
 * - POST /messages/send/reaction - Send reaction
 * - POST /messages/send/sticker  - Send sticker
 * - POST /messages/send/contact  - Send contact card
 * - POST /messages/send/location - Send location
 *
 * @see unified-messages wish
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelRegistry, OutgoingContent, OutgoingMessage } from '@omni/channel-sdk';
import { ERROR_CODES, OmniError } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Services } from '../../services';
import { ApiKeyService } from '../../services/api-keys';
import type { ApiKeyData, AppVariables } from '../../types';

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
 */
async function resolveRecipient(to: string, channelType: string, services: Services): Promise<string> {
  if (!isUUID(to)) return to;

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

/**
 * Plugin capability keys
 */
type PluginCapability =
  | 'canSendText'
  | 'canSendMedia'
  | 'canSendReaction'
  | 'canSendPoll'
  | 'canSendSticker'
  | 'canSendContact'
  | 'canSendLocation'
  | 'canSendTyping'
  | 'canReceiveReadReceipts';

/**
 * Get validated plugin for an instance with capability check
 */
async function getPluginForInstance(
  services: Services,
  channelRegistry: ChannelRegistry | null | undefined,
  instanceId: string,
  requiredCapability?: PluginCapability,
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
    const capabilityNames: Record<PluginCapability, string> = {
      canSendText: 'sending text messages',
      canSendMedia: 'sending media',
      canSendReaction: 'sending reactions',
      canSendPoll: 'sending polls',
      canSendSticker: 'sending stickers',
      canSendContact: 'sending contacts',
      canSendLocation: 'sending locations',
      canSendTyping: 'sending typing indicators',
      canReceiveReadReceipts: 'read receipts',
    };
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support ${capabilityNames[requiredCapability]}`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  return { instance, plugin };
}

/**
 * Look up reply context (isFromMe, rawPayload, text) for a message being replied to
 */
async function getReplyContext(
  services: Services,
  instanceId: string,
  chatExternalId: string,
  replyToId: string,
): Promise<{ replyToFromMe?: boolean; replyToRawPayload?: Record<string, unknown>; replyToText?: string }> {
  const chat = await services.chats.getByExternalId(instanceId, chatExternalId);
  if (!chat) return {};

  const originalMessage = await services.messages.getByExternalId(chat.id, replyToId);
  if (!originalMessage) return {};

  return {
    replyToFromMe: originalMessage.isFromMe,
    replyToRawPayload: originalMessage.rawPayload as Record<string, unknown> | undefined,
    replyToText: originalMessage.textContent ?? undefined,
  };
}

/**
 * Check if an API key has access to a specific instance.
 * Throws FORBIDDEN error if access is denied.
 */
function checkInstanceAccess(apiKey: ApiKeyData | undefined, instanceId: string): void {
  if (apiKey && !ApiKeyService.instanceAllowed(apiKey.instanceIds, instanceId)) {
    throw new OmniError({
      code: ERROR_CODES.FORBIDDEN,
      message: 'API key does not have access to this instance',
      context: { instanceId },
      recoverable: false,
    });
  }
}

/**
 * Handle send result and throw error if failed
 */
function handleSendResult(
  result: {
    success: boolean;
    messageId?: string;
    error?: string;
    errorCode?: string;
    retryable?: boolean;
    timestamp?: number;
  },
  context: { channelType: string; instanceId: string; operation: string },
): void {
  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? `Failed to ${context.operation}`,
      context: {
        channelType: context.channelType,
        instanceId: context.instanceId,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      recoverable: result.retryable ?? false,
    });
  }
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

// Mention schema - supports both WhatsApp and Discord formats
const MentionSchema = z.object({
  id: z.string().min(1).describe('User/role ID to mention'),
  type: z.enum(['user', 'role', 'channel', 'everyone', 'here']).default('user').describe('Mention type'),
});

// Send text message schema
const sendTextSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Recipient (phone number or platform ID)'),
  text: z.string().min(1).describe('Message text'),
  replyTo: z.string().optional().describe('Message ID to reply to'),
  mentions: z.array(MentionSchema).optional().describe('Users/roles to mention'),
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
  const apiKey = c.get('apiKey');

  // If API key has instance restrictions, pass them to the query
  const queryWithAccess = apiKey?.instanceIds ? { ...query, instanceIds: apiKey.instanceIds } : query;

  // Run list and count in parallel for efficiency
  const [result, total] = await Promise.all([
    services.messages.list(queryWithAccess),
    services.messages.count(queryWithAccess),
  ]);

  return c.json({
    items: result.items,
    meta: {
      total,
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
  const { instanceId, to, text, replyTo, mentions } = c.req.valid('json');
  const services = c.get('services');
  checkInstanceAccess(c.get('apiKey'), instanceId);

  const { instance, plugin } = await getPluginForInstance(
    services,
    c.get('channelRegistry'),
    instanceId,
    'canSendText',
  );
  const resolvedTo = await resolveRecipient(to, instance.channel, services);

  // Get reply context if replying
  const replyContext = replyTo ? await getReplyContext(services, instanceId, resolvedTo, replyTo) : {};

  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: { type: 'text', text } as OutgoingContent,
    replyTo,
    metadata: { ...(mentions ? { mentions } : {}), ...replyContext },
  };

  const result = await plugin.sendMessage(instanceId, outgoingMessage);
  handleSendResult(result, { channelType: instance.channel, instanceId, operation: 'send message' });

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
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

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
      // WhatsApp uses 'ptt' (push-to-talk) flag for voice notes
      ptt: data.voiceNote,
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
  checkInstanceAccess(c.get('apiKey'), instanceId);

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
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

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
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

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
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

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

// ============================================================================
// TTS Routes (Text-to-Speech)
// ============================================================================

/**
 * GET /messages/tts/voices - List available TTS voices
 *
 * Returns available ElevenLabs voices. Results are cached for 5 minutes.
 */
messagesRoutes.get('/tts/voices', async (c) => {
  const services = c.get('services');

  const voices = await services.tts.listVoices();

  return c.json({
    data: { voices },
  });
});

// Send TTS schema
const sendTtsSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Recipient (phone number or platform ID)'),
  text: z.string().min(1).max(5000).describe('Text to convert to speech (supports [happy], [laughs] tags)'),
  voiceId: z.string().optional().describe('ElevenLabs voice ID'),
  modelId: z.string().optional().describe('ElevenLabs model (default: eleven_v3)'),
  stability: z.number().min(0).max(1).optional().describe('Voice stability (0-1, default: 0.5)'),
  similarityBoost: z.number().min(0).max(1).optional().describe('Similarity boost (0-1, default: 0.75)'),
  presenceDelay: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .describe('Custom recording presence duration in ms (default: match audio duration)'),
});

/**
 * POST /messages/send/tts - Send TTS voice note
 *
 * Converts text to speech using ElevenLabs, converts to OGG/Opus,
 * shows recording presence, then sends as a voice note.
 */
messagesRoutes.post('/send/tts', zValidator('json', sendTtsSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

  const { instance, plugin } = await getPluginForInstance(
    services,
    c.get('channelRegistry'),
    data.instanceId,
    'canSendMedia',
  );

  // Resolve recipient
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Synthesize speech (request > instance defaults > global defaults)
  const ttsResult = await services.tts.synthesize(data.text, {
    voiceId: data.voiceId || instance.ttsVoiceId || undefined,
    modelId: data.modelId || instance.ttsModelId || undefined,
    stability: data.stability,
    similarityBoost: data.similarityBoost,
  });

  // Show "recording" presence before sending (if plugin supports it)
  if ('sendTyping' in plugin && typeof plugin.sendTyping === 'function') {
    const presenceDuration = data.presenceDelay ?? Math.min(ttsResult.durationMs, 15000);
    try {
      await (plugin as { sendTyping: (id: string, chatId: string, duration?: number) => Promise<void> }).sendTyping(
        data.instanceId,
        resolvedTo,
        presenceDuration,
      );
      // Wait for presence duration before sending
      if (presenceDuration > 0) {
        await new Promise((resolve) => setTimeout(resolve, presenceDuration));
      }
    } catch {
      // Presence is best-effort, don't fail the send
    }
  }

  // Build outgoing voice note message
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'audio',
      mimeType: ttsResult.mimeType,
    } as OutgoingContent,
    metadata: {
      audioBuffer: ttsResult.buffer,
      ptt: true,
    },
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(data.instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send TTS voice note',
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
        instanceId: instance.id,
        to: data.to,
        audioSizeKb: ttsResult.sizeKb,
        durationMs: ttsResult.durationMs,
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

// ============================================================================
// Forward Route (WhatsApp)
// ============================================================================

// Forward message schema
const forwardMessageSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Recipient to forward to'),
  messageId: z.string().min(1).describe('External message ID to forward'),
  fromChatId: z.string().min(1).describe('Chat ID where the message is from'),
});

/**
 * POST /messages/send/forward - Forward a message (WhatsApp)
 *
 * Fetches the original message from our DB and uses its rawPayload for forwarding.
 * This ensures the "Forwarded" label appears correctly.
 */
messagesRoutes.post('/send/forward', zValidator('json', forwardMessageSchema), async (c) => {
  const { instanceId, to, messageId, fromChatId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), instanceId);

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

  // Check if plugin supports forwarding
  if (!plugin.capabilities.canForwardMessage) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support forwarding messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Fetch the original message from our DB to get rawPayload
  // Chat externalId is the platform chat ID (e.g., WhatsApp JID)
  const chat = await services.chats.getByExternalId(instanceId, fromChatId);
  if (!chat) {
    throw new OmniError({
      code: ERROR_CODES.NOT_FOUND,
      message: `Chat not found for ${fromChatId}`,
      context: { fromChatId },
      recoverable: false,
    });
  }

  const originalMessage = await services.messages.getByExternalId(chat.id, messageId);
  if (!originalMessage) {
    throw new OmniError({
      code: ERROR_CODES.NOT_FOUND,
      message: `Message not found: ${messageId}`,
      context: { messageId, chatId: chat.id },
      recoverable: false,
    });
  }

  if (!originalMessage.rawPayload) {
    throw new OmniError({
      code: ERROR_CODES.VALIDATION,
      message: 'Message does not have rawPayload - cannot forward',
      context: { messageId },
      recoverable: false,
    });
  }

  // Resolve recipient
  const resolvedTo = await resolveRecipient(to, instance.channel, services);

  // Build outgoing message for forward with the full rawPayload
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'text',
      text: '', // Empty text - plugin will use forward instead
    } as OutgoingContent,
    metadata: {
      forward: {
        messageId,
        fromChatId,
        rawPayload: originalMessage.rawPayload, // Pass full message for proper forwarding
      },
    },
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to forward message',
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
        status: 'sent',
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

// ============================================================================
// Presence Routes
// ============================================================================

// Send presence schema
const sendPresenceSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Chat ID to show presence in'),
  type: z.enum(['typing', 'recording', 'paused']).describe('Presence type'),
  duration: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .default(5000)
    .describe('Duration in ms before auto-pause (default 5000, 0 = until paused)'),
});

/**
 * POST /messages/send/presence - Send presence indicator (typing, recording)
 *
 * Shows typing/recording indicator in a chat. Auto-pauses after duration.
 * - WhatsApp: supports typing, recording, paused
 * - Discord: supports typing only (recording/paused treated as typing)
 */
messagesRoutes.post('/send/presence', zValidator('json', sendPresenceSchema), async (c) => {
  const { instanceId, to, type, duration } = c.req.valid('json');
  const services = c.get('services');
  checkInstanceAccess(c.get('apiKey'), instanceId);

  const { instance, plugin } = await getPluginForInstance(
    services,
    c.get('channelRegistry'),
    instanceId,
    'canSendTyping',
  );

  // Resolve recipient (handles person ID to platform ID resolution)
  const resolvedTo = await resolveRecipient(to, instance.channel, services);

  // Check if plugin has sendTyping method
  if (!('sendTyping' in plugin) || typeof plugin.sendTyping !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement sendTyping`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // For paused type, send with 0 duration to immediately stop
  const effectiveDuration = type === 'paused' ? 0 : duration;

  // If recording type and plugin is discord, still use sendTyping (Discord only supports typing)
  // WhatsApp plugin handles all three types internally
  await (plugin as { sendTyping: (instanceId: string, chatId: string, duration?: number) => Promise<void> }).sendTyping(
    instanceId,
    resolvedTo,
    effectiveDuration,
  );

  return c.json({
    success: true,
    data: {
      instanceId,
      chatId: resolvedTo,
      type,
      duration: effectiveDuration,
    },
  });
});

// ============================================================================
// Read Receipt Routes
// ============================================================================

// Mark single message as read schema
const markMessageReadSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
});

// Mark batch messages as read schema
const markBatchReadSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  chatId: z.string().min(1).describe('Chat ID containing the messages'),
  messageIds: z.array(z.string().min(1)).min(1).max(100).describe('Message IDs to mark as read'),
});

/**
 * POST /messages/:id/read - Mark a single message as read
 *
 * Sends read receipt for a specific message.
 * Note: Requires the message to exist in our database to get chat context.
 */
messagesRoutes.post('/:id/read', zValidator('json', markMessageReadSchema), async (c) => {
  const messageId = c.req.param('id');
  const { instanceId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), instanceId);

  // Get message from our database
  const message = await services.messages.getById(messageId);
  const chat = await services.chats.getById(message.chatId);

  // Verify instance matches
  if (chat.instanceId !== instanceId) {
    throw new OmniError({
      code: ERROR_CODES.VALIDATION,
      message: "Instance ID does not match the message's instance",
      context: { instanceId, messageInstanceId: chat.instanceId },
      recoverable: false,
    });
  }

  const { instance, plugin } = await getPluginForInstance(
    services,
    channelRegistry,
    instanceId,
    'canReceiveReadReceipts',
  );

  // Check if plugin has markAsRead method
  if (!('markAsRead' in plugin) || typeof plugin.markAsRead !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement markAsRead`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Call plugin with external message ID
  await (
    plugin as { markAsRead: (instanceId: string, chatId: string, messageIds: string[]) => Promise<void> }
  ).markAsRead(instanceId, chat.externalId, [message.externalId]);

  return c.json({
    success: true,
    data: {
      messageId,
      externalMessageId: message.externalId,
      chatId: message.chatId,
    },
  });
});

/**
 * POST /messages/read - Mark multiple messages as read (batch)
 *
 * Sends read receipts for multiple messages in a single chat.
 */
messagesRoutes.post('/read', zValidator('json', markBatchReadSchema), async (c) => {
  const { instanceId, chatId, messageIds } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), instanceId);

  const { instance, plugin } = await getPluginForInstance(
    services,
    channelRegistry,
    instanceId,
    'canReceiveReadReceipts',
  );

  // Check if plugin has markAsRead method
  if (!('markAsRead' in plugin) || typeof plugin.markAsRead !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement markAsRead`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // chatId can be either external chat ID or internal UUID
  // Try to resolve as UUID first, fall back to external ID
  let externalChatId = chatId;
  const UUID_REGEX_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (UUID_REGEX_LOCAL.test(chatId)) {
    const chat = await services.chats.getById(chatId);
    if (chat.instanceId !== instanceId) {
      throw new OmniError({
        code: ERROR_CODES.VALIDATION,
        message: "Instance ID does not match the chat's instance",
        context: { instanceId, chatInstanceId: chat.instanceId },
        recoverable: false,
      });
    }
    externalChatId = chat.externalId;
  }

  await (
    plugin as { markAsRead: (instanceId: string, chatId: string, messageIds: string[]) => Promise<void> }
  ).markAsRead(instanceId, externalChatId, messageIds);

  return c.json({
    success: true,
    data: {
      instanceId,
      chatId: externalChatId,
      messageCount: messageIds.length,
    },
  });
});

// ============================================================================
// Discord-specific Send Routes
// ============================================================================

// Send poll schema (Discord only)
const sendPollSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Channel ID'),
  question: z.string().min(1).max(300).describe('Poll question'),
  answers: z.array(z.string().min(1).max(55)).min(2).max(10).describe('Poll answer options'),
  durationHours: z.number().int().min(1).max(168).optional().describe('Poll duration in hours (default 24, max 168)'),
  multiSelect: z.boolean().optional().describe('Allow multiple selections'),
  replyTo: z.string().optional().describe('Message ID to reply to'),
});

// Send embed schema (Discord only)
const sendEmbedSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Channel ID'),
  title: z.string().max(256).optional().describe('Embed title'),
  description: z.string().max(4096).optional().describe('Embed description'),
  color: z.number().int().optional().describe('Embed color (integer)'),
  url: z.string().url().optional().describe('URL for the title'),
  timestamp: z.string().datetime().optional().describe('Timestamp for footer'),
  footer: z
    .object({
      text: z.string().max(2048),
      iconUrl: z.string().url().optional(),
    })
    .optional()
    .describe('Footer text and icon'),
  author: z
    .object({
      name: z.string().max(256),
      url: z.string().url().optional(),
      iconUrl: z.string().url().optional(),
    })
    .optional()
    .describe('Author info'),
  thumbnail: z.string().url().optional().describe('Thumbnail URL'),
  image: z.string().url().optional().describe('Main image URL'),
  fields: z
    .array(
      z.object({
        name: z.string().max(256),
        value: z.string().max(1024),
        inline: z.boolean().optional(),
      }),
    )
    .max(25)
    .optional()
    .describe('Embed fields'),
  replyTo: z.string().optional().describe('Message ID to reply to'),
});

// Edit message via channel schema
const editMessageChannelSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  channelId: z.string().min(1).describe('Channel/Chat ID'),
  messageId: z.string().min(1).describe('Message ID to edit'),
  text: z.string().min(1).describe('New message text'),
});

// Delete message via channel schema
const deleteMessageChannelSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  channelId: z.string().min(1).describe('Channel/Chat ID'),
  messageId: z.string().min(1).describe('Message ID to delete'),
  fromMe: z.boolean().default(true).describe('Whether the message was sent by this instance'),
});

/**
 * POST /messages/send/poll - Send poll message (Discord only)
 */
messagesRoutes.post('/send/poll', zValidator('json', sendPollSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

  const { instance, plugin } = await getPluginForInstance(
    services,
    c.get('channelRegistry'),
    data.instanceId,
    'canSendPoll',
  );
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Get reply context if replying
  const replyContext = data.replyTo ? await getReplyContext(services, data.instanceId, resolvedTo, data.replyTo) : {};

  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: { type: 'poll', text: data.question } as OutgoingContent,
    metadata: {
      poll: {
        question: data.question,
        answers: data.answers,
        durationHours: data.durationHours ?? 24,
        multiSelect: data.multiSelect ?? false,
      },
      ...replyContext,
    },
    replyTo: data.replyTo,
  };

  const result = await plugin.sendMessage(data.instanceId, outgoingMessage);
  handleSendResult(result, { channelType: instance.channel, instanceId: data.instanceId, operation: 'send poll' });

  return c.json({ data: { messageId: result.messageId, status: 'sent', timestamp: result.timestamp } }, 201);
});

/**
 * POST /messages/send/embed - Send embed message (Discord only)
 */
messagesRoutes.post('/send/embed', zValidator('json', sendEmbedSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

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

  // Check if plugin supports embeds
  if (!plugin.capabilities.canSendEmbed) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support sending embeds`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Resolve recipient
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Look up original message data when replying
  let replyToFromMe: boolean | undefined;
  let replyToRawPayload: Record<string, unknown> | undefined;
  if (data.replyTo) {
    const chat = await services.chats.getByExternalId(data.instanceId, resolvedTo);
    if (chat) {
      const originalMessage = await services.messages.getByExternalId(chat.id, data.replyTo);
      if (originalMessage) {
        replyToFromMe = originalMessage.isFromMe;
        replyToRawPayload = originalMessage.rawPayload as Record<string, unknown> | undefined;
      }
    }
  }

  // Build outgoing message for embed
  // Note: We use 'text' type but pass embed data in metadata
  // The Discord plugin checks for metadata.embed and handles accordingly
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'text',
      text: data.description,
    } as OutgoingContent,
    metadata: {
      embed: {
        title: data.title,
        description: data.description,
        color: data.color,
        url: data.url,
        timestamp: data.timestamp,
        footer: data.footer,
        author: data.author,
        thumbnail: data.thumbnail,
        image: data.image,
        fields: data.fields,
      },
      ...(replyToFromMe !== undefined ? { replyToFromMe } : {}),
      ...(replyToRawPayload ? { replyToRawPayload } : {}),
    },
    replyTo: data.replyTo,
  };

  // Send via channel plugin
  const result = await plugin.sendMessage(data.instanceId, outgoingMessage);

  if (!result.success) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: result.error ?? 'Failed to send embed',
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
        status: 'sent',
        timestamp: result.timestamp,
      },
    },
    201,
  );
});

/**
 * POST /messages/edit-channel - Edit message via channel plugin
 */
messagesRoutes.post('/edit-channel', zValidator('json', editMessageChannelSchema), async (c) => {
  const { instanceId, channelId, messageId, text } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), instanceId);

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

  // Check if plugin supports editing
  if (!plugin.capabilities.canEditMessage) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support editing messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Check if plugin has editMessage method
  if (!('editMessage' in plugin) || typeof plugin.editMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement editMessage`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Edit via channel plugin
  await (
    plugin as { editMessage: (instanceId: string, channelId: string, messageId: string, text: string) => Promise<void> }
  ).editMessage(instanceId, channelId, messageId, text);

  return c.json({
    success: true,
    data: { messageId, edited: true },
  });
});

/**
 * POST /messages/delete-channel - Delete message via channel plugin
 */
messagesRoutes.post('/delete-channel', zValidator('json', deleteMessageChannelSchema), async (c) => {
  const { instanceId, channelId, messageId, fromMe } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), instanceId);

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

  // Check if plugin supports deleting
  if (!plugin.capabilities.canDeleteMessage) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support deleting messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Check if plugin has deleteMessage method
  if (!('deleteMessage' in plugin) || typeof plugin.deleteMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement deleteMessage`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Delete via channel plugin
  await (
    plugin as {
      deleteMessage: (instanceId: string, channelId: string, messageId: string, fromMe?: boolean) => Promise<void>;
    }
  ).deleteMessage(instanceId, channelId, messageId, fromMe);

  return c.json({
    success: true,
    data: { messageId, deleted: true },
  });
});

// ============================================================================
// B6: Star/Unstar Messages
// ============================================================================

const starMessageSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  channelId: z.string().min(1).describe('Chat JID or channel ID'),
  fromMe: z.boolean().default(true).describe('Whether the message was sent by this instance'),
});

/**
 * POST /messages/:id/star - Star a message
 */
messagesRoutes.post('/:id/star', zValidator('json', starMessageSchema), async (c) => {
  const messageId = c.req.param('id');
  const { instanceId, channelId, fromMe } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), instanceId);

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

  if (!('starMessage' in plugin) || typeof plugin.starMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support starring messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  await (
    plugin as {
      starMessage: (
        instanceId: string,
        chatId: string,
        messageId: string,
        star: boolean,
        fromMe?: boolean,
      ) => Promise<void>;
    }
  ).starMessage(instanceId, channelId, messageId, true, fromMe);

  return c.json({
    success: true,
    data: { messageId, starred: true },
  });
});

/**
 * DELETE /messages/:id/star - Unstar a message
 */
messagesRoutes.delete('/:id/star', zValidator('json', starMessageSchema), async (c) => {
  const messageId = c.req.param('id');
  const { instanceId, channelId, fromMe } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), instanceId);

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

  if (!('starMessage' in plugin) || typeof plugin.starMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support starring messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  await (
    plugin as {
      starMessage: (
        instanceId: string,
        chatId: string,
        messageId: string,
        star: boolean,
        fromMe?: boolean,
      ) => Promise<void>;
    }
  ).starMessage(instanceId, channelId, messageId, false, fromMe);

  return c.json({
    success: true,
    data: { messageId, starred: false },
  });
});

export { messagesRoutes };
