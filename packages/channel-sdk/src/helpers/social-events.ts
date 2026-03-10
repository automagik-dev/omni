/**
 * Social event emitter parameter types
 *
 * These types define the parameters for SocialChannelPlugin's emit* methods.
 * Follows the same pattern as events.ts for messaging events.
 */

/**
 * Parameters for emitPostReceived
 */
export interface EmitPostReceivedParams {
  /** Instance that received the post */
  instanceId: string;

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

/**
 * Parameters for emitPostCreated
 */
export interface EmitPostCreatedParams {
  /** Instance that created the post */
  instanceId: string;

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

/**
 * Parameters for emitPostUpdated
 */
export interface EmitPostUpdatedParams {
  /** Instance that detected the update */
  instanceId: string;

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

/**
 * Parameters for emitPostDeleted
 */
export interface EmitPostDeletedParams {
  /** Instance that detected the deletion */
  instanceId: string;

  /** Platform-assigned post ID */
  externalId: string;

  /** Reason for deletion (if known) */
  reason?: string;
}

/**
 * Parameters for emitCommentReceived
 */
export interface EmitCommentReceivedParams {
  /** Instance that received the comment */
  instanceId: string;

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

/**
 * Parameters for emitCommentSent
 */
export interface EmitCommentSentParams {
  /** Instance that sent the comment */
  instanceId: string;

  /** Platform-assigned comment ID */
  externalId: string;

  /** Post this comment belongs to */
  postExternalId: string;

  /** Parent comment ID for threaded replies */
  parentCommentExternalId?: string;

  /** Comment text */
  textContent: string;
}

/**
 * Parameters for emitConnectionReceived
 */
export interface EmitConnectionReceivedParams {
  /** Instance that received the connection request */
  instanceId: string;

  /** Platform user ID of person who sent the request */
  platformUserId: string;

  /** Display name */
  displayName?: string;

  /** Connection type (connect, follow, etc.) */
  connectionType: string;

  /** Optional message included with the request */
  message?: string;
}

/**
 * Parameters for emitConnectionAccepted
 */
export interface EmitConnectionAcceptedParams {
  /** Instance that accepted the connection */
  instanceId: string;

  /** Platform user ID of the connection */
  platformUserId: string;

  /** Display name */
  displayName?: string;

  /** Connection type */
  connectionType: string;
}

/**
 * Parameters for emitMentionReceived
 */
export interface EmitMentionReceivedParams {
  /** Instance that received the mention */
  instanceId: string;

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
