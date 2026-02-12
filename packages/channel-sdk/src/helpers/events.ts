/**
 * Event emitter parameter types
 *
 * These types define the parameters for BaseChannelPlugin's emit* methods.
 * The emit methods automatically build hierarchical subjects and ensure
 * type-safe payloads matching EventPayloadMap from @omni/core.
 */

import type { ContentType } from '@omni/core/types';

/**
 * Parameters for emitMessageReceived
 */
export interface EmitMessageReceivedParams {
  /** Instance that received the message */
  instanceId: string;

  /** Platform-assigned message ID */
  externalId: string;

  /** Chat/conversation ID */
  chatId: string;

  /** Sender identifier on the platform */
  from: string;

  /** Message content */
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
  };

  /** ID of message this is replying to */
  replyToId?: string;

  /** Raw payload from the platform (for debugging) */
  rawPayload?: Record<string, unknown>;

  /** Journey timing checkpoints (T0, T1, etc.) to include in event metadata */
  timings?: Record<string, number>;
}

/**
 * Parameters for emitMessageSent
 */
export interface EmitMessageSentParams {
  /** Instance that sent the message */
  instanceId: string;

  /** Platform-assigned message ID */
  externalId: string;

  /** Chat/conversation ID */
  chatId: string;

  /** Recipient identifier */
  to: string;

  /** Message content */
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
  };

  /** ID of message this was replying to */
  replyToId?: string;
}

/**
 * Parameters for emitMessageFailed
 */
export interface EmitMessageFailedParams {
  /** Instance that failed to send */
  instanceId: string;

  /** Platform-assigned message ID (if available) */
  externalId?: string;

  /** Chat/conversation ID */
  chatId: string;

  /** Error message */
  error: string;

  /** Error code */
  errorCode?: string;

  /** Whether the error is retryable */
  retryable: boolean;
}

/**
 * Parameters for emitMessageDelivered
 */
export interface EmitMessageDeliveredParams {
  /** Instance that sent the message */
  instanceId: string;

  /** Platform-assigned message ID */
  externalId: string;

  /** Chat/conversation ID */
  chatId: string;

  /** When the message was delivered */
  deliveredAt: number;
}

/**
 * Parameters for emitMessageRead
 */
export interface EmitMessageReadParams {
  /** Instance that sent the message */
  instanceId: string;

  /** Platform-assigned message ID */
  externalId: string;

  /** Chat/conversation ID */
  chatId: string;

  /** When the message was read */
  readAt: number;
}

/**
 * Parameters for emitMediaReceived
 */
export interface EmitMediaReceivedParams {
  /** Instance that received the media */
  instanceId: string;

  /** Event ID that triggered this media */
  eventId: string;

  /** Platform-assigned media ID */
  mediaId: string;

  /** MIME type of the media */
  mimeType: string;

  /** File size in bytes */
  size: number;

  /** URL to download the media */
  url: string;

  /** Duration in seconds (for audio/video) */
  duration?: number;
}

/**
 * Parameters for emitReactionReceived
 */
export interface EmitReactionReceivedParams {
  /** Instance that received the reaction */
  instanceId: string;

  /** The message being reacted to */
  messageId: string;

  /** Chat where reaction happened */
  chatId: string;

  /** User who reacted */
  from: string;

  /** Emoji used (unicode char or custom ID) */
  emoji: string;

  /** Custom emoji name (e.g., Discord custom emojis) */
  emojiName?: string;

  /** Whether emoji is platform-custom */
  isCustomEmoji?: boolean;

  /** Raw platform payload */
  rawPayload?: Record<string, unknown>;
}

/**
 * Parameters for emitReactionRemoved
 */
export interface EmitReactionRemovedParams {
  /** Instance that received the reaction removal */
  instanceId: string;

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
 * Metadata for instance connected event
 */
export interface InstanceConnectedMetadata {
  /** Profile name on the platform */
  profileName?: string;

  /** Profile picture URL */
  profilePicUrl?: string;

  /** Owner identifier (phone, email, username) */
  ownerIdentifier?: string;
}
