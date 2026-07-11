'use client';

/**
 * Activity — a live-ish feed of recent events, refreshed on a 10s incremental
 * poll that dedupes by id and backs off while the window is hidden
 * ({@link useIncrementalPoll}). Read-only.
 */
import { StatusDot } from '@khal-os/ui';
import type { Event } from '@omni/sdk';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { FreshnessBadge, formatAge } from '../../components/FreshnessBadge';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useIncrementalPoll } from '../../hooks/useIncrementalPoll';

function directionState(direction: string): 'active' | 'queued' {
  return direction === 'inbound' ? 'active' : 'queued';
}

function eventText(e: Event): string {
  const text = e.textContent ?? e.transcription ?? e.imageDescription ?? '';
  if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  return e.contentType ? `[${e.contentType}]` : '—';
}

export function ActivityPage() {
  const { client } = useOmniClient();
  const { items, error, lastPolledAt } = useIncrementalPoll<Event>({
    fetchPage: () => client.events.list({ limit: 20 }).then((r) => r.items),
    getId: (e) => e.id,
    intervalMs: 10_000,
    max: 200,
  });

  return (
    <PageShell
      eyebrow="Home"
      title="Activity"
      description="Recent events, polled every 10 seconds."
      actions={<FreshnessBadge observedAt={lastPolledAt} source="events poll" degraded={Boolean(error)} />}
    >
      {error && <div style={{ fontSize: 13, color: T.danger }}>Error: {error.message}</div>}
      {items.length === 0 && !error && <div style={{ fontSize: 13, color: T.muted }}>Waiting for events…</div>}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((e) => (
          <li
            key={e.id}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              padding: '8px 10px',
              borderBottom: `1px solid ${T.borderSubtle}`,
            }}
          >
            <StatusDot state={directionState(e.direction)} size="sm" />
            <span style={{ fontSize: 12, fontFamily: T.mono, color: T.accentBlue, minWidth: 150, flexShrink: 0 }}>
              {e.eventType}
            </span>
            <span style={{ fontSize: 13, color: T.fg, flex: 1, minWidth: 0 }}>{eventText(e)}</span>
            <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, flexShrink: 0 }}>
              {e.receivedAt ? formatAge(Date.now() - new Date(e.receivedAt).getTime()) : ''}
            </span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
