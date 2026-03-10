/**
 * Inbox Scraper — ported from linkedin-agent Python scripts.
 *
 * Sources:
 * - scan_raw.py: scroll_conversation_list(), read_conversation(), main loop
 * - read_full.py: full conversation history via scroll-up
 * - list_names.py: tab handling (Focused, InMail, Other)
 *
 * All DOM queries go through findElement() / SELECTORS from the centralized
 * selector registry. All waits use humanDelay() from the humanizer.
 */

import type { Page } from 'playwright';
import { CONVERSATION_SCROLL_MAX, HISTORY_SCROLL_UP, exactDelay, humanDelay } from '../browser/humanizer';
import { SELECTORS, combinedSelector, findElement } from '../browser/selectors';
import type { LinkedInConversation, LinkedInMessage } from '../types';

// ---------------------------------------------------------------------------
// Shorthand references to avoid repeated index access
// ---------------------------------------------------------------------------

const SEL = {
  conversationList: SELECTORS.inbox.conversationList,
  conversationItem: SELECTORS.inbox.conversationItem,
  participantNames: SELECTORS.inbox.participantNames,
  messageContent: SELECTORS.inbox.messageContent,
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ScrapeConversationsOptions {
  /** Maximum number of conversations to read (default: 20) */
  limit?: number;
  /** Maximum number of recent message lines to keep per conversation (default: 15) */
  maxMessagesPerConvo?: number;
}

export interface ScrapeFullConversationOptions {
  /** Number of scroll-up iterations to load older messages (default: 5) */
  scrollUpIterations?: number;
}

export type InboxTab = 'Focused' | 'InMail' | 'Other';

// ---------------------------------------------------------------------------
// Internal: inline helper for evaluate() — extracts innerText in browser ctx
// ---------------------------------------------------------------------------

/** Evaluate expression to extract innerText. Pass to ElementHandle.evaluate(). */
const EVAL_INNER_TEXT = (el: { innerText?: string }) => el.innerText?.trim() ?? '';

// ---------------------------------------------------------------------------
// Internal: scroll conversation list — ported from scan_raw.py line 27-39
// ---------------------------------------------------------------------------

/**
 * Scroll the conversation sidebar to load more items.
 * Ported from scan_raw.py scroll_conversation_list().
 *
 * Scrolls up to CONVERSATION_SCROLL_MAX (20) iterations, stopping early
 * if the item count stops growing or reaches targetCount.
 */
async function scrollConversationList(page: Page, targetCount: number): Promise<void> {
  const convList = await findElement(page, SEL.conversationList);
  if (!convList) return;

  let prevCount = 0;

  for (let i = 0; i < CONVERSATION_SCROLL_MAX; i++) {
    const items = await page.$$(combinedSelector(SEL.conversationItem));
    const current = items.length;

    if (current >= targetCount || current === prevCount) {
      break;
    }

    prevCount = current;

    // scan_raw.py: conv_list.first.evaluate("el => el.scrollTop = el.scrollHeight")
    await convList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    await humanDelay('scroll');
  }
}

// ---------------------------------------------------------------------------
// Internal: read a single conversation — ported from scan_raw.py line 42-58
// ---------------------------------------------------------------------------

/**
 * Click a conversation item, extract message text, return it.
 * Ported from scan_raw.py read_conversation().
 *
 * Flow: scroll into view → click → wait 2500ms → extract inner text →
 * take last N lines.
 */
async function readConversation(page: Page, item: Awaited<ReturnType<Page['$']>>, maxLines: number): Promise<string> {
  if (!item) return '';

  // scan_raw.py: item.scroll_into_view_if_needed()
  await item.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await exactDelay(500);

  // scan_raw.py: item.click()
  await item.click();

  // scan_raw.py: page.wait_for_timeout(2500)
  await humanDelay('messageLoad');

  // scan_raw.py: try multiple selectors for message content
  const messageContent = await findElement(page, SEL.messageContent);
  if (!messageContent) return '';

  const fullText: string = await messageContent.evaluate(EVAL_INNER_TEXT);

  if (!fullText) return '';

  // scan_raw.py: lines[-15:]
  const lines = fullText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.slice(-maxLines).join('\n');
}

// ---------------------------------------------------------------------------
// Internal: extract participant name from a conversation item
// ---------------------------------------------------------------------------

async function extractParticipantName(item: Awaited<ReturnType<Page['$']>>): Promise<string> {
  if (!item) return '';

  // Try primary selector first
  const nameEl = await item.$(SEL.participantNames.primary);
  if (nameEl) {
    const text = await nameEl.evaluate(EVAL_INNER_TEXT);
    if (text) return text;
  }

  // Try fallbacks
  for (const fb of SEL.participantNames.fallbacks) {
    const fbEl = await item.$(fb);
    if (fbEl) {
      const text = await fbEl.evaluate(EVAL_INNER_TEXT);
      if (text) return text;
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// scrapeConversations — ported from scan_raw.py main()
// ---------------------------------------------------------------------------

/**
 * Scrape conversations from the LinkedIn messaging inbox.
 * Ported from scan_raw.py main loop.
 *
 * Flow (matches scan_raw.py exactly):
 * 1. Scroll conversation list (20 iterations) to load items
 * 2. For each conversation:
 *    a. Extract sender name from DOM
 *    b. Click conversation item
 *    c. Wait for messages to load
 *    d. Extract last 15 lines of text
 *    e. Check if list is still visible; if not, navigate back
 *
 * @param page - Playwright Page (must already be on /messaging/)
 * @param options - Scraping options
 * @returns Array of conversations with sender and message text
 */
export async function scrapeConversations(
  page: Page,
  options?: ScrapeConversationsOptions,
): Promise<LinkedInConversation[]> {
  const limit = options?.limit ?? 20;
  const maxLines = options?.maxMessagesPerConvo ?? 15;

  // Step 1: Scroll to load conversations — scan_raw.py line 79
  await scrollConversationList(page, limit);

  // Step 2: Get all conversation items — scan_raw.py line 81-82
  let items = await page.$$(combinedSelector(SEL.conversationItem));
  const total = Math.min(items.length, limit);

  const results: LinkedInConversation[] = [];

  // Step 3: Iterate and read each conversation — scan_raw.py lines 88-118
  for (let i = 0; i < total; i++) {
    // Re-query items each iteration (DOM may have changed) — scan_raw.py line 89
    items = await page.$$(combinedSelector(SEL.conversationItem));
    if (i >= items.length) break;

    const item = items[i] as Awaited<ReturnType<Page['$']>>;

    // Extract sender name — scan_raw.py lines 94-97
    const sender = await extractParticipantName(item);
    if (!sender) continue;

    // Read conversation messages — scan_raw.py line 99
    const message = await readConversation(page, item, maxLines);

    results.push({
      externalId: String(i),
      participantNames: [sender],
      lastMessagePreview: message || undefined,
    });

    // Check if conversation list is still visible — scan_raw.py lines 113-118
    const convList = await findElement(page, SEL.conversationList);
    if (!convList) {
      // List disappeared, need to go back
      // scan_raw.py: goto_messaging(page) + scroll_conversation_list(page, LIMIT)
      await page.goto('https://www.linkedin.com/messaging/', {
        waitUntil: 'domcontentloaded',
      });
      await humanDelay('navigation');
      await scrollConversationList(page, limit);
    } else {
      const box = await convList.boundingBox();
      const isVisible = box !== null;
      if (!isVisible) {
        await page.goto('https://www.linkedin.com/messaging/', {
          waitUntil: 'domcontentloaded',
        });
        await humanDelay('navigation');
        await scrollConversationList(page, limit);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// scrapeFullConversation — ported from read_full.py
// ---------------------------------------------------------------------------

/**
 * Open a conversation by name and load full message history.
 * Ported from read_full.py.
 *
 * Flow:
 * 1. Scroll conversation list to load items
 * 2. Find conversation by case-insensitive substring match on participant name
 * 3. Click to open
 * 4. Scroll message thread upward (5 iterations) to load older messages
 * 5. Extract all text
 *
 * @param page - Playwright Page (must already be on /messaging/)
 * @param name - Target participant name (case-insensitive substring match)
 * @param options - Scroll options
 * @returns Array of messages extracted from the conversation
 */
export async function scrapeFullConversation(
  page: Page,
  name: string,
  options?: ScrapeFullConversationOptions,
): Promise<LinkedInMessage[]> {
  const scrollIterations = options?.scrollUpIterations ?? HISTORY_SCROLL_UP;
  const lowerName = name.toLowerCase();

  // Scroll to load conversations — read_full.py lines 30-40
  await scrollConversationList(page, 100);

  // Find and click target conversation — read_full.py lines 42-51
  const items = await page.$$(combinedSelector(SEL.conversationItem));

  let targetItem: Awaited<ReturnType<Page['$']>> = null;
  let matchedName = '';

  for (const item of items) {
    const participantName = await extractParticipantName(item);
    if (!participantName) continue;

    // read_full.py: target.lower() not in name.lower() → case-insensitive substring
    if (participantName.toLowerCase().includes(lowerName)) {
      targetItem = item;
      matchedName = participantName;
      break;
    }
  }

  if (!targetItem) {
    return [];
  }

  // Click to open conversation — read_full.py line 50
  await targetItem.click();
  await humanDelay('navigation');

  // Scroll up to load full history — read_full.py lines 53-58
  const thread = await findElement(page, SEL.messageContent);
  if (thread) {
    for (let i = 0; i < scrollIterations; i++) {
      // read_full.py: thread.first.evaluate("el => el.scrollTop = 0")
      await thread.evaluate((el) => {
        el.scrollTop = 0;
      });
      await humanDelay('postClick');
    }
  }

  // Extract all text — read_full.py lines 60-67
  const messageContent = await findElement(page, SEL.messageContent);
  if (!messageContent) {
    return [];
  }

  const fullText: string = await messageContent.evaluate(EVAL_INNER_TEXT);

  if (!fullText) {
    return [];
  }

  // Parse lines into messages
  const lines = fullText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const messages: LinkedInMessage[] = lines.map((line, idx) => ({
    externalId: `${matchedName}-${idx}`,
    conversationId: matchedName,
    senderName: matchedName,
    body: line,
  }));

  return messages;
}

// ---------------------------------------------------------------------------
// listConversationNames — ported from list_names.py
// ---------------------------------------------------------------------------

/**
 * List all visible conversation names in the current inbox tab.
 * Ported from list_names.py lines 29-34.
 *
 * @param page - Playwright Page (must already be on /messaging/)
 * @returns Array of conversation participant names
 */
export async function listConversationNames(page: Page): Promise<string[]> {
  const items = await page.$$(combinedSelector(SEL.conversationItem));
  const names: string[] = [];

  for (const item of items) {
    const name = await extractParticipantName(item);
    if (name) {
      names.push(name);
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// switchTab — ported from list_names.py tab handling
// ---------------------------------------------------------------------------

/**
 * Switch between messaging tabs (Focused, InMail, Other).
 * Ported from list_names.py tab detection logic.
 *
 * Looks for button/link elements within the messaging container that
 * match the target tab name (case-insensitive).
 *
 * @param page - Playwright Page (must already be on /messaging/)
 * @param tab - Target tab name
 * @returns true if the tab was found and clicked
 */
export async function switchTab(page: Page, tab: InboxTab): Promise<boolean> {
  const lowerTab = tab.toLowerCase();

  // list_names.py: looks in .msg-conversations-container, .msg-focused-inbox,
  // .scaffold-layout__sidebar for button/link elements
  const tabSelectors = [
    '.msg-conversations-container button',
    '.msg-conversations-container a',
    '.msg-focused-inbox button',
    '.msg-focused-inbox a',
    '.scaffold-layout__sidebar button',
    '.scaffold-layout__sidebar a',
  ];

  for (const sel of tabSelectors) {
    const elements = await page.$$(sel);
    for (const el of elements) {
      const text = await el.evaluate(EVAL_INNER_TEXT);
      if (text.toLowerCase().includes(lowerTab)) {
        await el.click();
        await humanDelay('navigation');
        return true;
      }
    }
  }

  return false;
}
