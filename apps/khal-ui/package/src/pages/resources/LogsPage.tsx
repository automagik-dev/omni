'use client';

/**
 * Logs — a live tail plus a recent-buffer snapshot, both rendered through the
 * KhalOS {@link LiveFeed} console: log levels map to feed types (colour + glyph),
 * everything is mono, and the tail auto-follows newly polled frames. The tail
 * consumes GET /logs/stream through {@link useSse} with `heartbeatMs: 0` (the
 * stream is kept alive by SSE comment keepalives EventSource never surfaces, so
 * the watchdog must be disabled). The snapshot reads GET /logs/recent with
 * level/module filters.
 */
import { Badge, Button, Input, LiveFeed, Note, SectionCard, Toggle } from '@khal-os/ui';
import type { FeedEvent } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { LogEntry } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { useSse } from '../../hooks/useSse';
import { CardSection, errMsg } from './shared';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Log severity → LiveFeed row type (drives the row colour + glyph). */
const LEVEL_FEED: Record<string, FeedEvent['type']> = {
  debug: 'system',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

/** Project log entries into feed rows — module tag prefixes the message, mono. */
function toFeed(entries: LogEntry[]): FeedEvent[] {
  return entries.map((e, i) => ({
    id: `${e.time ?? ''}-${i}`,
    type: LEVEL_FEED[e.level ?? 'info'] ?? 'info',
    message: `${e.module ? `${e.module}  ` : ''}${e.msg ?? ''}`,
    timestamp: e.time ? new Date(e.time) : undefined,
  }));
}

export function LogsPage() {
  const { ext } = useOmniClient();
  const [level, setLevel] = useState('info');
  const [modules, setModules] = useState('');
  const [live, setLive] = useState(false);

  const streamPath = useMemo(
    () => ext.logs.streamPath({ level, ...(modules ? { modules } : {}) }),
    [ext, level, modules],
  );
  const sse = useSse(streamPath, { enabled: live, heartbeatMs: 0, events: ['log', 'connected'], max: 200 });

  const recent = useOmniQuery(['logs', 'recent', level, modules], () =>
    ext.logs.recent({ level, limit: 200, ...(modules ? { modules } : {}) }),
  );

  const liveEntries: LogEntry[] = sse.messages
    .filter((m) => m.eventType === 'log')
    .map((m) => {
      try {
        return JSON.parse(m.data) as LogEntry;
      } catch {
        return { msg: m.data } as LogEntry;
      }
    });

  const liveFeed = toFeed(liveEntries);
  const recentFeed = toFeed(recent.data?.items ?? []);

  return (
    <PageShell
      eyebrow="Operations"
      title="Logs"
      description="Live log tail (SSE) and the recent-buffer snapshot, streamed through the console."
      actions={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}>
          Follow tail
          <Toggle checked={live} onChange={setLive} />
        </span>
      }
    >
      <SectionCard padding="md">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}>
            Min level
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                border: `1px solid ${T.border}`,
                background: T.surface,
                color: T.fg,
                fontSize: 13,
              }}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </span>
          <Input
            placeholder="modules (e.g. whatsapp:*, comma-sep)"
            value={modules}
            onChange={(e) => setModules(e.target.value)}
          />
          <Button size="small" variant="secondary" onClick={() => void recent.refetch()}>
            Refresh snapshot
          </Button>
        </div>
      </SectionCard>

      {live && (
        <CardSection
          title="Live tail"
          actions={
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge variant={sse.connected ? 'green' : sse.degraded ? 'red' : 'gray'}>
                {sse.connected ? 'streaming' : sse.degraded ? 'degraded' : 'connecting'}
              </Badge>
              <span style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
                {liveFeed.length} frames
              </span>
            </span>
          }
        >
          {liveFeed.length === 0 ? (
            <span style={{ fontSize: 12, color: T.muted }}>Waiting for log frames…</span>
          ) : (
            <LiveFeed events={liveFeed} height={320} maxVisible={200} showTimestamps />
          )}
        </CardSection>
      )}

      <CardSection title={`Recent buffer · ${recent.data?.items?.length ?? 0}`}>
        {recent.error ? (
          <Note type="error" label="Error">
            {errMsg(recent.error)}
          </Note>
        ) : recentFeed.length === 0 ? (
          <span style={{ fontSize: 12, color: T.muted }}>No recent logs.</span>
        ) : (
          <LiveFeed events={recentFeed} height={480} maxVisible={200} showTimestamps />
        )}
      </CardSection>
    </PageShell>
  );
}
