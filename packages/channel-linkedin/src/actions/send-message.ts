/**
 * Send Message Action — ported from linkedin-agent/reply.py
 *
 * Flow (exact match to reply.py):
 * 1. Scroll conversation list to find target by name (case-insensitive substring)
 * 2. Click the matching conversation
 * 3. Wait for message input to appear
 * 4. Fill input using typeText() (character-by-character typing)
 * 5. Locate send button (.msg-form__send-button, fallback button[type='submit'])
 * 6. Click send
 * 7. Return structured result
 */

import type { Page } from 'playwright';
import type { RateLimiter } from '../browser/humanizer';
import { CONVERSATION_SCROLL_MAX, humanDelay, typeText } from '../browser/humanizer';
import { SELECTORS, findElement } from '../browser/selectors';
import type { ActionResult, SendMessageResult } from '../types';

// Pre-extract selector entries to avoid index-signature optionality issues
const conversationListSel = SELECTORS.inbox.conversationList;
const conversationItemSel = SELECTORS.inbox.conversationItem;
const participantNamesSel = SELECTORS.inbox.participantNames;
const messageInputSel = SELECTORS.inbox.messageInput;
const sendButtonSel = SELECTORS.inbox.sendButton;

/**
 * Scroll the conversation list to load more conversations.
 * Ported from reply.py lines 31-41.
 */
async function scrollConversationList(page: Page): Promise<void> {
  const convList = await findElement(page, conversationListSel);
  if (!convList) return;

  let prevCount = 0;
  for (let i = 0; i < CONVERSATION_SCROLL_MAX; i++) {
    const items = await page.$$(conversationItemSel.primary);
    const currentCount = items.length;
    if (currentCount === prevCount) break;
    prevCount = currentCount;
    await convList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await humanDelay('scroll');
  }
}

/**
 * Find a conversation item by recipient name (case-insensitive substring match).
 * Returns the matching item and the displayed name, or null if not found.
 */
async function findConversationByName(
  page: Page,
  recipientName: string,
): Promise<{ item: import('playwright').ElementHandle; name: string } | null> {
  const items = await page.$$(conversationItemSel.primary);
  for (const item of items) {
    const nameEl = await item.$(participantNamesSel.primary);
    if (!nameEl) continue;
    const name = (await nameEl.innerText()).trim();
    if (name.toLowerCase().includes(recipientName.toLowerCase())) {
      return { item, name };
    }
  }
  return null;
}

/**
 * Fill the message input and click send in the active conversation.
 * Returns an error string on failure, or null on success.
 */
async function fillAndSendMessage(page: Page, text: string): Promise<string | null> {
  const inputEl = await findElement(page, messageInputSel, { timeout: 5000 });
  if (!inputEl) return 'Message input field not found after clicking conversation';

  const inputSelector = await resolveWorkingSelector(page, messageInputSel);
  if (!inputSelector) return 'Could not resolve message input selector';

  await typeText(page, inputSelector, text);
  await humanDelay('postClick');

  const sendBtn = await findElement(page, sendButtonSel, { timeout: 3000 });
  if (!sendBtn) return 'Send button not found';

  await sendBtn.click();
  await humanDelay('postClick');
  return null;
}

/**
 * Send a message to a LinkedIn conversation by recipient name.
 *
 * Ported from reply.py — uses the same scroll->find->click->fill->send flow.
 * Name matching is case-insensitive substring (same as reply.py line 51).
 *
 * @param page - Playwright Page (must already be on messaging page)
 * @param rateLimiter - RateLimiter instance to check messagesPerHour
 * @param recipientName - Name to search for (case-insensitive substring match)
 * @param text - Message text to send
 */
export async function sendMessage(
  page: Page,
  rateLimiter: RateLimiter,
  recipientName: string,
  text: string,
): Promise<ActionResult<SendMessageResult>> {
  if (!rateLimiter.canPerform('messagesPerHour')) {
    return { success: false, error: 'Rate limit exceeded for messagesPerHour' };
  }

  await scrollConversationList(page);

  const match = await findConversationByName(page, recipientName);
  if (!match) {
    return { success: false, error: `Conversation with '${recipientName}' not found` };
  }

  await match.item.click();
  await humanDelay('messageLoad');

  const sendError = await fillAndSendMessage(page, text);
  if (sendError) {
    return { success: false, error: sendError };
  }

  rateLimiter.record('messagesPerHour');

  return {
    success: true,
    data: { sentTo: match.name, message: text },
  };
}

/**
 * Resolve the first working CSS selector from a SelectorEntry.
 * Returns the selector string (not the element) so it can be passed to typeText.
 */
async function resolveWorkingSelector(
  page: Page,
  entry: { primary: string; fallbacks: string[] },
): Promise<string | null> {
  const allSelectors = [entry.primary, ...entry.fallbacks];
  for (const selector of allSelectors) {
    const el = await page.$(selector);
    if (el) return selector;
  }
  return null;
}
