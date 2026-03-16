/**
 * WhatsApp Channel Plugin for Omni v2
 *
 * Provides WhatsApp messaging via Baileys library.
 *
 * @example
 * ```typescript
 * import whatsappPlugin from '@omni/channel-whatsapp';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * registry.register(whatsappPlugin);
 * ```
 */

import { WhatsAppPlugin } from './plugin';

// Export the plugin instance (default export for auto-discovery)
const plugin = new WhatsAppPlugin();
export default plugin;

// Named exports for flexibility
export { WhatsAppPlugin } from './plugin';
export { WHATSAPP_CAPABILITIES } from './capabilities';
export { createStorageAuthState, clearAuthState, clearSenderKeys } from './auth';
export { toJid, toGroupJid, fromJid, isGroupJid, isUserJid, extractPhone, normalizeJid } from './jid';
export { WhatsAppError, ErrorCode, mapBaileysError, isRetryable } from './utils/errors';

// Presence
export { PresenceManager, createPresenceManager, setOnline, setOffline } from './presence';
export type { PresenceType } from './presence';

// Receipts
export {
  markMessageAsRead,
  markMessagesAsRead,
  markChatAsRead,
  mapStatusCode,
  isDelivered,
  isRead,
  shouldSendReadReceipt,
  ReceiptTracker,
  createReceiptTracker,
} from './receipts';
export type { MessageStatus, ReadReceiptMode, ReadReceiptConfig } from './receipts';

// Media utilities
export {
  downloadMedia,
  downloadMediaToBuffer,
  detectMediaType,
  getExtension,
  generateFilename,
} from './utils/download';
export type { DownloadResult, DetectedMedia } from './utils/download';

// Senders
export * from './senders';

// Socket utilities
export {
  createSocket,
  closeSocket,
  isSocketConnected,
  getSocketUser,
  getSocketUserName,
  SocketManager,
} from './socket';
export type { SocketConfig } from './socket';

// Types
export type { WhatsAppConfig, WhatsAppFetchHistoryOptions, MessageAnchor } from './plugin';

// Message and event types (derived from actual Baileys payloads)
export type {
  // Message key
  WAMessageKey,
  // Media base
  WAMediaBase,
  // Text messages
  WAConversationMessage,
  WAExtendedTextMessage,
  WAContextInfo,
  // Media messages
  WAAudioMessage,
  WAImageMessage,
  WAVideoMessage,
  WADocumentMessage,
  WAStickerMessage,
  // Other message types
  WAContactMessage,
  WAContactsArrayMessage,
  WALocationMessage,
  WALiveLocationMessage,
  WAPollCreationMessage,
  WAPollUpdateMessage,
  WAReactionMessage,
  // Events
  WACallEvent,
  WACallStatus,
  WAPresenceUpdate,
  WAPresenceData,
  WAPresenceStatus,
  WAGroupParticipantsUpdate,
  WAGroupParticipant,
  WAGroupAction,
  WAMessageReceiptUpdate,
  // Full message wrapper
  WAFullMessage,
  WAMessageContextInfo,
  // Updates
  WAChatUpdate,
  WAContactUpdate,
} from './types';
