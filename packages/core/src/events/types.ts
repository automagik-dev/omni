/**
 * Event type definitions for the Omni event system
 *
 * Supports three namespaces:
 * - Core events: Typed, maintained in @omni/core (message.*, instance.*, etc.)
 * - Custom events: User-defined, runtime registered (custom.*)
 * - System events: Internal operations (system.*)
 */

import type { ChannelType, ContentType } from '../types/channel';

/**
 * Core event types - typed and maintained in @omni/core
 */
export const CORE_EVENT_TYPES = [
  // Message lifecycle
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',

  // Interactive UI
  'message.button_click',
  'message.poll',
  'message.poll_vote',
  // Media processing
  'media.received',
  'media.processed',
  // Identity management
  'identity.created',
  'identity.linked',
  'identity.merged',
  'identity.unlinked',
  // Instance lifecycle
  'instance.connected',
  'instance.disconnected',
  'instance.qr_code',
  // Access control
  'access.allowed',
  'access.denied',
  'access.pairing_requested',
  // Presence
  'presence.typing',
  'presence.online',
  'presence.offline',
  // Sync operations
  'sync.started',
  'sync.progress',
  'sync.completed',
  'sync.failed',
  'profile.synced',
  // Reaction lifecycle
  'reaction.received',
  'reaction.removed',
  // Session lifecycle
  'session.reset',
  // Batch job operations
  'batch-job.created',
  'batch-job.started',
  'batch-job.progress',
  'batch-job.completed',
  'batch-job.cancelled',
  'batch-job.failed',
  // Agent state machine (ephemeral — NATS KV)
  'agent.state.changed',
  // Agent task lifecycle (persistent — omni-m7m)
  'agent.task.created',
  'agent.task.updated',
  'agent.task.completed',
  'agent.task.failed',
  'agent.task.cancelled',
  // A2A task lifecycle (inbound tasks from external A2A clients)
  'agent.a2a.task_received',
  'agent.a2a.task_updated',
  'agent.a2a.task_completed',
  'agent.a2a.task_failed',
  // Internal agent-to-agent routing
  'agent.internal.forwarded',
  // Conversation lifecycle
  'conversation.created',
  'conversation.updated',
  'conversation.deleted',
  // Social channel events
  'post.received',
  'post.created',
  'post.updated',
  'post.deleted',
  'comment.received',
  'comment.sent',
  'connection.received',
  'connection.accepted',
  'mention.received',
] as const;

export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

/**
 * Custom events - user-defined, runtime registered
 * Pattern: custom.{namespace}.{action}
 * Examples:
 *   custom.webhook.github.push
 *   custom.cron.daily_report
 *   custom.trigger.vip_alert
 */
export type CustomEventType = `custom.${string}`;

/**
 * System events - internal operations
 * Pattern: system.{operation}
 * Examples:
 *   system.dead_letter
 *   system.replay.started
 *   system.health.degraded
 */
export type SystemEventType = `system.${string}`;

/**
 * All event types: core + custom + system
 */
export type EventType = CoreEventType | CustomEventType | SystemEventType;

/**
 * Check if an event type is a core event
 */
export function isCoreEvent(type: string): type is CoreEventType {
  return (CORE_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Check if an event type is a custom event
 */
export function isCustomEvent(type: string): type is CustomEventType {
  return type.startsWith('custom.');
}

/**
 * Check if an event type is a system event
 */
export function isSystemEvent(type: string): type is SystemEventType {
  return type.startsWith('system.');
}

/**
 * Base event structure
 */
export interface OmniEvent<T extends EventType = EventType, P = unknown> {
  id: string;
  type: T;
  payload: P;
  metadata: EventMetadata;
  timestamp: number;
}

export interface EventMetadata {
  correlationId: string;
  instanceId?: string;
  channelType?: ChannelType;
  personId?: string;
  platformIdentityId?: string;
  traceId?: string;
  source?: string;
  /**
   * How the message entered the system.
   * - 'realtime': a live message received from the platform
   * - 'history-sync': a historical message replayed on reconnect (e.g. Baileys messaging-history.set)
   * Consumers (e.g. bots) should skip 'history-sync' messages to avoid replaying old messages.
   */
  ingestMode?: 'realtime' | 'history-sync';
  /** NATS stream sequence number (set by subscription handler, not by publisher) */
  streamSequence?: number;
  /** Journey timing checkpoints: checkpoint name → Unix ms timestamp */
  timings?: Record<string, number>;
  /** agents.id UUID — set when an agent processes/sends this event */
  agentId?: string;
}

/**
 * Add a timing checkpoint to event metadata (immutable — returns new metadata)
 */
export function withTiming(metadata: EventMetadata, checkpoint: string, timestamp: number = Date.now()): EventMetadata {
  return {
    ...metadata,
    timings: {
      ...metadata.timings,
      [checkpoint]: timestamp,
    },
  };
}

/**
 * Message event payloads
 */
export interface MessageReceivedPayload {
  externalId: string;
  chatId: string;
  /** Optional thread/topic identifier (e.g. Telegram forum topic) */
  threadId?: string;
  from: string;
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
    localPath?: string;
    isVoiceNote?: boolean;
  };
  replyToId?: string;
  rawPayload?: Record<string, unknown>;
}

export interface MessageSentPayload {
  externalId: string;
  chatId: string;
  /** Optional thread/topic identifier (e.g. Telegram forum topic) */
  threadId?: string;
  to: string;
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
  };
  replyToId?: string;
  /** agents.id UUID — set by agent-dispatcher when agent sends */
  senderAgentId?: string;
}

export interface MessageDeliveredPayload {
  externalId: string;
  chatId: string;
  deliveredAt: number;
}

export interface MessageReadPayload {
  externalId: string;
  chatId: string;
  readAt: number;
}

export interface MessageFailedPayload {
  externalId?: string;
  chatId: string;
  error: string;
  errorCode?: string;
  retryable: boolean;
}

/** Canonical event: inline button clicked (Telegram callback query, etc.) */
export interface MessageButtonClickPayload {
  /** Telegram callback_query.id (or equivalent platform id) */
  callbackQueryId?: string;
  /** The message that contained the button (if available) */
  messageId?: string;
  /** Chat/conversation id where click happened (if available) */
  chatId?: string;
  /** User who clicked */
  from: string;
  /** Button label shown to user (if available) */
  text?: string;
  /** Platform callback payload (e.g., Telegram callback_data) */
  data?: string;
  /** Raw platform payload for debugging */
  rawPayload?: Record<string, unknown>;
}

/** Canonical event: poll created/received */
export interface MessagePollPayload {
  /** Poll id on the platform */
  pollId: string;
  /** Chat id where poll belongs (if known) */
  chatId?: string;
  /** User who created the poll (if available) */
  from?: string;
  question: string;
  options: string[];
  /** Whether multiple options can be selected */
  multiSelect?: boolean;
  rawPayload?: Record<string, unknown>;
}

/** Canonical event: poll vote / poll answer */
export interface MessagePollVotePayload {
  pollId: string;
  /** Chat id where poll belongs (if known) */
  chatId?: string;
  /** User who voted */
  from: string;
  /** Selected option indices */
  optionIds: number[];
  rawPayload?: Record<string, unknown>;
}

/**
 * Media event payloads
 */
export interface MediaReceivedPayload {
  eventId: string;
  mediaId: string;
  mimeType: string;
  size: number;
  duration?: number;
  url: string;
}

export interface MediaProcessedPayload {
  eventId: string;
  mediaId: string;
  processingType: 'transcription' | 'description' | 'extraction';
  content: string;
  model?: string;
  provider?: string;
  tokensUsed?: number;
}

/**
 * Identity event payloads
 */
export interface IdentityCreatedPayload {
  personId: string;
  displayName?: string;
  primaryPhone?: string;
  primaryEmail?: string;
}

export interface IdentityLinkedPayload {
  personId: string;
  platformIdentityId: string;
  channelType: ChannelType;
  platformUserId: string;
  linkedBy: 'auto' | 'manual' | 'phone_match' | 'initial';
  confidence: number;
}

export interface IdentityMergedPayload {
  targetPersonId: string;
  sourcePersonId: string;
  mergedIdentityIds: string[];
  reason: 'same_phone' | 'same_email' | 'admin_linked' | 'user_claimed';
  mergedBy?: string;
}

export interface IdentityUnlinkedPayload {
  personId: string;
  platformIdentityId: string;
  reason?: string;
}

/**
 * Instance event payloads
 */
export interface InstanceConnectedPayload {
  instanceId: string;
  channelType: ChannelType;
  profileName?: string;
  profilePicUrl?: string;
  ownerIdentifier?: string;
}

export interface InstanceDisconnectedPayload {
  instanceId: string;
  channelType: ChannelType;
  reason?: string;
  willReconnect: boolean;
}

export interface InstanceQrCodePayload {
  instanceId: string;
  channelType: ChannelType;
  qrCode: string;
  expiresAt: number;
}

/**
 * Access event payloads
 */
export interface AccessAllowedPayload {
  instanceId: string;
  platformUserId: string;
  personId?: string;
  ruleId?: string;
}

export interface AccessDeniedPayload {
  instanceId: string;
  platformUserId: string;
  personId?: string;
  ruleId?: string;
  reason: string;
  action: 'block' | 'silent_block';
}

export interface AccessPairingRequestedPayload {
  instanceId: string;
  platformUserId: string;
  pairingCode: string;
  requestId: string;
  expiresAt: number;
}

/**
 * Sync event payloads
 */
export interface SyncJobConfig {
  depth?: '7d' | '30d' | '90d' | '1y' | 'all';
  channelId?: string;
  downloadMedia?: boolean;
  /** Explicit since timestamp (ISO string) — takes precedence over depth */
  since?: string;
  /** Explicit until timestamp (ISO string) */
  until?: string;
  /** Specific chat JIDs to fetch history for (WhatsApp only) */
  chatJids?: string[];
}

export interface SyncJobProgress {
  fetched: number;
  stored: number;
  duplicates: number;
  mediaDownloaded: number;
  totalEstimated?: number;
}

export type SyncJobType = 'profile' | 'messages' | 'contacts' | 'groups' | 'all' | 'history-push';

export interface SyncStartedPayload {
  jobId: string;
  instanceId: string;
  type: SyncJobType;
  config?: SyncJobConfig;
}

export interface SyncProgressPayload {
  jobId: string;
  instanceId: string;
  type: SyncJobType;
  progress: SyncJobProgress;
}

export interface SyncCompletedPayload {
  jobId: string;
  instanceId: string;
  type: SyncJobType;
  progress: SyncJobProgress;
}

export interface SyncFailedPayload {
  jobId: string;
  instanceId: string;
  type: SyncJobType;
  error: string;
}

export interface ProfileSyncedPayload {
  instanceId: string;
  name?: string;
  avatarUrl?: string;
  bio?: string;
  platformMetadata?: Record<string, unknown>;
}

/**
 * Batch job event payloads
 */
export type BatchJobType = 'targeted_chat_sync' | 'time_based_batch' | 'media_redownload';

export interface BatchJobProgress {
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  currentItem?: string;
  progressPercent: number;
  totalCostCents: number;
  totalTokens: number;
}

export interface BatchJobCreatedPayload {
  jobId: string;
  instanceId: string;
  jobType: BatchJobType;
  requestParams: Record<string, unknown>;
}

export interface BatchJobStartedPayload {
  jobId: string;
  instanceId: string;
  jobType: BatchJobType;
  totalItems: number;
}

export interface BatchJobProgressPayload {
  jobId: string;
  instanceId: string;
  progress: BatchJobProgress;
}

export interface BatchJobCompletedPayload {
  jobId: string;
  instanceId: string;
  jobType: BatchJobType;
  progress: BatchJobProgress;
  durationMs: number;
}

export interface BatchJobCancelledPayload {
  jobId: string;
  instanceId: string;
  progress: BatchJobProgress;
}

export interface BatchJobFailedPayload {
  jobId: string;
  instanceId: string;
  error: string;
  progress?: BatchJobProgress;
}

/**
 * Presence event payloads
 */
export interface PresenceTypingPayload {
  chatId: string;
  from: string;
  /** Timestamp when typing started */
  timestamp?: number;
}

export interface PresenceOnlinePayload {
  userId: string;
  lastSeen?: number;
}

export interface PresenceOfflinePayload {
  userId: string;
  lastSeen: number;
}

/**
 * Reaction event payloads
 */
export interface ReactionReceivedPayload {
  /** The message being reacted to */
  messageId: string;
  /** Chat where reaction happened */
  chatId: string;
  /** User who reacted (platform user ID) */
  from: string;
  /** Emoji used (unicode char or custom ID) */
  emoji: string;
  /** Custom emoji name (e.g., Discord custom emojis) */
  emojiName?: string;
  /** Whether emoji is platform-custom (not unicode) */
  isCustomEmoji?: boolean;
  /** Raw platform payload for channel-specific data */
  rawPayload?: Record<string, unknown>;
}

export interface ReactionRemovedPayload {
  /** The message the reaction was removed from */
  messageId: string;
  /** Chat where reaction was removed */
  chatId: string;
  /** User who removed the reaction */
  from: string;
  /** Emoji that was removed */
  emoji: string;
  /** Custom emoji name */
  emojiName?: string;
  /** Whether emoji is platform-custom */
  isCustomEmoji?: boolean;
}

// ─── Session Events ────────────────────────────────────────
export interface SessionResetPayload {
  /** Instance that the session belongs to */
  instanceId: string;
  /** Session ID that was reset */
  sessionId: string;
  /** When the reset occurred */
  timestamp: number;
}

/**
 * Agent state event payload
 */
export interface AgentStateChangedPayload {
  agentId: string;
  chatId: string;
  conversationId: string | null;
  status: string;
  statusMeta?: Record<string, unknown>;
  updatedAt: number;
}

/**
 * Agent task event payloads (omni-m7m)
 */
export interface AgentTaskCreatedPayload {
  taskId: string;
  agentId: string;
  chatId: string;
  conversationId: string | null;
  type: string;
  title: string;
  status: string;
}

export interface AgentTaskUpdatedPayload {
  taskId: string;
  agentId: string;
  chatId: string;
  status: string;
  progress: number;
}

export interface AgentTaskCompletedPayload {
  taskId: string;
  agentId: string;
  chatId: string;
  result: Record<string, unknown> | null;
}

export interface AgentTaskFailedPayload {
  taskId: string;
  agentId: string;
  chatId: string;
  error: string;
}

export interface AgentTaskCancelledPayload {
  taskId: string;
  agentId: string;
  chatId: string;
}

// ─── Social Channel Events ─────────────────────────────────

/** Canonical event: social post received from platform */
export interface PostReceivedPayload {
  /** Platform-assigned post ID */
  externalId: string;
  /** Post author (platform user ID) */
  authorPlatformUserId: string;
  /** Author display name */
  authorDisplayName?: string;
  /** Post type (text, article, image, video, poll, etc.) */
  postType: string;
  /** Text content of the post */
  textContent?: string;
  /** Media URLs attached to the post */
  mediaUrls?: string[];
  /** Link URL if post contains a link */
  linkUrl?: string;
  /** Engagement counts at time of receipt */
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
  /** Hashtags found in the post */
  hashtags?: string[];
  /** Raw platform payload */
  rawPayload?: Record<string, unknown>;
}

/** Canonical event: social post created by us */
export interface PostCreatedPayload {
  /** Platform-assigned post ID (after creation) */
  externalId: string;
  /** Post type */
  postType: string;
  /** Text content */
  textContent?: string;
  /** Media URLs attached */
  mediaUrls?: string[];
  /** Link URL */
  linkUrl?: string;
  /** Visibility setting */
  visibility?: string;
}

/** Canonical event: social post updated (content or engagement change) */
export interface PostUpdatedPayload {
  /** Platform-assigned post ID */
  externalId: string;
  /** Which fields changed */
  changedFields: string[];
  /** Updated engagement counts */
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
  impressionCount?: number;
}

/** Canonical event: social post deleted */
export interface PostDeletedPayload {
  /** Platform-assigned post ID */
  externalId: string;
  /** Reason for deletion (if known) */
  reason?: string;
}

/** Canonical event: comment received on a social post */
export interface CommentReceivedPayload {
  /** Platform-assigned comment ID */
  externalId: string;
  /** Post this comment belongs to (platform post ID) */
  postExternalId: string;
  /** Parent comment ID for threaded replies */
  parentCommentExternalId?: string;
  /** Comment author (platform user ID) */
  authorPlatformUserId: string;
  /** Author display name */
  authorDisplayName?: string;
  /** Comment text */
  textContent: string;
  /** Media URL if comment has media */
  mediaUrl?: string;
  /** Raw platform payload */
  rawPayload?: Record<string, unknown>;
}

/** Canonical event: comment sent by us */
export interface CommentSentPayload {
  /** Platform-assigned comment ID */
  externalId: string;
  /** Post this comment belongs to */
  postExternalId: string;
  /** Parent comment ID for threaded replies */
  parentCommentExternalId?: string;
  /** Comment text */
  textContent: string;
}

/** Canonical event: connection/follow request received */
export interface ConnectionReceivedPayload {
  /** Platform user ID of person who sent the request */
  platformUserId: string;
  /** Display name */
  displayName?: string;
  /** Connection type (connect, follow, etc.) */
  connectionType: string;
  /** Optional message included with the request */
  message?: string;
}

/** Canonical event: connection/follow request accepted */
export interface ConnectionAcceptedPayload {
  /** Platform user ID of the connection */
  platformUserId: string;
  /** Display name */
  displayName?: string;
  /** Connection type */
  connectionType: string;
}

/** Canonical event: mention received in a post or comment */
export interface MentionReceivedPayload {
  /** Where the mention occurred: 'post' or 'comment' */
  mentionContext: 'post' | 'comment';
  /** External ID of the post or comment containing the mention */
  sourceExternalId: string;
  /** Platform user ID of the person who mentioned us */
  mentionedByPlatformUserId: string;
  /** Display name of the person who mentioned us */
  mentionedByDisplayName?: string;
  /** Text content of the post/comment containing the mention */
  textContent?: string;
  /** Raw platform payload */
  rawPayload?: Record<string, unknown>;
}

/**
 * Event type map for type-safe event handling (core events only)
 */
export interface EventPayloadMap {
  'message.received': MessageReceivedPayload;
  'message.sent': MessageSentPayload;
  'message.delivered': MessageDeliveredPayload;
  'message.read': MessageReadPayload;
  'message.failed': MessageFailedPayload;
  'message.button_click': MessageButtonClickPayload;
  'message.poll': MessagePollPayload;
  'message.poll_vote': MessagePollVotePayload;
  'media.received': MediaReceivedPayload;
  'media.processed': MediaProcessedPayload;
  'identity.created': IdentityCreatedPayload;
  'identity.linked': IdentityLinkedPayload;
  'identity.merged': IdentityMergedPayload;
  'identity.unlinked': IdentityUnlinkedPayload;
  'instance.connected': InstanceConnectedPayload;
  'instance.disconnected': InstanceDisconnectedPayload;
  'instance.qr_code': InstanceQrCodePayload;
  'access.allowed': AccessAllowedPayload;
  'access.denied': AccessDeniedPayload;
  'access.pairing_requested': AccessPairingRequestedPayload;
  'sync.started': SyncStartedPayload;
  'sync.progress': SyncProgressPayload;
  'sync.completed': SyncCompletedPayload;
  'sync.failed': SyncFailedPayload;
  'profile.synced': ProfileSyncedPayload;
  'reaction.received': ReactionReceivedPayload;
  'reaction.removed': ReactionRemovedPayload;
  'session.reset': SessionResetPayload;
  'presence.typing': PresenceTypingPayload;
  'presence.online': PresenceOnlinePayload;
  'presence.offline': PresenceOfflinePayload;
  'batch-job.created': BatchJobCreatedPayload;
  'batch-job.started': BatchJobStartedPayload;
  'batch-job.progress': BatchJobProgressPayload;
  'batch-job.completed': BatchJobCompletedPayload;
  'batch-job.cancelled': BatchJobCancelledPayload;
  'batch-job.failed': BatchJobFailedPayload;
  'agent.state.changed': AgentStateChangedPayload;
  'agent.task.created': AgentTaskCreatedPayload;
  'agent.task.updated': AgentTaskUpdatedPayload;
  'agent.task.completed': AgentTaskCompletedPayload;
  'agent.task.failed': AgentTaskFailedPayload;
  'agent.task.cancelled': AgentTaskCancelledPayload;
  'agent.a2a.task_received': Record<string, unknown>;
  'agent.a2a.task_updated': Record<string, unknown>;
  'agent.a2a.task_completed': Record<string, unknown>;
  'agent.a2a.task_failed': Record<string, unknown>;
  'agent.internal.forwarded': Record<string, unknown>;
  'conversation.created': { conversationId: string; title: string | null };
  'conversation.updated': { conversationId: string; title: string | null };
  'conversation.deleted': { conversationId: string };
  // Social channel events
  'post.received': PostReceivedPayload;
  'post.created': PostCreatedPayload;
  'post.updated': PostUpdatedPayload;
  'post.deleted': PostDeletedPayload;
  'comment.received': CommentReceivedPayload;
  'comment.sent': CommentSentPayload;
  'connection.received': ConnectionReceivedPayload;
  'connection.accepted': ConnectionAcceptedPayload;
  'mention.received': MentionReceivedPayload;
}

/**
 * Typed event helper for core events
 */
export type TypedOmniEvent<T extends CoreEventType> = OmniEvent<T, EventPayloadMap[T]>;

/**
 * Generic payload for custom/system events (validated at runtime via registry)
 */
export type GenericEventPayload = Record<string, unknown>;
