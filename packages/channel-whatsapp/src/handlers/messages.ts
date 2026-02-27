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
import { basename, dirname, join } from 'node:path';
import { createDownloadGuard, createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
import type { DedupeCache } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { ContentType } from '@omni/core/types';
import type { MessageUpsertType, WAMessage, WAMessageKey, WASocket, proto } from 'baileys';
import { fromJid, isLidJid, isUserJid, resolveToPhoneJidLegacy } from '../jid';
import type { WhatsAppPlugin } from '../plugin';
import { isDelivered, isRead, mapStatusCode } from '../receipts';
import type { DecryptFailureTracker } from '../utils/decrypt-failure-tracker';
import { detectMediaType, downloadMediaToBuffer, getExtension } from '../utils/download';
import { getMediaSize } from './media';

const log = createLogger('whatsapp:messages');

/** Fallback dedupe cache — used when no per-instance cache is provided */
const fallbackDedupeCache = createInboundDedupeCache();

/** Download size guard — 50MB default */
const downloadGuard = createDownloadGuard();

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
 * Extract contextInfo from text and caption-bearing message types.
 */
function getMessageContextInfo(msg: WAMessage): proto.IContextInfo | null | undefined {
  const message = msg.message;
  return (
    message?.extendedTextMessage?.contextInfo ??
    message?.imageMessage?.contextInfo ??
    message?.videoMessage?.contextInfo ??
    message?.documentMessage?.contextInfo
  );
}

/**
 * Get the reply-to message ID if present
 */
function getReplyToId(msg: WAMessage): string | undefined {
  const contextInfo = getMessageContextInfo(msg);
  return contextInfo?.stanzaId || undefined;
}

// Note: replaceMentionsWithNames removed - mention replacement now handled in
// agent-dispatcher with database lookup for better reliability across API restarts

/**
 * Determine if a message is from me (outgoing)
 */
function isFromMe(msg: WAMessage): boolean {
  return msg.key.fromMe === true;
}

/**
 * Resolve the actual sender JID for a message.
 *
 * LID-first: keeps LID participant JIDs as canonical sender identity.
 * Stores LID↔phone mapping when participantAlt provides the alternate form.
 *
 * Fixes:
 * - isFromMe in groups: uses the bot's own JID instead of group JID
 */
function resolveSenderJid(plugin: WhatsAppPlugin, instanceId: string, msg: WAMessage, chatId: string): string {
  if (isFromMe(msg)) {
    // Use the bot's own JID for own messages (not chatId, which could be a group)
    return plugin.getMeJid(instanceId) || chatId;
  }

  // In groups, msg.key.participant is the actual sender
  const senderJid = msg.key.participant || msg.key.remoteJid || chatId;
  const participantAlt = (msg.key as Record<string, unknown>).participantAlt as string | undefined;

  // Always store bidirectional mapping when participantAlt provides the alternate form
  if (isLidJid(senderJid) && participantAlt && isUserJid(participantAlt)) {
    plugin.storeLidMapping(instanceId, senderJid, participantAlt);
  }

  // DEC-8: when lidFirstEnabled is disabled, resolve LID sender → phone (legacy behavior)
  if (!plugin.isLidFirstEnabled(instanceId)) {
    const lidCache = plugin.getLidMappingCache(instanceId);
    return resolveToPhoneJidLegacy(senderJid, participantAlt, lidCache);
  }

  // LID-first: keep sender JID as-is (LID stays LID, phone stays phone)
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
 * Returns:   {apiBaseUrl}/api/v2/media/{instanceId}/{YYYY-MM}/{externalId}.{ext}
 *
 * When apiBaseUrl is provided, returns an absolute URL (e.g. http://host:port/api/v2/media/...).
 * This is required for downstream consumers like the media processor that use fetch().
 */
export async function tryDownloadMedia(
  msg: WAMessage,
  instanceId: string,
  externalId: string,
  apiBaseUrl?: string,
): Promise<{ mediaUrl: string; mediaLocalPath: string; mimeType: string; size: number } | null> {
  const mediaInfo = detectMediaType(msg);
  if (!mediaInfo) return null;

  try {
    // Enforce size limit from message metadata BEFORE downloading.
    // WhatsApp proto fileLength is server-declared and available without
    // fetching the payload, preventing the full buffer from being allocated
    // for oversized media.
    const declaredSize = getMediaSize(msg);
    if (declaredSize !== undefined) {
      downloadGuard.checkSize(declaredSize, log, { instanceId, channel: 'whatsapp' });
    }

    // Try download with retry — iOS/macOS media sometimes needs a second attempt
    let result = await downloadMediaToBuffer(msg);
    if (!result) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await downloadMediaToBuffer(msg);
    }
    if (!result) return null;

    // Also verify actual buffer size after download (declared size may be absent or differ)
    downloadGuard.checkSize(result.buffer.length, log, {
      instanceId,
      channel: 'whatsapp',
    });

    // Build path matching MediaStorageService layout
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ext = getExtension(result.mimeType);
    // Sanitize externalId to prevent path traversal: strip directory components
    // and replace any non-alphanumeric characters (WhatsApp IDs are hex/alphanum).
    const safeExternalId = basename(externalId).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const relativePath = join(instanceId, yearMonth, `${safeExternalId}${ext}`);
    const fullPath = join(MEDIA_BASE_PATH, relativePath);

    // Write to disk
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, result.buffer);

    log.debug('Downloaded media', { externalId, path: relativePath, size: result.buffer.length });

    const mediaPath = `/api/v2/media/${relativePath}`;
    return {
      mediaUrl: apiBaseUrl ? `${apiBaseUrl}${mediaPath}` : mediaPath,
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
 * Annotate the raw message with LID identity info for downstream persistence.
 *
 * LID-first: when chatId is @lid, annotate with both the LID and the resolved phone
 * (from remoteJidAlt) when available.
 */
function annotateLidResolution(msg: WAMessage, rawChatId: string): void {
  const remoteJidAlt = (msg.key as Record<string, unknown>).remoteJidAlt as string | undefined;

  if (isLidJid(rawChatId)) {
    (msg as unknown as Record<string, unknown>).originalLidJid = rawChatId;
    (msg as unknown as Record<string, unknown>).addressingMode = 'lid';
    if (remoteJidAlt && isUserJid(remoteJidAlt)) {
      (msg as unknown as Record<string, unknown>).resolvedPhoneJid = remoteJidAlt;
    }
  } else if (isUserJid(rawChatId) && remoteJidAlt && isLidJid(remoteJidAlt)) {
    (msg as unknown as Record<string, unknown>).originalLidJid = remoteJidAlt;
    (msg as unknown as Record<string, unknown>).resolvedPhoneJid = rawChatId;
    (msg as unknown as Record<string, unknown>).addressingMode = 'phone';
  }
}

/**
 * Resolve the chat ID from a message.
 *
 * LID-first: keeps @lid JIDs as canonical chatId (no phone downconversion).
 * Stores bidirectional LID↔phone mapping when remoteJidAlt provides it.
 */
function resolveChatId(
  plugin: WhatsAppPlugin,
  instanceId: string,
  msg: WAMessage,
): { chatId: string; rawChatId: string } {
  const rawChatId = msg.key.remoteJid || '';
  const remoteJidAlt = (msg.key as Record<string, unknown>).remoteJidAlt as string | undefined;

  // Store bidirectional mapping when remoteJidAlt provides the alternate form
  // (always store mappings regardless of lidFirstEnabled — useful for future enable)
  if (isLidJid(rawChatId) && remoteJidAlt && isUserJid(remoteJidAlt)) {
    plugin.storeLidMapping(instanceId, rawChatId, remoteJidAlt);
    log.debug('Stored LID↔phone mapping from remoteJidAlt', { lid: rawChatId, phone: remoteJidAlt });
  } else if (isUserJid(rawChatId) && remoteJidAlt && isLidJid(remoteJidAlt)) {
    plugin.storeLidMapping(instanceId, remoteJidAlt, rawChatId);
    log.debug('Stored LID↔phone mapping from remoteJidAlt (reverse)', { lid: remoteJidAlt, phone: rawChatId });
  }

  // DEC-8: when lidFirstEnabled is disabled, resolve LID → phone (legacy behavior)
  if (!plugin.isLidFirstEnabled(instanceId)) {
    const lidCache = plugin.getLidMappingCache(instanceId);
    const chatId = resolveToPhoneJidLegacy(rawChatId, remoteJidAlt, lidCache);
    return { chatId, rawChatId };
  }

  // LID-first: use rawChatId as canonical (no resolution to phone)
  return { chatId: rawChatId, rawChatId };
}

/**
 * Sanitize inbound text content. Returns false when the message should be dropped.
 */
function sanitizeInboundText(content: ExtractedContent, instanceId: string, messageId?: string): boolean {
  if (!content.text) return true;

  const sanitized = sanitizeMessage(content.text, log, {
    instanceId,
    messageId,
  });

  if (!sanitized.ok) return false;
  content.text = sanitized.text;
  return true;
}

/**
 * Mark sender as LID for downstream identity resolution.
 */
function annotateSenderLidStatus(msg: WAMessage, senderJid: string): void {
  if (!isLidJid(senderJid)) return;
  (msg as unknown as Record<string, unknown>).senderIsLid = true;
}

/**
 * Extract platform timestamp (T0) in milliseconds.
 */
function getPlatformTimestamp(msg: WAMessage): number {
  if (!msg.messageTimestamp) return Date.now();
  const timestamp = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp);
  return timestamp * 1000;
}

/**
 * Process a single message
 */
async function processMessage(
  plugin: WhatsAppPlugin,
  instanceId: string,
  msg: WAMessage,
  dedupeCache: DedupeCache,
): Promise<void> {
  // DEBUG: Log full raw payload for development
  if (process.env.DEBUG_PAYLOADS === 'true') {
    log.debug('Raw payload', { msgId: msg.key.id, payload: msg });
  }

  const content = extractContent(msg);
  if (!content) return;

  // ── Sanitize inbound text ──
  if (!sanitizeInboundText(content, instanceId, msg.key.id || undefined)) return;

  // ── Dedupe check ──
  const externalIdForDedupe = msg.key.id || '';
  if (externalIdForDedupe && dedupeCache.isDuplicate(instanceId, externalIdForDedupe, 'whatsapp', log)) {
    return; // Duplicate — drop silently
  }

  // Note: Mention replacement (@phone → @Name) is handled in agent-dispatcher
  // with database lookup for better reliability across API restarts

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
  const mediaResult = await tryDownloadMedia(msg, instanceId, externalId, plugin.getApiBaseUrl());
  if (mediaResult) {
    content.mediaUrl = mediaResult.mediaUrl;
    content.mediaLocalPath = mediaResult.mediaLocalPath;
    content.mimeType = mediaResult.mimeType;
  }

  // Annotate LID identity info for downstream persistence
  annotateLidResolution(msg, rawChatId);

  // Annotate sender LID status independently of chat addressing mode.
  // In group chats the chat JID is @g.us (not @lid), so addressingMode stays unset,
  // but individual participants can still be @lid. Downstream identity resolution
  // uses this flag to skip phone extraction for LID sender IDs.
  annotateSenderLidStatus(msg, senderJid);

  // Extract platform timestamp (T0) — WhatsApp sends seconds since epoch
  const platformTimestamp = getPlatformTimestamp(msg);

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
 * Process a message status update
 *
 * Uses mapStatusCode from receipts.ts to convert Baileys status codes to our
 * delivery status enum, then delegates to plugin.handleMessageDelivered/Read
 * which emit the corresponding events and trigger DB updates via subscribers.
 */
async function processStatusUpdate(
  plugin: WhatsAppPlugin,
  instanceId: string,
  key: WAMessageKey,
  status: number,
): Promise<void> {
  const chatId = key.remoteJid || '';
  const externalId = key.id || '';

  const mappedStatus = mapStatusCode(status);

  // status=2 is server_ack — the WhatsApp server accepted the message.
  // Ack it out of the resend store so it won't be retried on reconnect.
  if (status === 2) {
    plugin.handleServerAck(instanceId, externalId);
  }

  if (isRead(mappedStatus)) {
    await plugin.handleMessageRead(instanceId, externalId, chatId);
  } else if (isDelivered(mappedStatus)) {
    await plugin.handleMessageDelivered(instanceId, externalId, chatId);
  }
}

/** proto.WebMessageInfo.StubType.CIPHERTEXT — stable in the WhatsApp protobuf spec */
const STUB_TYPE_CIPHERTEXT = 2;
const TRACK_GROUP_DECRYPT_FAILURES = process.env.WHATSAPP_TRACK_GROUP_DECRYPT_FAILURES !== 'false';

/**
 * Record decrypt failures for messages that arrived as CIPHERTEXT stubs (#70).
 * Only StubType.CIPHERTEXT (2) indicates a decrypt failure — other stub types
 * (GROUP_PARTICIPANT_ADD, GROUP_CHANGE_SUBJECT, etc.) are normal system events
 * that also have no message body. Tracking only CIPHERTEXT avoids false
 * positives that would block legitimate JIDs.
 */
function trackDecryptFailures(tracker: DecryptFailureTracker, messages: WAMessage[]): void {
  for (const msg of messages) {
    if (!msg.message && msg.messageStubType === STUB_TYPE_CIPHERTEXT) {
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      // Preserve #70 behavior by default: group traffic can be tracked by remoteJid.
      // Operators can disable group tracking if needed via env var.
      if (remoteJid.endsWith('@g.us') && !TRACK_GROUP_DECRYPT_FAILURES) continue;

      tracker.recordFailure(remoteJid);
    }
  }
}

/**
 * Set up message event handlers for a Baileys socket
 */
export function setupMessageHandlers(
  sock: WASocket,
  plugin: WhatsAppPlugin,
  instanceId: string,
  decryptTracker?: DecryptFailureTracker,
  dedupeCache?: DedupeCache,
): void {
  const cache = dedupeCache ?? fallbackDedupeCache;

  sock.ev.on('messages.upsert', async (upsert: { messages: WAMessage[]; type: MessageUpsertType }) => {
    // Log all message types to diagnose missing messages
    log.debug('messages.upsert received', {
      instanceId,
      type: upsert.type,
      count: upsert.messages.length,
      messageIds: upsert.messages.map((m) => m.key.id),
    });

    // Track decrypt failures for dynamic JID blocking (#70)
    if (decryptTracker) {
      trackDecryptFailures(decryptTracker, upsert.messages);
    }

    // Process all message types, not just 'notify'
    // 'notify' = incoming messages
    // 'append' = outgoing messages sent from this device
    // We need both to capture all conversation activity
    for (const msg of upsert.messages) {
      if (shouldProcessMessage(plugin, instanceId, msg)) {
        await processMessage(plugin, instanceId, msg, cache);
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
