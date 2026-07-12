'use client';

/**
 * Overview — the live landing page. Pulls instance states, backend health/info,
 * and event volume straight from the backend through the BFF (all read-only) and
 * lays them out as animated stat tiles, an instance list, health checks, and a
 * live feed of recent events.
 */
import { Button, DataRow, LiveFeed, NumberFlow, SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import type { FeedEvent, StatusState } from '@khal-os/ui';
import type { ReactNode } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { useScope } from '../../app/providers/ScopeProvider';
import { PageShell } from '../../components/PageShell';
import { SectionHead } from '../../components/ResourceDetail';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { feedMessage, toFeedType } from './feed-helpers';
import '../../components/runtime-styles';

/** Uniform stat tile: an animated/composed value over a label and subtext. */
function StatTile({
  value,
  label,
  description,
  dotState,
  accentColor,
}: {
  value: ReactNode;
  label: string;
  description?: string;
  dotState?: StatusState;
  accentColor?: string;
}) {
  return (
    <SectionCard padding="md" className="omni-card-hover">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {dotState && <StatusDot state={dotState} size="sm" pulse />}
          <span
            style={{
              fontSize: 30,
              fontWeight: 650,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              color: accentColor ?? T.fg,
              lineHeight: 1.1,
            }}
          >
            {value}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12.5, color: T.secondary }}>{label}</span>
          {description && <span style={{ fontSize: 11.5, color: T.tertiary, fontFamily: T.mono }}>{description}</span>}
        </div>
      </div>
    </SectionCard>
  );
}

export function OverviewPage() {
  const { client } = useOmniClient();
  const scope = useScope();

  const health = useOmniQuery(['system', 'health'], () => client.system.health(), { refetchInterval: 20_000 });
  const analytics = useOmniQuery(['events', 'analytics'], () => client.events.analytics(), { staleTime: 30_000 });
  const events = useOmniQuery(['events', 'recent', 12], () => client.events.list({ limit: 12 }));

  const h = health.data;
  const a = analytics.data;
  const instances = scope.instances;

  const inbound = a?.byDirection?.inbound ?? 0;
  const outbound = a?.byDirection?.outbound ?? 0;
  const activeCount = instances.filter((i) => i.isActive).length;
  const connected = h?.instances?.connected ?? 0;
  const totalInstances = h?.instances?.total ?? instances.length;
  // Honest label: outbound as a share of inbound (how many inbound get a reply),
  // not the backend's overall processing "success rate" (which reads alarmingly
  // low next to raw volume because most inbound traffic is never agent-answered).
  const replyPct = inbound > 0 ? Math.round((outbound / inbound) * 100) : null;

  const healthState: StatusState =
    h?.status === 'healthy' ? 'online' : h?.status === 'degraded' ? 'away' : h ? 'error' : 'idle';
  const healthWord = h?.status ? h.status.charAt(0).toUpperCase() + h.status.slice(1) : '—';

  const feedEvents: FeedEvent[] = (events.data?.items ?? []).map((e) => ({
    id: e.id,
    type: toFeedType(e),
    message: feedMessage(e),
    timestamp: e.receivedAt ? new Date(e.receivedAt) : undefined,
  }));

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <StatTile
          value={<NumberFlow value={activeCount} />}
          label="Instances active"
          description={`${connected}/${totalInstances} connected`}
          dotState={activeCount > 0 ? 'active' : 'idle'}
        />
        <StatTile
          value={healthWord}
          label="Backend status"
          description={h?.version ? `v${h.version}` : 'loading'}
          dotState={healthState}
        />
        <StatTile value={<NumberFlow value={a?.totalMessages ?? 0} />} label="Events (total)" description="all-time" />
        <StatTile
          value={
            <span>
              <NumberFlow value={inbound} /> <span style={{ color: T.tertiary }}>/</span>{' '}
              <NumberFlow value={outbound} />
            </span>
          }
          label="Inbound / outbound"
          description={replyPct === null ? 'no inbound yet' : `${replyPct}% replied`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <SectionCard padding="md">
          <div style={{ marginBottom: 12 }}>
            <SectionHead>Instances</SectionHead>
          </div>
          {scope.instancesLoading && <Spinner size="sm" />}
          {!scope.instancesLoading && instances.length === 0 && (
            <span style={{ fontSize: 13, color: T.muted }}>No instances.</span>
          )}
          <div>
            {instances.map((inst, i) => (
              <div
                key={inst.id}
                className="omni-row khal-anim-fade-up"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 8px',
                  borderBottom: `1px solid ${T.borderSubtle}`,
                  animationDelay: `${i * 60}ms`,
                }}
              >
                <StatusDot state={inst.isActive ? 'active' : 'idle'} size="sm" pulse={inst.isActive} />
                <span style={{ fontSize: 13, color: T.fg, fontWeight: 500, flex: 1, minWidth: 0 }}>{inst.name}</span>
                <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{inst.channel}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard padding="md">
          <div style={{ marginBottom: 12 }}>
            <SectionHead>Health checks</SectionHead>
          </div>
          {!h && <Spinner size="sm" />}
          {h && (
            <div>
              {Object.entries(h.checks ?? {}).map(([name, check]) => {
                const status = (check as { status?: string }).status;
                const ok = status === 'ok';
                return (
                  <DataRow
                    key={name}
                    variant="rule"
                    label={name}
                    value={status ?? 'unknown'}
                    statusDot
                    dotColor={ok ? T.ok : T.danger}
                    accentColor={ok ? T.ok : T.danger}
                  />
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionHead>Recent events</SectionHead>
        {events.error ? (
          <span style={{ fontSize: 13, color: T.danger }}>{(events.error as Error).message}</span>
        ) : (
          <SectionCard padding="sm">
            <LiveFeed events={feedEvents} height={320} showTimestamps />
          </SectionCard>
        )}
      </section>
    </PageShell>
  );
}
