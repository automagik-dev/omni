/**
 * Browser automation layer for LinkedIn.
 *
 * Re-exports the BrowserManager, selector registry, and humanizer utilities.
 */

export { BrowserManager } from './manager';
export type { BrowserConfig } from './manager';

export {
  SELECTORS,
  findElement,
  combinedSelector,
  selectorExists,
} from './selectors';
export type { SelectorEntry, InboxSelectorGroup, FeedSelectorGroup, ComposeSelectorGroup } from './selectors';

export {
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
} from './humanizer';
export type { TimingKey } from './humanizer';
