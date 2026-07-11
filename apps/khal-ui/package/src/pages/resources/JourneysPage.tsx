'use client';

/**
 * Journeys — latency tracing across the message pipeline. The summary card grid
 * plus a per-stage percentile table come from GET /journeys/summary; a
 * correlationId lookup renders a single journey's checkpoints and latencies.
 */
import { Button, Input, MetricDisplay, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, FieldGrid, JsonInspector, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

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

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>Look up a journey</h3>
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
          <div style={{ marginTop: 12 }}>
            {journey.isLoading ? (
              <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
            ) : journey.error ? (
              <Note type="error" label="Not found">
                {errMsg(journey.error)}
              </Note>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FieldGrid
                  fields={[
                    { label: 'Correlation ID', value: journey.data?.correlationId, mono: true },
                    { label: 'Started', value: fmtTime(journey.data?.startedAt), mono: true },
                    { label: 'Completed', value: fmtTime(journey.data?.completedAt), mono: true },
                    { label: 'Checkpoints', value: journey.data?.checkpoints?.length ?? 0 },
                  ]}
                />
                <JsonInspector value={journey.data ?? {}} />
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
