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
 * - POST   /messages/media/download - Ensure media is cached locally
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
 * - POST /messages/send/handoff  - Send handoff message (Gupshup only)
 *
 * @see unified-messages wish
 */

import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

import { zValidator } from '@hono/zod-validator';
import { sanitizeOutboundText } from '@omni/channel-sdk';
import type { ChannelRegistry, OutgoingContent, OutgoingMessage } from '@omni/channel-sdk';
import { ERROR_CODES, JOURNEY_STAGES, NotFoundError, OmniError, createLogger, getJourneyTracker } from '@omni/core';
import type { ChatClosedPayload, CloseContactOutcome } from '@omni/core/events';
import type { ChannelType } from '@omni/core/types';
import type { Database } from '@omni/db';
import { closeContactLogs, handoffLogs } from '@omni/db';
import * as Sentry from '@sentry/bun';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { sentryEnabled } from '../../lib/sentry-scrub';
import { optionalDateParam } from '../../schemas/date-query';
import type { Services } from '../../services';
import { ApiKeyService } from '../../services/api-keys';
import { type MediaFetchOptions, MediaStorageService } from '../../services/media-storage';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import type { ApiKeyData, AppVariables } from '../../types';
import { isHardTerminalOutcome, resolveCloseContactConfig } from './_close-contact-config';

const log = createLogger('routes:messages');
const mediaDownloadLog = createLogger('routes:messages:media-download');

const messagesRoutes = new Hono<{ Variables: AppVariables }>();

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
};

const DEFAULT_MIME_BY_MEDIA_TYPE: Record<'image' | 'audio' | 'video' | 'document', string> = {
  image: 'image/jpeg',
  audio: 'audio/ogg',
  video: 'video/mp4',
  document: 'application/octet-stream',
};

function inferMediaMimeType(type: 'image' | 'audio' | 'video' | 'document', filename?: string): string {
  if (filename) {
    const fromExtension = MIME_BY_EXTENSION[extname(filename).toLowerCase()];
    if (fromExtension) return fromExtension;
  }
  return DEFAULT_MIME_BY_MEDIA_TYPE[type];
}

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

function extractReactionTargetParticipant(rawPayload: Record<string, unknown> | null | undefined): string | undefined {
  const key = rawPayload?.key as Record<string, unknown> | undefined;
  const participant = key?.participant;
  return typeof participant === 'string' && participant.length > 0 ? participant : undefined;
}

async function resolveReactionTarget(
  services: Services,
  instanceId: string,
  resolvedTo: string,
  messageId: string,
): Promise<{ targetMessageId: string; metadata: Record<string, unknown> }> {
  const metadata: Record<string, unknown> = {};
  const chat = await services.chats.findByExternalIdSmart(instanceId, resolvedTo);

  if (!chat) {
    if (isUUID(messageId)) {
      throw new OmniError({
        code: ERROR_CODES.NOT_FOUND,
        message: `Reaction target message not found: ${messageId}`,
        context: { instanceId, resolvedTo, messageId },
        recoverable: false,
      });
    }

    log.warn('Reaction target chat not found in DB; deferring fromMe to channel plugin fallback (#386)', {
      instanceId,
      resolvedTo,
      messageId,
      fallback: 'plugin-heuristic',
    });
    return { targetMessageId: messageId, metadata };
  }

  const target = isUUID(messageId)
    ? await getReactionTargetByOmniId(services, instanceId, chat.id, messageId)
    : await services.messages.getByExternalId(chat.id, messageId);

  if (!target) {
    log.warn('Reaction target message not found in DB; deferring fromMe to channel plugin fallback (#386)', {
      instanceId,
      chatId: chat.id,
      messageId,
      fallback: 'plugin-heuristic',
    });
    return { targetMessageId: messageId, metadata };
  }

  metadata.fromMe = target.isFromMe === true;
  if (target.isFromMe !== true) {
    const participant = extractReactionTargetParticipant(
      target.rawPayload as Record<string, unknown> | null | undefined,
    );
    if (participant) metadata.targetParticipant = participant;
  }

  return { targetMessageId: target.externalId, metadata };
}

async function getReactionTargetByOmniId(
  services: Services,
  instanceId: string,
  chatId: string,
  messageId: string,
): Promise<Awaited<ReturnType<Services['messages']['getByExternalId']>>> {
  let target: Awaited<ReturnType<Services['messages']['getById']>>;

  try {
    target = await services.messages.getById(messageId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw reactionTargetNotFound(instanceId, chatId, messageId);
    }
    throw error;
  }

  if (target.chatId !== chatId) {
    throw reactionTargetNotFound(instanceId, chatId, messageId);
  }

  return target;
}

function reactionTargetNotFound(instanceId: string, chatId: string, messageId: string): OmniError {
  return new OmniError({
    code: ERROR_CODES.NOT_FOUND,
    message: `Reaction target message not found: ${messageId}`,
    context: { instanceId, chatId, messageId },
    recoverable: false,
  });
}

/**
 * Resolve recipient - handles Omni person IDs, Omni chat IDs, and platform IDs (WA JID etc.)
 *
 * Resolution order for UUIDs:
 * 1. Try as person ID → returns platformUserId for the channel
 * 2. Try as chat ID → returns chat.externalId (the platform JID/channel ID)
 * 3. Throw if UUID but not found in either table
 */
async function resolveRecipient(to: string, channelType: string, services: Services): Promise<string> {
  if (!isUUID(to)) return to;

  // Try as person ID first
  const identity = await services.persons.getIdentityForChannel(to, channelType).catch(() => null);
  if (identity) return identity.platformUserId;

  // Try as chat ID — use getById which throws NotFoundError on miss
  try {
    const chat = await services.chats.getById(to);
    return chat.externalId;
  } catch {
    // Not a chat UUID either — throw informative error
  }

  throw new OmniError({
    code: ERROR_CODES.RECIPIENT_NOT_ON_CHANNEL,
    message: `"${to}" is a UUID but not a known person or chat on ${channelType}. Pass a platform ID (e.g. WA JID) directly, or an Omni person/chat UUID.`,
    context: { to, channelType },
    recoverable: false,
  });
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

const permalinkQuerySchema = z.object({
  instanceId: z.string().uuid(),
  channelId: z.string().min(1).describe('Platform chat/channel id containing the message'),
});

/**
 * GET /messages/:id/permalink — resolve a stable deep link (#889).
 *
 * Resolved lazily and cached on the row: a permalink costs one API call and
 * almost no message is ever linked to, so paying it at ingest for every
 * message would be wasteful.
 *
 * This is also the input a quote is built from — Slack has no quote API, its
 * client renders the card by unfurling a permalink.
 */
messagesRoutes.get('/:id/permalink', zValidator('query', permalinkQuerySchema), async (c) => {
  const messageId = c.req.param('id');
  const { instanceId, channelId } = c.req.valid('query');
  checkInstanceAccess(c.get('apiKey'), instanceId);
  const services = c.get('services');

  const chat = await services.chats.getByExternalId(instanceId, channelId);
  const stored = chat ? await services.messages.getByExternalId(chat.id, messageId) : null;
  if (stored?.permalink) {
    return c.json({ data: { messageId, permalink: stored.permalink, cached: true } });
  }

  const { instance, plugin } = await getPluginForInstance(services, c.get('channelRegistry'), instanceId);

  if (typeof plugin.getPermalink !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} cannot resolve permalinks`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  const permalink = await plugin.getPermalink(instanceId, channelId, messageId);
  if (!permalink) {
    throw new OmniError({
      code: ERROR_CODES.NOT_FOUND,
      message: `No permalink available for message ${messageId}`,
      recoverable: false,
    });
  }

  if (chat) {
    // Cache best-effort; the caller already has its answer.
    await services.messages.setPermalink(chat.id, messageId, permalink).catch(() => {});
  }

  return c.json({ data: { messageId, permalink, cached: false } });
});

/**
 * Mirror a star/unstar into our own row (#889).
 *
 * Best-effort by design: the platform already accepted the change, so a
 * bookkeeping failure must not turn a successful star into an error response.
 */
async function persistStarState(
  services: Services,
  instanceId: string,
  channelExternalId: string,
  messageExternalId: string,
  starred: boolean,
): Promise<void> {
  try {
    const chat = await services.chats.getByExternalId(instanceId, channelExternalId);
    if (chat) await services.messages.setStarred(chat.id, messageExternalId, starred);
  } catch {
    // Intentionally swallowed — see the doc comment.
  }
}

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
  const chat = await services.chats.findByExternalIdSmart(instanceId, chatExternalId);
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
  externalId: z.string().min(1).optional(),
  since: optionalDateParam('since'),
  until: optionalDateParam('until'),
  search: z.string().optional(),
  includeHidden: z.coerce.boolean().default(false),
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
  threadId: z.string().optional().describe('Thread/topic ID (e.g. Telegram forum topic)'),
  mentions: z.array(MentionSchema).optional().describe('Users/roles to mention'),
  buttons: z
    .array(
      z.object({
        text: z.string().min(1).describe('Button label'),
        data: z.string().optional().describe('Callback payload (reply button / list row id)'),
        url: z.string().url().optional().describe('Link button URL (mutually exclusive with data)'),
        description: z
          .string()
          .optional()
          .describe('Secondary line under the option (WhatsApp Cloud list rows, ≤72 chars)'),
      }),
    )
    .max(10)
    .optional()
    .describe(
      'Inline buttons — channel maps them natively (WhatsApp Cloud: ≤3 reply buttons, 4-10 list; Telegram: inline keyboard)',
    ),
  list: z
    .object({
      sectionTitle: z.string().optional().describe('Section header above the options (≤24 chars)'),
      buttonLabel: z.string().optional().describe('Label of the button that opens the list (≤20 chars)'),
      forceList: z
        .boolean()
        .optional()
        .describe('Render a list even with ≤3 options (implied by any description/sectionTitle)'),
    })
    .optional()
    .describe('List presentation (WhatsApp Cloud)'),
  requestLocation: z
    .boolean()
    .optional()
    .describe('Ask the user to share their location (WhatsApp Cloud: native "Send location" button under the text)'),
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
  mimeType: z
    .string()
    .optional()
    .describe('MIME type of the media (e.g. image/gif enables GIF playback for video type)'),
  voiceNote: z.boolean().optional().describe('Send audio as voice note'),
  threadId: z.string().optional().describe('Thread/topic ID (e.g. Telegram forum topic)'),
});

function normalizeSendMediaMimeType(data: z.infer<typeof sendMediaSchema>): string {
  const inferred = data.mimeType ?? inferMediaMimeType(data.type, data.filename);
  if (data.type === 'audio' && data.voiceNote === true && inferred === 'audio/ogg') {
    return 'audio/ogg; codecs=opus';
  }
  return inferred;
}

function buildSendMediaMetadata(data: z.infer<typeof sendMediaSchema>): Record<string, unknown> {
  if (data.type === 'audio' && data.voiceNote === true && data.base64) {
    return { audioBuffer: Buffer.from(data.base64, 'base64'), ptt: true };
  }
  return { base64: data.base64, ptt: data.voiceNote };
}

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

const sendHandoffSchema = z.object({
  instanceId: z.string().uuid().describe('Gupshup instance ID'),
  chatId: z.string().min(1).describe('Chat ID to pause agent on'),
  to: z.string().min(1).describe('Recipient phone number'),
  text: z.string().min(1).describe('Message text shown to end user'),
  dadosLead: z.string().optional().describe('Free-text lead data summary for the human attendant'),
  motivoHandoff: z
    .string()
    .optional()
    .describe('Handoff trigger and notes (e.g. "Gatilho: sinalizou close ||| Obs: ...")'),
  extraInfo: z.string().optional().describe('Free-text briefing (legacy — prefer dadosLead)'),
  handoffFields: z
    .record(z.unknown())
    .optional()
    .describe('Structured fields for Gupshup flow variables (e.g. nome, cidade, temperatura_lead)'),
});

// Close-contact schema — terminal close primitive parallel to handoff.
// Hard outcomes (won/lost) flip `chats.settings.closed=true` permanently.
// Soft outcomes set `closeUntil` and reopen passively in the dispatcher.
// Auto-escalation via close_contact_logs history bounds the loop.
const sendCloseContactSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID — close-contact native send is Gupshup-only in v1'),
  chatId: z.string().min(1).describe('Chat DB UUID to mark as closed'),
  to: z.string().min(1).describe('Recipient phone or platform ID'),
  text: z.string().min(1).describe('Farewell message shown to the lead'),
  outcome: z
    .enum(['won', 'lost', 'redirected_sac', 'unqualified', 'no_response', 'other'])
    .describe('Drives terminal/cooldown/escalation logic and BI/audit trail'),
  reason: z.string().optional().describe('Free-text rationale persisted in close_contact_logs'),
  closeFields: z
    .record(z.unknown())
    .optional()
    .describe('Structured BI/CRM payload — forwarded to Gupshup native send when supported'),
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

// ============================================================================
// Media Download (Ensure Cached) Route
// ============================================================================

// MessageRef union schema — address a message by internal ID or (chatId, externalId)
const messageRefSchema = z.union([
  z.object({ messageId: z.string().uuid() }),
  z.object({ chatId: z.string().uuid(), externalId: z.string().min(1) }),
  z.object({ instanceId: z.string().uuid(), chatExternalId: z.string().min(1), externalId: z.string().min(1) }),
]);

// Lazy singleton for MediaStorageService (same pattern as media.ts)
let _mediaStorageForDownload: MediaStorageService | null = null;

function getMediaStorageForDownload(db: Database): MediaStorageService {
  if (!_mediaStorageForDownload) {
    _mediaStorageForDownload = new MediaStorageService(db);
  }
  return _mediaStorageForDownload;
}

/**
 * Resolve a message from a MessageRef union (either by messageId or chatId+externalId)
 */
async function resolveMessageFromRef(
  services: Services,
  ref: z.infer<typeof messageRefSchema>,
): Promise<Awaited<ReturnType<typeof services.messages.getById>>> {
  if ('messageId' in ref) {
    // getById throws NotFoundError (→ 404) if missing
    return services.messages.getById(ref.messageId);
  }
  if ('chatExternalId' in ref) {
    const chat = await services.chats.findByExternalIdSmart(ref.instanceId, ref.chatExternalId);
    if (!chat) {
      throw new OmniError({
        code: ERROR_CODES.NOT_FOUND,
        message: `Chat not found for instanceId=${ref.instanceId}, chatExternalId=${ref.chatExternalId}`,
        context: { instanceId: ref.instanceId, chatExternalId: ref.chatExternalId },
        recoverable: false,
      });
    }
    const found = await services.messages.getByExternalId(chat.id, ref.externalId);
    if (!found) {
      throw new OmniError({
        code: ERROR_CODES.NOT_FOUND,
        message: `Message not found for chatExternalId=${ref.chatExternalId}, externalId=${ref.externalId}`,
        context: { instanceId: ref.instanceId, chatExternalId: ref.chatExternalId, externalId: ref.externalId },
        recoverable: false,
      });
    }
    return found;
  }
  const found = await services.messages.getByExternalId(ref.chatId, ref.externalId);
  if (!found) {
    throw new OmniError({
      code: ERROR_CODES.NOT_FOUND,
      message: `Message not found for chatId=${ref.chatId}, externalId=${ref.externalId}`,
      context: { chatId: ref.chatId, externalId: ref.externalId },
      recoverable: false,
    });
  }
  return found;
}

function buildMediaDownloadFetchOptions(instance: Record<string, unknown>): MediaFetchOptions | undefined {
  if (instance.channel !== 'slack') return undefined;
  const slackBotToken = typeof instance.slackBotToken === 'string' ? instance.slackBotToken : undefined;
  if (!slackBotToken) return undefined;
  return {
    headers: { Authorization: `Bearer ${slackBotToken}` },
    preserveAuthRedirectHostSuffixes: ['slack.com'],
  };
}

/**
 * POST /messages/media/download - Ensure media is cached locally
 *
 * Accepts a MessageRef (either { messageId } or { chatId, externalId }).
 * If the message has media and it's already cached on disk, returns the download URL immediately.
 * Otherwise downloads from the remote mediaUrl, persists locally, and returns the download URL.
 *
 * @see media-drive-download wish — Group A
 */
messagesRoutes.post('/media/download', zValidator('json', messageRefSchema), async (c) => {
  const body = c.req.valid('json');
  const services = c.get('services');
  const db = c.get('db');
  const apiKey = c.get('apiKey');

  // 1. Resolve message from either ref type
  const message = await resolveMessageFromRef(services, body);

  // 2. Access check — resolve chat to verify instance ownership
  const chat = await services.chats.getById(message.chatId);
  const instanceId = chat.instanceId;
  if (!instanceId) {
    throw new OmniError({
      code: ERROR_CODES.NOT_FOUND,
      message: 'Chat has no associated instance',
      context: { chatId: chat.id },
      recoverable: false,
    });
  }
  const instance = await services.instances.getById(instanceId);
  checkInstanceAccess(apiKey, instanceId);

  // 3. Validate message has media
  if (!message.hasMedia || !message.mediaUrl) {
    return c.json(
      {
        error: {
          code: 'NO_MEDIA',
          message: 'Message has no media or no mediaUrl',
        },
      },
      400,
    );
  }

  const mediaStorage = getMediaStorageForDownload(db);
  const mediaUrl = message.mediaUrl as string; // validated non-null above
  let mediaLocalPath = message.mediaLocalPath as string | null;
  let cached = false;

  // 4. Check if already cached on disk
  if (mediaLocalPath) {
    const fullPath = join(mediaStorage.getBasePath(), mediaLocalPath);
    if (existsSync(fullPath)) {
      cached = true;
    } else {
      // Path set but file missing — need to re-download
      mediaDownloadLog.warn('mediaLocalPath set but file missing, re-downloading', {
        messageId: message.id,
        mediaLocalPath,
      });
      mediaLocalPath = null;
    }
  }

  // 5. Download from remote if not cached
  if (!cached) {
    try {
      const result = await mediaStorage.storeFromUrl(
        instanceId,
        message.id,
        mediaUrl,
        message.mediaMimeType ?? undefined,
        message.platformTimestamp ?? undefined,
        buildMediaDownloadFetchOptions(instance as Record<string, unknown>),
        // `mediaUrl` came off a stored message, i.e. a tenant-controlled
        // payload, so this download is tenant-controlled egress: pass the
        // REQUEST's tenant so the `OMNI_MEDIA_URL_GUARD=off` escape hatch is
        // subsumed here too (G5 deliverable (b), ADR-0009). Null off-scope
        // (flag-off), where the pre-G5 behavior is kept exactly.
        currentTenantScope()?.tenantId ?? undefined,
      );
      mediaLocalPath = result.localPath;
      await mediaStorage.updateMessageLocalPath(message.id, result.localPath);
      mediaDownloadLog.info('Downloaded and cached media', {
        messageId: message.id,
        mediaLocalPath: result.localPath,
      });
    } catch (error) {
      mediaDownloadLog.error('Failed to download media from remote', {
        messageId: message.id,
        mediaUrl,
        error: String(error),
      });
      throw new OmniError({
        code: ERROR_CODES.UNKNOWN,
        message: 'Failed to download media from remote URL',
        context: { messageId: message.id, mediaUrl },
        recoverable: true,
      });
    }
  }

  // 6. Build download URL — mediaLocalPath is guaranteed non-null here (either cached or just downloaded)
  const downloadUrl = `/api/v2/media/${mediaLocalPath as string}`;

  return c.json({
    data: {
      messageId: message.id,
      instanceId,
      mediaMimeType: message.mediaMimeType,
      mediaLocalPath,
      downloadUrl,
      cached,
    },
  });
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
messagesRoutes.post('/send', async (c) => {
  // Parse raw body first to detect media fields before schema validation strips them
  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } }, 400);
  }

  // Detect media fields sent to the wrong endpoint
  const mediaFieldIndicators = ['base64', 'url', 'filename', 'voiceNote', 'mediaUrl'];
  const mediaTypeValues = ['image', 'video', 'audio', 'document'];
  const hasMediaField = mediaFieldIndicators.some((f) => f in rawBody);
  const hasMediaType = 'type' in rawBody && mediaTypeValues.includes(rawBody.type as string);

  if (hasMediaField || hasMediaType) {
    return c.json(
      {
        error: {
          code: 'WRONG_ENDPOINT',
          message: 'Media payloads must use POST /api/v2/messages/send/media — this endpoint only sends plain text.',
          hint: {
            endpoint: 'POST /api/v2/messages/send/media',
            requiredFields: ['instanceId', 'to', 'type (image|video|audio|document)', 'url or base64'],
            optionalFields: ['caption', 'filename', 'voiceNote'],
          },
        },
      },
      422,
    );
  }

  // Validate as text schema
  const parsed = sendTextSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
  }

  const { instanceId, to, replyTo, threadId, mentions, buttons, list, requestLocation } = parsed.data;
  // Strip internal routing headers and agent directives before sending (GH #300)
  const text = sanitizeOutboundText(parsed.data.text);
  if (!text) {
    return c.json({ data: { messageId: '', status: 'filtered', instanceId, to } }, 200);
  }
  const services = c.get('services');
  checkInstanceAccess(c.get('apiKey'), instanceId);

  // T7: Agent response arrives at API — record journey checkpoint
  const correlationId = c.req.header('x-correlation-id');
  const tracker = getJourneyTracker();
  if (correlationId && tracker.isTracking(correlationId)) {
    tracker.recordCheckpoint(correlationId, 'T7', JOURNEY_STAGES.T7);
  }

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
    threadId,
    content: {
      type: requestLocation ? 'location_request' : 'text',
      text,
      ...(buttons?.length ? { buttons } : {}),
      ...(list ? { list } : {}),
    } as OutgoingContent,
    replyTo,
    metadata: { ...(mentions ? { mentions } : {}), ...replyContext },
  };

  // T8: API processed the send request
  if (correlationId && tracker.isTracking(correlationId)) {
    tracker.recordCheckpoint(correlationId, 'T8', JOURNEY_STAGES.T8);
  }

  const result = await plugin.sendMessage(instanceId, outgoingMessage);
  handleSendResult(result, { channelType: instance.channel, instanceId, operation: 'send message' });

  // Sentry metric: message sent count by channel
  if (sentryEnabled()) {
    Sentry.metrics.count('messages.sent', 1, { attributes: { channel_type: instance.channel } });
  }

  // T9: Outbound event published (plugin.sendMessage publishes message.sent to NATS)
  if (correlationId && tracker.isTracking(correlationId)) {
    tracker.recordCheckpoint(correlationId, 'T9', JOURNEY_STAGES.T9);
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
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

  // T7: Agent response arrives at API — record journey checkpoint
  const correlationId = c.req.header('x-correlation-id');
  const tracker = getJourneyTracker();
  if (correlationId && tracker.isTracking(correlationId)) {
    tracker.recordCheckpoint(correlationId, 'T7', JOURNEY_STAGES.T7);
  }

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

  const mediaMimeType = normalizeSendMediaMimeType(data);

  // Build outgoing message
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    threadId: data.threadId,
    content: {
      type: data.type,
      mediaUrl: data.url,
      caption: data.caption,
      filename: data.filename,
      mimeType: mediaMimeType,
    } as OutgoingContent,
    metadata: buildSendMediaMetadata(data),
  };

  // T8: API processed the send request
  if (correlationId && tracker.isTracking(correlationId)) {
    tracker.recordCheckpoint(correlationId, 'T8', JOURNEY_STAGES.T8);
  }

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

  // Sentry metric: message sent count by channel
  if (sentryEnabled()) {
    Sentry.metrics.count('messages.sent', 1, { attributes: { channel_type: instance.channel } });
  }

  // T9: Outbound event published
  if (correlationId && tracker.isTracking(correlationId)) {
    tracker.recordCheckpoint(correlationId, 'T9', JOURNEY_STAGES.T9);
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

  // Look up the target message to determine the provider-native ID and fromMe
  // (critical for WhatsApp reactions). CLI/history surfaces Omni message UUIDs,
  // but Baileys needs the WhatsApp externalId in key.id; sending an Omni UUID can
  // return command-level success while WhatsApp silently ignores the reaction.
  const { targetMessageId, metadata: reactionMetadata } = await resolveReactionTarget(
    services,
    instanceId,
    resolvedTo,
    messageId,
  );

  // Build outgoing message for reaction. When the target is unknown, omit
  // metadata so the plugin applies its own fallback (defaults to true for Baileys).
  const outgoingMessage: OutgoingMessage = {
    to: resolvedTo,
    content: {
      type: 'reaction',
      emoji,
      targetMessageId,
    } as OutgoingContent,
    metadata: reactionMetadata,
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

/**
 * POST /messages/send/handoff - Send handoff message (Gupshup only)
 *
 * Sends msg_type: HANDOFF to Gupshup, sets agentPaused: true on the chat,
 * and disarms any active follow-up sequence via the existing event chain.
 */
messagesRoutes.post('/send/handoff', zValidator('json', sendHandoffSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const db = c.get('db');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

  const instance = await services.instances.getById(data.instanceId);

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

  // Resolve the recipient for every channel — even when we won't push a
  // native payload we still want the audit row to record a real platform
  // identifier (phone/JID) rather than the caller's input, which may be
  // an Omni Person UUID. See issue #537 + gemini review on #538.
  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // Channels that declare `canHandoff: true` receive a channel-specific
  // HANDOFF payload (currently only Gupshup). For every other channel the
  // route still runs the channel-agnostic side effects below — agentPaused,
  // follow-up disarm, audit row — so agents can pause themselves on any
  // channel. The user-facing farewell is the agent's responsibility on
  // channels without native handoff. See issue #537.
  const hasNativeHandoff = plugin.capabilities?.canHandoff === true;

  let channelSendResult: Awaited<ReturnType<typeof plugin.sendMessage>> | null = null;
  if (hasNativeHandoff) {
    const outgoingMessage: OutgoingMessage = {
      to: resolvedTo,
      content: { type: 'text', text: data.text } as OutgoingContent,
      metadata: {
        isHandoff: true,
        dadosLead: data.dadosLead ?? data.extraInfo,
        motivoHandoff: data.motivoHandoff,
        handoffFields: data.handoffFields,
      },
    };
    channelSendResult = await plugin.sendMessage(data.instanceId, outgoingMessage);
    handleSendResult(channelSendResult, {
      channelType: instance.channel,
      instanceId: data.instanceId,
      operation: 'send handoff',
    });
  }

  // Set agentPaused — chains: chat.handoff_activated → follow-up disarm + agent stop.
  // Merge into existing settings so unrelated keys (followUpConfig, close*, …)
  // survive — a bare `{ agentPaused: true }` replaces the whole JSONB column.
  const handoffChat = await services.chats.getById(data.chatId);
  await services.chats.update(data.chatId, {
    settings: { ...((handoffChat?.settings as Record<string, unknown>) ?? {}), agentPaused: true },
  });

  // Close the race between chat.handoff_activated (two NATS hops away) and the
  // next sweeper tick (every 15s). Idempotent with the event-driven disarm in
  // follow-up-hooks.ts — disarmActive is a no-op on already-disarmed rows.
  // See issue #528.
  await services.followUpLifecycle.disarm({
    chatId: data.chatId,
    instanceId: data.instanceId,
    reason: 'handoff',
  });

  // Persist full handoff payload for auditing and traceability
  db.insert(handoffLogs)
    .values({
      instanceId: data.instanceId,
      chatUuid: data.chatId, // chatId in this route is the DB UUID of the chat
      chatId: resolvedTo, // resolved platform identifier (phone/JID)
      toPhone: resolvedTo,
      text: data.text,
      extraInfo: data.dadosLead ?? data.extraInfo ?? null,
      agentId: instance.agentId ?? null,
      externalMessageId: channelSendResult?.messageId ?? null,
      handoffFields: data.handoffFields ?? null,
      sentAt: new Date(),
      metadata: {
        instanceChannel: instance.channel,
        channelHandoffSupported: hasNativeHandoff,
        ...(data.motivoHandoff ? { motivoHandoff: data.motivoHandoff } : {}),
      },
    })
    .catch((err: unknown) => log.warn('Failed to persist handoff log', { error: String(err) }));

  return c.json(
    {
      data: {
        messageId: channelSendResult?.messageId ?? null,
        status: hasNativeHandoff ? 'sent' : 'paused',
        timestamp: channelSendResult?.timestamp ?? Date.now(),
      },
    },
    201,
  );
});

/**
 * Compute the terminal state for a close-contact event.
 *
 * v1 uses hardcoded defaults from `_close-contact-config.ts`. The
 * `resolveCloseContactConfig` helper already accepts an overrides bag, so
 * a future per-instance column can wire through without touching this
 * site — flagged as a tunable post-launch follow-up in design.md §8.
 *
 * Behaviour:
 *   - won/lost  → terminal:true, no cooldown.
 *   - soft outcomes → if recent_count >= threshold within the window:
 *       terminal:true (escalated), and the audit row is patched
 *       `escalated: true`. Otherwise terminal:false with `closeUntil`
 *       at now + cooldown.
 */
async function computeCloseContactTerminalState(
  db: Database,
  chatUuid: string,
  outcome: CloseContactOutcome,
  auditRowId: string | null,
): Promise<{ terminal: boolean; escalated: boolean; closeUntil: Date | null }> {
  const cfg = resolveCloseContactConfig(outcome, null);
  if (isHardTerminalOutcome(outcome)) {
    return { terminal: true, escalated: false, closeUntil: null };
  }
  if (cfg.escalationThreshold === null || cfg.escalationWindowMs === null) {
    const closeUntil = cfg.cooldownMs !== null ? new Date(Date.now() + cfg.cooldownMs) : null;
    return { terminal: false, escalated: false, closeUntil };
  }

  const windowStart = new Date(Date.now() - cfg.escalationWindowMs);
  const recent = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(closeContactLogs)
    .where(
      and(
        eq(closeContactLogs.chatUuid, chatUuid),
        eq(closeContactLogs.outcome, outcome),
        gte(closeContactLogs.sentAt, windowStart),
      ),
    );
  const recentCount = Number(recent[0]?.count ?? 0);

  if (recentCount >= cfg.escalationThreshold) {
    if (auditRowId) {
      await db.update(closeContactLogs).set({ escalated: true }).where(eq(closeContactLogs.id, auditRowId));
    }
    return { terminal: true, escalated: true, closeUntil: null };
  }

  const closeUntil = cfg.cooldownMs !== null ? new Date(Date.now() + cfg.cooldownMs) : null;
  return { terminal: false, escalated: false, closeUntil };
}

/**
 * POST /messages/send/close-contact - Terminal close
 *
 * Counterpart to /send/handoff: handoff pauses for a human; close terminates
 * the conversation cleanly. The route:
 *
 *   1. Sends a native CLOSING payload on channels that declare
 *      `canCloseContact: true` (Gupshup in v1). Other channels still run
 *      the channel-agnostic side effects below — agents can self-close on
 *      any channel.
 *   2. Inserts a row into close_contact_logs FIRST (the table is the
 *      source of truth for the escalation history query).
 *   3. Computes the terminal state from outcome + recent history:
 *        - `won` / `lost`        → hard terminal (`closed: true`).
 *        - `redirected_sac` etc. → soft close (`closeUntil` cooldown),
 *          unless the same outcome has fired ≥ threshold times within
 *          the configured window for this chat — then auto-promote to
 *          hard terminal and stamp `escalated: true` on the new row.
 *   4. Patches `chats.settings` with `agentPaused: true` plus the close
 *      fields. The chats service detects this and emits `chat.closed`
 *      (parallel to `chat.handoff_activated` for the handoff path).
 *   5. Disarms any active follow-up sequence inline with reason
 *      `contact_closed` to close the race against the event-driven
 *      follow-up-hooks subscriber. Idempotent.
 *
 * See `genie-hapvida/brain/Designs/design-eugenia-close-contact.md` for the
 * full state machine, defaults rationale, and finite-loop proof.
 */
messagesRoutes.post('/send/close-contact', zValidator('json', sendCloseContactSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const db = c.get('db');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

  const instance = await services.instances.getById(data.instanceId);

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

  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);
  const hasNativeClose = plugin.capabilities?.canCloseContact === true;
  const outcome = data.outcome as CloseContactOutcome;

  // ── 1. Native channel send (Gupshup CLOSING msg_type) ────────────────────
  let channelSendResult: Awaited<ReturnType<typeof plugin.sendMessage>> | null = null;
  if (hasNativeClose) {
    const outgoingMessage: OutgoingMessage = {
      to: resolvedTo,
      content: { type: 'text', text: data.text } as OutgoingContent,
      metadata: {
        isCloseContact: true,
        closeReason: data.reason,
        closeOutcome: outcome,
        closeFields: data.closeFields,
      },
    };
    channelSendResult = await plugin.sendMessage(data.instanceId, outgoingMessage);
    handleSendResult(channelSendResult, {
      channelType: instance.channel,
      instanceId: data.instanceId,
      operation: 'send close-contact',
    });
  }

  // ── 2. Insert audit row (with escalated:false; updated below if needed) ──
  const [auditRow] = await db
    .insert(closeContactLogs)
    .values({
      instanceId: data.instanceId,
      chatUuid: data.chatId,
      chatId: resolvedTo,
      toPhone: resolvedTo,
      text: data.text,
      outcome,
      reason: data.reason ?? null,
      closeFields: data.closeFields ?? null,
      agentId: instance.agentId ?? null,
      externalMessageId: channelSendResult?.messageId ?? null,
      escalated: false,
      sentAt: new Date(),
      metadata: {
        instanceChannel: instance.channel,
        channelCloseSupported: hasNativeClose,
      },
    })
    .returning();

  // ── 3. Compute terminal state from outcome + recent history ──────────────
  const { terminal, escalated, closeUntil } = await computeCloseContactTerminalState(
    db,
    data.chatId,
    outcome,
    auditRow?.id ?? null,
  );

  // ── 4. Update chat settings — emits chat.closed via chats service ────────
  //
  // Two distinct mechanisms — keep them decoupled:
  //
  //   - Follow-up disarm (always): the proactive Haiku follow-up is killed
  //     for every close-contact outcome. That's the whole point of this
  //     endpoint and is handled by the explicit `followUpLifecycle.disarm`
  //     call right below + the `chat.closed` event subscriber.
  //
  //   - Agent pause (only when the customer asked for silence): blocks the
  //     reactive agent from replying to inbound messages. We only set this
  //     on `lost` (lead explicitly told us to stop). For soft cooldowns
  //     (redirected_sac, unqualified, no_response, other) and the won
  //     terminal, the customer can still come back and reach the agent —
  //     a customer asking "I couldn't reach the SAC number" deserves a
  //     reply, not 24h of silence.
  //
  // The dispatcher's close-contact gate honours `closed === true` (hard
  // terminal) for skip and treats a pure soft cooldown as pass.
  const shouldPauseAgent = outcome === 'lost';
  const closedAt = new Date();
  // Merge into existing settings — replacing the whole JSONB column here would
  // drop unrelated keys such as followUpConfig.
  const closeChat = await services.chats.getById(data.chatId);
  await services.chats.update(data.chatId, {
    settings: {
      ...((closeChat?.settings as Record<string, unknown>) ?? {}),
      ...(shouldPauseAgent ? { agentPaused: true } : {}),
      closed: terminal,
      closeUntil: closeUntil?.toISOString() ?? null,
      closeOutcome: outcome,
    } as Record<string, unknown>,
  });

  // ── 5. Disarm inline (idempotent with the chat.closed → follow-up-hooks chain) ──
  await services.followUpLifecycle.disarm({
    chatId: data.chatId,
    instanceId: data.instanceId,
    reason: 'contact_closed',
  });

  // Emit chat.closed explicitly. For `lost` (the only outcome that flips
  // agentPaused: false → true here) the chats service also emits
  // chat.handoff_activated, which is fine — both subscribers disarm the
  // row idempotently and the explicit `followUpLifecycle.disarm` call above
  // already covered it. For all other outcomes only chat.closed fires, which
  // is what BI/audit consumers want anyway.
  if (services.eventBus) {
    const payload: ChatClosedPayload = {
      chatId: data.chatId,
      instanceId: data.instanceId,
      agentId: instance.agentId ?? null,
      outcome,
      reason: data.reason ?? null,
      escalated,
      closedFields: data.closeFields ?? null,
      closedAt: closedAt.toISOString(),
    };
    services.eventBus
      .publish('chat.closed', payload, { instanceId: data.instanceId })
      .catch((err) => log.debug('Failed to publish chat.closed', { error: String(err) }));
  }

  return c.json(
    {
      data: {
        messageId: channelSendResult?.messageId ?? null,
        status: 'closed',
        terminal,
        closeUntil: closeUntil?.toISOString() ?? null,
        escalated,
        outcome,
        timestamp: channelSendResult?.timestamp ?? closedAt.getTime(),
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
  if (typeof plugin.sendTyping === 'function') {
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
  const chat = await services.chats.findByExternalIdSmart(instanceId, fromChatId);
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
  threadId: z.string().min(1).optional().describe('Thread timestamp/id for thread-scoped presence surfaces'),
  status: z.string().min(1).max(100).optional().describe('Custom status text for channels that support it'),
  loadingMessages: z
    .array(z.string().min(1).max(100))
    .max(10)
    .optional()
    .describe('Rotating loading messages for channels that support them'),
  duration: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .describe('Duration in ms before auto-pause; omit for channel default, 0 = until paused'),
});

type SendPresenceInput = z.infer<typeof sendPresenceSchema>;

type PresenceStatusResult = {
  delivered?: boolean;
  method?: string;
  threadId?: string;
  status?: string;
  loadingMessages?: string[];
  reason?: string;
};

type PresenceStatusSender = {
  sendPresenceStatus: (
    instanceId: string,
    chatId: string,
    type: SendPresenceInput['type'],
    duration?: number,
    options?: { threadId?: string; status?: string; loadingMessages?: string[] },
  ) => Promise<PresenceStatusResult | undefined>;
};

function hasPresenceStatusSender(plugin: unknown): plugin is PresenceStatusSender {
  // sendPresenceStatus is on the ChannelPlugin contract since #889, but this
  // guard also accepts a bare object, so the shape check stays.
  return (
    typeof plugin === 'object' &&
    plugin !== null &&
    typeof (plugin as PresenceStatusSender).sendPresenceStatus === 'function'
  );
}

/**
 * POST /messages/send/presence - Send presence indicator (typing, recording)
 *
 * Shows typing/recording indicator in a chat. Auto-pauses after duration.
 * - WhatsApp: supports typing, recording, paused
 * - Discord: supports typing only (recording/paused treated as typing)
 * - Slack: supports AI Assistant thread status via assistant.threads.setStatus
 */
messagesRoutes.post('/send/presence', zValidator('json', sendPresenceSchema), async (c) => {
  const { instanceId, to, type, duration, threadId, status, loadingMessages } = c.req.valid('json');
  const services = c.get('services');
  checkInstanceAccess(c.get('apiKey'), instanceId);

  const { instance, plugin } = await getPluginForInstance(services, c.get('channelRegistry'), instanceId);

  // Resolve recipient (handles person ID to platform ID resolution)
  const resolvedTo = await resolveRecipient(to, instance.channel, services);

  const canSendNativeTyping = plugin.capabilities.canSendTyping === true;
  const canSendThreadStatus = hasPresenceStatusSender(plugin);

  if (!canSendNativeTyping && !canSendThreadStatus) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support typing indicators or thread status`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Native typing indicators keep the historical short burst default.
  // Slack thread status follows Slack's loading-state model: omit duration to
  // persist until reply cleanup, explicit pause, or Slack's own timeout.
  const effectiveDuration = type === 'paused' ? 0 : (duration ?? (canSendThreadStatus ? 0 : 5000));

  // If recording type and plugin is discord, still use sendTyping (Discord only supports typing)
  // WhatsApp plugin handles all three types internally
  const presenceResult = canSendThreadStatus
    ? await plugin.sendPresenceStatus(instanceId, resolvedTo, type, effectiveDuration, {
        threadId,
        status,
        loadingMessages,
      })
    : await (async (): Promise<PresenceStatusResult> => {
        if (typeof plugin.sendTyping !== 'function') {
          throw new OmniError({
            code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
            message: `Channel ${instance.channel} plugin does not implement sendTyping`,
            context: { channelType: instance.channel },
            recoverable: false,
          });
        }
        await plugin.sendTyping(instanceId, resolvedTo, effectiveDuration);
        return { delivered: true, method: 'typing_indicator' };
      })();

  return c.json({
    success: true,
    data: {
      instanceId,
      chatId: resolvedTo,
      type,
      duration: effectiveDuration,
      threadId: presenceResult?.threadId ?? threadId,
      delivered: presenceResult?.delivered ?? true,
      method: presenceResult?.method ?? 'typing_indicator',
      reason: presenceResult?.reason,
      status: presenceResult?.status,
      loadingMessages: presenceResult?.loadingMessages,
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
  if (typeof plugin.markAsRead !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement markAsRead`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  // Pass message data so the plugin can build channel-specific keys (e.g., group participant)
  const messageData = [{ externalId: message.externalId, rawPayload: message.rawPayload ?? null }];

  // Respect per-instance read receipt mode
  const readReceiptMode = (instance.readReceipts ?? 'on') as 'on' | 'off' | 'exclude-self';

  await (
    plugin as {
      markAsRead: (
        instanceId: string,
        chatId: string,
        messageIds: string[],
        messageData?: Array<{ externalId: string; rawPayload?: Record<string, unknown> | null }>,
        readReceiptMode?: 'on' | 'off' | 'exclude-self',
      ) => Promise<void>;
    }
  ).markAsRead(instanceId, chat.externalId, [message.externalId], messageData, readReceiptMode);

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
  if (typeof plugin.markAsRead !== 'function') {
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
  let internalChatId: string | undefined;
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
    internalChatId = chat.id;
  }

  // Fetch message data so the plugin can build channel-specific keys (e.g., group participant)
  if (!internalChatId) {
    const chat = await services.chats.findByExternalIdSmart(instanceId, externalChatId);
    if (chat) internalChatId = chat.id;
  }
  let messageData: Array<{ externalId: string; rawPayload?: Record<string, unknown> | null }> | undefined;
  if (internalChatId) {
    const msgs = await services.messages.getByExternalIds(internalChatId, messageIds);
    messageData = msgs.map((m) => ({ externalId: m.externalId, rawPayload: m.rawPayload ?? null }));
  }

  // Respect per-instance read receipt mode
  const readReceiptMode = (instance.readReceipts ?? 'on') as 'on' | 'off' | 'exclude-self';

  await (
    plugin as {
      markAsRead: (
        instanceId: string,
        chatId: string,
        messageIds: string[],
        messageData?: Array<{ externalId: string; rawPayload?: Record<string, unknown> | null }>,
        readReceiptMode?: 'on' | 'off' | 'exclude-self',
      ) => Promise<void>;
    }
  ).markAsRead(instanceId, externalChatId, messageIds, messageData, readReceiptMode);

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
    const chat = await services.chats.findByExternalIdSmart(data.instanceId, resolvedTo);
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
 * Verify that a message (looked up by internal UUID) belongs to the given instance.
 * Throws FORBIDDEN if the message's chat is owned by a different instance.
 */
async function verifyMessageInstanceOwnership(
  services: Pick<Services, 'chats'>,
  message: { chatId: string; externalId: string },
  instanceId: string,
): Promise<void> {
  if (!message.chatId) return;
  const chat = await services.chats.getById(message.chatId);
  if (chat && chat.instanceId !== instanceId) {
    throw new OmniError({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Message does not belong to this instance',
      context: { instanceId, messageInstanceId: chat.instanceId },
      recoverable: false,
    });
  }
}

/**
 * Resolve a message ID for channel plugin calls.
 *
 * Channel plugins need platform-native IDs (e.g. Baileys message key IDs), not
 * Omni internal UUIDs. If the caller passes an internal UUID, resolve it to the
 * stored externalId and enforce instance ownership before returning it.
 */
export async function resolveChannelMessageId(
  services: Pick<Services, 'messages' | 'chats'>,
  messageId: string,
  instanceId: string,
): Promise<string> {
  if (!isUUID(messageId)) return messageId;

  const message = await services.messages.getById(messageId);
  await verifyMessageInstanceOwnership(services, message, instanceId);

  log.debug('Resolved internal UUID to external ID', { messageId, externalId: message.externalId });
  return message.externalId;
}

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
  if (typeof plugin.editMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement editMessage`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  const resolvedMessageId = await resolveChannelMessageId(services, messageId, instanceId);

  // Edit via channel plugin — catch and surface plugin errors
  try {
    await plugin.editMessage(instanceId, channelId, resolvedMessageId, text);
  } catch (error) {
    // Re-throw typed errors (WhatsAppError, OmniError) for the global error handler
    if (error instanceof OmniError) throw error;
    // Wrap unexpected errors with edit-specific context
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: `Failed to edit message: ${error instanceof Error ? error.message : String(error)}`,
      context: { instanceId, channelType: instance.channel, messageId: resolvedMessageId },
      recoverable: false,
    });
  }

  return c.json({
    success: true,
    data: { messageId, externalId: resolvedMessageId, edited: true },
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
  if (typeof plugin.deleteMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} plugin does not implement deleteMessage`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  const resolvedMessageId = await resolveChannelMessageId(services, messageId, instanceId);

  // Delete via channel plugin
  await plugin.deleteMessage(instanceId, channelId, resolvedMessageId, fromMe);

  return c.json({
    success: true,
    data: { messageId, externalId: resolvedMessageId, deleted: true },
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

  if (typeof plugin.starMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support starring messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  await plugin.starMessage(instanceId, channelId, messageId, true, fromMe);

  // Persist AFTER the channel accepted it, so the row reflects the platform
  // rather than an intent that may have failed (#889). Best-effort: the star
  // did happen, and failing the response would misreport that.
  await persistStarState(services, instanceId, channelId, messageId, true);

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

  if (typeof plugin.starMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Channel ${instance.channel} does not support starring messages`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  await plugin.starMessage(instanceId, channelId, messageId, false, fromMe);

  await persistStarState(services, instanceId, channelId, messageId, false);

  return c.json({
    success: true,
    data: { messageId, starred: false },
  });
});

export { messagesRoutes };
