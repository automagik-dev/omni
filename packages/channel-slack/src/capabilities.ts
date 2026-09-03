/**
 * Slack channel capabilities declaration
 *
 * Defines what features the Slack plugin supports.
 */

import type { ChannelCapabilities } from '@omni/channel-sdk';

/**
 * Slack capabilities
 *
 * Slack supports rich messaging features including:
 * - Block Kit (buttons, select menus, modals, date/time pickers)
 * - Reactions, threads, DMs, multi-workspace
 * - Slash commands
 * - Message editing and deletion
 * - File uploads (up to 1GB)
 * - Streaming via progressive message editing
 *
 * Notable differences from Discord:
 * - No polls (Slack doesn't have native polls)
 * - No webhooks (using Socket Mode instead)
 * - No stickers (Slack uses custom emoji instead)
 * - No context menus (Slack uses shortcuts instead)
 * - No voice channels
 * - Has read receipts in some contexts
 */
export const SLACK_CAPABILITIES: ChannelCapabilities = {
  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  // Slack typing is thread-only via agents.sessions.setStatus (legacy
  // assistant.threads.setStatus fallback) — not a general typing indicator.
  // The plugin implements sendTyping() for thread contexts but the capability
  // is false because it cannot show typing in channels/DMs directly.
  canSendTyping: false,

  // Receipts
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,

  // Message operations
  canEditMessage: true,
  canDeleteMessage: true,
  canReplyToMessage: true,
  canForwardMessage: false,

  // Scheduling / permalinks (#889)
  canScheduleMessage: true,
  maxScheduleAheadMs: 120 * 24 * 60 * 60 * 1000, // Slack rejects post_at beyond 120 days
  canGetPermalink: true,
  canPinMessage: true,
  // Slack search needs a user token (`search:read`); a bot token cannot search.
  //
  // Stays false because ChannelCapabilities is a static property of the
  // plugin, not per instance — and whether search works depends on the
  // instance's authMode. Declaring true would promise it for bot-mode
  // instances too. searchMessages() throws a specific error in bot mode
  // instead, so a caller learns the capability is absent rather than reading
  // an empty result as "no matches" (#889).
  canSearchMessages: false,

  // Rich content
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,

  // Group/broadcast
  canHandleGroups: true,
  canHandleBroadcast: false,

  // Rich content (Slack-specific)
  canSendEmbed: false, // Slack uses Block Kit, not embeds
  canSendPoll: false,
  canSendButtons: true,
  canSendSelectMenu: true,
  canShowModal: true,
  canUseSlashCommands: true,
  canUseContextMenu: false,
  canHandleDMs: true,
  canHandleThreads: true,
  canCreateWebhooks: false,
  canSendViaWebhook: false,
  canHandleVoice: false,
  canStreamResponse: true,

  // Limits
  maxMessageLength: 4000,

  // Supported media types — Slack supports up to 1GB
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 1024 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 1024 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 1024 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 1024 * 1024 * 1024 },
  ],

  maxFileSize: 1024 * 1024 * 1024, // 1GB

  // Slack Block Kit limits
  maxButtonsPerRow: 5,
  maxRowsPerMessage: 50, // Slack allows up to 50 blocks per message
  maxSelectOptions: 100,
};
