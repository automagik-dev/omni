/**
 * Create Post Action — NEW (no Python equivalent)
 *
 * Flow:
 * 1. Navigate to feed if not already there
 * 2. Click "Start a post" button
 * 3. Wait for post editor to appear
 * 4. Type text using typeText() (character-by-character)
 * 5. Click Post button
 * 6. Return structured result
 */

import type { Page } from 'playwright';
import type { RateLimiter } from '../browser/humanizer';
import { humanDelay, typeText } from '../browser/humanizer';
import { SELECTORS, findElement } from '../browser/selectors';
import type { ActionResult, CreatePostResult } from '../types';

// Pre-extract selector entries to avoid index-signature optionality issues
const startPostButtonSel = SELECTORS.compose.startPostButton;
const postEditorSel = SELECTORS.compose.postEditor;
const postButtonSel = SELECTORS.compose.postButton;

/**
 * Create a new LinkedIn post.
 *
 * @param page - Playwright Page instance
 * @param rateLimiter - RateLimiter instance to check postsPerDay
 * @param text - Post content text
 */
export async function createPost(
  page: Page,
  rateLimiter: RateLimiter,
  text: string,
): Promise<ActionResult<CreatePostResult>> {
  // Check rate limit before proceeding
  if (!rateLimiter.canPerform('postsPerDay')) {
    return {
      success: false,
      error: 'Rate limit exceeded for postsPerDay',
    };
  }

  // Step 1: Ensure we are on the feed page
  const currentUrl = page.url();
  if (!currentUrl.includes('/feed')) {
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
    });
    await humanDelay('navigation');
  }

  // Step 2: Click "Start a post" button
  const startPostBtn = await findElement(page, startPostButtonSel, {
    timeout: 5000,
  });
  if (!startPostBtn) {
    return {
      success: false,
      error: 'Start a post button not found',
    };
  }

  await startPostBtn.click();
  await humanDelay('postClick');

  // Step 3: Wait for post editor to appear
  const editor = await findElement(page, postEditorSel, {
    timeout: 5000,
  });
  if (!editor) {
    return {
      success: false,
      error: 'Post editor not found after clicking Start a post',
    };
  }

  // Step 4: Type text using typeText for human-like input
  const editorSelector = await resolveWorkingSelector(page, postEditorSel);
  if (!editorSelector) {
    return {
      success: false,
      error: 'Could not resolve post editor selector',
    };
  }
  await typeText(page, editorSelector, text);
  await humanDelay('postClick');

  // Step 5: Click Post button
  const postBtn = await findElement(page, postButtonSel, {
    timeout: 5000,
  });
  if (!postBtn) {
    return {
      success: false,
      error: 'Post submit button not found',
    };
  }

  await postBtn.click();
  await humanDelay('navigation');

  // Record the action after success
  rateLimiter.record('postsPerDay');

  // Step 6: Return result
  return {
    success: true,
    data: {
      postUrl: undefined, // URL not easily extractable right after posting
    },
  };
}

/**
 * Resolve the first working CSS selector from a SelectorEntry.
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
