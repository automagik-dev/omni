'use client';

/**
 * Routing — the cross-instance view of how messages map to agents. It fans in
 * every instance's routes (the backend has no global route list), shows the
 * resolver's cache metrics, offers guarded create/toggle/delete (blocked on the
 * two production instances), and hosts the synthetic Route Test explainer.
 */
import { Badge, Button, MetricDisplay, Note } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { useScope } from '../../app/providers/ScopeProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { SchemaForm } from '../../components/SchemaForm';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../instances/components';
import { isProductionInstance } from '../instances/instance-helpers';
import { RouteTestPanel } from './RouteTestPanel';
import { type FannedRoute, fanInRoutes } from './routing-helpers';

const createRouteSchema = z.object({
  scope: z.enum(['chat', 'user']).describe('chat → needs chatId; user → needs personId'),
  agentId: z.string().min(1).describe('Agent UUID'),
  chatId: z.string().optional().describe('Chat UUID (scope=chat)'),
  personId: z.string().optional().describe('Person UUID (scope=user)'),
  label: z.string().optional().describe('Human label'),
  priority: z.number().int().optional().describe('Higher wins ties'),
  isActive: z.boolean().optional().describe('Active'),
});

function MetricsPanel() {
  const { ext } = useOmniClient();
  const metrics = useOmniQuery(['routes', 'metrics'], () => ext.routes.metrics(), { refetchInterval: 15_000 });
  const cache = (metrics.data?.data?.cache ?? {}) as Record<string, number>;

  return (
    <Panel title="Resolver cache" description="Global route-resolver cache metrics (live).">
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <MetricDisplay value={cache.hits ?? 0} label="Hits" />
        <MetricDisplay value={cache.misses ?? 0} label="Misses" />
        <MetricDisplay value={cache.hitRate != null ? `${cache.hitRate}%` : '—'} label="Hit rate" />
        <MetricDisplay value={cache.cacheSize ?? 0} label="Cache size" />
        <MetricDisplay value={cache.invalidations ?? 0} label="Invalidations" />
        <MetricDisplay value={cache.lastQueryMs != null ? `${cache.lastQueryMs}ms` : '—'} label="Last query" />
      </div>
    </Panel>
  );
}

function CreateRoutePanel({ onCreated }: { onCreated: () => void }) {
  const { ext } = useOmniClient();
  const scope = useScope();
  const [instanceId, setInstanceId] = useState('');
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isProd = isProductionInstance(instanceId);
  const guard = isProd ? 'Production instance — attaching routes is prohibited.' : undefined;

  return (
    <Panel title="Create route" description="Bind an agent to an instance by chat or person.">
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 360 }}>
        <span style={{ fontSize: 12, color: T.muted }}>Instance</span>
        <select
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          style={{
            padding: '7px 10px',
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: T.surface,
            color: T.fg,
            fontSize: 13,
          }}
        >
          <option value="">— pick an instance —</option>
          {scope.instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.channel}){isProductionInstance(i.id) ? ' · PROD' : ''}
            </option>
          ))}
        </select>
      </label>
      {guard && <Note type="default">{guard}</Note>}
      {error && <span style={{ fontSize: 12, color: T.danger }}>{error}</span>}
      {instanceId && (
        <SchemaForm
          schema={createRouteSchema}
          preview={isProd}
          submitLabel="Review route"
          onSubmit={(data) => {
            setError(null);
            const body: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
              if (v !== undefined && v !== '') body[k] = v;
            }
            setPending(body);
          }}
        />
      )}
      {pending && instanceId && !isProd && (
        <ActionButton
          label="Confirm create route"
          effect="live"
          targetName={scope.instances.find((i) => i.id === instanceId)?.name ?? instanceId}
          targetId={instanceId}
          confirmDescription="Attaches this route to the instance."
          onDone={() => {
            setPending(null);
            onCreated();
          }}
          run={() => ext.instances.createRoute(instanceId, pending)}
        />
      )}
    </Panel>
  );
}

export function RoutingPage() {
  const { ext } = useOmniClient();
  const scope = useScope();
  const instanceRefs = scope.instances.map((i) => ({ id: i.id, name: i.name }));

  const routes = useOmniQuery(
    ['routing', 'fan-in', instanceRefs.map((i) => i.id).join(',')],
    () => fanInRoutes(ext, instanceRefs),
    { enabled: instanceRefs.length > 0 },
  );

  const columns: ColumnDef<FannedRoute>[] = [
    {
      key: 'instanceName',
      header: 'Instance',
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, color: T.fg }}>{r.instanceName}</span>
          {isProductionInstance(r.instanceId) && <Badge variant="amber">prod</Badge>}
        </span>
      ),
    },
    { key: 'scope', header: 'Scope', width: 80, accessor: (r) => r.route.scope },
    { key: 'agentId', header: 'Agent', mono: true, width: 220, accessor: (r) => r.route.agentId ?? '—' },
    { key: 'label', header: 'Label', accessor: (r) => r.route.label ?? '—' },
    { key: 'priority', header: 'Prio', width: 60, accessor: (r) => r.route.priority ?? 0 },
    { key: 'isActive', header: 'Active', width: 70, accessor: (r) => (r.route.isActive === false ? 'no' : 'yes') },
    {
      key: 'actions',
      header: '',
      width: 240,
      render: (r) => {
        const prod = isProductionInstance(r.instanceId);
        const guard = prod ? 'Production instance — routes are read-only.' : undefined;
        return (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <ActionButton
              label={r.route.isActive === false ? 'Activate' : 'Deactivate'}
              effect="live"
              targetName={r.instanceName}
              targetId={r.instanceId}
              disabledReason={guard}
              onDone={() => void routes.refetch()}
              run={() => ext.instances.patchRoute(r.instanceId, r.route.id, { isActive: r.route.isActive === false })}
            />
            <ActionButton
              label="Delete"
              effect="live"
              destructive
              targetName={r.instanceName}
              targetId={r.instanceId}
              disabledReason={guard}
              confirmDescription={`Delete route ${r.route.label ?? r.route.id}.`}
              onDone={() => void routes.refetch()}
              run={() => ext.instances.deleteRoute(r.instanceId, r.route.id)}
            />
          </div>
        );
      },
    },
  ];

  return (
    <PageShell
      eyebrow="Channels & Access"
      title="Routing"
      description="How messages map to agents, across every instance."
      actions={
        <Button size="small" variant="secondary" onClick={() => void routes.refetch()}>
          Refresh
        </Button>
      }
    >
      <MetricsPanel />

      <Panel
        title="All routes"
        description="Fanned in from every instance."
        actions={<span style={{ fontSize: 12, color: T.muted }}>{routes.data?.length ?? 0} routes</span>}
      >
        <DataTable
          columns={columns}
          rows={routes.data ?? []}
          getRowKey={(r) => `${r.instanceId}:${r.route.id}`}
          loading={routes.isLoading}
          error={routes.error ? (routes.error as Error).message : null}
          emptyTitle="No routes configured"
        />
      </Panel>

      <RouteTestPanel instances={scope.instances} />

      <CreateRoutePanel onCreated={() => void routes.refetch()} />
    </PageShell>
  );
}
