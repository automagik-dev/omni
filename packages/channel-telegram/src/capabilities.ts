/**
 * Telegram channel capabilities declaration
 *
 * Defines what features the Telegram plugin supports.
 */

import type { ChannelCapabilities } from '@omni/channel-sdk';

/**
 * Telegram capabilities
 *
 * Telegram supports extensive messaging features including:
 * - Text, media (photo, audio, video, document, sticker)
 * - Reactions (Bot API 7.3+)
 * - Inline keyboards, callback queries
 * - DMs (private chats), groups, supergroups, channels
 * - Reply to messages, forwarding
 * - Location sharing, contact cards
 *
 * Notable differences from Discord:
 * - No rich embeds (use HTML/Markdown formatting instead)
 * - No voice channels
 * - No webhooks for sending (webhook is for receiving updates)
 * - Has read receipts (limited - only for bots in private chats)
 */
export const TELEGRAM_CAPABILITIES: ChannelCapabilities = {
  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: true,

  // Receipts - Telegram has limited support
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,

  // Message operations
  canEditMessage: true,
  canDeleteMessage: true,
  canReplyToMessage: true,
  canForwardMessage: true,

  // Rich content
  canSendContact: true,
  canSendLocation: true,
  canSendSticker: true,

  // Group/broadcast
  canHandleGroups: true,
  canHandleBroadcast: true, // Telegram channels

  // Rich content (Telegram-specific)
  canSendEmbed: false, // No rich embeds
  canSendPoll: true,
  canSendButtons: true, // Inline keyboards
  canSendSelectMenu: false,
  canShowModal: false,
  canUseSlashCommands: true, // Bot commands
  canUseContextMenu: false,
  canHandleDMs: true, // Private chats
  canHandleThreads: true, // Forum topics in supergroups
  canCreateWebhooks: false,
  canSendViaWebhook: false,
  canHandleVoice: false,

  // Limits
  maxMessageLength: 4096,

  // Supported media types
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 10 * 1024 * 1024 }, // 10MB for photos
    { mimeType: 'audio/*', maxSize: 50 * 1024 * 1024 }, // 50MB for audio
    { mimeType: 'video/*', maxSize: 50 * 1024 * 1024 }, // 50MB for video
    { mimeType: 'application/*', maxSize: 50 * 1024 * 1024 }, // 50MB for documents
  ],

  maxFileSize: 50 * 1024 * 1024, // 50MB
};
