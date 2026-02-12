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
  // Batch job operations
  'batch-job.created',
  'batch-job.started',
  'batch-job.progress',
  'batch-job.completed',
  'batch-job.cancelled',
  'batch-job.failed',
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
  /** NATS stream sequence number (set by subscription handler, not by publisher) */
  streamSequence?: number;
  /** Journey timing checkpoints: checkpoint name → Unix ms timestamp */
  timings?: Record<string, number>;
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
  from: string;
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
  };
  replyToId?: string;
  rawPayload?: Record<string, unknown>;
}

export interface MessageSentPayload {
  externalId: string;
  chatId: string;
  to: string;
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
  };
  replyToId?: string;
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
}

export interface SyncJobProgress {
  fetched: number;
  stored: number;
  duplicates: number;
  mediaDownloaded: number;
  totalEstimated?: number;
}

export type SyncJobType = 'profile' | 'messages' | 'contacts' | 'groups' | 'all';

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

/**
 * Event type map for type-safe event handling (core events only)
 */
export interface EventPayloadMap {
  'message.received': MessageReceivedPayload;
  'message.sent': MessageSentPayload;
  'message.delivered': MessageDeliveredPayload;
  'message.read': MessageReadPayload;
  'message.failed': MessageFailedPayload;
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
  'sync.started': SyncStartedPayload;
  'sync.progress': SyncProgressPayload;
  'sync.completed': SyncCompletedPayload;
  'sync.failed': SyncFailedPayload;
  'profile.synced': ProfileSyncedPayload;
  'reaction.received': ReactionReceivedPayload;
  'reaction.removed': ReactionRemovedPayload;
  'presence.typing': PresenceTypingPayload;
  'presence.online': PresenceOnlinePayload;
  'presence.offline': PresenceOfflinePayload;
  'batch-job.created': BatchJobCreatedPayload;
  'batch-job.started': BatchJobStartedPayload;
  'batch-job.progress': BatchJobProgressPayload;
  'batch-job.completed': BatchJobCompletedPayload;
  'batch-job.cancelled': BatchJobCancelledPayload;
  'batch-job.failed': BatchJobFailedPayload;
}

/**
 * Typed event helper for core events
 */
export type TypedOmniEvent<T extends CoreEventType> = OmniEvent<T, EventPayloadMap[T]>;

/**
 * Generic payload for custom/system events (validated at runtime via registry)
 */
export type GenericEventPayload = Record<string, unknown>;
