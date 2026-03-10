/**
 * Feed Poller — periodic feed sync with DB-backed diffing.
 *
 * On each tick:
 * 1. Scrape feed posts via scrapeFeedPosts()
 * 2. Load existing posts from DB via data access callbacks
 * 3. Diff scraped vs DB using diffByExternalId
 * 4. NEW posts: persist via callback, emit post.received
 * 5. UPDATED posts (engagement changed): update via callback, emit post.updated,
 *    record engagement snapshots
 * 6. REMOVED posts: mark as deleted via callback, emit post.deleted
 * 7. For posts with changed comment counts: sync comments
 */

import type { Page } from 'playwright';

import type { Logger } from '@omni/channel-sdk';
import { scrapePostComments } from '../scrapers/comments';
import { scrapeFeedPosts } from '../scrapers/feed';
import type { LinkedInComment, LinkedInPost } from '../types';
import { diffByExternalId } from './differ';

// ---------------------------------------------------------------------------
// Data access interface — avoids direct drizzle-orm imports
// ---------------------------------------------------------------------------

/**
 * Data access callbacks for the feed poller.
 * Implemented by the plugin using Drizzle ORM internally.
 */
export interface FeedPollerDataAccess {
  /** Load active posts from DB for this instance */
  loadExistingPosts(): Promise<LinkedInPost[]>;
  /** Insert a new post into DB */
  insertPost(post: LinkedInPost): Promise<void>;
  /** Update an existing post in DB */
  updatePost(externalId: string, post: LinkedInPost): Promise<void>;
  /** Mark a post as deleted in DB */
  markPostDeleted(externalId: string): Promise<void>;
  /** Insert an engagement snapshot for a post */
  insertEngagementSnapshot(externalId: string, post: LinkedInPost): Promise<void>;
  /** Load existing comments for a post (by external post ID) */
  loadExistingComments(postExternalId: string): Promise<LinkedInComment[]>;
  /** Insert a new comment into DB */
  insertComment(postExternalId: string, comment: LinkedInComment): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedPollerConfig {
  /** Playwright Page instance (must be on /feed/) */
  page: Page;
  /** Data access callbacks */
  dataAccess: FeedPollerDataAccess;
  /** Logger instance */
  logger: Logger;
  /** Callback for emitting post.received events */
  onPostReceived?: (post: LinkedInPost) => Promise<void>;
  /** Callback for emitting post.updated events */
  onPostUpdated?: (oldPost: LinkedInPost, newPost: LinkedInPost, changedFields: string[]) => Promise<void>;
  /** Callback for emitting post.deleted events */
  onPostDeleted?: (post: LinkedInPost) => Promise<void>;
  /** Callback for emitting comment.received events */
  onCommentReceived?: (comment: LinkedInComment) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether engagement counts changed between two scraped post snapshots.
 */
function postHasChanged(old: LinkedInPost, new_: LinkedInPost): boolean {
  return (
    old.likeCount !== new_.likeCount ||
    old.commentCount !== new_.commentCount ||
    old.repostCount !== new_.repostCount ||
    old.content !== new_.content
  );
}

/**
 * Compute which fields changed between two post snapshots.
 */
function getChangedFields(old: LinkedInPost, new_: LinkedInPost): string[] {
  const fields: string[] = [];
  if (old.likeCount !== new_.likeCount) fields.push('likeCount');
  if (old.commentCount !== new_.commentCount) fields.push('commentCount');
  if (old.repostCount !== new_.repostCount) fields.push('repostCount');
  if (old.content !== new_.content) fields.push('content');
  return fields;
}

function commentHasChanged(old: LinkedInComment, new_: LinkedInComment): boolean {
  return old.likeCount !== new_.likeCount || old.content !== new_.content;
}

// ---------------------------------------------------------------------------
// FeedPoller
// ---------------------------------------------------------------------------

export class FeedPoller {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config: FeedPollerConfig;
  private running = false;

  constructor(config: FeedPollerConfig) {
    this.config = config;
  }

  /**
   * Start periodic feed polling.
   *
   * @param intervalMs - Polling interval in milliseconds (default: 15 min)
   */
  start(intervalMs = 15 * 60 * 1000): void {
    if (this.intervalHandle) {
      this.config.logger.warn('FeedPoller already running, skipping start');
      return;
    }

    this.config.logger.info('FeedPoller started', { intervalMs });

    // Run immediately on start, then on interval
    void this.tick();
    this.intervalHandle = setInterval(() => void this.tick(), intervalMs);
  }

  /**
   * Stop the periodic polling.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.config.logger.info('FeedPoller stopped');
    }
  }

  /**
   * Whether the poller is currently running.
   */
  isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  /**
   * Handle newly added posts: persist and emit events.
   */
  private async handleAddedPosts(posts: LinkedInPost[]): Promise<void> {
    for (const post of posts) {
      await this.config.dataAccess.insertPost(post);
      if (this.config.onPostReceived) {
        await this.config.onPostReceived(post);
      }
    }
  }

  /**
   * Handle a single updated post: persist, snapshot engagement, and emit event.
   */
  private async handleUpdatedPost(oldPost: LinkedInPost, newPost: LinkedInPost): Promise<void> {
    const changedFields = getChangedFields(oldPost, newPost);
    await this.config.dataAccess.updatePost(newPost.externalId, newPost);

    const hasEngagementChange =
      changedFields.includes('likeCount') ||
      changedFields.includes('commentCount') ||
      changedFields.includes('repostCount');

    if (hasEngagementChange) {
      await this.config.dataAccess.insertEngagementSnapshot(newPost.externalId, newPost);
    }

    if (this.config.onPostUpdated) {
      await this.config.onPostUpdated(oldPost, newPost, changedFields);
    }
  }

  /**
   * Handle removed posts: mark deleted and emit events.
   */
  private async handleRemovedPosts(posts: LinkedInPost[]): Promise<void> {
    for (const post of posts) {
      await this.config.dataAccess.markPostDeleted(post.externalId);
      if (this.config.onPostDeleted) {
        await this.config.onPostDeleted(post);
      }
    }
  }

  /**
   * Execute a single sync cycle.
   */
  private async tick(): Promise<void> {
    if (this.running) {
      this.config.logger.debug('FeedPoller tick skipped (previous tick still running)');
      return;
    }

    this.running = true;
    const start = Date.now();

    try {
      this.config.logger.debug('FeedPoller tick starting');

      const scraped = await scrapeFeedPosts(this.config.page, { limit: 20 });
      const existingPosts = await this.config.dataAccess.loadExistingPosts();
      const diff = diffByExternalId(existingPosts, scraped, postHasChanged);

      await this.handleAddedPosts(diff.added);

      for (const { old: oldPost, new: newPost } of diff.updated) {
        await this.handleUpdatedPost(oldPost, newPost);
      }

      await this.handleRemovedPosts(diff.removed);

      const postsWithCommentChanges = diff.updated
        .filter(({ old: o, new: n }) => o.commentCount !== n.commentCount)
        .map(({ new: n }) => n);
      await this.syncComments(postsWithCommentChanges);

      const elapsed = Date.now() - start;
      this.config.logger.info('FeedPoller tick complete', {
        added: diff.added.length,
        updated: diff.updated.length,
        removed: diff.removed.length,
        unchanged: diff.unchanged.length,
        elapsedMs: elapsed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.config.logger.error('FeedPoller tick failed', { error: message });
    } finally {
      this.running = false;
    }
  }

  /**
   * Find the DOM element for a post by matching its data-urn attribute.
   */
  private async findPostElement(post: LinkedInPost): Promise<import('playwright').ElementHandle | null> {
    const postElements = await this.config.page.$$('.feed-shared-update-v2, [data-test-feed-post]');
    for (const el of postElements) {
      const dataUrn = await el.getAttribute('data-urn');
      if (dataUrn === post.externalId) return el;
    }
    return null;
  }

  /**
   * Sync comments for a single post element.
   */
  private async syncPostComments(post: LinkedInPost, postEl: import('playwright').ElementHandle): Promise<void> {
    const scrapedComments = await scrapePostComments(postEl);
    if (scrapedComments.length === 0) return;

    const existingComments = await this.config.dataAccess.loadExistingComments(post.externalId);
    const commentDiff = diffByExternalId(existingComments, scrapedComments, commentHasChanged);

    for (const comment of commentDiff.added) {
      await this.config.dataAccess.insertComment(post.externalId, comment);
      if (this.config.onCommentReceived) {
        await this.config.onCommentReceived(comment);
      }
    }
  }

  /**
   * Sync comments for posts where commentCount changed.
   */
  private async syncComments(posts: LinkedInPost[]): Promise<void> {
    for (const post of posts) {
      try {
        const matchedEl = await this.findPostElement(post);
        if (!matchedEl) continue;
        await this.syncPostComments(post, matchedEl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.config.logger.warn('Comment sync failed for post', {
          postId: post.externalId,
          error: message,
        });
      }
    }
  }
}
