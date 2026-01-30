/**
 * Message event handlers for Baileys socket
 *
 * Handles incoming messages and converts them to Omni format.
 */

import type { ContentType } from '@omni/core/types';
import type { MessageUpsertType, WAMessage, WAMessageKey, WASocket, proto } from '@whiskeysockets/baileys';
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

type MessageContent = proto.IMessage;
type ContentExtractor = (message: MessageContent) => ExtractedContent | null;

/**
 * Content extractors for each message type
 * Each extractor handles one specific message type
 */
const contentExtractors: Array<{ check: (m: MessageContent) => boolean; extract: ContentExtractor }> = [
  {
    check: (m) => !!m.conversation,
    extract: (m) => ({ type: 'text', text: m.conversation ?? undefined }),
  },
  {
    check: (m) => !!m.extendedTextMessage,
    extract: (m) => ({ type: 'text', text: m.extendedTextMessage?.text ?? undefined }),
  },
  {
    check: (m) => !!m.imageMessage,
    extract: (m) => ({
      type: 'image',
      caption: m.imageMessage?.caption ?? undefined,
      mimeType: m.imageMessage?.mimetype ?? 'image/jpeg',
    }),
  },
  {
    check: (m) => !!m.audioMessage,
    extract: (m) => ({
      type: 'audio',
      mimeType: m.audioMessage?.mimetype ?? 'audio/ogg',
    }),
  },
  {
    check: (m) => !!m.videoMessage,
    extract: (m) => ({
      type: 'video',
      caption: m.videoMessage?.caption ?? undefined,
      mimeType: m.videoMessage?.mimetype ?? 'video/mp4',
    }),
  },
  {
    check: (m) => !!m.documentMessage,
    extract: (m) => ({
      type: 'document',
      filename: m.documentMessage?.fileName ?? undefined,
      mimeType: m.documentMessage?.mimetype ?? 'application/octet-stream',
      caption: m.documentMessage?.caption ?? undefined,
    }),
  },
  {
    check: (m) => !!m.stickerMessage,
    extract: (m) => ({
      type: 'sticker',
      mimeType: m.stickerMessage?.mimetype ?? 'image/webp',
    }),
  },
  {
    check: (m) => !!m.locationMessage,
    extract: (m) => ({
      type: 'location',
      location: {
        latitude: m.locationMessage?.degreesLatitude ?? 0,
        longitude: m.locationMessage?.degreesLongitude ?? 0,
        name: m.locationMessage?.name ?? undefined,
        address: m.locationMessage?.address ?? undefined,
      },
    }),
  },
  {
    check: (m) => !!m.contactMessage,
    extract: (m) => ({
      type: 'contact',
      contact: {
        name: m.contactMessage?.displayName ?? 'Unknown',
        phone: m.contactMessage?.vcard ? extractPhoneFromVcard(m.contactMessage.vcard) : undefined,
      },
    }),
  },
  {
    check: (m) => !!m.reactionMessage,
    extract: (m) => ({
      type: 'reaction',
      emoji: m.reactionMessage?.text ?? undefined,
      targetMessageId: m.reactionMessage?.key?.id ?? undefined,
    }),
  },
];

/**
 * Extract content from a Baileys message using handler map
 */
function extractContent(msg: WAMessage): ExtractedContent | null {
  const message = msg.message;
  if (!message) return null;

  for (const { check, extract } of contentExtractors) {
    if (check(message)) {
      return extract(message);
    }
  }

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
 * Check if a message should be processed
 */
function shouldProcessMessage(msg: WAMessage): boolean {
  if (!msg.message) return false;
  if (isGroupJid(msg.key.remoteJid || '')) return false;
  return true;
}

/**
 * Process a single message
 */
async function processMessage(plugin: WhatsAppPlugin, instanceId: string, msg: WAMessage): Promise<void> {
  const content = extractContent(msg);
  if (!content) return;

  const chatId = msg.key.remoteJid || '';
  const externalId = msg.key.id || '';
  const { id: senderId } = fromJid(isFromMe(msg) ? chatId : msg.key.participant || chatId);
  const replyToId = getReplyToId(msg);

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
    return;
  }

  await plugin.handleMessageReceived(instanceId, externalId, chatId, senderId, content, replyToId, msg, isFromMe(msg));
}

/**
 * Message status codes
 */
const MessageStatus = {
  SERVER_ACK: 2,
  DELIVERY_ACK: 3,
  READ: 4,
  PLAYED: 5,
} as const;

/**
 * Process a message status update
 */
async function processStatusUpdate(
  plugin: WhatsAppPlugin,
  instanceId: string,
  key: WAMessageKey,
  status: number,
): Promise<void> {
  const chatId = key.remoteJid || '';
  const externalId = key.id || '';

  if (status === MessageStatus.DELIVERY_ACK) {
    await plugin.handleMessageDelivered(instanceId, externalId, chatId);
  } else if (status >= MessageStatus.READ) {
    await plugin.handleMessageRead(instanceId, externalId, chatId);
  }
}

/**
 * Set up message event handlers for a Baileys socket
 */
export function setupMessageHandlers(sock: WASocket, plugin: WhatsAppPlugin, instanceId: string): void {
  sock.ev.on('messages.upsert', async (upsert: { messages: WAMessage[]; type: MessageUpsertType }) => {
    if (upsert.type !== 'notify') return;

    for (const msg of upsert.messages) {
      if (shouldProcessMessage(msg)) {
        await processMessage(plugin, instanceId, msg);
      }
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.update.status) {
        await processStatusUpdate(plugin, instanceId, update.key, update.update.status);
      }
    }
  });

  sock.ev.on('messages.delete', async (_deletion) => {
    // Handle deleted messages if needed in the future
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
