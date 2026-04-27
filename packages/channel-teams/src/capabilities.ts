/**
 * Microsoft Teams channel capabilities declaration.
 *
 * Captures the messaging surface Bot Framework gives us today (text, attachments,
 * mentions, threading inside channels, 1:1 chats, message reactions). Adaptive
 * Cards / messaging extensions / typing indicators are scoped out for v1 — see
 * `.genie/brainstorms/teams-channel/DRAFT.md` and `DESIGN.md`.
 *
 * Notable Teams traits encoded here:
 * - `canSendTyping: true` — Bot Framework supports the `typing` activity.
 * - `canEditMessage: false` / `canDeleteMessage: false` — `tools.editMessage`
 *   and `tools.deleteMessage` are stubs in v1; Bot Framework's
 *   `updateActivity` / `deleteActivity` plumbing lands in a follow-up wish.
 *   The capability flag must stay `false` while the implementations throw
 *   `UNSUPPORTED_ACTIVITY` so the dispatcher never routes through them.
 *   See REVIEW.md B.1.
 * - `canSendReaction: true` — Teams allows bots to add limited reactions
 *   (`like`, `heart`, `laugh`, `surprised`, `sad`, `angry`).
 * - `canStreamResponse: false` — Teams has no native streaming surface for
 *   bots; Group 4 will revisit using progressive `updateActivity` calls.
 * - `maxMessageLength: 28_000` — Bot Framework cap for plain text in a single
 *   activity (Teams chat client further truncates the visible portion at
 *   ~4,000 chars; the plugin chunks to that limit in `markdown.ts`).
 */

import type { ChannelCapabilities } from '@omni/channel-sdk';

export const TEAMS_CAPABILITIES: ChannelCapabilities = {
  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: true,

  // Receipts (Bot Framework does not surface delivery / read receipts to bots)
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,

  // Message operations
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: true,
  canForwardMessage: false,

  // Rich content
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,

  // Group / broadcast
  canHandleGroups: true,
  canHandleBroadcast: false,

  // Rich content (Teams-specific surfaces; deferred to follow-up wishes)
  canSendEmbed: false,
  canSendPoll: false,
  canSendButtons: false,
  canSendSelectMenu: false,
  canShowModal: false,
  canUseSlashCommands: false,
  canUseContextMenu: false,
  canHandleDMs: true,
  canHandleThreads: true,
  canCreateWebhooks: false,
  canSendViaWebhook: false,
  canHandleVoice: false,
  canStreamResponse: false,

  // Limits
  maxMessageLength: 28_000,

  // Bot Framework attachment cap is 4MB per attachment for proactive uploads;
  // OneDrive-backed downloads are larger but require Graph permissions which
  // are out of scope for v1.
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 4 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 4 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 4 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 4 * 1024 * 1024 },
  ],

  maxFileSize: 4 * 1024 * 1024,
};
