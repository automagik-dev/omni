'use client';

/**
 * Agents registry — the AI side of Omni. A card grid (rich, scannable) with a
 * DataTable toggle (dense, sortable-by-eye), a session-scoped provider health
 * probe so each agent shows its linked provider's last real status, and a gated
 * create flow. Rows link into the full per-agent detail.
 */
import { Badge, Button, PillBadge } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentRow, ProviderHealth, ProviderRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { AgentCard } from './AgentCard';
import { CreateAgentDialog } from './CreateAgentDialog';
import { agentCapabilities, agentTypeLabel, providerBadgeVariant } from './agent-helpers';

type ViewMode = 'cards' | 'table';

export function AgentsListPage() {
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('cards');
  const [creating, setCreating] = useState(false);
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({});
  const [probing, setProbing] = useState(false);

  const agents = useOmniQuery(['agents', 'list'], () => ext.agents.list({ limit: 200 }));
  const providers = useOmniQuery(['providers', 'list'], () => ext.providers.list());

  const providerById = new Map<string, ProviderRow>();
  for (const p of providers.data?.items ?? []) providerById.set(p.id, p);

  const rows = agents.data?.items ?? [];

  const probeProviders = async () => {
    const ids = new Set<string>();
    for (const a of rows) if (a.agentProviderId) ids.add(a.agentProviderId);
    if (ids.size === 0) return;
    setProbing(true);
    const next: Record<string, ProviderHealth> = {};
    await Promise.all(
      [...ids].map(async (id) => {
        try {
          next[id] = await ext.providers.health(id);
        } catch (err) {
          next[id] = { healthy: false, error: err instanceof Error ? err.message : 'probe failed' };
        }
      }),
    );
    setHealth((prev) => ({ ...prev, ...next }));
    setProbing(false);
  };

  const columns: ColumnDef<AgentRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: T.fg }}>{a.name}</span>
          {a.isInternal && <Badge variant="blue">internal</Badge>}
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      width: 120,
      render: (a) => <Badge variant={providerBadgeVariant(a.provider)}>{a.provider}</Badge>,
    },
    { key: 'agentType', header: 'Type', width: 110, accessor: (a) => agentTypeLabel(a.agentType) },
    { key: 'model', header: 'Model', accessor: (a) => a.model || '—' },
    {
      key: 'linkedProvider',
      header: 'Linked provider',
      render: (a) => {
        const p = a.agentProviderId ? providerById.get(a.agentProviderId) : undefined;
        const h = a.agentProviderId ? health[a.agentProviderId] : undefined;
        if (!p) return a.agentProviderId ? `${a.agentProviderId.slice(0, 8)}…` : '—';
        return (
          <span>
            {p.name}{' '}
            <span style={{ color: h ? (h.healthy ? T.ok : T.danger) : T.muted }}>
              {h ? (h.healthy ? '✓' : '✕') : '·'}
            </span>
          </span>
        );
      },
    },
    {
      key: 'capabilities',
      header: 'Capabilities',
      render: (a) => {
        const caps = agentCapabilities(a);
        return caps.length ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {caps.slice(0, 4).map((c) => (
              <PillBadge key={c}>{c}</PillBadge>
            ))}
            {caps.length > 4 && <span style={{ fontSize: 11, color: T.muted }}>+{caps.length - 4}</span>}
          </div>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'isActive',
      header: 'Status',
      width: 100,
      render: (a) => <Badge variant={a.isActive ? 'green' : 'gray'}>{a.isActive ? 'active' : 'inactive'}</Badge>,
    },
    { key: 'id', header: 'ID', mono: true, width: 220 },
  ];

  return (
    <PageShell
      eyebrow="Agents & Automation"
      title="Agents"
      description="First-class agent registry — bindings, providers, capabilities, and health."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {(['cards', 'table'] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  background: view === m ? T.accent : 'transparent',
                  color: view === m ? '#fff' : T.muted,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <Button size="small" variant="secondary" disabled={probing} onClick={() => void probeProviders()}>
            {probing ? 'Probing…' : 'Probe providers'}
          </Button>
          <Button size="small" variant="secondary" onClick={() => void agents.refetch()}>
            Refresh
          </Button>
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New agent
          </Button>
        </div>
      }
    >
      {agents.error && <div style={{ fontSize: 13, color: T.danger }}>{(agents.error as Error).message}</div>}

      {view === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {rows.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              provider={a.agentProviderId ? providerById.get(a.agentProviderId) : undefined}
              health={a.agentProviderId ? health[a.agentProviderId] : undefined}
              onOpen={() => navigate(`/agents/${a.id}`)}
            />
          ))}
          {!agents.isLoading && rows.length === 0 && (
            <span style={{ fontSize: 13, color: T.muted }}>No agents registered.</span>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(a) => a.id}
          loading={agents.isLoading}
          error={agents.error ? (agents.error as Error).message : null}
          emptyTitle="No agents"
          onRowClick={(a) => navigate(`/agents/${a.id}`)}
        />
      )}

      <CreateAgentDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void agents.refetch();
          navigate(`/agents/${id}`);
        }}
      />
    </PageShell>
  );
}
