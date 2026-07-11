'use client';

/**
 * Automations list — event-driven workflows. A table with a gated enable/disable
 * toggle per row and a create flow, over the engine metrics and global execution
 * log so an operator sees both the config and the live behaviour on one screen.
 */
import { Badge, Button } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AutomationRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton } from '../instances/components';
import { AutomationGlobalLogsPanel, AutomationMetricsPanel } from './AutomationOpsPanels';
import { CreateAutomationDialog } from './CreateAutomationDialog';

export function AutomationsListPage() {
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const automations = useOmniQuery(['automations', 'list'], () => ext.automations.list());

  const columns: ColumnDef<AutomationRow>[] = [
    { key: 'name', header: 'Name', render: (a) => <span style={{ fontWeight: 600, color: T.fg }}>{a.name}</span> },
    { key: 'triggerEventType', header: 'Trigger', mono: true, accessor: (a) => a.triggerEventType },
    { key: 'actions', header: 'Actions', width: 80, accessor: (a) => a.actions?.length ?? 0 },
    { key: 'priority', header: 'Prio', width: 60, accessor: (a) => a.priority ?? 0 },
    {
      key: 'enabled',
      header: 'Enabled',
      width: 90,
      render: (a) => <Badge variant={a.enabled ? 'green' : 'gray'}>{a.enabled ? 'on' : 'off'}</Badge>,
    },
    {
      key: 'toggle',
      header: '',
      width: 130,
      render: (a) => (
        <ActionButton
          label={a.enabled ? 'Disable' : 'Enable'}
          effect="live"
          targetName={a.name}
          targetId={a.id}
          confirmDescription={
            a.enabled ? 'Stops this automation from firing.' : 'This automation will fire on matching events.'
          }
          onDone={() => void automations.refetch()}
          run={() => (a.enabled ? ext.automations.disable(a.id) : ext.automations.enable(a.id))}
        />
      ),
    },
  ];

  return (
    <PageShell
      eyebrow="Agents & Automation"
      title="Automations"
      description="Event-driven workflows — triggers, conditions, and actions."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" variant="secondary" onClick={() => void automations.refetch()}>
            Refresh
          </Button>
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New automation
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        rows={automations.data?.items ?? []}
        getRowKey={(a) => a.id}
        loading={automations.isLoading}
        error={automations.error ? (automations.error as Error).message : null}
        emptyTitle="No automations"
        onRowClick={(a) => navigate(`/automations/${a.id}`)}
      />

      <AutomationMetricsPanel />
      <AutomationGlobalLogsPanel />

      <CreateAutomationDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void automations.refetch();
          navigate(`/automations/${id}`);
        }}
      />
    </PageShell>
  );
}
