/**
 * WhatsApp channel capabilities declaration
 *
 * Defines what features the WhatsApp Baileys plugin supports.
 */

import type { ChannelCapabilities } from '@omni/channel-sdk';

/**
 * WhatsApp (Baileys) capabilities
 *
 * WhatsApp supports most messaging features except:
 * - Message editing (WhatsApp doesn't support this)
 * - Groups are deferred to a separate wish
 * - Broadcasts are deferred
 */
export const WHATSAPP_CAPABILITIES: ChannelCapabilities = {
  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: true,

  // Receipts
  canReceiveReadReceipts: true,
  canReceiveDeliveryReceipts: true,

  // Message operations
  canEditMessage: false, // WhatsApp doesn't support editing
  canDeleteMessage: true,
  canReplyToMessage: true,
  canForwardMessage: true,

  // Rich content
  canSendContact: true,
  canSendLocation: true,
  canSendSticker: true,
  canSendPoll: true,

  // Group/broadcast (deferred)
  canHandleGroups: false, // Defer to future wish
  canHandleBroadcast: false, // Defer to future wish

  // Limits
  maxMessageLength: 65536, // WhatsApp text limit

  // Supported media types with their size limits
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 16 * 1024 * 1024 }, // 16MB for images
    { mimeType: 'audio/*', maxSize: 16 * 1024 * 1024 }, // 16MB for audio
    { mimeType: 'video/*', maxSize: 64 * 1024 * 1024 }, // 64MB for video
    { mimeType: 'application/*', maxSize: 100 * 1024 * 1024 }, // 100MB for documents
  ],

  // Maximum file size (documents)
  maxFileSize: 100 * 1024 * 1024, // 100MB
};
