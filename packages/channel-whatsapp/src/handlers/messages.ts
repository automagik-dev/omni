/**
 * Message event handlers for Baileys socket
 *
 * Handles incoming messages and converts them to Omni format.
 */

import type { ContentType } from '@omni/core/types';
import type { MessageUpsertType, WAMessage, WAMessageKey, WASocket } from '@whiskeysockets/baileys';
import { fromJid, isGroupJid } from '../jid';
import type { WhatsAppPlugin } from '../plugin';

/**
 * Extract message content from a WAMessage
 */
interface ExtractedContent {
  type: ContentType;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  emoji?: string;
  targetMessageId?: string;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  contact?: {
    name: string;
    phone?: string;
  };
}

/**
 * Extract content from a Baileys message
 */
function extractContent(msg: WAMessage): ExtractedContent | null {
  const message = msg.message;
  if (!message) return null;

  // Text message
  if (message.conversation) {
    return {
      type: 'text',
      text: message.conversation,
    };
  }

  // Extended text (with reply, links, etc.)
  if (message.extendedTextMessage) {
    return {
      type: 'text',
      text: message.extendedTextMessage.text || undefined,
    };
  }

  // Image message
  if (message.imageMessage) {
    return {
      type: 'image',
      caption: message.imageMessage.caption || undefined,
      mimeType: message.imageMessage.mimetype || 'image/jpeg',
    };
  }

  // Audio message (including voice notes)
  if (message.audioMessage) {
    return {
      type: 'audio',
      mimeType: message.audioMessage.mimetype || 'audio/ogg',
    };
  }

  // Video message
  if (message.videoMessage) {
    return {
      type: 'video',
      caption: message.videoMessage.caption || undefined,
      mimeType: message.videoMessage.mimetype || 'video/mp4',
    };
  }

  // Document message
  if (message.documentMessage) {
    return {
      type: 'document',
      filename: message.documentMessage.fileName || undefined,
      mimeType: message.documentMessage.mimetype || 'application/octet-stream',
      caption: message.documentMessage.caption || undefined,
    };
  }

  // Sticker message
  if (message.stickerMessage) {
    return {
      type: 'sticker',
      mimeType: message.stickerMessage.mimetype || 'image/webp',
    };
  }

  // Location message
  if (message.locationMessage) {
    return {
      type: 'location',
      location: {
        latitude: message.locationMessage.degreesLatitude || 0,
        longitude: message.locationMessage.degreesLongitude || 0,
        name: message.locationMessage.name || undefined,
        address: message.locationMessage.address || undefined,
      },
    };
  }

  // Contact message
  if (message.contactMessage) {
    return {
      type: 'contact',
      contact: {
        name: message.contactMessage.displayName || 'Unknown',
        phone: message.contactMessage.vcard ? extractPhoneFromVcard(message.contactMessage.vcard) : undefined,
      },
    };
  }

  // Reaction message
  if (message.reactionMessage) {
    return {
      type: 'reaction',
      emoji: message.reactionMessage.text || undefined,
      targetMessageId: message.reactionMessage.key?.id || undefined,
    };
  }

  // Unknown message type
  return null;
}

/**
 * Extract phone number from vCard format
 */
function extractPhoneFromVcard(vcard: string): string | undefined {
  const telMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
  if (telMatch?.[1]) {
    return telMatch[1].replace(/[\s-]/g, '');
  }
  return undefined;
}

/**
 * Get the reply-to message ID if present
 */
function getReplyToId(msg: WAMessage): string | undefined {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  return contextInfo?.stanzaId || undefined;
}

/**
 * Determine if a message is from me (outgoing)
 */
function isFromMe(msg: WAMessage): boolean {
  return msg.key.fromMe === true;
}

/**
 * Set up message event handlers for a Baileys socket
 */
export function setupMessageHandlers(sock: WASocket, plugin: WhatsAppPlugin, instanceId: string): void {
  // Handle incoming/outgoing messages
  sock.ev.on('messages.upsert', async (upsert: { messages: WAMessage[]; type: MessageUpsertType }) => {
    const { messages, type } = upsert;

    // Only process actual messages (not history sync)
    if (type !== 'notify') {
      return;
    }

    for (const msg of messages) {
      // Skip status updates and other non-message updates
      if (!msg.message) continue;

      // Skip messages from groups if group handling is disabled
      if (isGroupJid(msg.key.remoteJid || '')) {
        // Groups are out of scope for this wish
        continue;
      }

      const content = extractContent(msg);
      if (!content) continue;

      const chatId = msg.key.remoteJid || '';
      const externalId = msg.key.id || '';
      const { id: senderId } = fromJid(isFromMe(msg) ? chatId : msg.key.participant || chatId);
      const replyToId = getReplyToId(msg);

      // For reactions, handle differently
      if (content.type === 'reaction') {
        await plugin.handleReactionReceived(
          instanceId,
          externalId,
          chatId,
          senderId,
          content.emoji || '',
          content.targetMessageId || '',
          isFromMe(msg),
        );
        continue;
      }

      // Emit the message received event
      await plugin.handleMessageReceived(
        instanceId,
        externalId,
        chatId,
        senderId,
        content,
        replyToId,
        msg,
        isFromMe(msg),
      );
    }
  });

  // Handle message updates (delivery/read receipts)
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      const { key, update: msgUpdate } = update;

      // Check for status updates
      if (msgUpdate.status) {
        const chatId = key.remoteJid || '';
        const externalId = key.id || '';

        // Status codes:
        // 2 = SERVER_ACK (sent)
        // 3 = DELIVERY_ACK (delivered)
        // 4 = READ (read)
        // 5 = PLAYED (for voice notes)
        if (msgUpdate.status === 3) {
          await plugin.handleMessageDelivered(instanceId, externalId, chatId);
        } else if (msgUpdate.status >= 4) {
          await plugin.handleMessageRead(instanceId, externalId, chatId);
        }
      }
    }
  });

  // Handle message deletions
  sock.ev.on('messages.delete', async (deletion) => {
    // Handle deleted messages if needed
    // For now, we just log it
    if ('keys' in deletion) {
      for (const _key of deletion.keys) {
        // Could emit a message.deleted event here
      }
    }
  });
}

/**
 * Build message key from identifiers
 */
export function buildMessageKey(chatId: string, messageId: string, fromMe: boolean): WAMessageKey {
  return {
    remoteJid: chatId,
    id: messageId,
    fromMe,
  };
}
