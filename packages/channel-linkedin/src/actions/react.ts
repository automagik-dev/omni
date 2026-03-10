/**
 * React Action — NEW (no Python equivalent)
 *
 * Reacts to a LinkedIn post with a specified reaction type.
 * Follows the same fill->click->verify pattern from reply.py.
 *
 * Flow:
 * 1. Hover over the reaction button on the post
 * 2. Wait for reaction picker to appear
 * 3. Click the appropriate reaction
 * 4. Return structured result
 */

import type { ElementHandle, Page } from 'playwright';
import type { RateLimiter } from '../browser/humanizer';
import { humanDelay } from '../browser/humanizer';
import { SELECTORS, findElement } from '../browser/selectors';
import type { ActionResult, LinkedInReactionType, ReactResult } from '../types';

// Pre-extract selector entry
const reactionButtonSel = SELECTORS.feed.reactionButton;

/**
 * Maps reaction types to their selectors in the LinkedIn reaction picker popup.
 * LinkedIn renders reactions as buttons with descriptive aria-labels.
 */
const REACTION_SELECTORS: Record<LinkedInReactionType, { primary: string; fallbacks: string[] }> = {
  like: {
    primary: 'button[aria-label*="Like" i]',
    fallbacks: ['.reactions-menu button:nth-child(1)', '[data-reaction-type="LIKE"]'],
  },
  celebrate: {
    primary: 'button[aria-label*="Celebrate" i]',
    fallbacks: ['.reactions-menu button:nth-child(2)', '[data-reaction-type="PRAISE"]'],
  },
  support: {
    primary: 'button[aria-label*="Support" i]',
    fallbacks: ['.reactions-menu button:nth-child(3)', '[data-reaction-type="EMPATHY"]'],
  },
  love: {
    primary: 'button[aria-label*="Love" i]',
    fallbacks: ['.reactions-menu button:nth-child(4)', '[data-reaction-type="INTEREST"]'],
  },
  insightful: {
    primary: 'button[aria-label*="Insightful" i]',
    fallbacks: ['.reactions-menu button:nth-child(5)', '[data-reaction-type="APPRECIATION"]'],
  },
  funny: {
    primary: 'button[aria-label*="Funny" i]',
    fallbacks: ['.reactions-menu button:nth-child(6)', '[data-reaction-type="ENTERTAINMENT"]'],
  },
};

/** Selector for the reaction picker popup */
const REACTION_PICKER = {
  primary: '.reactions-menu',
  fallbacks: ['[data-test-reactions-menu]', '.reactions-react-button__reaction-picker'],
};

/**
 * React to a LinkedIn post with a specific reaction type.
 *
 * @param page - Playwright Page instance
 * @param rateLimiter - RateLimiter instance to check reactionsPerHour
 * @param postElement - ElementHandle for the post container (.feed-shared-update-v2)
 * @param reactionType - Reaction to apply (like, celebrate, support, love, insightful, funny)
 * @param postId - External post identifier (for result tracking)
 */
export async function reactToPost(
  page: Page,
  rateLimiter: RateLimiter,
  postElement: ElementHandle,
  reactionType: LinkedInReactionType,
  postId: string,
): Promise<ActionResult<ReactResult>> {
  // Check rate limit before proceeding
  if (!rateLimiter.canPerform('reactionsPerHour')) {
    return {
      success: false,
      error: 'Rate limit exceeded for reactionsPerHour',
    };
  }

  // Step 1: Find and hover over the reaction button to trigger the picker
  let hovered = false;
  const reactionBtn = await postElement.$(reactionButtonSel.primary);
  if (reactionBtn) {
    await reactionBtn.hover();
    hovered = true;
  } else {
    for (const fallback of reactionButtonSel.fallbacks) {
      const btn = await postElement.$(fallback);
      if (btn) {
        await btn.hover();
        hovered = true;
        break;
      }
    }
  }

  if (!hovered) {
    return {
      success: false,
      error: 'Reaction button not found on post',
    };
  }

  await humanDelay('postClick');

  // Step 2: Wait for the reaction picker popup to appear
  const picker = await findElement(page, REACTION_PICKER, {
    timeout: 3000,
  });
  if (!picker) {
    return {
      success: false,
      error: 'Reaction picker did not appear after hovering',
    };
  }

  await humanDelay('postClick');

  // Step 3: Click the appropriate reaction
  const reactionEntry = REACTION_SELECTORS[reactionType];
  const reactionEl = await findElement(page, reactionEntry, {
    timeout: 3000,
  });
  if (!reactionEl) {
    return {
      success: false,
      error: `Reaction '${reactionType}' button not found in picker`,
    };
  }

  await reactionEl.click();
  await humanDelay('postClick');

  // Record the action after success
  rateLimiter.record('reactionsPerHour');

  // Step 4: Return result
  return {
    success: true,
    data: {
      reactionType,
      postId,
    },
  };
}
