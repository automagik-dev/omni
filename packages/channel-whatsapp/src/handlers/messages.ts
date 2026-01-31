/**
 * Message event handlers for Baileys socket
 *
 * Handles incoming messages and converts them to Omni format.
 * Supports all WhatsApp message types including:
 * - Basic: text, image, audio, video, document, sticker
 * - Interactive: reaction, location, live_location, contact
 * - Extended: poll, poll_update, event, product
 * - Lifecycle: edit, delete
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
  // Poll-specific fields
  poll?: {
    name: string;
    options: string[];
    selectableCount?: number;
  };
  pollVotes?: string[];
  // Event/calendar specific fields
  event?: {
    name: string;
    description?: string;
    location?: string;
    startTime?: Date;
    endTime?: Date;
  };
  // Product-specific fields
  product?: {
    id: string;
    title?: string;
    description?: string;
    price?: string;
    currency?: string;
    imageUrl?: string;
  };
  // Edit-specific fields
  editedText?: string;
  editedMessageId?: string;
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
  // Poll creation message
  {
    check: (m) => !!m.pollCreationMessage || !!m.pollCreationMessageV3,
    extract: (m) => {
      const poll = m.pollCreationMessage || m.pollCreationMessageV3;
      return {
        type: 'poll' as ContentType,
        text: poll?.name ?? undefined,
        poll: {
          name: poll?.name ?? '',
          options: poll?.options?.map((o: { optionName?: string | null }) => o.optionName ?? '') ?? [],
          selectableCount: poll?.selectableOptionsCount ?? undefined,
        },
      };
    },
  },
  // Poll update (vote) message
  {
    check: (m) => !!m.pollUpdateMessage,
    extract: (m) => ({
      type: 'poll_update' as ContentType,
      targetMessageId: m.pollUpdateMessage?.pollCreationMessageKey?.id ?? undefined,
      // Note: votes are encrypted, need decryption with original poll message
      pollVotes: [],
    }),
  },
  // Event/calendar message (scheduled events)
  {
    check: (m) => !!m.eventMessage,
    extract: (m) => ({
      type: 'event' as ContentType,
      text: m.eventMessage?.name ?? undefined,
      event: {
        name: m.eventMessage?.name ?? '',
        description: m.eventMessage?.description ?? undefined,
        location: m.eventMessage?.location?.name ?? undefined,
        startTime: m.eventMessage?.startTime
          ? new Date(Number(m.eventMessage.startTime) * 1000)
          : undefined,
      },
    }),
  },
  // Live location sharing
  {
    check: (m) => !!m.liveLocationMessage,
    extract: (m) => ({
      type: 'live_location' as ContentType,
      location: {
        latitude: m.liveLocationMessage?.degreesLatitude ?? 0,
        longitude: m.liveLocationMessage?.degreesLongitude ?? 0,
        name: m.liveLocationMessage?.caption ?? undefined,
      },
      text: m.liveLocationMessage?.caption ?? undefined,
    }),
  },
  // Product message (for business accounts)
  {
    check: (m) => !!m.productMessage,
    extract: (m) => ({
      type: 'product' as ContentType,
      text: m.productMessage?.product?.productId ?? undefined,
      product: {
        id: m.productMessage?.product?.productId ?? '',
        title: m.productMessage?.product?.title ?? undefined,
        description: m.productMessage?.product?.description ?? undefined,
        price: m.productMessage?.product?.priceAmount1000
          ? String(Number(m.productMessage.product.priceAmount1000) / 1000)
          : undefined,
        currency: m.productMessage?.product?.currencyCode ?? undefined,
        imageUrl: m.productMessage?.product?.productImageCount
          ? m.productMessage?.product?.productImage?.url ?? undefined
          : undefined,
      },
    }),
  },
  // Protocol message - handles internal WhatsApp protocol events
  // Types: 0=REVOKE, 3=EPHEMERAL_SETTING, 4=EPHEMERAL_SYNC, 5=HISTORY_SYNC,
  //        6=APP_STATE_KEY_SHARE, 7=APP_STATE_KEY_REQUEST, 14=EDIT, 15=KEEP_IN_CHAT (pin)
  {
    check: (m) => !!m.protocolMessage,
    extract: (m) => {
      const proto = m.protocolMessage;
      // Cast to number to handle all protocol types (including ones not in the TypeScript enum)
      const protoType = proto?.type as number | undefined;

      // Message edit (type 14 = MESSAGE_EDIT)
      if (protoType === 14 || proto?.editedMessage) {
        return {
          type: 'edit' as ContentType,
          targetMessageId: proto?.key?.id ?? undefined,
          editedText: proto?.editedMessage?.conversation ||
            proto?.editedMessage?.extendedTextMessage?.text ||
            undefined,
        };
      }

      // Message delete/revoke (type 0 = REVOKE)
      if (protoType === 0) {
        return {
          type: 'delete' as ContentType,
          targetMessageId: proto?.key?.id ?? undefined,
        };
      }

      // Ephemeral settings (type 3) - disappearing messages toggle
      if (protoType === 3) {
        const expiration = proto?.ephemeralExpiration;
        console.log(`[WhatsApp] Disappearing messages ${expiration ? `enabled (${expiration}s)` : 'disabled'}`);
        return null; // Don't emit as message
      }

      // Pin message (type 15 = KEEP_IN_CHAT)
      if (protoType === 15) {
        console.log(`[WhatsApp] Message pinned: ${proto?.key?.id}`);
        return null; // TODO: emit as 'pin' event when we add support
      }

      // Internal sync messages - silently ignore
      // 4=EPHEMERAL_SYNC, 5=HISTORY_SYNC, 6=KEY_SHARE, 7=KEY_REQUEST, 8=MSG_FANOUT
      // 9=INITIAL_SECURITY, 10=APP_STATE_FATAL, 11=SHARE_PHONE, 12-17=various internal
      if (protoType !== undefined && protoType !== 0 && protoType !== 14) {
        // All other protocol types are internal sync - don't emit
        return null;
      }

      return null;
    },
  },
  // Template button reply
  {
    check: (m) => !!m.templateButtonReplyMessage,
    extract: (m) => ({
      type: 'text' as ContentType,
      text: m.templateButtonReplyMessage?.selectedDisplayText ?? m.templateButtonReplyMessage?.selectedId ?? undefined,
    }),
  },
  // List response message
  {
    check: (m) => !!m.listResponseMessage,
    extract: (m) => ({
      type: 'text' as ContentType,
      text: m.listResponseMessage?.title ?? m.listResponseMessage?.singleSelectReply?.selectedRowId ?? undefined,
    }),
  },
  // Buttons response message
  {
    check: (m) => !!m.buttonsResponseMessage,
    extract: (m) => ({
      type: 'text' as ContentType,
      text: m.buttonsResponseMessage?.selectedDisplayText ?? m.buttonsResponseMessage?.selectedButtonId ?? undefined,
    }),
  },
  // Sender key distribution - internal E2E encryption, ignore
  {
    check: (m) => !!m.senderKeyDistributionMessage,
    extract: () => null, // Internal encryption key, don't emit
  },
  // Message history bundle - internal sync, ignore
  {
    check: (m) => !!(m as Record<string, unknown>).messageHistoryBundle,
    extract: () => null, // History sync, don't emit
  },
  // Device sent message (multi-device sync)
  {
    check: (m) => !!(m as Record<string, unknown>).deviceSentMessage,
    extract: (m) => {
      // Extract the actual message from the device sync wrapper
      const deviceMsg = (m as Record<string, unknown>).deviceSentMessage as Record<string, unknown> | undefined;
      const innerMsg = deviceMsg?.message as MessageContent | undefined;
      if (innerMsg) {
        // Re-run extraction on the inner message
        for (const { check, extract } of contentExtractors.slice(0, -3)) {
          if (check(innerMsg)) {
            return extract(innerMsg);
          }
        }
      }
      return null; // Can't extract inner content
    },
  },
];

/**
 * Known internal message types that should be silently ignored
 */
const INTERNAL_MESSAGE_TYPES = new Set([
  'messageContextInfo', // Context info for replies, mentions
  'senderKeyDistributionMessage', // E2E encryption key distribution
  'messageHistoryBundle', // History sync
  'protocolMessage', // Already handled above
  'encReactionMessage', // Encrypted reaction (handled via messages.reaction event)
  'peerDataOperationRequestMessage', // Internal peer sync
  'peerDataOperationRequestResponseMessage', // Internal peer sync response
  'botInvokeMessage', // Bot-related internal
  'callLogMessage', // Call log sync
]);

/**
 * Fallback extractor for unknown message types
 * Returns null for internal types, captures user-facing unknowns for debugging
 */
function extractUnknownContent(message: MessageContent): ExtractedContent | null {
  // Get all keys that have truthy values (actual message content)
  const messageKeys = Object.keys(message).filter(
    (k) => message[k as keyof MessageContent] && k !== 'messageContextInfo',
  );

  // If all keys are internal types, silently ignore
  const hasOnlyInternalTypes = messageKeys.every((k) => INTERNAL_MESSAGE_TYPES.has(k));
  if (hasOnlyInternalTypes || messageKeys.length === 0) {
    return null;
  }

  // Log unknown types at debug level for future investigation
  console.debug(`[WhatsApp] Unknown message type: ${messageKeys.join(', ')}`);

  return {
    type: 'unknown' as ContentType,
    text: `Unknown message type: ${messageKeys.join(', ')}`,
  };
}

/**
 * Extract content from a Baileys message using handler map
 * Falls back to 'unknown' type for unrecognized messages to ensure nothing is lost
 */
function extractContent(msg: WAMessage): ExtractedContent | null {
  const message = msg.message;
  if (!message) return null;

  for (const { check, extract } of contentExtractors) {
    if (check(message)) {
      const result = extract(message);
      if (result) return result;
    }
  }

  // Fallback: capture unknown message types so they're not lost
  return extractUnknownContent(message);
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
  // DEBUG: Log full raw payload for development
  if (process.env.DEBUG_PAYLOADS === 'true') {
    console.log(`\n[DEBUG PAYLOAD] ${msg.key.id}`);
    console.log(JSON.stringify(msg, null, 2));
    console.log('[/DEBUG PAYLOAD]\n');
  }

  const content = extractContent(msg);
  if (!content) return;

  const chatId = msg.key.remoteJid || '';
  const externalId = msg.key.id || '';
  const { id: senderId } = fromJid(isFromMe(msg) ? chatId : msg.key.participant || chatId);
  const replyToId = getReplyToId(msg);

  // Handle reactions specially (they reference another message)
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

  // Handle edit messages via protocol message
  if (content.type === 'edit' && content.targetMessageId) {
    await plugin.handleMessageEdited(
      instanceId,
      content.targetMessageId,
      chatId,
      content.editedText || content.text || '',
    );
    return;
  }

  // Handle delete messages via protocol message
  if (content.type === 'delete' && content.targetMessageId) {
    await plugin.handleMessageDeleted(
      instanceId,
      content.targetMessageId,
      chatId,
      isFromMe(msg),
    );
    return;
  }

  // Pass all content fields including extended ones (poll, event, product, etc.)
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
      // Handle delivery/read status updates
      if (update.update.status) {
        await processStatusUpdate(plugin, instanceId, update.key, update.update.status);
      }

      // Handle message edits
      if (update.update.message) {
        const editedContent = update.update.message;
        const newText =
          editedContent.conversation ||
          editedContent.extendedTextMessage?.text ||
          editedContent.imageMessage?.caption ||
          editedContent.videoMessage?.caption ||
          null;

        if (newText) {
          await plugin.handleMessageEdited(
            instanceId,
            update.key.id || '',
            update.key.remoteJid || '',
            newText,
          );
        }
      }
    }
  });

  sock.ev.on('messages.delete', async (deletion) => {
    // Handle message deletions (revoke)
    if ('keys' in deletion) {
      // Batch deletion
      for (const key of deletion.keys) {
        await plugin.handleMessageDeleted(
          instanceId,
          key.id || '',
          key.remoteJid || '',
          key.fromMe || false,
        );
      }
    }
  });

  // Handle message reactions (separate from upsert for updates to existing reactions)
  sock.ev.on('messages.reaction', async (reactions) => {
    for (const { key, reaction } of reactions) {
      const chatId = key.remoteJid || '';
      const messageId = key.id || '';
      const { id: senderId } = fromJid(reaction.key?.participant || reaction.key?.remoteJid || chatId);

      await plugin.handleReactionReceived(
        instanceId,
        reaction.key?.id || messageId,
        chatId,
        senderId,
        reaction.text || '',
        messageId,
        reaction.key?.fromMe || false,
      );
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
