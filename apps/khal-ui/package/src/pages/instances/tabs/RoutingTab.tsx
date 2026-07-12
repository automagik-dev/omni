'use client';

/**
 * Routing tab: per-instance agent routes, CRUD only (deeper routing UX is Group
 * E). A create form, a live list, and per-row view / activate-toggle / delete.
 * Create/patch/delete are live actions gated on production; the list is a read.
 */
import { useState } from 'react';
import { z } from 'zod';
import type { AgentRouteRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { SchemaForm } from '../../../components/SchemaForm';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../components';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

const createRouteSchema = z.object({
  scope: z.enum(['chat', 'user']).describe('chat → needs chatId; user → needs personId'),
  agentId: z.string().min(1).describe('Agent UUID'),
  chatId: z.string().optional().describe('Chat UUID (scope=chat)'),
  personId: z.string().optional().describe('Person UUID (scope=user)'),
  label: z.string().optional().describe('Human label'),
  priority: z.number().int().optional().describe('Higher wins ties'),
  isActive: z.boolean().optional().describe('Active'),
});

export function RoutingTab({ instance, isProduction }: InstanceTabProps) {
  const { ext } = useOmniClient();
  const id = instance.id;
  const name = instance.name;
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;
  const [error, setError] = useState<string | null>(null);

  const routes = useOmniQuery(['instances', id, 'routes'], () => ext.instances.listRoutes(id));

  const submit = async (data: Record<string, unknown>) => {
    if (guard) {
      setError(guard);
      return;
    }
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== '') body[k] = v;
      }
      await ext.instances.createRoute(id, body);
      void routes.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const columns: ColumnDef<AgentRouteRow>[] = [
    { key: 'scope', header: 'Scope', width: 90 },
    { key: 'agentId', header: 'Agent', mono: true, accessor: (r) => r.agentId ?? '—' },
    { key: 'label', header: 'Label', accessor: (r) => r.label ?? '—' },
    { key: 'priority', header: 'Prio', width: 70, accessor: (r) => r.priority ?? 0 },
    { key: 'isActive', header: 'Active', width: 80, accessor: (r) => (r.isActive ? 'yes' : 'no') },
    {
      key: 'actions',
      header: '',
      width: 260,
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ActionButton
            label="View"
            effect="read-only"
            targetName={name}
            targetId={id}
            run={() => ext.instances.getRoute(id, r.id)}
          />
          <ActionButton
            label={r.isActive ? 'Deactivate' : 'Activate'}
            effect="live"
            targetName={name}
            targetId={id}
            disabledReason={guard}
            onDone={() => void routes.refetch()}
            run={() => ext.instances.patchRoute(id, r.id, { isActive: !r.isActive })}
          />
          <ActionButton
            label="Delete"
            effect="live"
            destructive
            targetName={name}
            targetId={id}
            disabledReason={guard}
            confirmDescription={`Delete route ${r.label ?? r.id}.`}
            onDone={() => void routes.refetch()}
            run={() => ext.instances.deleteRoute(id, r.id)}
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel title="Create route" description="Route this instance's traffic to an agent by chat or person.">
        {error && <span style={{ fontSize: 12, color: T.danger }}>{error}</span>}
        <SchemaForm
          schema={createRouteSchema}
          preview={isProduction}
          submitLabel="Create route"
          onSubmit={(data) => void submit(data as Record<string, unknown>)}
        />
      </Panel>

      <Panel
        title="Routes"
        description="Agent routes for this instance."
        actions={<span style={{ fontSize: 12, color: T.muted }}>{routes.data?.items?.length ?? 0} routes</span>}
      >
        <DataTable
          columns={columns}
          rows={routes.data?.items ?? []}
          getRowKey={(r) => r.id}
          loading={routes.isLoading}
          error={routes.error ? (routes.error as Error).message : null}
          emptyTitle="No routes"
        />
      </Panel>
    </div>
  );
}
