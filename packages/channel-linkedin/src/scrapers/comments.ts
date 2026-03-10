/**
 * Comments Scraper — extracts threaded comments from LinkedIn posts.
 *
 * NEW scraper (no Python equivalent). Follows the same DOM parsing patterns
 * established in the inbox scraper (scan_raw.py port).
 *
 * All DOM queries go through findElement() / SELECTORS from the centralized
 * selector registry. All waits use humanDelay() from the humanizer.
 */

import type { ElementHandle } from 'playwright';
import { humanDelay } from '../browser/humanizer';
import { SELECTORS } from '../browser/selectors';
import type { LinkedInComment } from '../types';

// ---------------------------------------------------------------------------
// Selectors for comments (structural, not in registry since comment DOM
// is nested within post elements)
// ---------------------------------------------------------------------------

const COMMENT_SELECTORS = {
  /** Top-level comment container */
  commentItem: '.comments-comment-item',
  /** Comment author name */
  commentAuthor: '.comments-post-meta__name-text',
  /** Comment body text */
  commentBody: '.comments-comment-item__main-content',
  /** Reply container (nested under a comment) */
  replyItem: '.comments-reply-item',
  /** Reply body text */
  replyBody: '.comments-reply-item__main-content',
  /** Like count on a comment */
  commentLikes: '.comments-comment-social-bar__reactions-count',
  /** Author profile link */
  commentAuthorLink: '.comments-post-meta__name-text a',
  /** "Show more replies" / "Load more comments" button */
  loadMoreComments: 'button.comments-comments-list__load-more-comments-button',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const EVAL_INNER_TEXT = (el: { innerText?: string }) => el.innerText?.trim() ?? '';

// ---------------------------------------------------------------------------
// Internal: extract a single comment element
// ---------------------------------------------------------------------------

async function extractComment(
  commentEl: ElementHandle,
  postId: string,
  index: number,
  parentCommentId?: string,
): Promise<LinkedInComment | null> {
  try {
    // Author name
    const authorEl = await commentEl.$(COMMENT_SELECTORS.commentAuthor);
    const authorName = authorEl ? await authorEl.evaluate(EVAL_INNER_TEXT) : '';

    // Author profile URL
    let authorProfileUrl: string | undefined;
    const authorLink = await commentEl.$(COMMENT_SELECTORS.commentAuthorLink);
    if (authorLink) {
      authorProfileUrl = (await authorLink.getAttribute('href')) ?? undefined;
    }

    // Comment body
    const bodySelector = parentCommentId ? COMMENT_SELECTORS.replyBody : COMMENT_SELECTORS.commentBody;
    const bodyEl = await commentEl.$(bodySelector);
    const content = bodyEl ? await bodyEl.evaluate(EVAL_INNER_TEXT) : '';

    if (!content && !authorName) return null;

    // Like count
    let likeCount: number | undefined;
    const likeEl = await commentEl.$(COMMENT_SELECTORS.commentLikes);
    if (likeEl) {
      const likeText = await likeEl.evaluate(EVAL_INNER_TEXT);
      const parsed = Number.parseInt(likeText.replace(/[^\d]/g, ''), 10);
      if (!Number.isNaN(parsed)) likeCount = parsed;
    }

    // External ID
    const dataUrn = await commentEl.getAttribute('data-urn');
    const externalId = dataUrn ?? `${postId}-comment-${index}`;

    return {
      externalId,
      postId,
      parentCommentId,
      authorName,
      authorProfileUrl,
      content,
      likeCount,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// scrapePostComments
// ---------------------------------------------------------------------------

/**
 * Extract comments from a LinkedIn post, including threaded replies.
 *
 * Expects that the comment section is already expanded (i.e., the comment
 * button has been clicked on the post). Will attempt to load more comments
 * by clicking "Load more" buttons.
 *
 * @param postElement - The post's ElementHandle (the .feed-shared-update-v2 container)
 * @returns Array of comments with parent references for threading
 */
/**
 * Expand the comment section by clicking the comment button and loading more comments.
 */
async function expandComments(postElement: ElementHandle): Promise<void> {
  const commentBtnEntry = SELECTORS.feed.commentButton;
  const commentBtn = await postElement.$(commentBtnEntry.primary);
  if (commentBtn) {
    await commentBtn.click();
    await humanDelay('postClick');
  }

  const loadMoreBtn = await postElement.$(COMMENT_SELECTORS.loadMoreComments);
  if (!loadMoreBtn) return;
  try {
    await loadMoreBtn.click();
    await humanDelay('messageLoad');
  } catch {
    // Button may not be clickable
  }
}

/**
 * Extract a top-level comment and its threaded replies.
 */
async function extractCommentWithReplies(
  commentEl: ElementHandle,
  postId: string,
  index: number,
): Promise<LinkedInComment[]> {
  const results: LinkedInComment[] = [];
  const comment = await extractComment(commentEl, postId, index);
  if (!comment) return results;

  results.push(comment);

  const replyEls = await commentEl.$$(COMMENT_SELECTORS.replyItem);
  for (let j = 0; j < replyEls.length; j++) {
    const replyEl = replyEls[j] as ElementHandle;
    const reply = await extractComment(replyEl, postId, j, comment.externalId);
    if (reply) {
      results.push(reply);
    }
  }

  return results;
}

export async function scrapePostComments(postElement: ElementHandle): Promise<LinkedInComment[]> {
  const dataUrn = await postElement.getAttribute('data-urn');
  const postId = dataUrn ?? `post-${Date.now()}`;

  await expandComments(postElement);

  const commentEls = await postElement.$$(COMMENT_SELECTORS.commentItem);
  const results: LinkedInComment[] = [];

  for (let i = 0; i < commentEls.length; i++) {
    const commentEl = commentEls[i] as ElementHandle;
    const commentResults = await extractCommentWithReplies(commentEl, postId, i);
    results.push(...commentResults);
  }

  return results;
}
