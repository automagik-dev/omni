/**
 * Social channel plugin base class
 *
 * Extends BaseChannelPlugin with social-specific functionality:
 * - Abstract methods for social operations (createPost, getFeed, etc.)
 * - Event emission helpers for social events (post.*, comment.*, connection.*, mention.*)
 *
 * Social channels (LinkedIn, Twitter/X, Instagram) should extend this class
 * instead of BaseChannelPlugin directly.
 *
 * @example
 * ```typescript
 * export class LinkedInPlugin extends SocialChannelPlugin {
 *   readonly id = 'linkedin' as const;
 *   readonly name = 'LinkedIn';
 *   readonly version = '1.0.0';
 *   readonly capabilities = {
 *     ...DEFAULT_CAPABILITIES,
 *     canCreatePost: true,
 *     canReadFeed: true,
 *     canComment: true,
 *     canHandleConnections: true,
 *   };
 *
 *   async createPost(instanceId, post) { ... }
 *   async getFeed(instanceId, options) { ... }
 *   // ... other abstract methods
 * }
 * ```
 */

import { generateCorrelationId } from '@omni/core';
import type {
  EmitCommentReceivedParams,
  EmitCommentSentParams,
  EmitConnectionAcceptedParams,
  EmitConnectionReceivedParams,
  EmitMentionReceivedParams,
  EmitPostCreatedParams,
  EmitPostDeletedParams,
  EmitPostReceivedParams,
  EmitPostUpdatedParams,
} from '../helpers/social-events';
import { BaseChannelPlugin } from './BaseChannelPlugin';

// ─────────────────────────────────────────────────────────────
// Social method types
// ─────────────────────────────────────────────────────────────

/** Input for creating a social post */
export interface CreatePostInput {
  /** Text content of the post */
  textContent?: string;
  /** Media URLs to attach */
  mediaUrls?: string[];
  /** Link URL to include */
  linkUrl?: string;
  /** Post visibility (public, connections, etc.) */
  visibility?: string;
}

/** Result of creating a social post */
export interface CreatePostResult {
  success: boolean;
  /** Platform-assigned post ID */
  externalId?: string;
  error?: string;
}

/** Options for fetching the social feed */
export interface GetFeedOptions {
  /** Maximum number of posts to fetch */
  limit?: number;
  /** Cursor or offset for pagination */
  cursor?: string;
}

/** A post from the social feed */
export interface FeedPost {
  externalId: string;
  authorPlatformUserId: string;
  authorDisplayName?: string;
  postType: string;
  textContent?: string;
  mediaUrls?: string[];
  linkUrl?: string;
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
  impressionCount?: number;
  hashtags?: string[];
  platformTimestamp?: Date;
  rawPayload?: Record<string, unknown>;
}

/** Result of fetching the social feed */
export interface GetFeedResult {
  posts: FeedPost[];
  nextCursor?: string;
  hasMore: boolean;
}

/** A comment on a social post */
export interface PostComment {
  externalId: string;
  postExternalId: string;
  parentCommentExternalId?: string;
  authorPlatformUserId: string;
  authorDisplayName?: string;
  textContent: string;
  mediaUrl?: string;
  likeCount?: number;
  replyCount?: number;
  platformTimestamp?: Date;
  rawPayload?: Record<string, unknown>;
}

/** Result of fetching comments on a post */
export interface GetCommentsResult {
  comments: PostComment[];
  hasMore: boolean;
}

/** A connection/follower on the social platform */
export interface SocialConnection {
  platformUserId: string;
  displayName?: string;
  connectionType: string;
  status: string;
  message?: string;
  connectedAt?: Date;
  requestedAt?: Date;
}

/** Result of fetching connections */
export interface GetConnectionsResult {
  connections: SocialConnection[];
  hasMore: boolean;
}

/**
 * Abstract base class for social channel plugins
 *
 * Extends BaseChannelPlugin with social-specific abstract methods
 * and event emission helpers for post, comment, connection, and mention events.
 */
export abstract class SocialChannelPlugin extends BaseChannelPlugin {
  // ─────────────────────────────────────────────────────────────
  // Abstract social methods - must be implemented by subclasses
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a post on the social platform
   */
  abstract createPost(instanceId: string, post: CreatePostInput): Promise<CreatePostResult>;

  /**
   * Fetch the social feed
   */
  abstract getFeed(instanceId: string, options?: GetFeedOptions): Promise<GetFeedResult>;

  /**
   * Fetch comments on a specific post
   */
  abstract getComments(instanceId: string, postExternalId: string): Promise<GetCommentsResult>;

  /**
   * React to a social post
   *
   * @param instanceId - Instance to react from
   * @param postExternalId - Platform post ID to react to
   * @param reactionType - Reaction type (like, celebrate, support, etc.)
   */
  abstract reactToPost(instanceId: string, postExternalId: string, reactionType: string): Promise<void>;

  /**
   * Fetch connections/followers
   */
  abstract getConnections(instanceId: string): Promise<GetConnectionsResult>;

  // ─────────────────────────────────────────────────────────────
  // Social Event Emission Helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Emit post.received event
   */
  protected async emitPostReceived(params: EmitPostReceivedParams): Promise<void> {
    await this.eventBus.publish(
      'post.received',
      {
        externalId: params.externalId,
        authorPlatformUserId: params.authorPlatformUserId,
        authorDisplayName: params.authorDisplayName,
        postType: params.postType,
        textContent: params.textContent,
        mediaUrls: params.mediaUrls,
        linkUrl: params.linkUrl,
        likeCount: params.likeCount,
        commentCount: params.commentCount,
        repostCount: params.repostCount,
        hashtags: params.hashtags,
        rawPayload: params.rawPayload,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted post.received', {
      instanceId: params.instanceId,
      externalId: params.externalId,
    });
  }

  /**
   * Emit post.created event
   */
  protected async emitPostCreated(params: EmitPostCreatedParams): Promise<void> {
    await this.eventBus.publish(
      'post.created',
      {
        externalId: params.externalId,
        postType: params.postType,
        textContent: params.textContent,
        mediaUrls: params.mediaUrls,
        linkUrl: params.linkUrl,
        visibility: params.visibility,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted post.created', {
      instanceId: params.instanceId,
      externalId: params.externalId,
    });
  }

  /**
   * Emit post.updated event
   */
  protected async emitPostUpdated(params: EmitPostUpdatedParams): Promise<void> {
    await this.eventBus.publish(
      'post.updated',
      {
        externalId: params.externalId,
        changedFields: params.changedFields,
        likeCount: params.likeCount,
        commentCount: params.commentCount,
        repostCount: params.repostCount,
        impressionCount: params.impressionCount,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted post.updated', {
      instanceId: params.instanceId,
      externalId: params.externalId,
      changedFields: params.changedFields,
    });
  }

  /**
   * Emit post.deleted event
   */
  protected async emitPostDeleted(params: EmitPostDeletedParams): Promise<void> {
    await this.eventBus.publish(
      'post.deleted',
      {
        externalId: params.externalId,
        reason: params.reason,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted post.deleted', {
      instanceId: params.instanceId,
      externalId: params.externalId,
    });
  }

  /**
   * Emit comment.received event
   */
  protected async emitCommentReceived(params: EmitCommentReceivedParams): Promise<void> {
    await this.eventBus.publish(
      'comment.received',
      {
        externalId: params.externalId,
        postExternalId: params.postExternalId,
        parentCommentExternalId: params.parentCommentExternalId,
        authorPlatformUserId: params.authorPlatformUserId,
        authorDisplayName: params.authorDisplayName,
        textContent: params.textContent,
        mediaUrl: params.mediaUrl,
        rawPayload: params.rawPayload,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted comment.received', {
      instanceId: params.instanceId,
      externalId: params.externalId,
      postExternalId: params.postExternalId,
    });
  }

  /**
   * Emit comment.sent event
   */
  protected async emitCommentSent(params: EmitCommentSentParams): Promise<void> {
    await this.eventBus.publish(
      'comment.sent',
      {
        externalId: params.externalId,
        postExternalId: params.postExternalId,
        parentCommentExternalId: params.parentCommentExternalId,
        textContent: params.textContent,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted comment.sent', {
      instanceId: params.instanceId,
      externalId: params.externalId,
      postExternalId: params.postExternalId,
    });
  }

  /**
   * Emit connection.received event
   */
  protected async emitConnectionReceived(params: EmitConnectionReceivedParams): Promise<void> {
    await this.eventBus.publish(
      'connection.received',
      {
        platformUserId: params.platformUserId,
        displayName: params.displayName,
        connectionType: params.connectionType,
        message: params.message,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted connection.received', {
      instanceId: params.instanceId,
      platformUserId: params.platformUserId,
    });
  }

  /**
   * Emit connection.accepted event
   */
  protected async emitConnectionAccepted(params: EmitConnectionAcceptedParams): Promise<void> {
    await this.eventBus.publish(
      'connection.accepted',
      {
        platformUserId: params.platformUserId,
        displayName: params.displayName,
        connectionType: params.connectionType,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted connection.accepted', {
      instanceId: params.instanceId,
      platformUserId: params.platformUserId,
    });
  }

  /**
   * Emit mention.received event
   */
  protected async emitMentionReceived(params: EmitMentionReceivedParams): Promise<void> {
    await this.eventBus.publish(
      'mention.received',
      {
        mentionContext: params.mentionContext,
        sourceExternalId: params.sourceExternalId,
        mentionedByPlatformUserId: params.mentionedByPlatformUserId,
        mentionedByDisplayName: params.mentionedByDisplayName,
        textContent: params.textContent,
        rawPayload: params.rawPayload,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted mention.received', {
      instanceId: params.instanceId,
      mentionContext: params.mentionContext,
      sourceExternalId: params.sourceExternalId,
    });
  }
}
