/**
 * LinkedIn DOM Scrapers — barrel exports.
 *
 * Inbox scraper: ported from linkedin-agent Python scripts (scan_raw.py,
 * read_full.py, list_names.py).
 *
 * Feed, comments, profile, connections scrapers: NEW implementations
 * following the same DOM parsing patterns.
 */

// Inbox (ported from scan_raw.py, read_full.py, list_names.py)
export {
  scrapeConversations,
  scrapeFullConversation,
  listConversationNames,
  switchTab,
} from './inbox';
export type {
  ScrapeConversationsOptions,
  ScrapeFullConversationOptions,
  InboxTab,
} from './inbox';

// Feed (NEW)
export { scrapeFeedPosts } from './feed';
export type { ScrapeFeedPostsOptions } from './feed';

// Comments (NEW)
export { scrapePostComments } from './comments';

// Profile (NEW)
export { scrapeProfile } from './profile';

// Connections (NEW)
export { scrapeConnections, scrapePendingInvites } from './connections';
