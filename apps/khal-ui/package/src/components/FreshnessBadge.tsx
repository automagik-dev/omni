'use client';

/**
 * Compact freshness indicator: a status dot, the data source, and a live-ticking
 * age since it was observed. Turns amber/"degraded" when the source is unhealthy
 * or the data has gone stale past `staleAfterMs`, so an operator can tell at a
 * glance whether what they're looking at is current.
 */
import { StatusDot } from '@khal-os/ui';
import { useEffect, useState } from 'react';
import { T } from './tokens';

export interface FreshnessBadgeProps {
  /** When the data was observed (epoch ms). Undefined = never / loading. */
  observedAt?: number;
  /** Human label for where the data came from (e.g. "/diag", "SSE"). */
  source: string;
  /** Force the degraded state (e.g. SSE disconnected). */
  degraded?: boolean;
  /** Age beyond which data is considered stale (default 60s). */
  staleAfterMs?: number;
}

export function formatAge(ms: number): string {
  if (ms < 1000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function FreshnessBadge({ observedAt, source, degraded = false, staleAfterMs = 60_000 }: FreshnessBadgeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = observedAt ? now - observedAt : undefined;
  const stale = age !== undefined && age > staleAfterMs;
  const state = degraded ? 'error' : stale ? 'away' : observedAt ? 'live' : 'idle';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${T.border}`,
        background: T.surface,
        fontSize: 12,
        color: T.muted,
        whiteSpace: 'nowrap',
      }}
      title={observedAt ? `Observed ${new Date(observedAt).toLocaleString()} · ${source}` : `${source} · no data yet`}
    >
      <StatusDot state={state} size="sm" />
      <span style={{ color: T.fg, fontWeight: 500 }}>{source}</span>
      <span aria-hidden style={{ opacity: 0.4 }}>
        ·
      </span>
      <span>{degraded ? 'degraded' : age === undefined ? 'no data' : formatAge(age)}</span>
    </span>
  );
}
