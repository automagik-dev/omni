'use client';

/**
 * Health & Incidents — the single place to answer "is Omni OK right now?".
 * Combines the BFF↔backend edge (`/diag`), backend `/health` checks, NATS
 * consumer positions (`/health/consumers`), and dead-letter stats. All reads.
 */
import { Button, DataRow, MetricDisplay, ProgressBar, SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { useKhalToken } from '../../auth';
import { FreshnessBadge, formatAge } from '../../components/FreshnessBadge';
import { PageShell } from '../../components/PageShell';
import { SectionHead } from '../../components/ResourceDetail';
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

export function HealthPage() {
  const { client, bffBase } = useOmniClient();
  const token = useKhalToken();
  const { diag, observedAt, refresh } = useDiag(10_000);
  const health = useOmniQuery(['system', 'health'], () => client.system.health(), { refetchInterval: 15_000 });
  const consumers = useOmniQuery(
    // Key on the token so a login/logout re-polls under the new identity.
    ['health', 'consumers', token ?? null],
    async () => {
      // Forward the KHAL identity the same way the `ext` layer does — a bearer
      // when the host issued one, omitted (never `Bearer undefined`) otherwise.
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${bffBase}/api/v2/health/consumers`, { headers });
      return (await res.json()) as ConsumersResponse;
    },
    { refetchInterval: 15_000 },
  );
  const deadLetters = useOmniQuery(['dead-letters', 'stats'], () => client.deadLetters.stats(), {
    refetchInterval: 20_000,
  });

  const h = health.data;
  const dl = deadLetters.data;
  const dlTotal = dl?.total ?? 0;
  const dlPending = dl?.pending ?? 0;

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
          <SectionHead>BFF ↔ backend edge</SectionHead>
          {diag && (
            <StatusDot state={diag.auth === 'ok' ? 'online' : 'error'} size="sm" pulse showLabel label={diag.auth} />
          )}
        </div>
        {!diag && <Spinner size="sm" />}
        {diag && (
          <div>
            <DataRow variant="rule" label="Auth" value={diag.auth} accentColor={diag.auth === 'ok' ? T.ok : T.danger} />
            <DataRow variant="rule" label="Backend version" value={diag.version ?? '—'} />
            <DataRow
              variant="rule"
              label="Latency"
              value={diag.latencyMs !== undefined ? `${diag.latencyMs}ms` : '—'}
            />
            <DataRow variant="rule" label="Key" value={diag.keyName ?? diag.keyPrefix ?? '—'} />
            <DataRow variant="rule" label="Scopes" value={diag.scopes ? String(diag.scopes.length) : '—'} />
            <DataRow variant="rule" label="Origin" value={diag.baseUrl ?? '—'} />
          </div>
        )}
      </SectionCard>

      <SectionCard padding="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionHead>Backend health</SectionHead>
          {h && (
            <StatusDot
              state={h.status === 'healthy' ? 'online' : h.status === 'degraded' ? 'away' : 'error'}
              size="sm"
              pulse
              showLabel
              label={h.status}
            />
          )}
        </div>
        {!h && <Spinner size="sm" />}
        {h && (
          <div>
            {Object.entries(h.checks ?? {}).map(([name, check]) => {
              const status = (check as { status?: string; latency?: number }).status;
              const latency = (check as { latency?: number }).latency;
              const ok = status === 'ok';
              return (
                <DataRow
                  key={name}
                  variant="rule"
                  label={name}
                  value={latency !== undefined ? `${status ?? '—'} · ${latency}ms` : (status ?? '—')}
                  statusDot
                  dotColor={ok ? T.ok : T.danger}
                  accentColor={ok ? T.ok : T.danger}
                />
              );
            })}
            <DataRow variant="rule" label="uptime" value={formatAge(1000 * (h.uptime ?? 0))} />
          </div>
        )}
      </SectionCard>

      <SectionCard padding="md">
        <div style={{ marginBottom: 12 }}>
          <SectionHead>Consumers{consumers.data ? ` · ${consumers.data.totalTracked} tracked` : ''}</SectionHead>
        </div>
        {consumers.isLoading && <Spinner size="sm" />}
        {consumers.error && <span style={{ fontSize: 13, color: T.danger }}>{(consumers.error as Error).message}</span>}
        {consumers.data && consumers.data.consumers.length === 0 && (
          <span style={{ fontSize: 13, color: T.muted }}>No consumers tracked.</span>
        )}
        <div>
          {(consumers.data?.consumers ?? []).map((c) => (
            <DataRow
              key={c.consumer}
              variant="rule"
              label={c.consumer}
              value={`${c.stream} · seq ${c.lastSequence} · ${c.updatedAt ? formatAge(Date.now() - new Date(c.updatedAt).getTime()) : '—'}`}
            />
          ))}
        </div>
      </SectionCard>

      <SectionCard padding="md">
        <div style={{ marginBottom: 12 }}>
          <SectionHead>Dead letters</SectionHead>
        </div>
        {!dl && <Spinner size="sm" />}
        {dl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
              <MetricDisplay value={dlTotal} label="Total" accentColor={dlTotal > 0 ? T.warn : undefined} />
              <MetricDisplay value={dlPending} label="Pending" accentColor={dlPending > 0 ? T.danger : undefined} />
              <MetricDisplay value={dl.retrying ?? 0} label="Retrying" />
              <MetricDisplay value={dl.resolved ?? 0} label="Resolved" />
              <MetricDisplay value={dl.abandoned ?? 0} label="Abandoned" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: T.tertiary, fontFamily: T.mono, letterSpacing: '0.08em' }}>
                PENDING BACKLOG
              </span>
              <ProgressBar
                value={dlPending}
                max={Math.max(dlTotal, 1)}
                color={dlPending > 0 ? T.danger : T.ok}
                showLabel
              />
            </div>
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
