/**
 * Channel capabilities declaration
 *
 * Defines what features a channel supports. Used by the platform
 * to adapt behavior based on channel limitations.
 */

/**
 * Capabilities that a channel can declare support for
 */
export interface ChannelCapabilities {
  /** Can send plain text messages */
  canSendText: boolean;

  /** Can send media (images, audio, video, documents) */
  canSendMedia: boolean;

  /** Can send reactions to messages */
  canSendReaction: boolean;

  /**
   * Can send typing indicators.
   *
   * Consumed by the idle-chat follow-up system (issue #404) — when a
   * follow-up is about to fire and `FollowUpSequenceConfig.showTypingIndicator`
   * is true, the runtime calls `ChannelPlugin.sendTyping()` (if implemented)
   * for ~2.5s before the outbound send. Plugins whose `canSendTyping` is
   * `false` or which don't implement `sendTyping()` are silently skipped.
   */
  canSendTyping: boolean;

  /** Can receive read receipts */
  canReceiveReadReceipts: boolean;

  /** Can receive delivery receipts */
  canReceiveDeliveryReceipts: boolean;

  /** Can edit sent messages */
  canEditMessage: boolean;

  /** Can delete sent messages */
  canDeleteMessage: boolean;

  /** Can reply to specific messages (quote/thread) */
  canReplyToMessage: boolean;

  /** Can forward messages */
  canForwardMessage: boolean;

  /** Can send contact cards */
  canSendContact: boolean;

  /** Can send location pins */
  canSendLocation: boolean;

  /** Can send stickers */
  canSendSticker: boolean;

  /** Can handle group chats */
  canHandleGroups: boolean;

  /** Can handle broadcast/channel messages */
  canHandleBroadcast: boolean;

  // ─────────────────────────────────────────────────────────────
  // Rich content (Discord, Slack, etc.)
  // ─────────────────────────────────────────────────────────────

  /** Can send rich embeds (cards with title, description, fields) */
  canSendEmbed?: boolean;

  /** Can create polls */
  canSendPoll?: boolean;

  /** Can send action buttons */
  canSendButtons?: boolean;

  /** Can send select menus / dropdowns */
  canSendSelectMenu?: boolean;

  /** Can show modal dialogs */
  canShowModal?: boolean;

  /** Can use slash commands */
  canUseSlashCommands?: boolean;

  /** Can use context menu commands (right-click actions) */
  canUseContextMenu?: boolean;

  /** Can handle direct messages */
  canHandleDMs?: boolean;

  /** Can handle thread conversations */
  canHandleThreads?: boolean;

  /** Can create webhooks for the channel */
  canCreateWebhooks?: boolean;

  /** Can send messages via webhooks */
  canSendViaWebhook?: boolean;

  /** Can handle voice channels (future) */
  canHandleVoice?: boolean;

  /** Can stream partial response updates (thinking/content/final/error) */
  canStreamResponse?: boolean;

  /**
   * Whether the channel exposes a native handoff protocol (e.g. a dedicated
   * `HANDOFF` message type that pops a ticket in an operator UI). Only
   * channels with `canHandoff: true` receive a channel-specific payload from
   * `POST /messages/send/handoff`; for every other channel the route still
   * runs the channel-agnostic side effects (`agentPaused=true`, follow-up
   * disarm, audit log). See issue #537.
   */
  canHandoff?: boolean;

  /**
   * Whether the channel exposes a native terminal-close protocol (e.g. a
   * dedicated `CLOSING` message type that closes the journey on the
   * provider side). Only channels with `canCloseContact: true` receive a
   * channel-specific payload from `POST /messages/send/close-contact`; for
   * every other channel the route still runs the channel-agnostic side
   * effects (`agentPaused=true`, optional `closed=true`, follow-up disarm,
   * audit log).
   */
  canCloseContact?: boolean;

  // ─────────────────────────────────────────────────────────────
  // Scheduling, permalinks and pinning (issue #889)
  // ─────────────────────────────────────────────────────────────

  /**
   * Whether the channel schedules messages natively (Slack
   * chat.scheduleMessage). When `true`, omni delegates the timer to the
   * platform, so delivery survives omni being down. When false/absent, omni
   * parks the message and sends it itself at `sendAt`.
   *
   * Note this says nothing about *listing*: Slack only reports scheduled
   * messages created by the same token, which is why omni keeps its own
   * `scheduled_messages` table either way.
   */
  canScheduleMessage?: boolean;

  /** Longest lead time the platform accepts when scheduling natively (Slack: 120 days). */
  maxScheduleAheadMs?: number;

  /**
   * Whether the channel can resolve a stable deep link to a message
   * (Slack chat.getPermalink). Required to render quotes as unfurled cards.
   */
  canGetPermalink?: boolean;

  /** Whether individual messages can be pinned (as opposed to pinning a chat). */
  canPinMessage?: boolean;

  /**
   * Whether the channel exposes full-text message search. Slack does, but only
   * with a user token (`search:read`) — a bot token cannot search.
   */
  canSearchMessages?: boolean;

  // ─────────────────────────────────────────────────────────────
  // Messaging-window constraints (issue #404)
  // ─────────────────────────────────────────────────────────────

  /**
   * Whether the channel enforces a bounded messaging window after the
   * customer's most recent inbound message. Set `true` for WhatsApp BSP /
   * Cloud (Meta enforces a 24h free-form window; beyond it only approved
   * templates may be sent).
   *
   * Consumed by the idle-chat follow-up system to decide whether to disarm a
   * sequence with `window_expired` when the window has elapsed. Channels
   * that leave this `undefined`/`false` are treated as "no window" and
   * follow-ups fire without a window check.
   */
  hasMessagingWindow?: boolean;

  /**
   * Length of the messaging window in milliseconds. Only meaningful when
   * `hasMessagingWindow === true`. Defaults to 24h (86_400_000 ms) in the
   * follow-up runtime if omitted.
   */
  messagingWindowMs?: number;

  // ─────────────────────────────────────────────────────────────
  // Limits
  // ─────────────────────────────────────────────────────────────

  /** Maximum message length (0 = unlimited) */
  maxMessageLength: number;

  /** Supported media types */
  supportedMediaTypes: SupportedMediaType[];

  /** Maximum file size in bytes (0 = unlimited) */
  maxFileSize: number;

  /** Maximum embed fields (for rich embeds) */
  maxEmbedFields?: number;

  /** Maximum buttons per row */
  maxButtonsPerRow?: number;

  /** Maximum rows per message (for components) */
  maxRowsPerMessage?: number;

  /** Maximum options in a select menu */
  maxSelectOptions?: number;
}

/**
 * Media type support definition
 */
export interface SupportedMediaType {
  /** MIME type pattern (e.g., 'image/*', 'audio/mp3') */
  mimeType: string;

  /** Maximum file size for this type in bytes */
  maxSize?: number;
}

/**
 * Default capabilities - conservative defaults
 */
export const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  // Core messaging
  canSendText: true,
  canSendMedia: false,
  canSendReaction: false,
  canSendTyping: false,
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: false,
  canForwardMessage: false,
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,
  canHandleGroups: false,
  canHandleBroadcast: false,

  // Rich content (disabled by default)
  canSendEmbed: false,
  canSendPoll: false,
  canSendButtons: false,
  canSendSelectMenu: false,
  canShowModal: false,
  canUseSlashCommands: false,
  canUseContextMenu: false,
  canHandleDMs: false,
  canHandleThreads: false,
  canCreateWebhooks: false,
  canSendViaWebhook: false,
  canHandleVoice: false,

  // Limits
  maxMessageLength: 0,
  supportedMediaTypes: [],
  maxFileSize: 0,
  maxEmbedFields: undefined,
  maxButtonsPerRow: undefined,
  maxRowsPerMessage: undefined,
  maxSelectOptions: undefined,
};
