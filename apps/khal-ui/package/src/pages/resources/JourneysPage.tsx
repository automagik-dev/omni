'use client';

/**
 * Journeys — latency tracing across the message pipeline. The summary card grid
 * plus a per-stage percentile table come from GET /journeys/summary; a
 * correlationId lookup renders a single journey's checkpoints and latencies.
 */
import { Button, Input, MetricDisplay, Note, SectionCard, StatusDot } from '@khal-os/ui';
import { useState } from 'react';
import type { Journey } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, JsonInspector, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { CardSection, DataRowList, errMsg, fmtTime } from './shared';

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * A single journey's checkpoints as the shared vertical StatusDot timeline — each
 * checkpoint a node on a connected spine, with its stage, absolute time, and the
 * delta from the prior checkpoint in mono. Mirrors the chat "Trace" tab so a
 * latency journey reads identically wherever it surfaces.
 */
function JourneyTrace({ journey }: { journey: Journey }) {
  const checkpoints = [...(journey.checkpoints ?? [])].sort((a, b) => a.timestamp - b.timestamp);
  if (checkpoints.length === 0) {
    return <span style={{ fontSize: 12.5, color: T.muted }}>No checkpoints recorded for this journey.</span>;
  }
  const start = checkpoints[0]?.timestamp ?? 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {checkpoints.map((c, i) => {
        const prev = checkpoints[i - 1];
        const delta = prev ? c.timestamp - prev.timestamp : 0;
        const last = i === checkpoints.length - 1;
        return (
          <div
            key={`${c.stage}-${c.timestamp}-${i}`}
            style={{ position: 'relative', paddingLeft: 22, paddingBottom: last ? 0 : 14 }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 6,
                top: 14,
                bottom: last ? undefined : -2,
                height: last ? 0 : undefined,
                width: 1,
                background: T.border,
              }}
            />
            <span style={{ position: 'absolute', left: 2, top: 4 }}>
              <StatusDot state={last ? 'active' : 'online'} size="sm" pulse={last} />
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: T.fg }}>{c.name || c.stage}</span>
              {c.name && c.stage && c.name !== c.stage && (
                <span style={{ fontSize: 11, fontFamily: T.mono, color: T.tertiary }}>{c.stage}</span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                {i > 0 && (
                  <span
                    style={{ fontSize: 11, fontFamily: T.mono, color: T.secondary, fontVariantNumeric: 'tabular-nums' }}
                  >
                    +{fmtMs(delta)}
                  </span>
                )}
                <span style={{ fontSize: 11, fontFamily: T.mono, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMs(c.timestamp - start)}
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface StageRow {
  stage: string;
  count: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function JourneysPage() {
  const { ext } = useOmniClient();
  const [since, setSince] = useState('24h');
  const [correlationId, setCorrelationId] = useState('');
  const [lookupId, setLookupId] = useState('');

  const summary = useOmniQuery(['journeys', 'summary', since], () => ext.journeys.summary({ since }));
  const journey = useOmniQuery(['journeys', lookupId], () => ext.journeys.get(lookupId), {
    enabled: Boolean(lookupId),
  });

  const stageRows: StageRow[] = Object.entries(summary.data?.stages ?? {}).map(([stage, s]) => ({
    stage,
    count: s.count,
    avg: Math.round(s.avg),
    p50: Math.round(s.p50),
    p95: Math.round(s.p95),
    p99: Math.round(s.p99),
    max: Math.round(s.max),
  }));

  const columns: ColumnDef<StageRow>[] = [
    { key: 'stage', header: 'Stage', render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.stage}</span> },
    { key: 'count', header: 'Count', width: 90, align: 'right' },
    { key: 'avg', header: 'Avg ms', width: 90, align: 'right', mono: true },
    { key: 'p50', header: 'p50', width: 80, align: 'right', mono: true },
    { key: 'p95', header: 'p95', width: 80, align: 'right', mono: true },
    { key: 'p99', header: 'p99', width: 80, align: 'right', mono: true },
    { key: 'max', header: 'Max ms', width: 90, align: 'right', mono: true },
  ];

  return (
    <PageShell
      eyebrow="Messaging"
      title="Journeys"
      description="End-to-end latency tracing across the message pipeline."
      actions={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}>
          Since
          <select
            value={since}
            onChange={(e) => setSince(e.target.value)}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.surface,
              color: T.fg,
              fontSize: 13,
            }}
          >
            {['30m', '1h', '6h', '24h', '7d'].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <Button size="small" variant="secondary" onClick={() => void summary.refetch()}>
            Refresh
          </Button>
        </span>
      }
    >
      {summary.error ? (
        <Note type="error" label="Error">
          {errMsg(summary.error)}
        </Note>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <SectionCard padding="md">
            <MetricDisplay value={summary.data?.totalTracked ?? 0} label="Tracked" />
          </SectionCard>
          <SectionCard padding="md">
            <MetricDisplay value={summary.data?.completedJourneys ?? 0} label="Completed" />
          </SectionCard>
          <SectionCard padding="md">
            <MetricDisplay value={summary.data?.activeJourneys ?? 0} label="Active" accentColor={T.accentBlue} />
          </SectionCard>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={stageRows}
        getRowKey={(r) => r.stage}
        loading={summary.isLoading}
        emptyTitle="No stage latencies"
        emptyDescription="No journeys tracked in this window."
      />

      <CardSection title="Look up a journey">
        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            setLookupId(correlationId.trim());
          }}
        >
          <Input placeholder="correlationId" value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} />
          <Button size="small" variant="default" typeName="submit" disabled={!correlationId.trim()}>
            Trace
          </Button>
        </form>

        {lookupId && (
          <div style={{ marginTop: 14 }}>
            {journey.isLoading ? (
              <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
            ) : journey.error ? (
              <Note type="error" label="Not found">
                {errMsg(journey.error)}
              </Note>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <DataRowList
                  rows={[
                    { label: 'Correlation ID', value: journey.data?.correlationId ?? '—' },
                    { label: 'Started', value: fmtTime(journey.data?.startedAt) },
                    { label: 'Completed', value: fmtTime(journey.data?.completedAt) },
                    { label: 'Checkpoints', value: journey.data?.checkpoints?.length ?? 0 },
                  ]}
                />
                {journey.data && <JourneyTrace journey={journey.data} />}
                <JsonInspector value={journey.data ?? {}} />
              </div>
            )}
          </div>
        )}
      </CardSection>
    </PageShell>
  );
}
