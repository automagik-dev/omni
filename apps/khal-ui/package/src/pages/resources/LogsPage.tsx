'use client';

/**
 * Logs — a live tail plus a recent-buffer snapshot. The tail consumes
 * GET /logs/stream through {@link useSse} with `heartbeatMs: 0` (the stream is
 * kept alive by SSE comment keepalives EventSource never surfaces, so the
 * watchdog must be disabled). The snapshot reads GET /logs/recent with
 * level/module filters.
 */
import { Badge, Button, Input, Note, SectionCard, Toggle } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { LogEntry } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { useSse } from '../../hooks/useSse';
import { errMsg, fmtTime } from './shared';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const LEVEL_VARIANT: Record<string, 'gray' | 'blue' | 'amber' | 'red'> = {
  debug: 'gray',
  info: 'blue',
  warn: 'amber',
  error: 'red',
};

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        fontFamily: T.mono,
        fontSize: 12,
        padding: '2px 0',
        borderBottom: `1px solid ${T.borderSubtle}`,
      }}
    >
      <Badge variant={LEVEL_VARIANT[entry.level ?? 'info'] ?? 'gray'} size="sm">
        {entry.level ?? '—'}
      </Badge>
      <span style={{ color: T.muted, minWidth: 150 }}>{fmtTime(entry.time)}</span>
      <span style={{ color: T.accentBlue, minWidth: 120 }}>{entry.module ?? '—'}</span>
      <span style={{ color: T.fg, flex: 1, wordBreak: 'break-word' }}>{entry.msg ?? ''}</span>
    </div>
  );
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

  return (
    <PageShell
      eyebrow="Operations"
      title="Logs"
      description="Live log tail (SSE) and the recent-buffer snapshot."
      actions={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}>
          Live tail
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
        <SectionCard padding="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>Live tail</h3>
            <Badge variant={sse.connected ? 'green' : sse.degraded ? 'red' : 'gray'}>
              {sse.connected ? 'streaming' : sse.degraded ? 'degraded' : 'connecting'}
            </Badge>
            <span style={{ fontSize: 12, color: T.muted }}>{liveEntries.length} frames</span>
          </div>
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: 8,
              background: T.sunken,
            }}
          >
            {liveEntries.length === 0 ? (
              <span style={{ fontSize: 12, color: T.muted }}>Waiting for log frames…</span>
            ) : (
              liveEntries.map((e, i) => <LogLine key={`${e.time}-${i}`} entry={e} />)
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: T.fg }}>
          Recent buffer ({recent.data?.items?.length ?? 0})
        </h3>
        {recent.error ? (
          <Note type="error" label="Error">
            {errMsg(recent.error)}
          </Note>
        ) : (
          <div
            style={{
              maxHeight: 480,
              overflowY: 'auto',
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: 8,
              background: T.sunken,
            }}
          >
            {(recent.data?.items ?? []).length === 0 ? (
              <span style={{ fontSize: 12, color: T.muted }}>No recent logs.</span>
            ) : (
              (recent.data?.items ?? []).map((e, i) => <LogLine key={`${e.time}-${i}`} entry={e} />)
            )}
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
