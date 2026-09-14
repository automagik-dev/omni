/**
 * Pure helpers for on-demand history paging (#1121, #1122).
 */
import type { MessageAnchor } from '../plugin';

/** Phone answers bursts of on-demand requests only partially; page anchors in small batches. */
export const ANCHOR_BATCH_SIZE = 10;

export interface ChatTrackerEntry {
  chatJid: string;
  anchorTs: number;
  count: number;
  oldest: { key: unknown; timestamp: number } | null;
}

/** Tracker keyed by both chatJid and anchor remoteJid (LID vs PN addressing); aliases share one entry. */
export type ChatTracker = Map<string, ChatTrackerEntry>;

export function createChatTracker(anchors: MessageAnchor[]): ChatTracker {
  const tracker: ChatTracker = new Map();
  for (const anchor of anchors) {
    const entry: ChatTrackerEntry = { chatJid: anchor.chatJid, anchorTs: anchor.timestamp, count: 0, oldest: null };
    tracker.set(anchor.chatJid, entry);
    if (anchor.messageKey.remoteJid) tracker.set(anchor.messageKey.remoteJid, entry);
  }
  return tracker;
}

/** Continue a chat while its round returned any message older than its anchor. */
export function buildNextAnchors(tracker: ChatTracker): { anchors: MessageAnchor[]; totalFetched: number } {
  const anchors: MessageAnchor[] = [];
  let totalFetched = 0;

  for (const data of new Set(tracker.values())) {
    totalFetched += data.count;
    if (data.count === 0 || !data.oldest || data.oldest.timestamp >= data.anchorTs) continue;

    const key = data.oldest.key as { remoteJid?: string; id?: string; fromMe?: boolean } | undefined;
    if (!key?.remoteJid || !key.id) continue;

    anchors.push({
      chatJid: data.chatJid,
      messageKey: { remoteJid: key.remoteJid, id: key.id, fromMe: key.fromMe ?? false },
      timestamp: data.oldest.timestamp,
    });
  }
  return { anchors, totalFetched };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
