/**
 * Profile Scraper — extracts the connected user's profile information.
 *
 * NEW scraper (no Python equivalent). Follows the same DOM parsing patterns
 * established in the inbox scraper (scan_raw.py port).
 *
 * All waits use humanDelay() from the humanizer.
 */

import type { Page } from 'playwright';
import { humanDelay } from '../browser/humanizer';
import type { LinkedInProfile } from '../types';

// ---------------------------------------------------------------------------
// Profile DOM selectors (structural — not in the centralized registry
// since profile pages have a distinct layout from feed/messaging)
// ---------------------------------------------------------------------------

interface ProfileSelectorEntry {
  primary: string;
  fallbacks: string[];
}

interface ProfileSelectors {
  name: ProfileSelectorEntry;
  headline: ProfileSelectorEntry;
  currentPosition: ProfileSelectorEntry;
  location: ProfileSelectorEntry;
  avatar: ProfileSelectorEntry;
  connectionCount: ProfileSelectorEntry;
}

const PROFILE_SELECTORS: ProfileSelectors = {
  /** Profile name (h1 on profile page) */
  name: {
    primary: 'h1.text-heading-xlarge',
    fallbacks: ['.pv-text-details--left-aligned h1', '.top-card-layout__title'],
  },
  /** Headline / tagline */
  headline: {
    primary: '.text-body-medium.break-words',
    fallbacks: ['.pv-text-details--left-aligned .text-body-medium', '.top-card-layout__headline'],
  },
  /** Current position */
  currentPosition: {
    primary: '.pv-text-details--right-panel .inline-show-more-text',
    fallbacks: ['.experience-item__title'],
  },
  /** Location */
  location: {
    primary: '.pv-text-details--left-aligned .text-body-small:last-child',
    fallbacks: ['.top-card-layout__first-subline'],
  },
  /** Profile photo */
  avatar: {
    primary: '.pv-top-card-profile-picture__image',
    fallbacks: ['.profile-photo-edit__preview', 'img.top-card-layout__entity-image'],
  },
  /** Connection count */
  connectionCount: {
    primary: '.pv-top-card--list .t-bold',
    fallbacks: ['[data-test-connection-count]'],
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const EVAL_INNER_TEXT = (el: { innerText?: string }) => el.innerText?.trim() ?? '';

async function extractText(page: Page, entry: ProfileSelectorEntry): Promise<string | undefined> {
  const allSelectors = [entry.primary, ...entry.fallbacks];

  for (const sel of allSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.evaluate(EVAL_INNER_TEXT);
        if (text) return text;
      }
    } catch {
      // Selector didn't match, try next
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// scrapeProfile
// ---------------------------------------------------------------------------

/**
 * Extract the connected user's profile information from the current page.
 *
 * The page should already be navigated to a LinkedIn profile URL
 * (e.g., https://www.linkedin.com/in/username/).
 *
 * @param page - Playwright Page (must already be on a profile page)
 * @returns Structured profile data
 */
export async function scrapeProfile(page: Page): Promise<LinkedInProfile> {
  // Wait for profile content to load
  await humanDelay('navigation');

  // Extract profile URL from the current page
  const profileUrl = page.url();
  const urlMatch = profileUrl.match(/\/in\/([^/]+)/);
  const externalId = urlMatch ? (urlMatch[1] as string) : profileUrl;

  // Name
  const name = (await extractText(page, PROFILE_SELECTORS.name)) ?? '';

  // Headline
  const headline = await extractText(page, PROFILE_SELECTORS.headline);

  // Current position
  const currentPosition = await extractText(page, PROFILE_SELECTORS.currentPosition);

  // Location
  const location = await extractText(page, PROFILE_SELECTORS.location);

  // Avatar URL
  let avatarUrl: string | undefined;
  const avatarEntry = PROFILE_SELECTORS.avatar;
  const allAvatarSelectors = [avatarEntry.primary, ...avatarEntry.fallbacks];
  for (const sel of allAvatarSelectors) {
    try {
      const img = await page.$(sel);
      if (img) {
        avatarUrl = (await img.getAttribute('src')) ?? undefined;
        if (avatarUrl) break;
      }
    } catch {
      // Try next
    }
  }

  // Connection count
  let connectionCount: number | undefined;
  const connText = await extractText(page, PROFILE_SELECTORS.connectionCount);
  if (connText) {
    const parsed = Number.parseInt(connText.replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(parsed)) connectionCount = parsed;
  }

  return {
    externalId,
    name,
    headline,
    avatarUrl,
    profileUrl,
    currentPosition,
    location,
    connectionCount,
  };
}
