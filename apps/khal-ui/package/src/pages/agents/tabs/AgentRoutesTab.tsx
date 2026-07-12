'use client';

/**
 * Routes that reference this agent, derived read-only by fanning in every
 * instance's routes and filtering client-side (there is no cross-instance route
 * list on the backend). Shows which instances would dispatch to this agent and
 * under what scope — a quick "where is this agent wired?" answer.
 */
import type { AgentRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { useScope } from '../../../app/providers/ScopeProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { Panel } from '../../instances/components';
import { type FannedRoute, fanInRoutes } from '../../routing/routing-helpers';

export function AgentRoutesTab({ agent }: { agent: AgentRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const scope = useScope();
  const instanceRefs = scope.instances.map((i) => ({ id: i.id, name: i.name }));

  const routes = useOmniQuery(
    ['routing', 'fan-in', instanceRefs.map((i) => i.id).join(',')],
    () => fanInRoutes(ext, instanceRefs),
    { enabled: instanceRefs.length > 0 },
  );

  const mine = (routes.data ?? []).filter((r) => r.route.agentId === agent.id);

  const columns: ColumnDef<FannedRoute>[] = [
    {
      key: 'instanceName',
      header: 'Instance',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.instanceName}</span>,
    },
    { key: 'scope', header: 'Scope', width: 90, accessor: (r) => r.route.scope },
    { key: 'label', header: 'Label', accessor: (r) => r.route.label ?? '—' },
    { key: 'priority', header: 'Prio', width: 70, accessor: (r) => r.route.priority ?? 0 },
    { key: 'isActive', header: 'Active', width: 80, accessor: (r) => (r.route.isActive === false ? 'no' : 'yes') },
    { key: 'routeId', header: 'Route ID', mono: true, width: 220, accessor: (r) => r.route.id },
  ];

  return (
    <Panel
      title="Routes using this agent"
      description="Read-only — derived by scanning every instance's routes."
      actions={<span style={{ fontSize: 12, color: T.muted }}>{mine.length} route(s)</span>}
    >
      <DataTable
        columns={columns}
        rows={mine}
        getRowKey={(r) => `${r.instanceId}:${r.route.id}`}
        loading={routes.isLoading}
        error={routes.error ? (routes.error as Error).message : null}
        emptyTitle="No routes reference this agent"
      />
    </Panel>
  );
}
