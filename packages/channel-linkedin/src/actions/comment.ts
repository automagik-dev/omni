/**
 * Comment Action — NEW (no Python equivalent)
 *
 * Posts a comment on a LinkedIn post. Follows the same fill->click->verify
 * pattern established in reply.py.
 *
 * Flow:
 * 1. Click the comment button on the post
 * 2. Wait for comment input to appear
 * 3. Type comment using typeText() (character-by-character)
 * 4. Submit comment
 * 5. Return structured result
 */

import type { ElementHandle, Page } from 'playwright';
import type { RateLimiter } from '../browser/humanizer';
import { humanDelay, typeText } from '../browser/humanizer';
import { SELECTORS, findElement } from '../browser/selectors';
import type { ActionResult, CommentResult } from '../types';

// Pre-extract selector entries
const commentButtonSel = SELECTORS.feed.commentButton;

/** Selector for the comment input field within a post's comment section */
const COMMENT_INPUT = {
  primary: '.ql-editor[data-placeholder]',
  fallbacks: [
    '.comments-comment-box__form .ql-editor',
    '[role="textbox"][aria-label*="comment" i]',
    '.comments-comment-texteditor .ql-editor',
  ],
};

/** Selector for the comment submit button */
const COMMENT_SUBMIT = {
  primary: '.comments-comment-box__submit-button',
  fallbacks: ['button.comments-comment-box__submit-button--cr', '.comments-comment-box button[type="submit"]'],
};

/**
 * Post a comment on a LinkedIn post.
 *
 * @param page - Playwright Page instance
 * @param rateLimiter - RateLimiter instance to check commentsPerHour
 * @param postElement - ElementHandle for the post container (.feed-shared-update-v2)
 * @param text - Comment text
 * @param postId - External post identifier (for result tracking)
 */
export async function postComment(
  page: Page,
  rateLimiter: RateLimiter,
  postElement: ElementHandle,
  text: string,
  postId: string,
): Promise<ActionResult<CommentResult>> {
  // Check rate limit before proceeding
  if (!rateLimiter.canPerform('commentsPerHour')) {
    return {
      success: false,
      error: 'Rate limit exceeded for commentsPerHour',
    };
  }

  // Step 1: Click the comment button on the post
  let clickedComment = false;
  const commentBtn = await postElement.$(commentButtonSel.primary);
  if (commentBtn) {
    await commentBtn.click();
    clickedComment = true;
  } else {
    for (const fallback of commentButtonSel.fallbacks) {
      const btn = await postElement.$(fallback);
      if (btn) {
        await btn.click();
        clickedComment = true;
        break;
      }
    }
  }

  if (!clickedComment) {
    return {
      success: false,
      error: 'Comment button not found on post',
    };
  }

  await humanDelay('postClick');

  // Step 2: Wait for comment input to appear
  const commentInput = await findElement(page, COMMENT_INPUT, {
    timeout: 5000,
  });
  if (!commentInput) {
    return {
      success: false,
      error: 'Comment input field not found',
    };
  }

  // Step 3: Type comment using typeText for human-like input
  const inputSelector = await resolveWorkingSelector(page, COMMENT_INPUT);
  if (!inputSelector) {
    return {
      success: false,
      error: 'Could not resolve comment input selector',
    };
  }
  await typeText(page, inputSelector, text);
  await humanDelay('postClick');

  // Step 4: Submit comment
  const submitBtn = await findElement(page, COMMENT_SUBMIT, {
    timeout: 3000,
  });
  if (!submitBtn) {
    // Fallback: press Enter to submit
    await page.keyboard.press('Enter');
  } else {
    await submitBtn.click();
  }

  await humanDelay('postClick');

  // Record the action after success
  rateLimiter.record('commentsPerHour');

  // Step 5: Return result
  return {
    success: true,
    data: {
      commentText: text,
      postId,
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
