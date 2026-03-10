/**
 * Connection Actions — NEW (no Python equivalent)
 *
 * Send connection requests and accept pending invitations on LinkedIn.
 * Follows the same fill->click->verify pattern from reply.py.
 */

import type { ElementHandle, Page } from 'playwright';
import type { RateLimiter } from '../browser/humanizer';
import { humanDelay, typeText } from '../browser/humanizer';
import { findElement } from '../browser/selectors';
import type { ActionResult, ConnectResult } from '../types';

// ---------------------------------------------------------------------------
// Selectors for connection actions
// ---------------------------------------------------------------------------

/** Connect button on a profile page */
const CONNECT_BUTTON = {
  primary: 'button[aria-label*="Connect" i]',
  fallbacks: ['.pvs-profile-actions button:has-text("Connect")', 'button.pv-s-profile-actions--connect'],
};

/** "Add a note" button in the connection invite dialog */
const ADD_NOTE_BUTTON = {
  primary: 'button[aria-label*="Add a note" i]',
  fallbacks: ['.send-invite button:has-text("Add a note")', '.artdeco-modal button:has-text("Add a note")'],
};

/** Note textarea in the connection invite dialog */
const NOTE_INPUT = {
  primary: 'textarea[name="message"]',
  fallbacks: ['.send-invite textarea', '#custom-message', '.artdeco-modal textarea'],
};

/** Send invite / Send now button */
const SEND_INVITE_BUTTON = {
  primary: 'button[aria-label*="Send" i]',
  fallbacks: ['.artdeco-modal button:has-text("Send")', '.send-invite button[type="submit"]'],
};

/** Profile name element on a profile page */
const PROFILE_NAME = {
  primary: '.text-heading-xlarge',
  fallbacks: ['h1.inline', '.pv-top-card--list li:first-child'],
};

/** Pending invite accept button in invitation card */
const ACCEPT_BUTTON = {
  primary: 'button[aria-label*="Accept" i]',
  fallbacks: ['.invitation-card__action-btn:has-text("Accept")', 'button.artdeco-button--secondary:has-text("Accept")'],
};

/** Invitation card element */
const INVITATION_CARD = {
  primary: '.invitation-card',
  fallbacks: ['.mn-invitation-list li', '[data-test-invitation-card]'],
};

/** Invitation card name */
const INVITATION_NAME = {
  primary: '.invitation-card__title',
  fallbacks: ['.invitation-card__tvm-title', '.mn-invitation-list .artdeco-entity-lockup__title'],
};

// ---------------------------------------------------------------------------
// Send Connection Request
// ---------------------------------------------------------------------------

/**
 * Send a connection request to a LinkedIn profile.
 *
 * @param page - Playwright Page instance
 * @param rateLimiter - RateLimiter instance to check connectionsPerDay
 * @param profileUrl - Full LinkedIn profile URL to connect with
 * @param message - Optional personalized note to include with the request
 */
export async function sendConnectionRequest(
  page: Page,
  rateLimiter: RateLimiter,
  profileUrl: string,
  message?: string,
): Promise<ActionResult<ConnectResult>> {
  // Check rate limit before proceeding
  if (!rateLimiter.canPerform('connectionsPerDay')) {
    return {
      success: false,
      error: 'Rate limit exceeded for connectionsPerDay',
    };
  }

  // Step 1: Navigate to the profile
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay('navigation');
  } catch {
    return {
      success: false,
      error: `Failed to navigate to profile: ${profileUrl}`,
    };
  }

  // Get the profile name for the result
  const nameEl = await findElement(page, PROFILE_NAME, { timeout: 5000 });
  const profileName = nameEl ? (await nameEl.innerText()).trim() : profileUrl;

  // Step 2: Click Connect button
  const connectBtn = await findElement(page, CONNECT_BUTTON, { timeout: 5000 });
  if (!connectBtn) {
    return {
      success: false,
      error: 'Connect button not found on profile page (may already be connected)',
    };
  }

  await connectBtn.click();
  await humanDelay('postClick');

  // Step 3: Optionally add a personalized message
  if (message) {
    const addNoteBtn = await findElement(page, ADD_NOTE_BUTTON, { timeout: 3000 });
    if (addNoteBtn) {
      await addNoteBtn.click();
      await humanDelay('postClick');

      // Find and fill the note textarea
      const noteSelector = await resolveWorkingSelector(page, NOTE_INPUT);
      if (noteSelector) {
        await typeText(page, noteSelector, message);
        await humanDelay('postClick');
      }
    }
  }

  // Step 4: Click Send
  const sendBtn = await findElement(page, SEND_INVITE_BUTTON, { timeout: 3000 });
  if (!sendBtn) {
    return {
      success: false,
      error: 'Send invite button not found in dialog',
    };
  }

  await sendBtn.click();
  await humanDelay('postClick');

  // Record the action after success
  rateLimiter.record('connectionsPerDay');

  return {
    success: true,
    data: {
      profileName,
      action: 'sent',
    },
  };
}

// ---------------------------------------------------------------------------
// Accept Connection Request
// ---------------------------------------------------------------------------

/**
 * Query multiple elements using primary selector with fallbacks.
 * Returns the first non-empty result set.
 */
async function queryAllWithFallbacks(
  container: Page | ElementHandle,
  entry: { primary: string; fallbacks: string[] },
): Promise<ElementHandle[]> {
  const results = await container.$$(entry.primary);
  if (results.length > 0) return results;
  for (const fallback of entry.fallbacks) {
    const fbResults = await container.$$(fallback);
    if (fbResults.length > 0) return fbResults;
  }
  return [];
}

/**
 * Query a single element using primary selector with fallbacks.
 */
async function queryWithFallbacks(
  container: ElementHandle,
  entry: { primary: string; fallbacks: string[] },
): Promise<ElementHandle | null> {
  const el = await container.$(entry.primary);
  if (el) return el;
  for (const fallback of entry.fallbacks) {
    const fbEl = await container.$(fallback);
    if (fbEl) return fbEl;
  }
  return null;
}

/**
 * Navigate to the invitation manager page.
 * Returns an error message on failure, or null on success.
 */
async function navigateToInvitations(page: Page): Promise<string | null> {
  try {
    await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/', {
      waitUntil: 'domcontentloaded',
    });
    await humanDelay('navigation');
    return null;
  } catch {
    return 'Failed to navigate to invitation manager';
  }
}

/**
 * Scroll the page to load more invitation cards.
 */
async function scrollToLoadInvitations(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.scrollBy(0, 500)');
    await humanDelay('scroll');
  }
}

/**
 * Accept a pending connection request by name.
 *
 * Uses case-insensitive substring matching (same pattern as reply.py and archive_batch.py).
 *
 * @param page - Playwright Page instance
 * @param rateLimiter - RateLimiter instance to check connectionsPerDay
 * @param name - Name of the person whose invite to accept (case-insensitive substring)
 */
export async function acceptConnectionRequest(
  page: Page,
  rateLimiter: RateLimiter,
  name: string,
): Promise<ActionResult<ConnectResult>> {
  if (!rateLimiter.canPerform('connectionsPerDay')) {
    return { success: false, error: 'Rate limit exceeded for connectionsPerDay' };
  }

  const navError = await navigateToInvitations(page);
  if (navError) {
    return { success: false, error: navError };
  }

  await scrollToLoadInvitations(page);

  const cards = await queryAllWithFallbacks(page, INVITATION_CARD);

  for (const card of cards) {
    const result = await tryAcceptCard(card, name, rateLimiter);
    if (result) return result;
  }

  return { success: false, error: `No pending invitation from '${name}' found` };
}

/**
 * Attempt to accept a single invitation card if it matches the target name.
 * Returns an ActionResult if the card matches (success or failure), or null to skip.
 */
async function tryAcceptCard(
  card: ElementHandle,
  name: string,
  rateLimiter: RateLimiter,
): Promise<ActionResult<ConnectResult> | null> {
  const cardNameEl = await queryWithFallbacks(card, INVITATION_NAME);
  if (!cardNameEl) return null;

  const cardName = (await cardNameEl.innerText()).trim();
  if (!cardName.toLowerCase().includes(name.toLowerCase())) return null;

  const acceptBtn = await queryWithFallbacks(card, ACCEPT_BUTTON);
  if (!acceptBtn) {
    return { success: false, error: `Found invitation from '${cardName}' but Accept button not found` };
  }

  await acceptBtn.click();
  await humanDelay('postClick');
  rateLimiter.record('connectionsPerDay');

  return { success: true, data: { profileName: cardName, action: 'accepted' } };
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
