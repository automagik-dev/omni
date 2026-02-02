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

/**
 * Truncate string to max length (safe for varchar columns)
 */
function truncate(str: string | undefined | null, maxLength: number): string | undefined {
  if (!str) return undefined;
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * Map content type to message type
 */
function mapContentType(contentType: string | undefined): MessageType {
  switch (contentType) {
    case 'audio':
      return 'audio';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
    case 'contact':
      return 'contact';
    case 'location':
      return 'location';
    case 'poll':
    case 'poll_update':
      return 'poll';
    default:
      return 'text';
  }
}

/**
 * Infer chat type from context
 */
function inferChatType(chatId: string, isGroup?: boolean): ChatType {
  // WhatsApp group IDs end with @g.us, DMs end with @s.whatsapp.net
  if (chatId.includes('@g.us') || chatId.includes('@broadcast')) {
    return 'group';
  }
  if (chatId.includes('@newsletter')) {
    return 'channel';
  }
  if (isGroup) {
    return 'group';
  }
  return 'dm';
}

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

        try {
          // Skip if no instance ID
          if (!metadata.instanceId) {
            log.debug('Skipping message without instanceId', { externalId: payload.externalId });
            return;
          }

          const channel = (metadata.channelType ?? 'whatsapp') as ChannelType;

          // Find or create chat
          const { chat } = await services.chats.findOrCreate(metadata.instanceId, payload.chatId, {
            chatType: inferChatType(payload.chatId, payload.rawPayload?.isGroup as boolean | undefined),
            channel,
            name: truncate(payload.rawPayload?.chatName as string | undefined, 255),
          });

          // Find or create participant - truncate platformUserId for varchar(255)
          if (payload.from) {
            const participantUserId = payload.from.length > 255 ? payload.from.slice(0, 255) : payload.from;
            await services.chats.findOrCreateParticipant(chat.id, participantUserId, {
              displayName: truncate(payload.rawPayload?.pushName as string | undefined, 255),
            });
          }

          // Auto-create Person + PlatformIdentity for sender if doesn't exist
          let senderPersonId = metadata.personId;
          let senderPlatformIdentityId = metadata.platformIdentityId;

          if (payload.from && !senderPlatformIdentityId) {
            const displayName = truncate(payload.rawPayload?.pushName as string | undefined, 255);
            // Note: platformUserId (JID) should never exceed 255 chars in practice
            const platformUserId = payload.from.length > 255 ? payload.from.slice(0, 255) : payload.from;
            const { identity, person, isNew } = await services.persons.findOrCreateIdentity(
              {
                channel,
                instanceId: metadata.instanceId,
                platformUserId,
                platformUsername: displayName,
              },
              {
                createPerson: true,
                displayName,
              },
            );

            senderPlatformIdentityId = identity.id;
            senderPersonId = person?.id;

            if (isNew) {
              log.debug('Auto-created identity for sender', {
                platformUserId: payload.from,
                identityId: identity.id,
                personId: person?.id,
              });

              // Fetch profile from channel plugin and update identity
              try {
                const plugin = await getPlugin(channel);
                if (plugin && 'fetchUserProfile' in plugin) {
                  const fetchProfile = plugin.fetchUserProfile as (
                    instanceId: string,
                    userId: string,
                  ) => Promise<{
                    displayName?: string;
                    avatarUrl?: string;
                    bio?: string;
                    platformData?: Record<string, unknown>;
                  }>;

                  const profile = await fetchProfile.call(plugin, metadata.instanceId, payload.from);

                  if (profile.avatarUrl || profile.bio || profile.platformData) {
                    await services.persons.updateIdentityProfile(identity.id, profile);
                    log.debug('Updated identity with profile data', {
                      identityId: identity.id,
                      hasAvatar: !!profile.avatarUrl,
                      hasBio: !!profile.bio,
                      hasPlatformData: !!profile.platformData,
                    });
                  }
                }
              } catch (profileError) {
                // Don't fail message processing if profile fetch fails
                log.warn('Failed to fetch profile for new identity', {
                  identityId: identity.id,
                  error: String(profileError),
                });
              }
            }
          }

          // Extract raw payload info safely
          const rawPayload = payload.rawPayload;
          const quotedMessage = rawPayload?.quotedMessage as Record<string, unknown> | undefined;

          // Extract platform timestamp from raw payload if available (for history sync messages)
          // WhatsApp messageTimestamp is in Unix seconds, fallback to event timestamp
          let platformTimestamp = new Date(event.timestamp);
          if (rawPayload?.messageTimestamp) {
            const ts = rawPayload.messageTimestamp;
            const tsNum = typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : null;
            if (tsNum && !Number.isNaN(tsNum)) {
              // WhatsApp timestamps are in seconds, convert to milliseconds
              platformTimestamp = new Date(tsNum < 1e12 ? tsNum * 1000 : tsNum);
            }
          }

          // Create message
          const { message, created } = await services.messages.findOrCreate(chat.id, payload.externalId, {
            source: 'realtime',
            messageType: mapContentType(payload.content.type),
            textContent: payload.content.text,
            platformTimestamp,
            // Sender info (use resolved identity) - truncate varchar(255) fields
            senderPlatformUserId: truncate(payload.from, 255),
            senderDisplayName: truncate(rawPayload?.pushName as string | undefined, 255),
            senderPersonId: senderPersonId,
            senderPlatformIdentityId: senderPlatformIdentityId,
            isFromMe: false,
            // Media
            hasMedia: !!(payload.content.mediaUrl || payload.content.mimeType),
            mediaMimeType: payload.content.mimeType,
            mediaUrl: payload.content.mediaUrl,
            // Reply info - truncate varchar(255) fields
            replyToExternalId: truncate(payload.replyToId, 255),
            quotedText: quotedMessage?.conversation as string | undefined,
            quotedSenderName: truncate(quotedMessage?.pushName as string | undefined, 255),
            // Forward info
            isForwarded: !!(rawPayload?.isForwarded || rawPayload?.forwardingScore),
            // Raw data
            rawPayload: rawPayload,
          });

          if (created) {
            log.debug('Created message', {
              messageId: message.id,
              externalId: payload.externalId,
              chatId: chat.id,
            });
          }

          // Record participant activity
          if (payload.from) {
            const activityUserId = payload.from.length > 255 ? payload.from.slice(0, 255) : payload.from;
            await services.chats.recordParticipantActivity(chat.id, activityUserId);
          }
        } catch (error) {
          log.error('Failed to persist message.received to unified model', {
            externalId: payload.externalId,
            error: String(error),
          });
          // Re-throw to trigger NATS retry mechanism
          throw error;
        }
      },
      {
        durable: 'message-persistence-received',
        queue: 'message-persistence',
        maxRetries: 3,
        retryDelayMs: 1000,
        startFrom: 'last',
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

          // Find or create chat
          const { chat } = await services.chats.findOrCreate(metadata.instanceId, payload.chatId, {
            chatType: inferChatType(payload.chatId),
            channel: (metadata.channelType ?? 'whatsapp') as ChannelType,
          });

          // Create message (sent by us)
          const { message, created } = await services.messages.findOrCreate(chat.id, payload.externalId, {
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
      },
    );

    log.info('Message persistence initialized - populating unified chats/messages');
  } catch (error) {
    log.error('Failed to set up message persistence', { error: String(error) });
    throw error;
  }
}
