/**
 * Message Persistence Handler
 *
 * Subscribes to message events and creates unified chats/messages.
 * This is the bridge between the event-based system and the unified message model.
 *
 * Flow:
 * - message.received → find/create chat → create message (source: 'realtime')
 * - message.sent → find/create chat → create message (source: 'realtime', isFromMe: true)
 * - message.delivered/read → update message delivery status
 *
 * @see unified-messages wish
 */

import type { EventBus, MessageReceivedPayload, MessageSentPayload } from '@omni/core';
import { createLogger } from '@omni/core';
import type { ChannelType, ChatType, MessageType } from '@omni/db';
import type { Services } from '../services';
import { getPlugin } from './loader';

const log = createLogger('message-persistence');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Truncate string to max length (safe for varchar columns)
 */
function truncate(str: string | undefined | null, maxLength: number): string | undefined {
  if (!str) return undefined;
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * Content type to message type mapping
 */
const CONTENT_TYPE_MAP: Record<string, MessageType> = {
  audio: 'audio',
  image: 'image',
  video: 'video',
  document: 'document',
  sticker: 'sticker',
  contact: 'contact',
  location: 'location',
  poll: 'poll',
  poll_update: 'poll',
};

/**
 * WhatsApp internal JID suffixes that don't represent real chats.
 * These are used for device sync, broadcasts, and channels - not user conversations.
 *
 * @lid - Linked Device ID (device-to-device sync)
 * @broadcast - Status broadcasts and broadcast lists
 * @newsletter - WhatsApp Channels (one-way broadcasts)
 */
const INTERNAL_JID_SUFFIXES = ['@lid', '@broadcast', '@newsletter'];

/**
 * Check if a chat ID is an internal WhatsApp JID that should be skipped.
 * These don't represent real conversations and shouldn't be stored as chats.
 */
function isInternalWhatsAppJid(chatId: string): boolean {
  return INTERNAL_JID_SUFFIXES.some((suffix) => chatId.endsWith(suffix));
}

/**
 * Map content type to message type
 */
function mapContentType(contentType: string | undefined): MessageType {
  return CONTENT_TYPE_MAP[contentType ?? ''] ?? 'text';
}

/**
 * Infer chat type from context
 */
function inferChatType(chatId: string, isGroup?: boolean): ChatType {
  if (chatId.includes('@g.us') || chatId.includes('@broadcast')) return 'group';
  if (chatId.includes('@newsletter')) return 'channel';
  if (isGroup) return 'group';
  return 'dm';
}

/**
 * Find long string fields in an object (for debugging varchar issues)
 */
function findLongStrings(obj: unknown, prefix = '', minLength = 200): Record<string, number> {
  const result: Record<string, number> = {};
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = `${prefix}${key}`;
    if (typeof val === 'string' && val.length > minLength) {
      result[fullKey] = val.length;
    } else if (val && typeof val === 'object') {
      Object.assign(result, findLongStrings(val, `${fullKey}.`, minLength));
    }
  }
  return result;
}

/**
 * Extract platform timestamp from raw payload
 */
function extractPlatformTimestamp(rawPayload: Record<string, unknown> | undefined, fallback: number): Date {
  if (!rawPayload?.messageTimestamp) return new Date(fallback);

  const ts = rawPayload.messageTimestamp;
  const tsNum = typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : null;
  if (!tsNum || Number.isNaN(tsNum)) return new Date(fallback);

  // WhatsApp timestamps are in seconds, convert to milliseconds
  return new Date(tsNum < 1e12 ? tsNum * 1000 : tsNum);
}

/**
 * Extract phone number from WhatsApp JID
 */
function extractPhoneFromJid(jid: string, channel: string): string | undefined {
  if (!channel.startsWith('whatsapp')) return undefined;
  return jid.split('@')[0]?.replace(/\D/g, '');
}

// ============================================================================
// Identity Processing
// ============================================================================

interface IdentityResult {
  personId: string | undefined;
  platformIdentityId: string | undefined;
}

/**
 * Process sender identity - find or create person + platform identity
 */
async function processSenderIdentity(
  services: Services,
  payload: MessageReceivedPayload,
  metadata: { instanceId: string; personId?: string; platformIdentityId?: string; channelType?: string },
  channel: ChannelType,
): Promise<IdentityResult> {
  // Return existing if already resolved
  if (metadata.platformIdentityId) {
    return { personId: metadata.personId, platformIdentityId: metadata.platformIdentityId };
  }

  if (!payload.from) {
    return { personId: metadata.personId, platformIdentityId: undefined };
  }

  const displayName = truncate(payload.rawPayload?.pushName as string | undefined, 255);
  const platformUserId = truncate(payload.from, 255) ?? payload.from;
  const phoneNumber = extractPhoneFromJid(platformUserId, channel);

  const { identity, person, isNew } = await services.persons.findOrCreateIdentity(
    { channel, instanceId: metadata.instanceId, platformUserId, platformUsername: displayName },
    { createPerson: true, displayName, matchByPhone: phoneNumber },
  );

  // Fetch profile for new identities (non-blocking)
  if (isNew) {
    log.debug('Auto-created identity for sender', {
      platformUserId: payload.from,
      identityId: identity.id,
      personId: person?.id,
    });
    fetchAndUpdateProfile(services, channel, metadata.instanceId, payload.from, identity.id).catch(() => {});
  }

  return { personId: person?.id, platformIdentityId: identity.id };
}

/**
 * Fetch user profile from channel plugin and update identity (non-blocking)
 */
async function fetchAndUpdateProfile(
  services: Services,
  channel: ChannelType,
  instanceId: string,
  userId: string,
  identityId: string,
): Promise<void> {
  try {
    const plugin = await getPlugin(channel);
    if (!plugin || !('fetchUserProfile' in plugin)) return;

    const fetchProfile = plugin.fetchUserProfile as (
      instanceId: string,
      userId: string,
    ) => Promise<{ displayName?: string; avatarUrl?: string; bio?: string; platformData?: Record<string, unknown> }>;

    const profile = await fetchProfile.call(plugin, instanceId, userId);
    if (profile.avatarUrl || profile.bio || profile.platformData) {
      await services.persons.updateIdentityProfile(identityId, profile);
      log.debug('Updated identity with profile data', {
        identityId,
        hasAvatar: !!profile.avatarUrl,
        hasBio: !!profile.bio,
      });
    }
  } catch (error) {
    log.warn('Failed to fetch profile for new identity', { identityId, error: String(error) });
  }
}

// ============================================================================
// Message Received Handler
// ============================================================================

interface MessageMetadata {
  instanceId: string;
  personId?: string;
  platformIdentityId?: string;
  channelType?: string;
}

/**
 * Handle message.received event - main processing logic
 */
async function handleMessageReceived(
  services: Services,
  payload: MessageReceivedPayload,
  metadata: MessageMetadata,
  eventTimestamp: number,
): Promise<void> {
  const channel = (metadata.channelType ?? 'whatsapp') as ChannelType;
  const chatExternalId = truncate(payload.chatId, 255) ?? payload.chatId;
  const messageExternalId = truncate(payload.externalId, 255) ?? payload.externalId;
  const rawPayload = payload.rawPayload;

  // Step 1: Find or create chat
  const chatType = inferChatType(payload.chatId, rawPayload?.isGroup as boolean | undefined);
  // For DMs, use pushName as chat name since it's the contact's WhatsApp display name
  // For groups, chatName would come from group subject (handled separately)
  const pushName = truncate(rawPayload?.pushName as string | undefined, 255);
  const chatName = truncate(rawPayload?.chatName as string | undefined, 255);
  const effectiveName = chatName || (chatType === 'dm' ? pushName : undefined);

  const { chat, created: chatCreated } = await services.chats.findOrCreate(metadata.instanceId, chatExternalId, {
    chatType,
    channel,
    name: effectiveName,
  });

  // Update chat name if it's missing and we have a pushName (for DMs)
  if (!chatCreated && !chat.name && chatType === 'dm' && pushName) {
    await services.chats.update(chat.id, { name: pushName });
    chat.name = pushName; // Update local reference
  }

  // Step 2: Process sender identity (before participant, so we have IDs)
  const { personId, platformIdentityId } = await processSenderIdentity(services, payload, metadata, channel);

  // Step 3: Find or create participant (with identity links)
  if (payload.from) {
    const participantUserId = truncate(payload.from, 255) ?? payload.from;
    await services.chats.findOrCreateParticipant(chat.id, participantUserId, {
      displayName: truncate(rawPayload?.pushName as string | undefined, 255),
      personId,
      platformIdentityId,
    });
  }

  // Step 4: Build and create message
  const quotedMessage = rawPayload?.quotedMessage as Record<string, unknown> | undefined;
  const platformTimestamp = extractPlatformTimestamp(rawPayload, eventTimestamp);

  const { created } = await services.messages.findOrCreate(chat.id, messageExternalId, {
    source: 'realtime',
    messageType: mapContentType(payload.content.type),
    textContent: payload.content.text,
    platformTimestamp,
    senderPlatformUserId: truncate(payload.from, 255),
    senderDisplayName: truncate(rawPayload?.pushName as string | undefined, 255),
    senderPersonId: personId,
    senderPlatformIdentityId: platformIdentityId,
    isFromMe: false,
    hasMedia: !!(payload.content.mediaUrl || payload.content.mimeType),
    mediaMimeType: truncate(payload.content.mimeType, 100),
    mediaUrl: payload.content.mediaUrl,
    replyToExternalId: truncate(payload.replyToId, 255),
    quotedText: quotedMessage?.conversation as string | undefined,
    quotedSenderName: truncate(quotedMessage?.pushName as string | undefined, 255),
    isForwarded: !!(rawPayload?.isForwarded || rawPayload?.forwardingScore),
    rawPayload,
  });

  if (created) {
    log.debug('Created message', { externalId: payload.externalId, chatId: chat.id });
  }

  // Step 5: Record participant activity
  if (payload.from) {
    const activityUserId = truncate(payload.from, 255) ?? payload.from;
    await services.chats.recordParticipantActivity(chat.id, activityUserId);
  }
}

/**
 * Log detailed error info for message.received failures
 */
function logMessageReceivedError(payload: MessageReceivedPayload, error: unknown): void {
  const rawPayload = payload.rawPayload;
  const quotedMsg = rawPayload?.quotedMessage as Record<string, unknown> | undefined;
  const longFields = findLongStrings(rawPayload, 'raw.');

  log.error('Failed to persist message.received to unified model', {
    externalId: payload.externalId,
    error: String(error),
    fieldLengths: {
      chatId: payload.chatId?.length,
      from: payload.from?.length,
      pushName: (rawPayload?.pushName as string)?.length,
      chatName: (rawPayload?.chatName as string)?.length,
      mimeType: payload.content?.mimeType?.length,
      replyToId: payload.replyToId?.length,
      quotedPushName: (quotedMsg?.pushName as string)?.length,
      quotedParticipant: (quotedMsg?.participant as string)?.length,
    },
    longFields: Object.keys(longFields).length > 0 ? longFields : undefined,
  });
}

// ============================================================================
// Main Setup
// ============================================================================

/**
 * Set up message persistence - subscribes to message events and writes to chats/messages tables
 */
export async function setupMessagePersistence(eventBus: EventBus, services: Services): Promise<void> {
  try {
    // Subscribe to message.received with durable consumer for reliability
    // - durable: survives API restarts, resumes from last acked message
    // - queue: load balances across multiple API instances
    // - maxRetries: retries failed messages before dead letter
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const payload = event.payload as MessageReceivedPayload;
        const metadata = event.metadata;

        // Skip if no instance ID
        if (!metadata.instanceId) {
          log.debug('Skipping message without instanceId', { externalId: payload.externalId });
          return;
        }

        try {
          await handleMessageReceived(
            services,
            payload,
            { ...metadata, instanceId: metadata.instanceId },
            event.timestamp,
          );
        } catch (error) {
          logMessageReceivedError(payload, error);
          throw error;
        }
      },
      {
        durable: 'message-persistence-received',
        queue: 'message-persistence',
        maxRetries: 3,
        retryDelayMs: 1000,
        startFrom: 'last',
        concurrency: 10, // Process up to 10 messages in parallel
      },
    );

    // Subscribe to message.sent with durable consumer
    await eventBus.subscribe(
      'message.sent',
      async (event) => {
        const payload = event.payload as MessageSentPayload;
        const metadata = event.metadata;

        try {
          // Skip if no instance ID
          if (!metadata.instanceId) {
            log.debug('Skipping sent message without instanceId', { externalId: payload.externalId });
            return;
          }

          // Truncate IDs for varchar(255) safety
          const chatExternalId = truncate(payload.chatId, 255) ?? payload.chatId;
          const messageExternalId = truncate(payload.externalId, 255) ?? payload.externalId;

          // Find or create chat
          const { chat } = await services.chats.findOrCreate(metadata.instanceId, chatExternalId, {
            chatType: inferChatType(payload.chatId),
            channel: (metadata.channelType ?? 'whatsapp') as ChannelType,
          });

          // Create message (sent by us)
          const { message, created } = await services.messages.findOrCreate(chat.id, messageExternalId, {
            source: 'realtime',
            messageType: mapContentType(payload.content.type),
            textContent: payload.content.text,
            platformTimestamp: new Date(event.timestamp),
            // Sender info (from us)
            senderPersonId: metadata.personId,
            senderPlatformIdentityId: metadata.platformIdentityId,
            isFromMe: true,
            // Media
            hasMedia: !!payload.content.mediaUrl,
            mediaUrl: payload.content.mediaUrl,
            // Reply info - truncate varchar(255) fields
            replyToExternalId: truncate(payload.replyToId, 255),
          });

          if (created) {
            log.debug('Created sent message', {
              messageId: message.id,
              externalId: payload.externalId,
              chatId: chat.id,
            });
          }
        } catch (error) {
          log.error('Failed to persist message.sent to unified model', {
            externalId: payload.externalId,
            error: String(error),
          });
          throw error;
        }
      },
      {
        durable: 'message-persistence-sent',
        queue: 'message-persistence',
        maxRetries: 3,
        retryDelayMs: 1000,
        startFrom: 'last',
        concurrency: 10,
      },
    );

    // Subscribe to message.delivered - update delivery status
    await eventBus.subscribe(
      'message.delivered',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; deliveredAt: number };
        const metadata = event.metadata;

        try {
          if (!metadata.instanceId) return;

          // Skip internal WhatsApp JIDs (device sync, broadcasts, newsletters)
          if (isInternalWhatsAppJid(payload.chatId)) return;

          // Find the chat
          const chat = await services.chats.getByExternalId(metadata.instanceId, payload.chatId);
          if (!chat) {
            log.debug('Chat not found for message.delivered', { chatId: payload.chatId });
            return;
          }

          // Find the message
          const message = await services.messages.getByExternalId(chat.id, payload.externalId);
          if (!message) {
            log.debug('Message not found for message.delivered', { externalId: payload.externalId });
            return;
          }

          // Update delivery status
          await services.messages.updateDeliveryStatus(message.id, 'delivered');
          log.debug('Updated message delivery status', { messageId: message.id, status: 'delivered' });
        } catch (error) {
          log.error('Failed to update delivery status', {
            externalId: payload.externalId,
            error: String(error),
          });
          // Note: Not re-throwing - delivery status updates are non-critical
          // If they fail, the message is still stored, just status may be stale
        }
      },
      {
        durable: 'message-persistence-delivered',
        queue: 'message-persistence',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'last',
        concurrency: 10,
      },
    );

    // Subscribe to message.read - update delivery status
    await eventBus.subscribe(
      'message.read',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; readAt: number };
        const metadata = event.metadata;

        try {
          if (!metadata.instanceId) return;

          // Skip internal WhatsApp JIDs (device sync, broadcasts, newsletters)
          if (isInternalWhatsAppJid(payload.chatId)) return;

          // Find the chat
          const chat = await services.chats.getByExternalId(metadata.instanceId, payload.chatId);
          if (!chat) {
            log.debug('Chat not found for message.read', { chatId: payload.chatId });
            return;
          }

          // Find the message
          const message = await services.messages.getByExternalId(chat.id, payload.externalId);
          if (!message) {
            log.debug('Message not found for message.read', { externalId: payload.externalId });
            return;
          }

          // Update delivery status to read
          await services.messages.updateDeliveryStatus(message.id, 'read');
          log.debug('Updated message delivery status', { messageId: message.id, status: 'read' });
        } catch (error) {
          log.error('Failed to update read status', {
            externalId: payload.externalId,
            error: String(error),
          });
          // Note: Not re-throwing - read status updates are non-critical
        }
      },
      {
        durable: 'message-persistence-read',
        queue: 'message-persistence',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'last',
        concurrency: 10,
      },
    );

    log.info('Message persistence initialized - populating unified chats/messages');
  } catch (error) {
    log.error('Failed to set up message persistence', { error: String(error) });
    throw error;
  }
}
