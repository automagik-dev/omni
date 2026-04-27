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
 * - `canSendReaction: false` — Teams accepts the outbound `messageReaction`
 *   activity at the Bot Framework Connector but does NOT render bot-authored
 *   reactions in the client. Sending reactions to user messages requires
 *   Microsoft Graph (`/teams/{id}/channels/{id}/messages/{id}/setReaction`),
 *   which would need separate admin consent and is out of v1 scope. The
 *   `sendReaction` sender stays exported as a no-op for non-Teams Bot
 *   Framework channels (Direct Line, etc.) but the dispatcher MUST NOT
 *   route through it for `'teams'` instances.
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
  canSendReaction: false,
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

  // Bot Framework proactive `MessageFactory.attachment` accepts inline
  // image/audio/video bytes up to ~4 MiB and renders them in Teams via the
  // standard attachment renderer. Generic `application/*` (PDF, docs, etc.)
  // can be SENT as link cards but file UPLOAD into a Teams channel/group
  // requires the FileConsentCard flow (personal scope only) or Microsoft
  // Graph + SharePoint (any scope). Neither is implemented in v1, so we
  // only declare the inline media types that actually work end-to-end.
  // Operators sending PDFs/docs today should host the file and pass a
  // public `mediaUrl` — the plugin will render it as a hyperlink card.
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 4 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 4 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 4 * 1024 * 1024 },
  ],

  maxFileSize: 4 * 1024 * 1024,
};
