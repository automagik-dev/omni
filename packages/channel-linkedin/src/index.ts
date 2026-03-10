/**
 * LinkedIn Channel Plugin for Omni v2
 *
 * Provides LinkedIn messaging, feed management, and social interactions
 * via Playwright browser automation.
 *
 * @example
 * ```typescript
 * import linkedInPlugin from '@omni/channel-linkedin';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * registry.register(linkedInPlugin);
 * ```
 */

import { LinkedInPlugin } from './plugin';

// Export the plugin instance (default export for auto-discovery)
const plugin = new LinkedInPlugin();
export default plugin;

// Named exports for the plugin class
export { LinkedInPlugin } from './plugin';

// Sync engine
export {
  diffByExternalId,
  FeedPoller,
  InboxPoller,
} from './sync';

export type {
  DiffResult,
  FeedPollerConfig,
  FeedPollerDataAccess,
  InboxPollerConfig,
} from './sync';

// Browser automation layer
export {
  BrowserManager,
  SELECTORS,
  findElement,
  combinedSelector,
  selectorExists,
  TIMING,
  NAV_RETRY_ATTEMPTS,
  NAV_RETRY_DELAY,
  CONVERSATION_SCROLL_MAX,
  HISTORY_SCROLL_UP,
  humanDelay,
  exactDelay,
  typeText,
  RateLimiter,
  isActiveHours,
} from './browser';

export type {
  BrowserConfig,
  SelectorEntry,
  InboxSelectorGroup,
  FeedSelectorGroup,
  ComposeSelectorGroup,
  TimingKey,
} from './browser';

// Actions (mutate state on LinkedIn)
export {
  sendMessage,
  createPost,
  postComment,
  reactToPost,
  sendConnectionRequest,
  acceptConnectionRequest,
} from './actions';

// DOM Scrapers
export {
  scrapeConversations,
  scrapeFullConversation,
  listConversationNames,
  switchTab,
  scrapeFeedPosts,
  scrapePostComments,
  scrapeProfile,
  scrapeConnections,
  scrapePendingInvites,
} from './scrapers';

export type {
  ScrapeConversationsOptions,
  ScrapeFullConversationOptions,
  InboxTab,
  ScrapeFeedPostsOptions,
} from './scrapers';

// LinkedIn types
export { DEFAULT_RATE_LIMITS } from './types';

export type {
  LinkedInInstanceConfig,
  LinkedInPost,
  LinkedInComment,
  LinkedInConnection,
  LinkedInConversation,
  LinkedInMessage,
  LinkedInProfile,
  LinkedInReactionType,
  RateLimitsConfig,
  ActiveHoursConfig,
  SyncIntervalsConfig,
  ActionResult,
  SendMessageResult,
  CreatePostResult,
  ReactResult,
  CommentResult,
  ConnectResult,
} from './types';
