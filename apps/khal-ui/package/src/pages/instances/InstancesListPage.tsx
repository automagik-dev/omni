'use client';

/**
 * Instances list — the entry point of the channels vertical. A live DataTable of
 * every instance (name, channel, active/default, profile) with a create flow and
 * row navigation into the per-instance detail. Production instances are tagged
 * so an operator sees, before clicking in, which rows are read-only.
 */
import { Badge, Button, PillBadge } from '@khal-os/ui';
import type { Instance } from '@omni/sdk';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '../../app/providers/ScopeProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { CreateInstanceDialog } from './CreateInstanceDialog';
import { channelLabel, isProductionInstance } from './instance-helpers';

export function InstancesListPage() {
  const scope = useScope();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const columns: ColumnDef<Instance>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (i) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: T.fg }}>{i.name}</span>
          {i.isDefault && <PillBadge>default</PillBadge>}
          {isProductionInstance(i.id) && (
            <span style={{ fontSize: 10, color: T.warn, fontWeight: 700, letterSpacing: '0.04em' }}>
              PROD · READ-ONLY
            </span>
          )}
        </div>
      ),
    },
    { key: 'channel', header: 'Channel', width: 170, accessor: (i) => channelLabel(i.channel) },
    {
      key: 'isActive',
      header: 'Status',
      width: 110,
      render: (i) => <Badge variant={i.isActive ? 'green' : 'gray'}>{i.isActive ? 'active' : 'inactive'}</Badge>,
    },
    { key: 'profileName', header: 'Profile', accessor: (i) => i.profileName ?? '—' },
    { key: 'id', header: 'ID', mono: true, width: 300 },
  ];

  return (
    <PageShell
      eyebrow="Channels"
      title="Instances"
      description="Channel instances, their connection status, and per-instance configuration."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" variant="secondary" onClick={() => scope.refreshInstances()}>
            Refresh
          </Button>
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New instance
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        rows={scope.instances}
        getRowKey={(i) => i.id}
        loading={scope.instancesLoading}
        error={scope.instancesError ? scope.instancesError.message : null}
        emptyTitle="No instances yet"
        emptyDescription="Create one to connect a channel."
        onRowClick={(i) => navigate(`/instances/${i.id}`)}
      />

      <CreateInstanceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          scope.refreshInstances();
          navigate(`/instances/${id}`);
        }}
      />
    </PageShell>
  );
}
