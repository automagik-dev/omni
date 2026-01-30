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
export { createStorageAuthState, clearAuthState } from './auth';
export { toJid, toGroupJid, fromJid, isGroupJid, isUserJid, extractPhone, normalizeJid } from './jid';
export { WhatsAppError, ErrorCode, mapBaileysError, isRetryable } from './utils/errors';

// Presence & typing
export { PresenceManager, createPresenceManager, setOnline, setOffline } from './presence';
export type { PresenceType } from './presence';
export {
  sendTyping,
  sendRecording,
  stopTyping,
  clearAllTypingTimers,
  TypingIndicator,
  createTypingIndicator,
  DEFAULT_TYPING_DURATION,
} from './typing';
export type { TypingState } from './typing';

// Receipts
export {
  markMessageAsRead,
  markMessagesAsRead,
  markChatAsRead,
  mapStatusCode,
  isDelivered,
  isRead,
  ReceiptTracker,
  createReceiptTracker,
} from './receipts';
export type { MessageStatus } from './receipts';

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

// Types
export type { WhatsAppConfig } from './plugin';
