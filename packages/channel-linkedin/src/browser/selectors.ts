/**
 * Centralized Selector Registry for LinkedIn DOM elements.
 *
 * Primary selectors are sourced from the proven linkedin-agent Python scripts.
 * Each entry includes the source file reference and 1-2 fallback alternatives
 * using aria-roles or data-attribute patterns.
 *
 * When LinkedIn updates their DOM, update the primary selector and shift the
 * old primary into fallbacks. This keeps the fallback chain historically aware.
 */

import type { ElementHandle, Page } from 'playwright';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectorEntry {
  /** The proven selector from linkedin-agent scripts */
  primary: string;
  /** Fallback selectors (aria-role, data-attribute, structural alternatives) */
  fallbacks: string[];
}

// ---------------------------------------------------------------------------
// Typed selector groups (explicit properties, no index signature)
// ---------------------------------------------------------------------------

export interface InboxSelectorGroup {
  conversationList: SelectorEntry;
  conversationItem: SelectorEntry;
  participantNames: SelectorEntry;
  messageContent: SelectorEntry;
  messageInput: SelectorEntry;
  sendButton: SelectorEntry;
  tabRow: SelectorEntry;
}

export interface FeedSelectorGroup {
  postContainer: SelectorEntry;
  postContent: SelectorEntry;
  postAuthor: SelectorEntry;
  reactionButton: SelectorEntry;
  commentButton: SelectorEntry;
  likeCount: SelectorEntry;
  commentCount: SelectorEntry;
}

export interface ComposeSelectorGroup {
  startPostButton: SelectorEntry;
  postEditor: SelectorEntry;
  postButton: SelectorEntry;
}

// ---------------------------------------------------------------------------
// Inbox Selectors — sourced from scan_raw.py, reply.py, list_names.py, read_full.py
// ---------------------------------------------------------------------------

const inbox: InboxSelectorGroup = {
  /** Scrollable conversation list container — scan_raw.py line 28 */
  conversationList: {
    primary: '.msg-conversations-container__conversations-list',
    fallbacks: ['[data-test-conversations-list]', '.msg-conversations-container ul'],
  },

  /** Individual conversation item — scan_raw.py line 33 */
  conversationItem: {
    primary: 'li.msg-conversation-listitem',
    fallbacks: ['[data-test-conversation-item]', '.msg-conversations-container li'],
  },

  /** Participant name(s) inside conversation item — scan_raw.py line 94 */
  participantNames: {
    primary: '.msg-conversation-listitem__participant-names',
    fallbacks: ['[data-test-participant-names]', '.msg-conversation-card__participant-names'],
  },

  /** Message list content area (thread body) — scan_raw.py line 50 */
  messageContent: {
    primary: '.msg-s-message-list-content',
    fallbacks: ['.msg-thread', '[data-test-message-list]'],
  },

  /** Message input field — reply.py line 59 */
  messageInput: {
    primary: '.msg-form__contenteditable',
    fallbacks: ['[role="textbox"]', '.msg-form [contenteditable="true"]'],
  },

  /** Send button — reply.py line 64 */
  sendButton: {
    primary: '.msg-form__send-button',
    fallbacks: ['button[type="submit"]', '.msg-form__send-btn'],
  },

  /** Tab navigation row — list_names.py line 22 */
  tabRow: {
    primary: '.msg-conversations-container__title-row',
    fallbacks: ['[data-test-tab-row]', '.msg-tab-container'],
  },
};

// ---------------------------------------------------------------------------
// Feed Selectors — NEW (no Python equivalent)
// ---------------------------------------------------------------------------

const feed: FeedSelectorGroup = {
  /** Individual post container */
  postContainer: {
    primary: '.feed-shared-update-v2',
    fallbacks: ['[data-test-feed-post]'],
  },

  /** Post text content */
  postContent: {
    primary: '.feed-shared-update-v2__description',
    fallbacks: ['.update-components-text'],
  },

  /** Post author name */
  postAuthor: {
    primary: '.update-components-actor__name',
    fallbacks: ['.feed-shared-actor__name'],
  },

  /** Reaction (like) button */
  reactionButton: {
    primary: '.reactions-react-button',
    fallbacks: ['[data-test-react-button]'],
  },

  /** Comment button */
  commentButton: {
    primary: '.comment-button',
    fallbacks: ['[data-test-comment-button]'],
  },

  /** Like/reaction count */
  likeCount: {
    primary: '.social-details-social-counts__reactions-count',
    fallbacks: ['[data-test-like-count]'],
  },

  /** Comment count */
  commentCount: {
    primary: '.social-details-social-counts__comments',
    fallbacks: ['[data-test-comment-count]'],
  },
};

// ---------------------------------------------------------------------------
// Compose Selectors — NEW (no Python equivalent)
// ---------------------------------------------------------------------------

const compose: ComposeSelectorGroup = {
  /** "Start a post" trigger button */
  startPostButton: {
    primary: '.share-box-feed-entry__trigger',
    fallbacks: ['[data-test-share-box]'],
  },

  /** Rich text editor for post content */
  postEditor: {
    primary: '.ql-editor',
    fallbacks: ['[data-test-post-editor]', '[role="textbox"]'],
  },

  /** "Post" submit button */
  postButton: {
    primary: '.share-actions__primary-action',
    fallbacks: ['button[data-test-post-button]'],
  },
};

// ---------------------------------------------------------------------------
// Consolidated Registry
// ---------------------------------------------------------------------------

export const SELECTORS = {
  inbox,
  feed,
  compose,
} as const;

// ---------------------------------------------------------------------------
// Selector Resolution Helper
// ---------------------------------------------------------------------------

/**
 * Try the primary selector first, then each fallback in order.
 * Returns the first matching ElementHandle, or null if none match.
 *
 * @param page - Playwright Page instance
 * @param entry - SelectorEntry with primary + fallbacks
 * @param options - Optional timeout for waiting (default: no wait, immediate check)
 */
export async function findElement(
  page: Page,
  entry: SelectorEntry,
  options?: { timeout?: number },
): Promise<ElementHandle | null> {
  const allSelectors = [entry.primary, ...entry.fallbacks];

  for (const selector of allSelectors) {
    try {
      if (options?.timeout) {
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout: options.timeout });
        const handle = await locator.elementHandle();
        if (handle) return handle;
      } else {
        const handle = await page.$(selector);
        if (handle) return handle;
      }
    } catch {
      // Selector didn't match or timed out, try next
    }
  }

  return null;
}

/**
 * Build a combined CSS selector string from a SelectorEntry (primary + fallbacks).
 * Useful for Playwright's locator() which accepts comma-separated selectors.
 *
 * @param entry - SelectorEntry with primary + fallbacks
 * @returns Comma-separated selector string
 */
export function combinedSelector(entry: SelectorEntry): string {
  return [entry.primary, ...entry.fallbacks].join(', ');
}

/**
 * Check if any selector in the entry matches an element on the page.
 * Non-blocking — returns immediately.
 *
 * @param page - Playwright Page instance
 * @param entry - SelectorEntry to check
 * @returns true if at least one selector matches
 */
export async function selectorExists(page: Page, entry: SelectorEntry): Promise<boolean> {
  const el = await findElement(page, entry);
  return el !== null;
}
