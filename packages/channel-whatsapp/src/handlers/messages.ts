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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '@omni/core';
import type { ContentType } from '@omni/core/types';
import type { MessageUpsertType, WAMessage, WAMessageKey, WASocket, proto } from '@whiskeysockets/baileys';
import { fromJid, isLidJid, resolveToPhoneJid } from '../jid';
import type { WhatsAppPlugin } from '../plugin';
import { detectMediaType, downloadMediaToBuffer, getExtension } from '../utils/download';

const log = createLogger('whatsapp:messages');

/**
 * Extract message content from a WAMessage
 */
interface ExtractedContent {
  type: ContentType;
  text?: string;
  mediaUrl?: string;
  mediaLocalPath?: string;
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
        startTime: m.eventMessage?.startTime ? new Date(Number(m.eventMessage.startTime) * 1000) : undefined,
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
          ? (m.productMessage?.product?.productImage?.url ?? undefined)
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
          editedText:
            proto?.editedMessage?.conversation || proto?.editedMessage?.extendedTextMessage?.text || undefined,
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
        log.debug('Disappearing messages', { enabled: !!expiration, expiration });
        return null; // Don't emit as message
      }

      // Pin message (type 15 = KEEP_IN_CHAT)
      if (protoType === 15) {
        log.debug('Message pinned', { msgId: proto?.key?.id });
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
  // Ephemeral message (disappearing messages wrapper - FutureProofMessage)
  {
    check: (m) => !!m.ephemeralMessage,
    extract: (m) => {
      const innerMsg = m.ephemeralMessage?.message as MessageContent | undefined;
      if (innerMsg) {
        for (const { check, extract } of contentExtractors.slice(0, -1)) {
          if (check(innerMsg)) {
            return extract(innerMsg);
          }
        }
      }
      return null;
    },
  },
  // View-once message (FutureProofMessage wrapper)
  {
    check: (m) => !!m.viewOnceMessage,
    extract: (m) => {
      const innerMsg = m.viewOnceMessage?.message as MessageContent | undefined;
      if (innerMsg) {
        for (const { check, extract } of contentExtractors.slice(0, -1)) {
          if (check(innerMsg)) {
            return extract(innerMsg);
          }
        }
      }
      return null;
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
  'pollResultSnapshotMessage', // Poll result sync (internal, not user-facing content)
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
  log.debug('Unknown message type', { keys: messageKeys });

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
 * Resolve the actual sender JID for a message.
 *
 * Fixes:
 * - isFromMe in groups: uses the bot's own JID instead of group JID
 * - @lid participant JIDs: resolves to phone JID via cache/remoteJidAlt
 */
function resolveSenderJid(plugin: WhatsAppPlugin, instanceId: string, msg: WAMessage, chatId: string): string {
  if (isFromMe(msg)) {
    // Use the bot's own JID for own messages (not chatId, which could be a group)
    return plugin.getMeJid(instanceId) || chatId;
  }

  // In groups, msg.key.participant is the actual sender
  const senderJid = msg.key.participant || msg.key.remoteJid || chatId;

  // Resolve @lid participant JIDs to phone JIDs
  if (isLidJid(senderJid)) {
    const participantAlt = (msg.key as Record<string, unknown>).participantAlt as string | undefined;
    const lidCache = plugin.getLidMappingCache(instanceId);
    return resolveToPhoneJid(senderJid, participantAlt, lidCache);
  }

  return senderJid;
}

/**
 * Check if a message should be processed
 */
function shouldProcessMessage(plugin: WhatsAppPlugin, instanceId: string, msg: WAMessage): boolean {
  if (!msg.message) return false;

  // Skip bot-sent message echoes: when we send a message via sendMessage(),
  // Baileys receives it back as messages.upsert with fromMe=true.
  // Without this check, agents would reply to their own messages in self-chat.
  if (isFromMe(msg) && msg.key.id && plugin.isBotSentMessage(instanceId, msg.key.id)) {
    log.debug('Skipping bot-sent message echo', { instanceId, externalId: msg.key.id });
    return false;
  }

  return true;
}

/**
 * Default media storage base path
 */
const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

/**
 * Download media from a message and return the API-serving URL.
 *
 * Stores at: data/media/{instanceId}/{YYYY-MM}/{externalId}.{ext}
 * Returns:   /api/v2/media/{instanceId}/{YYYY-MM}/{externalId}.{ext}
 */
async function tryDownloadMedia(
  msg: WAMessage,
  instanceId: string,
  externalId: string,
): Promise<{ mediaUrl: string; mediaLocalPath: string; mimeType: string; size: number } | null> {
  const mediaInfo = detectMediaType(msg);
  if (!mediaInfo) return null;

  try {
    // Try download with retry — iOS/macOS media sometimes needs a second attempt
    let result = await downloadMediaToBuffer(msg);
    if (!result) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await downloadMediaToBuffer(msg);
    }
    if (!result) return null;

    // Build path matching MediaStorageService layout
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ext = getExtension(result.mimeType);
    const relativePath = join(instanceId, yearMonth, `${externalId}${ext}`);
    const fullPath = join(MEDIA_BASE_PATH, relativePath);

    // Write to disk
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, result.buffer);

    log.debug('Downloaded media', { externalId, path: relativePath, size: result.buffer.length });

    return {
      mediaUrl: `/api/v2/media/${relativePath}`,
      mediaLocalPath: relativePath,
      mimeType: result.mimeType,
      size: result.buffer.length,
    };
  } catch (error) {
    log.warn('Media download failed, continuing without media', { externalId, error: String(error) });
    return null;
  }
}

/**
 * Handle special message types (reactions, edits, deletes).
 * Returns true if the message was handled and should not be processed further.
 */
async function handleSpecialMessage(
  plugin: WhatsAppPlugin,
  instanceId: string,
  content: ExtractedContent,
  externalId: string,
  chatId: string,
  senderId: string,
  msg: WAMessage,
): Promise<boolean> {
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
    return true;
  }

  if (content.type === 'edit' && content.targetMessageId) {
    await plugin.handleMessageEdited(
      instanceId,
      content.targetMessageId,
      chatId,
      content.editedText || content.text || '',
    );
    return true;
  }

  if (content.type === 'delete' && content.targetMessageId) {
    await plugin.handleMessageDeleted(instanceId, content.targetMessageId, chatId, isFromMe(msg));
    return true;
  }

  return false;
}

/**
 * Annotate the raw message with LID resolution info for downstream persistence
 */
function annotateLidResolution(msg: WAMessage, rawChatId: string, chatId: string): void {
  if (isLidJid(rawChatId) && chatId !== rawChatId) {
    (msg as unknown as Record<string, unknown>).originalLidJid = rawChatId;
    (msg as unknown as Record<string, unknown>).addressingMode = 'lid';
  }
}

/**
 * Resolve the chat ID from a message, handling @lid → phone JID conversion
 */
function resolveChatId(
  plugin: WhatsAppPlugin,
  instanceId: string,
  msg: WAMessage,
): { chatId: string; rawChatId: string } {
  const rawChatId = msg.key.remoteJid || '';
  const remoteJidAlt = (msg.key as Record<string, unknown>).remoteJidAlt as string | undefined;
  const lidCache = plugin.getLidMappingCache(instanceId);
  const chatId = resolveToPhoneJid(rawChatId, remoteJidAlt, lidCache);

  // If we resolved a LID, store the mapping for future messages
  if (isLidJid(rawChatId) && chatId !== rawChatId) {
    plugin.storeLidMapping(instanceId, rawChatId, chatId);
    log.debug('Resolved LID to phone JID', { rawChatId, chatId, source: remoteJidAlt ? 'remoteJidAlt' : 'cache' });
  }

  return { chatId, rawChatId };
}

/**
 * Process a single message
 */
async function processMessage(plugin: WhatsAppPlugin, instanceId: string, msg: WAMessage): Promise<void> {
  // DEBUG: Log full raw payload for development
  if (process.env.DEBUG_PAYLOADS === 'true') {
    log.debug('Raw payload', { msgId: msg.key.id, payload: msg });
  }

  const content = extractContent(msg);
  if (!content) return;

  // Resolve @lid JID to phone-based JID before any event emission
  const { chatId, rawChatId } = resolveChatId(plugin, instanceId, msg);

  const externalId = msg.key.id || '';
  const senderJid = resolveSenderJid(plugin, instanceId, msg, chatId);
  const { id: senderId } = fromJid(senderJid);
  const replyToId = getReplyToId(msg);

  // Handle special message types (reactions, edits, deletes) — returns true if handled
  if (await handleSpecialMessage(plugin, instanceId, content, externalId, chatId, senderId, msg)) {
    return;
  }

  // Download media if present (non-blocking on failure)
  const mediaResult = await tryDownloadMedia(msg, instanceId, externalId);
  if (mediaResult) {
    content.mediaUrl = mediaResult.mediaUrl;
    content.mediaLocalPath = mediaResult.mediaLocalPath;
    content.mimeType = mediaResult.mimeType;
  }

  // If LID was resolved, annotate the raw message so downstream can persist the mapping
  annotateLidResolution(msg, rawChatId, chatId);

  // Extract platform timestamp (T0) — WhatsApp sends seconds since epoch
  const platformTimestamp = msg.messageTimestamp
    ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp)) * 1000
    : Date.now();

  // Pass all content fields including extended ones (poll, event, product, etc.)
  await plugin.handleMessageReceived(
    instanceId,
    externalId,
    chatId,
    senderId,
    content,
    replyToId,
    msg,
    isFromMe(msg),
    platformTimestamp,
  );
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
    // Log all message types to diagnose missing messages
    log.debug('messages.upsert received', {
      instanceId,
      type: upsert.type,
      count: upsert.messages.length,
      messageIds: upsert.messages.map((m) => m.key.id),
    });

    // Process all message types, not just 'notify'
    // 'notify' = incoming messages
    // 'append' = outgoing messages sent from this device
    // We need both to capture all conversation activity
    for (const msg of upsert.messages) {
      if (shouldProcessMessage(plugin, instanceId, msg)) {
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
          await plugin.handleMessageEdited(instanceId, update.key.id || '', update.key.remoteJid || '', newText);
        }
      }
    }
  });

  sock.ev.on('messages.delete', async (deletion) => {
    // Handle message deletions (revoke)
    if ('keys' in deletion) {
      // Batch deletion
      for (const key of deletion.keys) {
        await plugin.handleMessageDeleted(instanceId, key.id || '', key.remoteJid || '', key.fromMe || false);
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
