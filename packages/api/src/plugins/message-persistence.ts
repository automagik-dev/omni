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

const log = createLogger('message-persistence');

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
    // Subscribe to message.received
    await eventBus.subscribe('message.received', async (event) => {
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
          name: payload.rawPayload?.chatName as string | undefined,
        });

        // Find or create participant
        if (payload.from) {
          await services.chats.findOrCreateParticipant(chat.id, payload.from, {
            displayName: payload.rawPayload?.pushName as string | undefined,
          });
        }

        // Auto-create Person + PlatformIdentity for sender if doesn't exist
        let senderPersonId = metadata.personId;
        let senderPlatformIdentityId = metadata.platformIdentityId;

        if (payload.from && !senderPlatformIdentityId) {
          const displayName = payload.rawPayload?.pushName as string | undefined;
          const { identity, person, isNew } = await services.persons.findOrCreateIdentity(
            {
              channel,
              instanceId: metadata.instanceId,
              platformUserId: payload.from,
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
          }
        }

        // Extract raw payload info safely
        const rawPayload = payload.rawPayload;
        const quotedMessage = rawPayload?.quotedMessage as Record<string, unknown> | undefined;

        // Create message
        const { message, created } = await services.messages.findOrCreate(chat.id, payload.externalId, {
          source: 'realtime',
          messageType: mapContentType(payload.content.type),
          textContent: payload.content.text,
          platformTimestamp: new Date(event.timestamp),
          // Sender info (use resolved identity)
          senderPlatformUserId: payload.from,
          senderDisplayName: rawPayload?.pushName as string | undefined,
          senderPersonId: senderPersonId,
          senderPlatformIdentityId: senderPlatformIdentityId,
          isFromMe: false,
          // Media
          hasMedia: !!(payload.content.mediaUrl || payload.content.mimeType),
          mediaMimeType: payload.content.mimeType,
          mediaUrl: payload.content.mediaUrl,
          // Reply info
          replyToExternalId: payload.replyToId,
          quotedText: quotedMessage?.conversation as string | undefined,
          quotedSenderName: quotedMessage?.pushName as string | undefined,
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
          await services.chats.recordParticipantActivity(chat.id, payload.from);
        }
      } catch (error) {
        log.error('Failed to persist message.received to unified model', {
          externalId: payload.externalId,
          error: String(error),
        });
      }
    });

    // Subscribe to message.sent
    await eventBus.subscribe('message.sent', async (event) => {
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
          // Reply info
          replyToExternalId: payload.replyToId,
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
      }
    });

    // Subscribe to message.delivered - update delivery status
    await eventBus.subscribe('message.delivered', async (event) => {
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
      }
    });

    // Subscribe to message.read - update delivery status
    await eventBus.subscribe('message.read', async (event) => {
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
      }
    });

    log.info('Message persistence initialized - populating unified chats/messages');
  } catch (error) {
    log.error('Failed to set up message persistence', { error: String(error) });
    throw error;
  }
}
