/**
 * LinkedIn-specific types for the channel-linkedin plugin.
 *
 * These types represent LinkedIn entities as scraped from the DOM
 * and stored in the social DB tables.
 */

// ---------------------------------------------------------------------------
// Rate Limits
// ---------------------------------------------------------------------------

export interface RateLimitsConfig {
  messagesPerHour: number;
  profileViewsPerHour: number;
  connectionsPerDay: number;
  postsPerDay: number;
  commentsPerHour: number;
  reactionsPerHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitsConfig = {
  messagesPerHour: 20,
  profileViewsPerHour: 50,
  connectionsPerDay: 25,
  postsPerDay: 5,
  commentsPerHour: 15,
  reactionsPerHour: 30,
};

// ---------------------------------------------------------------------------
// Active Hours
// ---------------------------------------------------------------------------

export interface ActiveHoursConfig {
  /** Hour of day to start (0-23) */
  start: number;
  /** Hour of day to stop (0-23) */
  end: number;
  /** IANA timezone, e.g. 'America/Sao_Paulo' */
  timezone: string;
}

// ---------------------------------------------------------------------------
// Sync Intervals (ms)
// ---------------------------------------------------------------------------

export interface SyncIntervalsConfig {
  feed: number;
  inbox: number;
  connections: number;
  engagement: number;
}

// ---------------------------------------------------------------------------
// Instance Configuration
// ---------------------------------------------------------------------------

export interface LinkedInInstanceConfig {
  /** Path to persistent Chromium user data directory */
  browserDataPath: string;
  /** Polling intervals in milliseconds */
  syncIntervals: SyncIntervalsConfig;
  /** Per-action rate limits */
  rateLimits: RateLimitsConfig;
  /** Operating window to avoid off-hours activity */
  activeHours: ActiveHoursConfig;
  /** Run browser in headless mode (default: true) */
  headless?: boolean;
  /** Browser viewport width (default: 1280) */
  viewportWidth?: number;
  /** Browser viewport height (default: 900) */
  viewportHeight?: number;
  /** Browser locale (default: 'pt-BR') */
  locale?: string;
}

// ---------------------------------------------------------------------------
// LinkedIn Entities
// ---------------------------------------------------------------------------

export type LinkedInReactionType = 'like' | 'celebrate' | 'support' | 'love' | 'insightful' | 'funny';

export interface LinkedInProfile {
  /** LinkedIn profile URL slug or ID */
  externalId: string;
  /** Display name */
  name: string;
  /** Headline / tagline */
  headline?: string;
  /** Profile picture URL */
  avatarUrl?: string;
  /** Profile page URL */
  profileUrl?: string;
  /** Current company / position */
  currentPosition?: string;
  /** Location string */
  location?: string;
  /** Number of connections */
  connectionCount?: number;
}

export interface LinkedInConversation {
  /** Internal index or identifier from DOM */
  externalId: string;
  /** Participant display names */
  participantNames: string[];
  /** Last message preview text */
  lastMessagePreview?: string;
  /** Whether the conversation has unread messages */
  isUnread?: boolean;
  /** Timestamp of the last activity */
  lastActivityAt?: number;
}

export interface LinkedInMessage {
  /** Unique identifier (constructed from conversation + index) */
  externalId: string;
  /** The conversation this message belongs to */
  conversationId: string;
  /** Sender display name */
  senderName: string;
  /** Message body text */
  body: string;
  /** Timestamp if extractable */
  timestamp?: number;
  /** Whether this message was sent by the connected account */
  isOutgoing?: boolean;
}

export interface LinkedInPost {
  /** Post URN or unique DOM identifier */
  externalId: string;
  /** Author display name */
  authorName: string;
  /** Author profile URL */
  authorProfileUrl?: string;
  /** Author avatar URL */
  authorAvatarUrl?: string;
  /** Post body text */
  content: string;
  /** Media attachments (image/video URLs) */
  mediaUrls?: string[];
  /** Hashtags extracted from content */
  hashtags?: string[];
  /** Post URL */
  postUrl?: string;
  /** Engagement counts */
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
  /** Timestamp */
  postedAt?: number;
  /** Scraped timestamp */
  scrapedAt: number;
}

export interface LinkedInComment {
  /** Comment identifier */
  externalId: string;
  /** Parent post ID */
  postId: string;
  /** Parent comment ID (for threaded replies) */
  parentCommentId?: string;
  /** Author display name */
  authorName: string;
  /** Author profile URL */
  authorProfileUrl?: string;
  /** Comment body text */
  content: string;
  /** Like count */
  likeCount?: number;
  /** Timestamp */
  postedAt?: number;
}

export interface LinkedInConnection {
  /** Profile identifier */
  externalId: string;
  /** Display name */
  name: string;
  /** Headline */
  headline?: string;
  /** Profile URL */
  profileUrl?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Connection status */
  status: 'connected' | 'pending_sent' | 'pending_received';
  /** When the connection was established */
  connectedAt?: number;
}

// ---------------------------------------------------------------------------
// Action Results
// ---------------------------------------------------------------------------

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SendMessageResult {
  sentTo: string;
  message: string;
}

export interface CreatePostResult {
  postUrl?: string;
}

export interface ReactResult {
  reactionType: LinkedInReactionType;
  postId: string;
}

export interface CommentResult {
  commentText: string;
  postId: string;
}

export interface ConnectResult {
  profileName: string;
  action: 'sent' | 'accepted' | 'rejected';
}
