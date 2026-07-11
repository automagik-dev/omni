'use client';

/**
 * Overview — the live landing page. Pulls instance states, backend health/info,
 * and event volume straight from the backend through the BFF (all read-only) and
 * lays them out as stat tiles, an instance list, health checks, and a recent
 * events table.
 */
import { Button, MetricDisplay, SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import type { Event } from '@omni/sdk';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { useScope } from '../../app/providers/ScopeProvider';
import { DataTable } from '../../components/DataTable';
import type { ColumnDef } from '../../components/DataTable';
import { formatAge } from '../../components/FreshnessBadge';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';

const eventColumns: ColumnDef<Event>[] = [
  { key: 'eventType', header: 'Type', width: 160 },
  { key: 'direction', header: 'Dir', width: 80 },
  { key: 'contentType', header: 'Content', width: 100, accessor: (e) => e.contentType ?? '—' },
  {
    key: 'textContent',
    header: 'Preview',
    accessor: (e) => {
      const text = e.textContent ?? e.transcription ?? e.imageDescription ?? '';
      return text.length > 80 ? `${text.slice(0, 80)}…` : text || '—';
    },
  },
  {
    key: 'receivedAt',
    header: 'Received',
    width: 110,
    mono: true,
    accessor: (e) => (e.receivedAt ? formatAge(Date.now() - new Date(e.receivedAt).getTime()) : '—'),
  },
];

export function OverviewPage() {
  const { client } = useOmniClient();
  const scope = useScope();

  const health = useOmniQuery(['system', 'health'], () => client.system.health(), { refetchInterval: 20_000 });
  const analytics = useOmniQuery(['events', 'analytics'], () => client.events.analytics(), { staleTime: 30_000 });
  const events = useOmniQuery(['events', 'recent', 8], () => client.events.list({ limit: 8 }));

  const h = health.data;
  const a = analytics.data;
  const instances = scope.instances;

  const inbound = a?.byDirection?.inbound ?? 0;
  const outbound = a?.byDirection?.outbound ?? 0;
  const activeCount = instances.filter((i) => i.isActive).length;

  return (
    <PageShell
      eyebrow="Home"
      title="Overview"
      description="Live instance states, backend health, and event volume."
      actions={
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            void health.refetch();
            void analytics.refetch();
            void events.refetch();
            scope.refreshInstances();
          }}
        >
          Refresh
        </Button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <SectionCard padding="md">
          <MetricDisplay
            value={h ? `${activeCount}/${h.instances?.total ?? instances.length}` : '—'}
            label="Instances active"
            description={h ? `${h.instances?.connected ?? 0} connected` : 'loading'}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={h?.status ?? '—'}
            label="Backend status"
            accentColor={h?.status === 'healthy' ? T.ok : h?.status === 'degraded' ? T.warn : T.danger}
            description={h?.version ? `v${h.version}` : ''}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={a?.totalMessages ?? '—'} label="Events (total)" description="all-time" />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={a ? `${inbound}/${outbound}` : '—'}
            label="Inbound / outbound"
            description={a ? `${Math.round(a.successRate ?? 0)}% success` : ''}
          />
        </SectionCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <SectionCard padding="md">
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>Instances</h3>
          {scope.instancesLoading && <Spinner size="sm" />}
          {!scope.instancesLoading && instances.length === 0 && (
            <span style={{ fontSize: 13, color: T.muted }}>No instances.</span>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {instances.map((inst) => (
              <li key={inst.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StatusDot state={inst.isActive ? 'active' : 'idle'} size="sm" />
                <span style={{ fontSize: 13, color: T.fg, fontWeight: 500, flex: 1, minWidth: 0 }}>{inst.name}</span>
                <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{inst.channel}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard padding="md">
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>Health checks</h3>
          {!h && <Spinner size="sm" />}
          {h && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(h.checks ?? {}).map(([name, check]) => {
                const status = (check as { status?: string }).status;
                return (
                  <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <StatusDot state={status === 'ok' ? 'active' : 'error'} size="sm" />
                    <span style={{ fontSize: 13, color: T.fg, flex: 1, textTransform: 'capitalize' }}>{name}</span>
                    <span style={{ fontSize: 11, color: status === 'ok' ? T.ok : T.danger, fontFamily: T.mono }}>
                      {status ?? 'unknown'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>Recent events</h3>
        <DataTable
          columns={eventColumns}
          rows={events.data?.items ?? []}
          getRowKey={(e) => e.id}
          loading={events.isLoading}
          error={events.error ? (events.error as Error).message : null}
          emptyTitle="No recent events"
        />
      </section>
    </PageShell>
  );
}
