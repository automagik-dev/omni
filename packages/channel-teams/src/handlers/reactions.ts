/**
 * Inbound reaction handler.
 *
 * Bot Framework delivers reactions as `messageReaction` activities with
 * `reactionsAdded` / `reactionsRemoved` arrays. The `replyToId` field
 * points at the activity the user reacted to.
 *
 * Teams uses string emoji shortcodes (`like`, `heart`, `laugh`, `surprised`,
 * `sad`, `angry`) rather than literal emoji characters; we surface the
 * Teams-side identifier and let downstream consumers normalise as needed.
 */

import type { TeamsActivityMeta } from '../types';
import type { InboundActivity } from './activity-types';
import { toActivityMeta } from './conversation';

export interface ParsedReactionEvent {
  meta: TeamsActivityMeta;
  /** Activity id the reaction targets */
  targetActivityId: string;
  /** Reaction shortcode (`like`, `heart`, ...) */
  reaction: string;
  /** Whether the reaction was added (true) or removed (false) */
  added: boolean;
}

export function parseReactionActivity(activity: InboundActivity): ParsedReactionEvent[] {
  if (activity.type !== 'messageReaction') return [];
  if (!activity.replyToId) return [];

  const meta = toActivityMeta(activity);
  const targetActivityId = activity.replyToId;

  const events: ParsedReactionEvent[] = [];

  for (const r of activity.reactionsAdded ?? []) {
    if (r?.type) {
      events.push({ meta, targetActivityId, reaction: r.type, added: true });
    }
  }
  for (const r of activity.reactionsRemoved ?? []) {
    if (r?.type) {
      events.push({ meta, targetActivityId, reaction: r.type, added: false });
    }
  }

  return events;
}
