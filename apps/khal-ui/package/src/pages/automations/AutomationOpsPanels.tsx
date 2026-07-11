'use client';

/**
 * Engine-wide automation observability: the engine metrics snapshot and the
 * recent global execution logs (across all automations). Both are live reads.
 */
import { Badge, Button, MetricDisplay } from '@khal-os/ui';
import type { AutomationLogRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { Panel } from '../instances/components';
import { logStatusVariant } from './automation-helpers';

export function AutomationMetricsPanel() {
  const { ext } = useOmniClient();
  const metrics = useOmniQuery(['automation-metrics'], () => ext.automations.metrics(), { refetchInterval: 15_000 });
  const m = metrics.data ?? {};

  return (
    <Panel
      title="Engine metrics"
      description="Automation engine health (live)."
      actions={<Badge variant={m.running ? 'green' : 'gray'}>{m.running ? 'running' : 'stopped'}</Badge>}
    >
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <MetricDisplay value={m.totalExecutions ?? 0} label="Executions" />
        <MetricDisplay value={m.totalActions ?? 0} label="Actions" />
        <MetricDisplay value={m.successRate != null ? `${m.successRate}%` : '—'} label="Success rate" />
        <MetricDisplay value={m.avgExecutionTimeMs != null ? `${m.avgExecutionTimeMs}ms` : '—'} label="Avg time" />
        <MetricDisplay
          value={m.recentFailures ?? 0}
          label="Recent failures"
          accentColor={(m.recentFailures ?? 0) > 0 ? T.warn : undefined}
        />
        <MetricDisplay value={Array.isArray(m.instanceQueues) ? m.instanceQueues.length : 0} label="Instance queues" />
      </div>
    </Panel>
  );
}

const LOG_COLUMNS: ColumnDef<AutomationLogRow>[] = [
  { key: 'createdAt', header: 'When', mono: true, width: 210, accessor: (l) => l.createdAt ?? '—' },
  { key: 'automationId', header: 'Automation', mono: true, width: 220, accessor: (l) => l.automationId ?? '—' },
  {
    key: 'status',
    header: 'Status',
    width: 100,
    render: (l) => <Badge variant={logStatusVariant(l.status)}>{l.status ?? '—'}</Badge>,
  },
  {
    key: 'executionTimeMs',
    header: 'Time',
    width: 90,
    accessor: (l) => (l.executionTimeMs != null ? `${l.executionTimeMs}ms` : '—'),
  },
  { key: 'error', header: 'Error', accessor: (l) => l.error ?? '—' },
];

export function AutomationGlobalLogsPanel() {
  const { ext } = useOmniClient();
  const logs = useOmniQuery(['automation-logs', 'global'], () => ext.automations.globalLogs({ limit: 25 }));

  return (
    <Panel
      title="Recent executions (all automations)"
      description="Global execution log."
      actions={
        <Button size="small" variant="secondary" onClick={() => void logs.refetch()}>
          Refresh
        </Button>
      }
    >
      <DataTable
        columns={LOG_COLUMNS}
        rows={logs.data?.items ?? []}
        getRowKey={(l) => l.id ?? l.eventId ?? JSON.stringify(l)}
        loading={logs.isLoading}
        error={logs.error ? (logs.error as Error).message : null}
        emptyTitle="No executions logged yet"
      />
    </Panel>
  );
}
