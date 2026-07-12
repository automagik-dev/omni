'use client';

/**
 * Groups — a cross-instance directory of group chats. Fans GET
 * /instances/:id/groups in across every instance and tags each row with its
 * source instance. Deep group management (subject, participants, invites) lives
 * on the instance detail's Groups tab — each row links there.
 */
import { Badge, Button, Input, Note } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GroupRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { StatGrid, errMsg, fmtTime, useInstanceMap } from './shared';

interface GroupWithInstance extends GroupRow {
  __instanceId: string;
  __instanceName: string;
}

export function GroupsPage() {
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const { instances, loading: instancesLoading } = useInstanceMap();
  const [search, setSearch] = useState('');

  const groups = useOmniQuery(
    ['groups', 'cross-instance', instances.map((i) => i.id).join(',')],
    async (): Promise<GroupWithInstance[]> => {
      const results = await Promise.allSettled(
        instances.map(async (inst) => {
          const res = await ext.instances.groups(inst.id, { limit: 200 });
          return (res.items ?? []).map((g) => ({ ...g, __instanceId: inst.id, __instanceName: inst.name }));
        }),
      );
      return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    },
    { enabled: instances.length > 0 },
  );

  const q = search.trim().toLowerCase();
  const rows = (groups.data ?? []).filter(
    (g) => !q || (g.name ?? '').toLowerCase().includes(q) || (g.externalId ?? '').toLowerCase().includes(q),
  );

  const columns: ColumnDef<GroupWithInstance>[] = [
    {
      key: 'name',
      header: 'Group',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.name ?? '(unnamed)'}</span>,
    },
    { key: 'instance', header: 'Instance', render: (r) => <Badge variant="blue">{r.__instanceName}</Badge> },
    { key: 'memberCount', header: 'Members', width: 100, align: 'right', accessor: (r) => r.memberCount ?? '—' },
    { key: 'createdAt', header: 'Created', width: 180, mono: true, accessor: (r) => fmtTime(r.createdAt) },
    {
      key: 'manage',
      header: '',
      width: 120,
      render: (r) => (
        <Button size="small" variant="secondary" onClick={() => navigate(`/instances/${r.__instanceId}`)}>
          Manage →
        </Button>
      ),
    },
  ];

  return (
    <PageShell
      eyebrow="Messaging"
      title="Groups"
      description="Cross-instance group directory. Deep management lives on each instance."
      actions={
        <Button size="small" variant="secondary" onClick={() => void groups.refetch()}>
          Refresh
        </Button>
      }
    >
      {instancesLoading ? (
        <Note type="default">Loading instances…</Note>
      ) : (
        <>
          <StatGrid
            min={150}
            stats={[
              { label: 'Groups', value: groups.data?.length ?? 0 },
              { label: 'Instances scanned', value: instances.length },
            ]}
          />

          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => `${r.__instanceId}:${r.externalId ?? r.name}`}
            loading={groups.isLoading}
            error={errMsg(groups.error)}
            emptyTitle="No groups"
            emptyDescription="No instance returned any groups."
            toolbar={<Input placeholder="Filter groups…" value={search} onChange={(e) => setSearch(e.target.value)} />}
          />
        </>
      )}
    </PageShell>
  );
}
