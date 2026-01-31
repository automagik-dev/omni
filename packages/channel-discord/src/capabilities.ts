/**
 * Discord channel capabilities declaration
 *
 * Defines what features the Discord plugin supports.
 */

import type { ChannelCapabilities } from '@omni/channel-sdk';

/**
 * Discord capabilities
 *
 * Discord supports extensive messaging features including:
 * - Rich embeds, buttons, select menus, modals
 * - Reactions, stickers, polls
 * - Threads, DMs, multi-guild
 * - Slash commands, context menus
 *
 * Notable differences from WhatsApp:
 * - No forwarding (Discord doesn't have a forward feature)
 * - No contact cards (not a phone-based platform)
 * - No location sharing (not natively supported)
 * - No read/delivery receipts (Discord doesn't expose these)
 * - Full message editing support
 */
export const DISCORD_CAPABILITIES: ChannelCapabilities = {
  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: true,

  // Receipts - Discord doesn't expose these
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,

  // Message operations
  canEditMessage: true,
  canDeleteMessage: true,
  canReplyToMessage: true,
  canForwardMessage: false, // Discord doesn't have forwarding

  // Rich content - Limited on Discord
  canSendContact: false, // No contact cards
  canSendLocation: false, // No location pins
  canSendSticker: true,

  // Group/broadcast
  canHandleGroups: true, // Guilds/servers
  canHandleBroadcast: false, // No broadcast lists

  // Rich content (Discord-specific)
  canSendEmbed: true,
  canSendPoll: true,
  canSendButtons: true,
  canSendSelectMenu: true,
  canShowModal: true,
  canUseSlashCommands: true,
  canUseContextMenu: true,
  canHandleDMs: true,
  canHandleThreads: true,
  canCreateWebhooks: true,
  canSendViaWebhook: true,
  canHandleVoice: false, // Future - deferred

  // Limits
  maxMessageLength: 2000,

  // Supported media types with their size limits
  // Standard limit is 25MB, boosted servers get up to 500MB
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 25 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 25 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 25 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 25 * 1024 * 1024 },
  ],

  // Maximum file size (base, without boost)
  maxFileSize: 25 * 1024 * 1024, // 25MB

  // Discord-specific limits
  maxEmbedFields: 25,
  maxButtonsPerRow: 5,
  maxRowsPerMessage: 5,
  maxSelectOptions: 25,
};
