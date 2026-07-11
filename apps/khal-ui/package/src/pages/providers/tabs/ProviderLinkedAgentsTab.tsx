'use client';

/**
 * Agents in the registry that link to this provider (agentProviderId ===
 * provider.id), derived client-side. Read-only, with row navigation into each
 * agent's detail.
 */
import { Badge } from '@khal-os/ui';
import { useNavigate } from 'react-router-dom';
import type { AgentRow, ProviderRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { agentTypeLabel } from '../../agents/agent-helpers';
import { Panel } from '../../instances/components';

export function ProviderLinkedAgentsTab({ provider }: { provider: ProviderRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const agents = useOmniQuery(['agents', 'list'], () => ext.agents.list({ limit: 200 }));
  const linked = (agents.data?.items ?? []).filter((a) => a.agentProviderId === provider.id);

  const columns: ColumnDef<AgentRow>[] = [
    { key: 'name', header: 'Name', render: (a) => <span style={{ fontWeight: 600, color: T.fg }}>{a.name}</span> },
    { key: 'agentType', header: 'Type', width: 110, accessor: (a) => agentTypeLabel(a.agentType) },
    { key: 'model', header: 'Model', accessor: (a) => a.model || '—' },
    {
      key: 'isActive',
      header: 'Status',
      width: 100,
      render: (a) => <Badge variant={a.isActive ? 'green' : 'gray'}>{a.isActive ? 'active' : 'inactive'}</Badge>,
    },
    { key: 'id', header: 'ID', mono: true, width: 220 },
  ];

  return (
    <Panel title="Linked agents" actions={<span style={{ fontSize: 12, color: T.muted }}>{linked.length}</span>}>
      <DataTable
        columns={columns}
        rows={linked}
        getRowKey={(a) => a.id}
        loading={agents.isLoading}
        error={agents.error ? (agents.error as Error).message : null}
        emptyTitle="No agents link to this provider"
        onRowClick={(a) => navigate(`/agents/${a.id}`)}
      />
    </Panel>
  );
}
