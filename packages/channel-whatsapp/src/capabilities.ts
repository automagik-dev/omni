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
 * - Message editing (WhatsApp supports editing own messages; older clients/libraries may be limited)
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
  canEditMessage: true, // WhatsApp supports editing own messages
  canDeleteMessage: true,
  canReplyToMessage: true,
  canForwardMessage: true,

  // Rich content
  canSendContact: true,
  canSendLocation: true,
  canSendSticker: true,
  canSendPoll: true,

  // Streaming (progressive response edits) — disabled: edit-based streaming is buggy on WhatsApp
  canStreamResponse: false,

  // Group/broadcast
  canHandleGroups: true, // Groups work de facto (handles @g.us JIDs, participant resolution)
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
