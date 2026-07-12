'use client';

/**
 * Activity — a live-ish feed of recent events, refreshed on a 10s incremental
 * poll that dedupes by id and backs off while the window is hidden
 * ({@link useIncrementalPoll}). Renders as a full-height `LiveFeed` console with
 * direction/type filters. Read-only.
 */
import { Button, LiveFeed, SectionCard } from '@khal-os/ui';
import type { FeedEvent } from '@khal-os/ui';
import type { Event } from '@omni/sdk';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useIncrementalPoll } from '../../hooks/useIncrementalPoll';
import { type FeedFilter, feedMessage, matchesFilter, toFeedType } from './feed-helpers';

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'outbound', label: 'Outbound' },
  { key: 'agent', label: 'Agent' },
  { key: 'error', label: 'Errors' },
];

// Tall console that fills most of the window without a live resize observer.
const FEED_HEIGHT = typeof window !== 'undefined' ? Math.max(360, window.innerHeight - 320) : 520;

export function ActivityPage() {
  const { client } = useOmniClient();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const { items, error, lastPolledAt } = useIncrementalPoll<Event>({
    fetchPage: () => client.events.list({ limit: 20 }).then((r) => r.items),
    getId: (e) => e.id,
    intervalMs: 10_000,
    max: 200,
  });

  const feedEvents: FeedEvent[] = items
    .filter((e) => matchesFilter(e, filter))
    .map((e) => ({
      id: e.id,
      type: toFeedType(e),
      message: feedMessage(e),
      timestamp: e.receivedAt ? new Date(e.receivedAt) : undefined,
    }));

  return (
    <PageShell
      eyebrow="Home"
      title="Activity"
      description="Recent events, polled every 10 seconds."
      actions={<FreshnessBadge observedAt={lastPolledAt} source="events poll" degraded={Boolean(error)} />}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="small"
            variant={filter === f.key ? 'secondary' : 'tertiary'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && <div style={{ fontSize: 13, color: T.danger }}>Error: {error.message}</div>}

      <SectionCard padding="sm">
        <LiveFeed events={feedEvents} height={FEED_HEIGHT} maxVisible={200} showTimestamps />
      </SectionCard>
    </PageShell>
  );
}
