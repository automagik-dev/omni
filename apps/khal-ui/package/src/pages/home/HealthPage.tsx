'use client';

/**
 * Health & Incidents — the single place to answer "is Omni OK right now?".
 * Combines the BFF↔backend edge (`/diag`), backend `/health` checks, NATS
 * consumer positions (`/health/consumers`), and dead-letter stats. All reads.
 */
import { Button, MetricDisplay, SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { DataTable } from '../../components/DataTable';
import type { ColumnDef } from '../../components/DataTable';
import { FreshnessBadge, formatAge } from '../../components/FreshnessBadge';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useDiag } from '../../hooks/useDiag';
import { useOmniQuery } from '../../hooks/useOmniQuery';

interface Consumer {
  consumer: string;
  stream: string;
  lastSequence: number;
  lastEventId: string;
  updatedAt: string;
}

interface ConsumersResponse {
  status: string;
  consumers: Consumer[];
  totalTracked: number;
}

const consumerColumns: ColumnDef<Consumer>[] = [
  { key: 'consumer', header: 'Consumer' },
  { key: 'stream', header: 'Stream', width: 120 },
  { key: 'lastSequence', header: 'Last seq', width: 110, mono: true, align: 'right' },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: 110,
    mono: true,
    accessor: (c) => (c.updatedAt ? formatAge(Date.now() - new Date(c.updatedAt).getTime()) : '—'),
  },
];

export function HealthPage() {
  const { client, bffBase } = useOmniClient();
  const { diag, observedAt, refresh } = useDiag(10_000);
  const health = useOmniQuery(['system', 'health'], () => client.system.health(), { refetchInterval: 15_000 });
  const consumers = useOmniQuery(
    ['health', 'consumers'],
    async () => {
      const res = await fetch(`${bffBase}/api/v2/health/consumers`, { headers: { accept: 'application/json' } });
      return (await res.json()) as ConsumersResponse;
    },
    { refetchInterval: 15_000 },
  );
  const deadLetters = useOmniQuery(['dead-letters', 'stats'], () => client.deadLetters.stats(), {
    refetchInterval: 20_000,
  });

  const h = health.data;
  const dl = deadLetters.data;

  return (
    <PageShell
      eyebrow="Home"
      title="Health & Incidents"
      description="BFF, backend, consumer lag, and dead letters."
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessBadge observedAt={observedAt} source="/diag" degraded={diag !== undefined && diag.auth !== 'ok'} />
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              refresh();
              void health.refetch();
              void consumers.refetch();
              void deadLetters.refetch();
            }}
          >
            Refresh
          </Button>
        </div>
      }
    >
      <SectionCard padding="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>BFF ↔ backend edge</h3>
          {diag && <StatusDot state={diag.auth === 'ok' ? 'active' : 'error'} size="sm" showLabel label={diag.auth} />}
        </div>
        {!diag && <Spinner size="sm" />}
        {diag && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <Field label="Auth" value={diag.auth} accent={diag.auth === 'ok' ? T.ok : T.danger} />
            <Field label="Backend version" value={diag.version ?? '—'} mono />
            <Field label="Latency" value={diag.latencyMs !== undefined ? `${diag.latencyMs}ms` : '—'} mono />
            <Field label="Key" value={diag.keyName ?? diag.keyPrefix ?? '—'} mono />
            <Field label="Scopes" value={diag.scopes ? String(diag.scopes.length) : '—'} />
            <Field label="Origin" value={diag.baseUrl ?? '—'} mono />
          </div>
        )}
      </SectionCard>

      <SectionCard padding="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>Backend health</h3>
          {h && (
            <StatusDot
              state={h.status === 'healthy' ? 'active' : h.status === 'degraded' ? 'away' : 'error'}
              size="sm"
              showLabel
              label={h.status}
            />
          )}
        </div>
        {!h && <Spinner size="sm" />}
        {h && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            {Object.entries(h.checks ?? {}).map(([name, check]) => {
              const status = (check as { status?: string; latency?: number }).status;
              const latency = (check as { latency?: number }).latency;
              return (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusDot state={status === 'ok' ? 'active' : 'error'} size="sm" />
                  <span style={{ fontSize: 13, color: T.fg, textTransform: 'capitalize' }}>{name}</span>
                  {latency !== undefined && (
                    <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{latency}ms</span>
                  )}
                </div>
              );
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: T.muted }}>uptime</span>
              <span style={{ fontSize: 13, color: T.fg, fontFamily: T.mono }}>{formatAge(1000 * (h.uptime ?? 0))}</span>
            </div>
          </div>
        )}
      </SectionCard>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>
          Consumers{consumers.data ? ` (${consumers.data.totalTracked} tracked)` : ''}
        </h3>
        <DataTable
          columns={consumerColumns}
          rows={consumers.data?.consumers ?? []}
          getRowKey={(c) => c.consumer}
          loading={consumers.isLoading}
          error={consumers.error ? (consumers.error as Error).message : null}
          emptyTitle="No consumers tracked"
        />
      </section>

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: T.fg }}>Dead letters</h3>
        {!dl && <Spinner size="sm" />}
        {dl && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
            <MetricDisplay value={dl.total ?? 0} label="Total" accentColor={(dl.total ?? 0) > 0 ? T.warn : undefined} />
            <MetricDisplay
              value={dl.pending ?? 0}
              label="Pending"
              accentColor={(dl.pending ?? 0) > 0 ? T.danger : undefined}
            />
            <MetricDisplay value={dl.retrying ?? 0} label="Retrying" />
            <MetricDisplay value={dl.resolved ?? 0} label="Resolved" />
            <MetricDisplay value={dl.abandoned ?? 0} label="Abandoned" />
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}

function Field({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span
        style={{ fontSize: 13, color: accent ?? T.fg, fontFamily: mono ? T.mono : undefined, wordBreak: 'break-all' }}
      >
        {value}
      </span>
    </div>
  );
}
