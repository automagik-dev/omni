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
import { deepSanitize, sanitizeText } from '../utils/utf8';
import { getPlugin } from './loader';

const log = createLogger('message-persistence');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Truncate string to max length (safe for varchar columns).
 * Also sanitizes for valid UTF-8.
 */
function truncate(str: string | undefined | null, maxLength: number): string | undefined {
  const safe = sanitizeText(str);
  if (!safe) return undefined;
  return safe.length > maxLength ? safe.slice(0, maxLength) : safe;
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
  reaction: 'reaction',
};

/**
 * WhatsApp internal JID suffixes that don't represent real chats.
 * These are used for broadcasts and channels - not user conversations.
 *
 * Note: @lid JIDs ARE real chats (Linked Device IDs) — they get resolved
 * to phone JIDs in the WhatsApp message handler before reaching here.
 * Any unresolved @lid JIDs that still arrive should be stored (not skipped).
 *
 * @broadcast - Status broadcasts and broadcast lists
 * @newsletter - WhatsApp Channels (one-way broadcasts)
 */
const INTERNAL_JID_SUFFIXES = ['@broadcast', '@newsletter'];

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
  let tsNum: number | null = null;

  if (typeof ts === 'number') {
    tsNum = ts;
  } else if (typeof ts === 'string') {
    tsNum = Number(ts);
  } else if (typeof ts === 'object' && ts !== null && 'low' in ts) {
    // Protobuf Long format: { low: number, high: number, unsigned: boolean }
    tsNum = (ts as { low: number }).low;
  }

  if (!tsNum || Number.isNaN(tsNum)) return new Date(fallback);

  // WhatsApp timestamps are in seconds, convert to milliseconds
  return new Date(tsNum < 1e12 ? tsNum * 1000 : tsNum);
}

/**
 * Build a chat preview string from a message payload.
 * For groups, prefixes with sender name. Includes media type badges.
 */
function buildChatPreview(payload: MessageReceivedPayload, rawPayload: Record<string, unknown> | undefined): string {
  const isGroup = payload.chatId.endsWith('@g.us') || rawPayload?.isGroup === true;
  const isFromMe = rawPayload?.isFromMe === true;

  const text = payload.content.text ?? '';
  const badge =
    payload.content.type !== 'text' ? (MEDIA_BADGES[payload.content.type] ?? `[${payload.content.type}]`) : '';
  let preview = badge ? (text ? `${badge} ${text}` : badge) : text;

  // Prefix with sender name for groups (not from self)
  if (isGroup && !isFromMe) {
    const sender = (rawPayload?.pushName as string) || (rawPayload?.displayName as string) || '';
    if (sender) preview = `${sender}: ${preview}`;
  }

  return preview.substring(0, 500);
}

const MEDIA_BADGES: Record<string, string> = {
  image: '[Image]',
  audio: '[Audio]',
  video: '[Video]',
  document: '[Document]',
  sticker: '[Sticker]',
  contact: '[Contact]',
  location: '[Location]',
  poll: '[Poll]',
};

/**
 * Extract and validate phone from sender ID.
 * Returns E.164 phone (+digits) or undefined for non-phone IDs.
 *
 * Filters out:
 * - Group IDs (contain dashes, e.g. "120363123-1234567@g.us")
 * - LID references (numeric but not phone numbers)
 * - Meta IDs (non-numeric platform identifiers)
 * - IDs that are too short (<7 digits) or too long (>15 digits)
 */
function extractPhoneFromSender(senderId: string, channel: string): string | undefined {
  if (!channel.startsWith('whatsapp')) return undefined;

  // Strip @suffix if still present (defensive)
  const bare = senderId.split('@')[0] || senderId;

  // Must be only digits (filters out group IDs with dashes, meta IDs, LIDs with letters)
  if (!/^\d+$/.test(bare)) return undefined;

  // E.164 validation: 7-15 digits
  if (bare.length < 7 || bare.length > 15) return undefined;

  return `+${bare}`;
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
  const phoneNumber = extractPhoneFromSender(platformUserId, channel);

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

/** Check if a chat name should be updated given a new incoming name */
function shouldUpdateChatName(current: string | null | undefined, incoming: string): boolean {
  if (!current) return true;
  if (current.endsWith('@s.whatsapp.net') || current.endsWith('@lid')) return true;
  return incoming !== current; // Name changed (e.g. Discord channel/thread rename)
}

/**
 * Post-process a chat after findOrCreate: populate canonicalId, persist LID mappings,
 * and fix stale names (raw JIDs).
 */
async function postProcessChat(
  services: Services,
  chat: { id: string; canonicalId?: string | null; name?: string | null },
  chatCreated: boolean,
  chatExternalId: string,
  chatType: ChatType,
  pushName: string | undefined,
  instanceId: string,
  rawPayload: Record<string, unknown> | undefined,
  isFromMe: boolean,
): Promise<void> {
  // Populate canonicalId for phone-based chats (enables search by phone number)
  if (chatExternalId.endsWith('@s.whatsapp.net') && !chat.canonicalId) {
    await services.chats.update(chat.id, { canonicalId: chatExternalId });
    chat.canonicalId = chatExternalId;
  }

  // Persist LID→phone mapping if the message was resolved from a LID
  // Also set canonicalId on the chat so LID chats point to their phone JID
  const originalLidJid = rawPayload?.originalLidJid as string | undefined;
  if (originalLidJid && chatExternalId.endsWith('@s.whatsapp.net')) {
    services.chats.upsertLidMapping(instanceId, originalLidJid, chatExternalId).catch((err) => {
      log.debug('Failed to persist LID mapping (non-critical)', { error: String(err) });
    });
    if (!chat.canonicalId) {
      await services.chats.update(chat.id, { canonicalId: chatExternalId });
      chat.canonicalId = chatExternalId;
    }
  }

  // Update chat name if missing, stale, or changed (e.g. Discord thread/channel renames)
  // For DMs: only update from incoming messages (not sent by us) to prevent flip-flopping
  if (!chatCreated) {
    const chatName = rawPayload?.chatName as string | undefined;
    const effectiveName = chatName || (chatType === 'dm' && !isFromMe ? pushName : undefined);
    if (effectiveName && shouldUpdateChatName(chat.name, effectiveName)) {
      await services.chats.update(chat.id, { name: effectiveName });
      chat.name = effectiveName;
    }
  }
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
  // Deep-sanitize rawPayload: WhatsApp protobuf can contain invalid UTF-8 bytes
  // (e.g. truncated multi-byte chars) that PostgreSQL rejects on insert
  const rawPayload = payload.rawPayload ? deepSanitize(payload.rawPayload) : undefined;

  // Step 1: Find or create chat
  const chatType = inferChatType(payload.chatId, rawPayload?.isGroup as boolean | undefined);
  const isFromMe = rawPayload?.isFromMe === true;

  // For DMs: only use pushName if message is FROM the other person (not sent by us)
  // This prevents the chat name from flip-flopping between sender names
  // For groups: always use chatName (group subject)
  const pushName = truncate(rawPayload?.pushName as string | undefined, 255);
  const chatName = truncate(rawPayload?.chatName as string | undefined, 255);
  const effectiveName = chatName || (chatType === 'dm' && !isFromMe ? pushName : undefined);

  const { chat, created: chatCreated } = await services.chats.findOrCreate(metadata.instanceId, chatExternalId, {
    chatType,
    channel,
    name: effectiveName,
  });

  // Post-process chat: canonicalId, LID mapping, name updates
  await postProcessChat(
    services,
    chat,
    chatCreated,
    chatExternalId,
    chatType,
    pushName,
    metadata.instanceId,
    rawPayload,
    isFromMe,
  );

  // Step 2: Process sender identity (before participant, so we have IDs)
  const { personId, platformIdentityId } = await processSenderIdentity(services, payload, metadata, channel);

  // Step 3: Find or create participant (with identity links)
  let participantResult: Awaited<ReturnType<typeof services.chats.findOrCreateParticipant>> | undefined;
  if (payload.from) {
    const participantUserId = truncate(payload.from, 255) ?? payload.from;
    participantResult = await services.chats.findOrCreateParticipant(chat.id, participantUserId, {
      displayName: truncate(rawPayload?.pushName as string | undefined, 255),
      personId,
      platformIdentityId,
    });
  }

  // Step 4: Resolve sender display name (fallback chain)
  const senderDisplayName =
    truncate(rawPayload?.pushName as string | undefined, 255) || // Try pushName first
    participantResult?.participant.displayName || // Fallback to participant displayName
    undefined;

  // Step 5: Build and create message
  const quotedMessage = rawPayload?.quotedMessage as Record<string, unknown> | undefined;
  const platformTimestamp = extractPlatformTimestamp(rawPayload, eventTimestamp);

  const { created } = await services.messages.findOrCreate(chat.id, messageExternalId, {
    source: 'realtime',
    messageType: mapContentType(payload.content.type),
    textContent: sanitizeText(payload.content.text),
    platformTimestamp,
    senderPlatformUserId: truncate(payload.from, 255),
    senderDisplayName,
    senderPersonId: personId,
    senderPlatformIdentityId: platformIdentityId,
    isFromMe: rawPayload?.isFromMe === true,
    hasMedia: !!(payload.content.mediaUrl || payload.content.mimeType),
    mediaMimeType: truncate(payload.content.mimeType, 100),
    mediaUrl: payload.content.mediaUrl,
    mediaLocalPath: rawPayload?.mediaLocalPath as string | undefined,
    replyToExternalId: truncate(payload.replyToId, 255),
    quotedText: quotedMessage?.conversation as string | undefined,
    quotedSenderName: truncate(quotedMessage?.pushName as string | undefined, 255),
    isForwarded: !!(rawPayload?.isForwarded || rawPayload?.forwardingScore),
    rawPayload,
  });

  if (created) {
    log.debug('Created message', { externalId: payload.externalId, chatId: chat.id });
  }

  // Step 6: Record participant activity
  if (payload.from) {
    const activityUserId = truncate(payload.from, 255) ?? payload.from;
    await services.chats.recordParticipantActivity(chat.id, activityUserId);
  }

  // Step 7: Update chat lastMessageAt and preview
  const preview = sanitizeText(buildChatPreview(payload, rawPayload)) ?? '';
  services.chats.updateLastMessage(chat.id, preview, platformTimestamp).catch((error) => {
    log.debug('Failed to update chat lastMessage (non-critical)', { error: String(error) });
  });

  // Step 8: Update lastMessageAt on instance (for reconnect gap detection)
  services.instances.updateLastMessageAt(metadata.instanceId, platformTimestamp).catch((error) => {
    log.debug('Failed to update instance lastMessageAt (non-critical)', { error: String(error) });
  });
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
          // Track consumer offset after successful processing
          if (metadata.streamSequence) {
            await services.consumerOffsets.updateOffset(
              'message-persistence-received',
              'MESSAGE',
              metadata.streamSequence,
              event.id,
            );
          }
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
        startFrom: 'first',
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
            textContent: sanitizeText(payload.content.text),
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
          // Track consumer offset after successful processing
          if (metadata.streamSequence) {
            await services.consumerOffsets.updateOffset(
              'message-persistence-sent',
              'MESSAGE',
              metadata.streamSequence,
              event.id,
            );
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
        startFrom: 'first',
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

          // Find the chat (use smart lookup to handle LID/phone JID resolution)
          const chat = await services.chats.findByExternalIdSmart(metadata.instanceId, payload.chatId);
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
        startFrom: 'first',
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

          // Find the chat (use smart lookup to handle LID/phone JID resolution)
          const chat = await services.chats.findByExternalIdSmart(metadata.instanceId, payload.chatId);
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
        startFrom: 'first',
        concurrency: 10,
      },
    );

    // Subscribe to instance.connected for post-reconnect backfill detection
    await eventBus.subscribe(
      'instance.connected',
      async (event) => {
        const payload = event.payload as { instanceId: string };
        const instanceId = payload.instanceId;
        if (!instanceId) return;

        try {
          const lastMessageAt = await services.instances.getLastMessageAt(instanceId);
          if (!lastMessageAt) return;

          const gapMs = Date.now() - lastMessageAt.getTime();
          const gapMinutes = Math.round(gapMs / 60_000);

          // Only trigger backfill if gap > 5 minutes
          if (gapMs > 5 * 60 * 1000) {
            const channelType = event.metadata.channelType ?? ('whatsapp-baileys' as ChannelType);

            // Discord sync requires a specific channelId — skip auto-backfill
            // (users can trigger per-channel sync manually via POST /instances/:id/sync)
            if (channelType === 'discord') {
              log.info('Instance reconnected with message gap (Discord — skipping auto-backfill, use manual sync)', {
                instanceId,
                gapMinutes,
              });
            } else {
              log.warn('Instance reconnected with message gap', {
                instanceId,
                lastMessageAt: lastMessageAt.toISOString(),
                gapMinutes,
              });

              // Create a sync job (inserts DB row + publishes sync.started event)
              const job = await services.syncJobs.create({
                instanceId,
                channelType,
                type: 'messages',
                config: {
                  since: lastMessageAt.toISOString(),
                  until: new Date().toISOString(),
                },
              });

              log.info('Post-reconnect backfill triggered', {
                instanceId,
                jobId: job.id,
                since: lastMessageAt.toISOString(),
                gapMinutes,
              });
            }
          } else {
            log.debug('Instance reconnected, gap within threshold', { instanceId, gapMinutes });
          }
        } catch (error) {
          log.warn('Post-reconnect gap check failed (non-critical)', {
            instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'message-persistence-reconnect',
        queue: 'message-persistence',
        maxRetries: 2,
        retryDelayMs: 1000,
        startFrom: 'first',
        concurrency: 5,
      },
    );

    log.info('Message persistence initialized - populating unified chats/messages');

    // Startup gap detection (non-blocking)
    detectStartupGaps(services).catch((error) => {
      log.warn('Startup gap detection failed (non-critical)', { error: String(error) });
    });
  } catch (error) {
    log.error('Failed to set up message persistence', { error: String(error) });
    throw error;
  }
}

/**
 * Detect unprocessed message gaps on startup by comparing
 * stored consumer offsets with current stream state.
 */
async function detectStartupGaps(services: Services): Promise<void> {
  const consumers = [
    'message-persistence-received',
    'message-persistence-sent',
    'message-persistence-delivered',
    'message-persistence-read',
  ];

  for (const consumerName of consumers) {
    const offset = await services.consumerOffsets.getOffset(consumerName);
    if (offset > 0) {
      log.info('Consumer startup offset', { consumer: consumerName, lastSequence: offset });
    }
  }
}
