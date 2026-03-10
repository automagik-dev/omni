/**
 * Connections Scraper — extracts connections list and pending invites.
 *
 * NEW scraper (no Python equivalent). Follows the same DOM parsing patterns
 * established in the inbox scraper (scan_raw.py port).
 *
 * All waits use humanDelay() from the humanizer.
 */

import type { ElementHandle, Page } from 'playwright';
import { humanDelay } from '../browser/humanizer';
import type { LinkedInConnection } from '../types';

// ---------------------------------------------------------------------------
// Connections DOM selectors
// ---------------------------------------------------------------------------

interface ConnectionSelectorEntry {
  primary: string;
  fallbacks: string[];
}

interface ConnectionSelectors {
  connectionCard: ConnectionSelectorEntry;
  connectionName: ConnectionSelectorEntry;
  connectionHeadline: ConnectionSelectorEntry;
  connectionLink: ConnectionSelectorEntry;
  connectionAvatar: ConnectionSelectorEntry;
  inviteCard: ConnectionSelectorEntry;
  inviteName: ConnectionSelectorEntry;
  inviteHeadline: ConnectionSelectorEntry;
}

const CONNECTION_SELECTORS: ConnectionSelectors = {
  connectionCard: {
    primary: '.mn-connection-card',
    fallbacks: ['.scaffold-finite-scroll__content li', '[data-test-connection-card]'],
  },
  connectionName: {
    primary: '.mn-connection-card__name',
    fallbacks: ['.mn-connection-card__details a span:first-child'],
  },
  connectionHeadline: {
    primary: '.mn-connection-card__occupation',
    fallbacks: ['.mn-connection-card__details .t-14'],
  },
  connectionLink: {
    primary: '.mn-connection-card__link',
    fallbacks: ['.mn-connection-card a[href*="/in/"]'],
  },
  connectionAvatar: {
    primary: '.mn-connection-card__profile-image',
    fallbacks: ['.mn-connection-card img.EntityPhoto-circle-4'],
  },
  inviteCard: {
    primary: '.invitation-card',
    fallbacks: ['.mn-invitation-card', '[data-test-invite-card]'],
  },
  inviteName: {
    primary: '.invitation-card__title',
    fallbacks: ['.mn-invitation-card__name'],
  },
  inviteHeadline: {
    primary: '.invitation-card__subtitle',
    fallbacks: ['.mn-invitation-card__occupation'],
  },
};

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
const INVITATIONS_URL = 'https://www.linkedin.com/mynetwork/invitation-manager/';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const EVAL_INNER_TEXT = (el: { innerText?: string }) => el.innerText?.trim() ?? '';

async function tryExtractText(container: ElementHandle, entry: ConnectionSelectorEntry): Promise<string> {
  const all = [entry.primary, ...entry.fallbacks];
  for (const sel of all) {
    try {
      const child = await container.$(sel);
      if (child) {
        const text = await child.evaluate(EVAL_INNER_TEXT);
        if (text) return text;
      }
    } catch {
      // Try next
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Internal: extract external ID from a profile URL
// ---------------------------------------------------------------------------

function extractExternalIdFromUrl(profileUrl: string | undefined, fallback: string): string {
  if (!profileUrl) return fallback;
  const match = profileUrl.match(/\/in\/([^/?]+)/);
  return match ? (match[1] as string) : fallback;
}

// ---------------------------------------------------------------------------
// Internal: extract attribute using fallback selectors
// ---------------------------------------------------------------------------

async function tryExtractAttribute(
  container: ElementHandle,
  entry: ConnectionSelectorEntry,
  attribute: string,
): Promise<string | undefined> {
  const allSelectors = [entry.primary, ...entry.fallbacks];
  for (const sel of allSelectors) {
    const el = await container.$(sel);
    if (el) {
      const value = (await el.getAttribute(attribute)) ?? undefined;
      if (value) return value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal: extract a single connection card
// ---------------------------------------------------------------------------

async function extractConnectionCard(card: ElementHandle, index: number): Promise<LinkedInConnection | null> {
  const name = await tryExtractText(card, CONNECTION_SELECTORS.connectionName);
  if (!name) return null;

  const headline = await tryExtractText(card, CONNECTION_SELECTORS.connectionHeadline);
  const profileUrl = await tryExtractAttribute(card, CONNECTION_SELECTORS.connectionLink, 'href');
  const externalId = extractExternalIdFromUrl(profileUrl, `connection-${index}`);
  const avatarUrl = await tryExtractAttribute(card, CONNECTION_SELECTORS.connectionAvatar, 'src');

  return {
    externalId,
    name,
    headline: headline || undefined,
    profileUrl,
    avatarUrl,
    status: 'connected',
  };
}

// ---------------------------------------------------------------------------
// Internal: extract a single invite card
// ---------------------------------------------------------------------------

async function extractInviteCard(card: ElementHandle, index: number): Promise<LinkedInConnection | null> {
  const name = await tryExtractText(card, CONNECTION_SELECTORS.inviteName);
  if (!name) return null;

  const headline = await tryExtractText(card, CONNECTION_SELECTORS.inviteHeadline);

  let profileUrl: string | undefined;
  const linkEl = await card.$('a[href*="/in/"]');
  if (linkEl) {
    profileUrl = (await linkEl.getAttribute('href')) ?? undefined;
  }

  const externalId = extractExternalIdFromUrl(profileUrl, `invite-${index}`);

  return {
    externalId,
    name,
    headline: headline || undefined,
    profileUrl,
    status: 'pending_received',
  };
}

// ---------------------------------------------------------------------------
// scrapeConnections
// ---------------------------------------------------------------------------

/**
 * Navigate to the connections page and extract the visible connections list.
 *
 * Scrolls the page to load more connections, then extracts structured data
 * from each connection card.
 *
 * @param page - Playwright Page instance
 * @param options - Optional limit and scroll settings
 * @returns Array of connections
 */
export async function scrapeConnections(
  page: Page,
  options?: { limit?: number; scrollIterations?: number },
): Promise<LinkedInConnection[]> {
  const limit = options?.limit ?? 50;
  const scrollIterations = options?.scrollIterations ?? 5;

  // Navigate to connections page
  await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded' });
  await humanDelay('navigation');

  // Scroll to load more connections
  const cardEntry = CONNECTION_SELECTORS.connectionCard;
  for (let i = 0; i < scrollIterations; i++) {
    const cards = await page.$$(cardEntry.primary);
    if (cards.length >= limit) break;

    await page.evaluate('window.scrollBy(0, window.innerHeight)');
    await humanDelay('scroll');
  }

  // Extract connections
  const allSelectors = [cardEntry.primary, ...cardEntry.fallbacks];

  let cardElements: Awaited<ReturnType<Page['$$']>> = [];
  for (const sel of allSelectors) {
    cardElements = await page.$$(sel);
    if (cardElements.length > 0) break;
  }

  const total = Math.min(cardElements.length, limit);
  const results: LinkedInConnection[] = [];

  for (let i = 0; i < total; i++) {
    const card = cardElements[i] as ElementHandle;
    const connection = await extractConnectionCard(card, i);
    if (connection) results.push(connection);
  }

  return results;
}

// ---------------------------------------------------------------------------
// scrapePendingInvites
// ---------------------------------------------------------------------------

/**
 * Navigate to the invitations page and extract pending connection requests.
 *
 * @param page - Playwright Page instance
 * @returns Array of pending connections
 */
export async function scrapePendingInvites(page: Page): Promise<LinkedInConnection[]> {
  // Navigate to invitations page
  await page.goto(INVITATIONS_URL, { waitUntil: 'domcontentloaded' });
  await humanDelay('navigation');

  // Find invite cards
  const inviteEntry = CONNECTION_SELECTORS.inviteCard;
  const allSelectors = [inviteEntry.primary, ...inviteEntry.fallbacks];

  let inviteElements: Awaited<ReturnType<Page['$$']>> = [];
  for (const sel of allSelectors) {
    inviteElements = await page.$$(sel);
    if (inviteElements.length > 0) break;
  }

  const results: LinkedInConnection[] = [];

  for (let i = 0; i < inviteElements.length; i++) {
    const card = inviteElements[i] as ElementHandle;
    const invite = await extractInviteCard(card, i);
    if (invite) results.push(invite);
  }

  return results;
}
