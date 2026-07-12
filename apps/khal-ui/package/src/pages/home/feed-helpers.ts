/**
 * Shared mappers from Omni {@link Event}s to `@khal-os/ui` `LiveFeed` rows —
 * used by the Overview recent-events feed and the Activity page. Direction and
 * error/agent markers drive the feed-row type (and therefore its color).
 */
import type { FeedEventType } from '@khal-os/ui';
import type { Event } from '@omni/sdk';

export type FeedFilter = 'all' | 'inbound' | 'outbound' | 'agent' | 'error';

export function toFeedType(e: Event): FeedEventType {
  if (e.eventType?.includes('error') || e.eventType?.includes('failed')) return 'error';
  if (e.eventType?.includes('agent')) return 'agent';
  if (e.direction === 'outbound') return 'success';
  if (e.direction === 'inbound') return 'info';
  return 'system';
}

export function feedMessage(e: Event): string {
  const text = e.textContent ?? e.transcription ?? e.imageDescription ?? '';
  const body = text
    ? text.length > 120
      ? `${text.slice(0, 120)}…`
      : text
    : e.contentType
      ? `[${e.contentType}]`
      : '—';
  return `${e.eventType} · ${body}`;
}

export function matchesFilter(e: Event, filter: FeedFilter): boolean {
  if (filter === 'all') return true;
  const type = toFeedType(e);
  if (filter === 'error') return type === 'error';
  if (filter === 'agent') return type === 'agent';
  return e.direction === filter;
}
