/**
 * Feed Scraper — extracts structured post data from the LinkedIn feed.
 *
 * NEW scraper (no Python equivalent). Follows the same DOM parsing patterns
 * established in the inbox scraper (scan_raw.py port).
 *
 * All DOM queries go through findElement() / SELECTORS from the centralized
 * selector registry. All waits use humanDelay() from the humanizer.
 */

import type { ElementHandle, Page } from 'playwright';
import { humanDelay } from '../browser/humanizer';
import { SELECTORS, combinedSelector } from '../browser/selectors';
import type { LinkedInPost } from '../types';

// ---------------------------------------------------------------------------
// Shorthand references
// ---------------------------------------------------------------------------

const SEL = {
  postContainer: SELECTORS.feed.postContainer,
  postContent: SELECTORS.feed.postContent,
  postAuthor: SELECTORS.feed.postAuthor,
  likeCount: SELECTORS.feed.likeCount,
  commentCount: SELECTORS.feed.commentCount,
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ScrapeFeedPostsOptions {
  /** Maximum number of posts to scrape (default: 10) */
  limit?: number;
  /** Number of scroll iterations to load more posts (default: 5) */
  scrollIterations?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const EVAL_INNER_TEXT = (el: { innerText?: string }) => el.innerText?.trim() ?? '';

async function tryExtractText(container: ElementHandle, primary: string, fallbacks: string[]): Promise<string> {
  const el = await container.$(primary);
  if (el) {
    const text = await el.evaluate(EVAL_INNER_TEXT);
    if (text) return text;
  }
  for (const fb of fallbacks) {
    const fbEl = await container.$(fb);
    if (fbEl) {
      const text = await fbEl.evaluate(EVAL_INNER_TEXT);
      if (text) return text;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Internal helpers for post extraction
// ---------------------------------------------------------------------------

/** Parse a numeric count from an element's inner text. */
async function extractCount(postEl: ElementHandle, selector: string): Promise<number | undefined> {
  const el = await postEl.$(selector);
  if (!el) return undefined;
  const text = await el.evaluate(EVAL_INNER_TEXT);
  const parsed = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Extract src attributes from multiple matching elements. */
async function extractSrcAttributes(postEl: ElementHandle, selector: string): Promise<string[]> {
  const elements = await postEl.$$(selector);
  const urls: string[] = [];
  for (const el of elements) {
    const src = await el.getAttribute('src');
    if (src) urls.push(src);
  }
  return urls;
}

/** Extract a single attribute from the first matching element. */
async function extractAttribute(
  postEl: ElementHandle,
  selector: string,
  attribute: string,
): Promise<string | undefined> {
  const el = await postEl.$(selector);
  if (!el) return undefined;
  return (await el.getAttribute(attribute)) ?? undefined;
}

/** Resolve the external ID from data-urn, post URL, or fallback index. */
async function resolveExternalId(postEl: ElementHandle, postUrl: string | undefined, index: number): Promise<string> {
  const dataUrn = await postEl.getAttribute('data-urn');
  if (dataUrn) return dataUrn;
  if (postUrl) return postUrl;
  return `feed-post-${index}`;
}

// ---------------------------------------------------------------------------
// Internal: extract a single post from its DOM element
// ---------------------------------------------------------------------------

async function extractPost(postEl: ElementHandle, index: number): Promise<LinkedInPost | null> {
  try {
    const authorName = await tryExtractText(postEl, SEL.postAuthor.primary, SEL.postAuthor.fallbacks);
    const content = await tryExtractText(postEl, SEL.postContent.primary, SEL.postContent.fallbacks);
    if (!content && !authorName) return null;

    const hashtags = content.match(/#[\w\u00C0-\u024F]+/g) ?? [];
    const likeCount = await extractCount(postEl, SEL.likeCount.primary);
    const commentCount = await extractCount(postEl, SEL.commentCount.primary);

    const imgUrls = await extractSrcAttributes(postEl, 'img[src*="media"]');
    const videoUrls = await extractSrcAttributes(postEl, 'video source');
    const mediaUrls = [...imgUrls, ...videoUrls];

    const authorProfileUrl = await extractAttribute(
      postEl,
      '.update-components-actor__name a, .feed-shared-actor__name a',
      'href',
    );
    const authorAvatarUrl = await extractAttribute(
      postEl,
      '.update-components-actor__image img, .feed-shared-actor__avatar img',
      'src',
    );
    const postUrl = await extractAttribute(postEl, 'a[href*="/feed/update/"]', 'href');
    const externalId = await resolveExternalId(postEl, postUrl, index);

    return {
      externalId,
      authorName,
      authorProfileUrl,
      authorAvatarUrl,
      content,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      hashtags: hashtags.length > 0 ? hashtags : undefined,
      postUrl,
      likeCount,
      commentCount,
      scrapedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// scrapeFeedPosts
// ---------------------------------------------------------------------------

/**
 * Scrape posts from the LinkedIn feed.
 *
 * Scrolls the feed page to load more posts, then extracts structured data
 * from each post element including author, content, media, engagement counts,
 * and hashtags.
 *
 * @param page - Playwright Page (must already be on /feed/)
 * @param options - Scraping options
 * @returns Array of structured post data
 */
export async function scrapeFeedPosts(page: Page, options?: ScrapeFeedPostsOptions): Promise<LinkedInPost[]> {
  const limit = options?.limit ?? 10;
  const scrollIterations = options?.scrollIterations ?? 5;

  // Scroll feed to load more posts (same pattern as inbox scroll)
  for (let i = 0; i < scrollIterations; i++) {
    const posts = await page.$$(combinedSelector(SEL.postContainer));
    if (posts.length >= limit) break;

    await page.evaluate('window.scrollBy(0, window.innerHeight)');
    await humanDelay('scroll');
  }

  // Extract posts
  const postElements = await page.$$(combinedSelector(SEL.postContainer));
  const total = Math.min(postElements.length, limit);

  const results: LinkedInPost[] = [];

  for (let i = 0; i < total; i++) {
    const postEl = postElements[i] as ElementHandle;
    const post = await extractPost(postEl, i);
    if (post) {
      results.push(post);
    }
  }

  return results;
}
