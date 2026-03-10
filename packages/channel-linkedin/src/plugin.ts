/**
 * LinkedInPlugin — main plugin class for the LinkedIn channel.
 *
 * Extends SocialChannelPlugin from channel-sdk and wires together:
 * - BrowserManager for Playwright-based automation
 * - RateLimiter for humanized rate limiting
 * - FeedPoller for periodic feed sync
 * - InboxPoller for periodic inbox sync
 * - All scrapers and actions from Groups B-D
 *
 * Plugin metadata:
 * - id: 'linkedin'
 * - name: 'LinkedIn'
 * - channelType: 'linkedin'
 */

import { SocialChannelPlugin } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  ConnectionStatus,
  CreatePostInput,
  CreatePostResult,
  FeedPost,
  GetCommentsResult,
  GetConnectionsResult,
  GetFeedOptions,
  GetFeedResult,
  HealthCheck,
  InstanceConfig,
  OutgoingMessage,
  PostComment,
  SendResult,
  SocialConnection,
} from '@omni/channel-sdk';
import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelType } from '@omni/core/types';

import {
  createPost as createPostAction,
  reactToPost as reactToPostAction,
  sendMessage as sendMessageAction,
} from './actions';
import { BrowserManager, RateLimiter, SELECTORS, isActiveHours, selectorExists } from './browser';
import type { BrowserConfig } from './browser';
import { scrapeConnections, scrapeFeedPosts, scrapePendingInvites, scrapePostComments } from './scrapers';
import { FeedPoller } from './sync/feed-poller';
import type { FeedPollerDataAccess } from './sync/feed-poller';
import { InboxPoller } from './sync/inbox-poller';
import type {
  ActiveHoursConfig,
  LinkedInComment,
  LinkedInInstanceConfig,
  LinkedInPost,
  LinkedInReactionType,
  RateLimitsConfig,
  SyncIntervalsConfig,
} from './types';
import { DEFAULT_RATE_LIMITS } from './types';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const LINKEDIN_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canCreatePost: true,
  canReadFeed: true,
  canComment: true,
  canHandleConnections: true,
  canHandleDMs: true,
  maxMessageLength: 8000,
};

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_SYNC_INTERVALS: SyncIntervalsConfig = {
  feed: 15 * 60 * 1000, // 15 minutes
  inbox: 5 * 60 * 1000, // 5 minutes
  connections: 60 * 60 * 1000, // 1 hour
  engagement: 30 * 60 * 1000, // 30 minutes
};

const DEFAULT_ACTIVE_HOURS: ActiveHoursConfig = {
  start: 8,
  end: 22,
  timezone: 'America/Sao_Paulo',
};

// ---------------------------------------------------------------------------
// Per-instance state
// ---------------------------------------------------------------------------

interface InstanceState {
  browser: BrowserManager;
  rateLimiter: RateLimiter;
  feedPoller: FeedPoller | null;
  inboxPoller: InboxPoller | null;
  config: LinkedInInstanceConfig;
}

// ---------------------------------------------------------------------------
// LinkedInPlugin
// ---------------------------------------------------------------------------

export class LinkedInPlugin extends SocialChannelPlugin {
  readonly id = 'linkedin' as ChannelType;
  readonly name = 'LinkedIn';
  readonly version = '1.0.0';
  readonly capabilities = LINKEDIN_CAPABILITIES;

  private instanceStates = new Map<string, InstanceState>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect a LinkedIn instance.
   *
   * 1. Parse instance config for LinkedIn-specific settings
   * 2. Launch BrowserManager with persistent Chromium context
   * 3. Verify authentication (check for login redirect)
   * 4. Start feed and inbox pollers
   * 5. Emit instance.connected event
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    if (this.instanceStates.has(instanceId)) {
      throw new Error(`LinkedIn instance '${instanceId}' already connected`);
    }

    const linkedInConfig = this.parseConfig(config);

    this.instances.setInstance(instanceId, config, {
      state: 'connecting',
      since: new Date(),
      message: 'Launching browser...',
    });

    // Create browser manager
    const browserConfig: BrowserConfig = {
      browserDataPath: linkedInConfig.browserDataPath,
      headless: linkedInConfig.headless,
      viewportWidth: linkedInConfig.viewportWidth,
      viewportHeight: linkedInConfig.viewportHeight,
      locale: linkedInConfig.locale,
    };

    const browser = new BrowserManager(browserConfig);
    const rateLimiter = new RateLimiter(linkedInConfig.rateLimits);

    try {
      // Launch browser
      await browser.launch();
      this.logger.info('Browser launched', { instanceId });

      // Navigate to messaging to verify auth
      await browser.navigateToMessaging();

      // Check authentication
      if (!browser.isAuthenticated()) {
        this.instances.setInstance(instanceId, config, {
          state: 'error',
          since: new Date(),
          message: 'Authentication required - please log in to LinkedIn in the browser',
          error: {
            code: 'AUTH_REQUIRED',
            message: 'LinkedIn session not authenticated. Log in via the persistent browser profile.',
            retryable: true,
          },
        });
        await this.emitInstanceDisconnected(instanceId, 'auth_expired');
        return;
      }

      // Create data access layer for feed poller
      const dataAccess = this.createDataAccess(instanceId);

      // Create and start feed poller
      const feedPoller = new FeedPoller({
        page: browser.getPage(),
        dataAccess,
        logger: this.logger,
        onPostReceived: async (post) => {
          await this.emitPostReceived({
            instanceId,
            externalId: post.externalId,
            authorPlatformUserId: post.authorProfileUrl ?? post.authorName,
            authorDisplayName: post.authorName,
            postType: 'text',
            textContent: post.content,
            mediaUrls: post.mediaUrls,
            hashtags: post.hashtags,
            likeCount: post.likeCount,
            commentCount: post.commentCount,
            repostCount: post.repostCount,
          });
        },
        onPostUpdated: async (_oldPost, newPost, changedFields) => {
          await this.emitPostUpdated({
            instanceId,
            externalId: newPost.externalId,
            changedFields,
            likeCount: newPost.likeCount,
            commentCount: newPost.commentCount,
            repostCount: newPost.repostCount,
          });
        },
        onPostDeleted: async (post) => {
          await this.emitPostDeleted({
            instanceId,
            externalId: post.externalId,
            reason: 'not_found_in_feed',
          });
        },
        onCommentReceived: async (comment) => {
          await this.emitCommentReceived({
            instanceId,
            externalId: comment.externalId,
            postExternalId: comment.postId,
            parentCommentExternalId: comment.parentCommentId,
            authorPlatformUserId: comment.authorProfileUrl ?? comment.authorName,
            authorDisplayName: comment.authorName,
            textContent: comment.content,
          });
        },
      });

      // Create and start inbox poller
      const inboxPoller = new InboxPoller({
        page: browser.getPage(),
        instanceId,
        logger: this.logger,
        onMessageReceived: async (message, conversation) => {
          await this.emitMessageReceived({
            instanceId,
            externalId: message.externalId,
            chatId: conversation.externalId,
            from: message.senderName,
            content: {
              type: 'text',
              text: message.body,
            },
          });
        },
      });

      // Store instance state
      const state: InstanceState = {
        browser,
        rateLimiter,
        feedPoller,
        inboxPoller,
        config: linkedInConfig,
      };
      this.instanceStates.set(instanceId, state);

      // Start pollers (respecting active hours)
      if (isActiveHours(linkedInConfig.activeHours)) {
        feedPoller.start(linkedInConfig.syncIntervals.feed);
        inboxPoller.start(linkedInConfig.syncIntervals.inbox);
      } else {
        this.logger.info('Outside active hours, pollers will start when active hours begin', { instanceId });
      }

      // Update instance status
      this.instances.setInstance(instanceId, config, {
        state: 'connected',
        since: new Date(),
        message: 'LinkedIn connected via persistent browser session',
      });

      await this.emitInstanceConnected(instanceId, {
        profileName: 'LinkedIn User',
      });

      this.logger.info('LinkedIn instance connected', { instanceId });
    } catch (error) {
      await browser.close();
      const message = error instanceof Error ? error.message : String(error);

      this.instances.setInstance(instanceId, config, {
        state: 'error',
        since: new Date(),
        message: `Connection failed: ${message}`,
        error: {
          code: 'CONNECTION_FAILED',
          message,
          retryable: true,
        },
      });

      throw error;
    }
  }

  /**
   * Disconnect a LinkedIn instance.
   *
   * 1. Stop pollers
   * 2. Close browser
   * 3. Emit instance.disconnected event
   */
  async disconnect(instanceId: string): Promise<void> {
    const state = this.instanceStates.get(instanceId);
    if (!state) {
      this.logger.warn('Disconnect called for unknown instance', { instanceId });
      return;
    }

    // Stop pollers
    state.feedPoller?.stop();
    state.inboxPoller?.stop();

    // Close browser
    await state.browser.close();

    // Clean up
    this.instanceStates.delete(instanceId);
    this.instances.setInstance(
      instanceId,
      { instanceId, credentials: {} },
      {
        state: 'disconnected',
        since: new Date(),
        message: 'Disconnected',
      },
    );

    await this.emitInstanceDisconnected(instanceId);
    this.logger.info('LinkedIn instance disconnected', { instanceId });
  }

  // ─────────────────────────────────────────────────────────────
  // Messaging
  // ─────────────────────────────────────────────────────────────

  /**
   * Send a message to a LinkedIn conversation.
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.requireState(instanceId);
    const page = state.browser.getPage();
    const text = message.content.text ?? '';

    if (!text) {
      return {
        success: false,
        error: 'Message text is required',
        timestamp: Date.now(),
      };
    }

    // Navigate to messaging if needed
    const currentUrl = page.url();
    if (!currentUrl.includes('/messaging')) {
      await state.browser.navigateToMessaging();
    }

    const result = await sendMessageAction(page, state.rateLimiter, message.to, text);

    if (result.success && result.data) {
      await this.emitMessageSent({
        instanceId,
        externalId: `msg-${Date.now()}`,
        chatId: message.to,
        to: message.to,
        content: { type: 'text', text },
      });
    }

    return {
      success: result.success,
      messageId: result.success ? `msg-${Date.now()}` : undefined,
      error: result.error,
      timestamp: Date.now(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Social methods (SocialChannelPlugin abstract implementations)
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a post on LinkedIn.
   */
  async createPost(instanceId: string, post: CreatePostInput): Promise<CreatePostResult> {
    const state = this.requireState(instanceId);
    const page = state.browser.getPage();
    const text = post.textContent ?? '';

    if (!text) {
      return { success: false, error: 'Post text content is required' };
    }

    // Navigate to feed if needed
    const currentUrl = page.url();
    if (!currentUrl.includes('/feed')) {
      await state.browser.navigateToFeed();
    }

    const result = await createPostAction(page, state.rateLimiter, text);

    if (result.success) {
      await this.emitPostCreated({
        instanceId,
        externalId: `post-${Date.now()}`,
        postType: 'text',
        textContent: text,
        visibility: post.visibility,
      });
    }

    return {
      success: result.success,
      externalId: result.success ? `post-${Date.now()}` : undefined,
      error: result.error,
    };
  }

  /**
   * Get feed posts. Live scrapes from LinkedIn.
   */
  async getFeed(instanceId: string, options?: GetFeedOptions): Promise<GetFeedResult> {
    const state = this.requireState(instanceId);
    const page = state.browser.getPage();

    // Navigate to feed if needed
    const currentUrl = page.url();
    if (!currentUrl.includes('/feed')) {
      await state.browser.navigateToFeed();
    }

    const posts = await scrapeFeedPosts(page, {
      limit: options?.limit ?? 10,
    });

    const feedPosts: FeedPost[] = posts.map((p) => ({
      externalId: p.externalId,
      authorPlatformUserId: p.authorProfileUrl ?? p.authorName,
      authorDisplayName: p.authorName,
      postType: 'text',
      textContent: p.content,
      mediaUrls: p.mediaUrls,
      hashtags: p.hashtags,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      repostCount: p.repostCount,
    }));

    return {
      posts: feedPosts,
      hasMore: feedPosts.length >= (options?.limit ?? 10),
    };
  }

  /**
   * Get comments on a specific post.
   */
  async getComments(instanceId: string, postExternalId: string): Promise<GetCommentsResult> {
    const state = this.requireState(instanceId);
    const page = state.browser.getPage();

    // Find the post element by its externalId (data-urn)
    const postElements = await page.$$('.feed-shared-update-v2, [data-test-feed-post]');
    let matchedEl = null;

    for (const el of postElements) {
      const dataUrn = await el.getAttribute('data-urn');
      if (dataUrn === postExternalId) {
        matchedEl = el;
        break;
      }
    }

    if (!matchedEl) {
      return { comments: [], hasMore: false };
    }

    const scrapedComments = await scrapePostComments(matchedEl);

    const comments: PostComment[] = scrapedComments.map((c) => ({
      externalId: c.externalId,
      postExternalId: c.postId,
      parentCommentExternalId: c.parentCommentId,
      authorPlatformUserId: c.authorProfileUrl ?? c.authorName,
      authorDisplayName: c.authorName,
      textContent: c.content,
      likeCount: c.likeCount,
    }));

    return {
      comments,
      hasMore: false,
    };
  }

  /**
   * React to a LinkedIn post.
   */
  async reactToPost(instanceId: string, postExternalId: string, reactionType: string): Promise<void> {
    const state = this.requireState(instanceId);
    const page = state.browser.getPage();

    // Find the post element
    const postElements = await page.$$('.feed-shared-update-v2, [data-test-feed-post]');
    let matchedEl = null;

    for (const el of postElements) {
      const dataUrn = await el.getAttribute('data-urn');
      if (dataUrn === postExternalId) {
        matchedEl = el;
        break;
      }
    }

    if (!matchedEl) {
      throw new Error(`Post '${postExternalId}' not found on current page`);
    }

    const result = await reactToPostAction(
      page,
      state.rateLimiter,
      matchedEl,
      reactionType as LinkedInReactionType,
      postExternalId,
    );

    if (!result.success) {
      throw new Error(result.error ?? 'Failed to react to post');
    }
  }

  /**
   * Get connections list.
   */
  async getConnections(instanceId: string): Promise<GetConnectionsResult> {
    const state = this.requireState(instanceId);
    const page = state.browser.getPage();

    const connections = await scrapeConnections(page);
    const pendingInvites = await scrapePendingInvites(page);

    const all: SocialConnection[] = [
      ...connections.map((c) => ({
        platformUserId: c.externalId,
        displayName: c.name,
        connectionType: 'connect',
        status: c.status,
        connectedAt: c.connectedAt ? new Date(c.connectedAt) : undefined,
      })),
      ...pendingInvites.map((c) => ({
        platformUserId: c.externalId,
        displayName: c.name,
        connectionType: 'connect',
        status: c.status,
      })),
    ];

    return {
      connections: all,
      hasMore: false,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Status & Health
  // ─────────────────────────────────────────────────────────────

  /**
   * Get connection status for an instance.
   */
  override async getStatus(instanceId: string): Promise<ConnectionStatus> {
    const state = this.instanceStates.get(instanceId);

    if (!state) {
      return {
        state: 'disconnected',
        since: new Date(),
        message: 'Instance not found',
      };
    }

    if (!state.browser.isConnected()) {
      return {
        state: 'error',
        since: new Date(),
        message: 'Browser connection lost',
        error: {
          code: 'BROWSER_DISCONNECTED',
          message: 'The Chromium browser is no longer connected',
          retryable: true,
        },
      };
    }

    if (!state.browser.isAuthenticated()) {
      return {
        state: 'error',
        since: new Date(),
        message: 'LinkedIn authentication expired',
        error: {
          code: 'AUTH_EXPIRED',
          message: 'LinkedIn session has expired. Please re-authenticate.',
          retryable: true,
        },
      };
    }

    return {
      state: 'connected',
      since: new Date(),
      message: 'Connected',
    };
  }

  /**
   * Custom health checks including selector verification.
   */
  protected override async getHealthChecks(): Promise<HealthCheck[]> {
    const checks = await super.getHealthChecks();

    // Check selector health for each connected instance
    for (const [instanceId, state] of this.instanceStates) {
      try {
        const page = state.browser.getPage();

        // Check if key selectors are resolvable
        const inboxConvListExists = await selectorExists(page, SELECTORS.inbox.conversationList);
        const feedPostExists = await selectorExists(page, SELECTORS.feed.postContainer);

        if (inboxConvListExists || feedPostExists) {
          checks.push({
            name: `selectors:${instanceId}`,
            status: 'pass',
            message: 'Critical DOM selectors found',
            data: {
              inboxConversationList: inboxConvListExists,
              feedPostContainer: feedPostExists,
            },
          });
        } else {
          checks.push({
            name: `selectors:${instanceId}`,
            status: 'warn',
            message: 'No critical selectors matched - LinkedIn DOM may have changed',
            data: {
              inboxConversationList: false,
              feedPostContainer: false,
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push({
          name: `selectors:${instanceId}`,
          status: 'fail',
          message: `Selector health check failed: ${message}`,
        });
      }

      // Rate limiter summary
      checks.push({
        name: `rate-limiter:${instanceId}`,
        status: 'pass',
        message: 'Rate limiter summary',
        data: state.rateLimiter.getSummary() as unknown as Record<string, unknown>,
      });
    }

    return checks;
  }

  // ─────────────────────────────────────────────────────────────
  // Data Access Layer
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a FeedPollerDataAccess implementation for a given instance.
   *
   * Uses the PluginDatabase interface (db.execute) to avoid direct drizzle-orm
   * imports, which cause duplicate package resolution issues in monorepos.
   */
  private createDataAccess(instanceId: string): FeedPollerDataAccess {
    const db = this.db;

    return {
      loadExistingPosts: async (): Promise<LinkedInPost[]> => {
        const rows = await db.execute<{
          external_id: string;
          author_display_name: string | null;
          text_content: string | null;
          like_count: number;
          comment_count: number;
          repost_count: number;
          media_urls: string[] | null;
          hashtags: string[] | null;
          last_synced_at: string | null;
          created_at: string;
        }>(
          `SELECT external_id, author_display_name, text_content, like_count,
                  comment_count, repost_count, media_urls, hashtags,
                  last_synced_at, created_at
           FROM social_posts
           WHERE instance_id = $1 AND status = 'active'`,
          [instanceId],
        );

        return rows.map((row) => ({
          externalId: row.external_id,
          authorName: row.author_display_name ?? '',
          content: row.text_content ?? '',
          likeCount: row.like_count,
          commentCount: row.comment_count,
          repostCount: row.repost_count,
          mediaUrls: row.media_urls ?? undefined,
          hashtags: row.hashtags ?? undefined,
          scrapedAt: row.last_synced_at ? new Date(row.last_synced_at).getTime() : new Date(row.created_at).getTime(),
        }));
      },

      insertPost: async (post: LinkedInPost): Promise<void> => {
        await db.execute(
          `INSERT INTO social_posts
            (instance_id, external_id, channel, author_display_name,
             author_platform_user_id, post_type, text_content, media_urls,
             hashtags, like_count, comment_count, repost_count,
             last_synced_at, platform_timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(),
                   ${post.postedAt ? '$13' : 'NULL'})`,
          [
            instanceId,
            post.externalId,
            'linkedin',
            post.authorName,
            post.authorProfileUrl ?? post.authorName,
            'text',
            post.content,
            post.mediaUrls ? JSON.stringify(post.mediaUrls) : null,
            post.hashtags ?? null,
            post.likeCount ?? 0,
            post.commentCount ?? 0,
            post.repostCount ?? 0,
            ...(post.postedAt ? [new Date(post.postedAt).toISOString()] : []),
          ],
        );
      },

      updatePost: async (externalId: string, post: LinkedInPost): Promise<void> => {
        await db.execute(
          `UPDATE social_posts
           SET like_count = $1, comment_count = $2, repost_count = $3,
               text_content = $4, last_synced_at = NOW(), updated_at = NOW()
           WHERE instance_id = $5 AND external_id = $6`,
          [post.likeCount ?? 0, post.commentCount ?? 0, post.repostCount ?? 0, post.content, instanceId, externalId],
        );
      },

      markPostDeleted: async (externalId: string): Promise<void> => {
        await db.execute(
          `UPDATE social_posts
           SET status = 'deleted', updated_at = NOW()
           WHERE instance_id = $1 AND external_id = $2`,
          [instanceId, externalId],
        );
      },

      insertEngagementSnapshot: async (externalId: string, post: LinkedInPost): Promise<void> => {
        await db.execute(
          `INSERT INTO social_engagement_snapshots (post_id, like_count, comment_count, repost_count)
           SELECT id, $1, $2, $3
           FROM social_posts
           WHERE instance_id = $4 AND external_id = $5
           LIMIT 1`,
          [post.likeCount ?? 0, post.commentCount ?? 0, post.repostCount ?? 0, instanceId, externalId],
        );
      },

      loadExistingComments: async (postExternalId: string): Promise<LinkedInComment[]> => {
        const rows = await db.execute<{
          external_id: string;
          author_display_name: string | null;
          text_content: string | null;
          like_count: number;
          parent_comment_id: string | null;
        }>(
          `SELECT sc.external_id, sc.author_display_name, sc.text_content,
                  sc.like_count, sc.parent_comment_id
           FROM social_comments sc
           JOIN social_posts sp ON sc.post_id = sp.id
           WHERE sp.instance_id = $1 AND sp.external_id = $2`,
          [instanceId, postExternalId],
        );

        return rows.map((row) => ({
          externalId: row.external_id,
          postId: postExternalId,
          parentCommentId: row.parent_comment_id ?? undefined,
          authorName: row.author_display_name ?? '',
          content: row.text_content ?? '',
          likeCount: row.like_count,
        }));
      },

      insertComment: async (postExternalId: string, comment: LinkedInComment): Promise<void> => {
        // Resolve parent comment ID if this is a reply
        let parentClause = 'NULL';
        const params: unknown[] = [
          postExternalId,
          instanceId,
          comment.externalId,
          comment.authorName,
          comment.authorProfileUrl ?? comment.authorName,
          comment.content,
          comment.likeCount ?? 0,
        ];

        if (comment.parentCommentId) {
          parentClause = `(SELECT sc2.id FROM social_comments sc2
                           JOIN social_posts sp2 ON sc2.post_id = sp2.id
                           WHERE sp2.instance_id = $8 AND sp2.external_id = $9
                             AND sc2.external_id = $10
                           LIMIT 1)`;
          params.push(instanceId, postExternalId, comment.parentCommentId);
        }

        await db.execute(
          `INSERT INTO social_comments
            (post_id, parent_comment_id, external_id, author_display_name,
             author_platform_user_id, text_content, like_count, last_synced_at)
           SELECT sp.id, ${parentClause}, $3, $4, $5, $6, $7, NOW()
           FROM social_posts sp
           WHERE sp.instance_id = $2 AND sp.external_id = $1
           LIMIT 1`,
          params,
        );
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────

  /**
   * Parse InstanceConfig into LinkedInInstanceConfig with defaults.
   */
  private parseConfig(config: InstanceConfig): LinkedInInstanceConfig {
    const opts = config.options ?? {};
    const creds = config.credentials ?? {};

    return {
      browserDataPath: (creds.browserDataPath as string) ?? (opts.browserDataPath as string) ?? '.browser_data',
      syncIntervals: {
        ...DEFAULT_SYNC_INTERVALS,
        ...(opts.syncIntervals as Partial<SyncIntervalsConfig> | undefined),
      },
      rateLimits: {
        ...DEFAULT_RATE_LIMITS,
        ...(opts.rateLimits as Partial<RateLimitsConfig> | undefined),
      },
      activeHours: {
        ...DEFAULT_ACTIVE_HOURS,
        ...(opts.activeHours as Partial<ActiveHoursConfig> | undefined),
      },
      headless: (opts.headless as boolean | undefined) ?? true,
      viewportWidth: (opts.viewportWidth as number | undefined) ?? 1280,
      viewportHeight: (opts.viewportHeight as number | undefined) ?? 900,
      locale: (opts.locale as string | undefined) ?? 'pt-BR',
    };
  }

  /**
   * Get instance state or throw if not connected.
   */
  private requireState(instanceId: string): InstanceState {
    const state = this.instanceStates.get(instanceId);
    if (!state) {
      throw new Error(`LinkedIn instance '${instanceId}' is not connected`);
    }
    return state;
  }
}
