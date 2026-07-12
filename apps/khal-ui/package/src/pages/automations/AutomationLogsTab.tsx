'use client';

/**
 * Execution logs for a single automation (GET /automations/:id/logs). Read-only.
 */
import { Badge, Button } from '@khal-os/ui';
import type { AutomationLogRow, AutomationRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { Panel } from '../instances/components';
import { logStatusVariant } from './automation-helpers';

export function AutomationLogsTab({ automation }: { automation: AutomationRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const logs = useOmniQuery(['automations', automation.id, 'logs'], () =>
    ext.automations.logs(automation.id, { limit: 50 }),
  );

  const columns: ColumnDef<AutomationLogRow>[] = [
    { key: 'createdAt', header: 'When', mono: true, width: 210, accessor: (l) => l.createdAt ?? '—' },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (l) => <Badge variant={logStatusVariant(l.status)}>{l.status ?? '—'}</Badge>,
    },
    { key: 'conditionsMatched', header: 'Matched', width: 90, accessor: (l) => (l.conditionsMatched ? 'yes' : 'no') },
    {
      key: 'executionTimeMs',
      header: 'Time',
      width: 90,
      accessor: (l) => (l.executionTimeMs != null ? `${l.executionTimeMs}ms` : '—'),
    },
    { key: 'error', header: 'Error', accessor: (l) => l.error ?? '—' },
  ];

  return (
    <Panel
      title="Execution logs"
      description="This automation's execution history."
      actions={
        <Button size="small" variant="secondary" onClick={() => void logs.refetch()}>
          Refresh
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={logs.data?.items ?? []}
        getRowKey={(l) => l.id ?? l.eventId ?? JSON.stringify(l)}
        loading={logs.isLoading}
        error={logs.error ? (logs.error as Error).message : null}
        emptyTitle="No executions logged"
      />
    </Panel>
  );
}
