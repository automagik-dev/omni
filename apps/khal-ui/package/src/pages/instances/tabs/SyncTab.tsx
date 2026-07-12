'use client';

/**
 * Sync tab: an immediate profile sync, a start-sync form (type + depth +
 * media), and the history of sync jobs with live status. Starting a sync is a
 * live action gated on production; profile sync and the job list are reads/soft
 * actions available everywhere.
 */
import type { StartSyncBody, SyncJobSummary } from '@omni/sdk';
import { useState } from 'react';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../components';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

const SYNC_TYPES: StartSyncBody['type'][] = ['profile', 'messages', 'contacts', 'groups', 'all'];
const SYNC_DEPTHS: NonNullable<StartSyncBody['depth']>[] = ['7d', '30d', '90d', '1y', 'all'];

const jobColumns: ColumnDef<SyncJobSummary>[] = [
  { key: 'type', header: 'Type', width: 110 },
  { key: 'status', header: 'Status', width: 120 },
  {
    key: 'progressPercent',
    header: 'Progress',
    width: 100,
    accessor: (j) => (j.progressPercent != null ? `${Math.round(j.progressPercent)}%` : '—'),
  },
  { key: 'createdAt', header: 'Created', accessor: (j) => new Date(j.createdAt).toLocaleString() },
  { key: 'jobId', header: 'Job', mono: true },
];

const selectStyle = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
} as const;

export function SyncTab({ instance, isProduction }: InstanceTabProps) {
  const { client } = useOmniClient();
  const id = instance.id;
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;
  const [type, setType] = useState<StartSyncBody['type']>('all');
  const [depth, setDepth] = useState<NonNullable<StartSyncBody['depth']>>('7d');
  const [downloadMedia, setDownloadMedia] = useState(false);

  const jobs = useOmniQuery(['instances', id, 'syncs'], () => client.instances.listSyncs(id, { limit: 25 }), {
    refetchInterval: 8000,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel title="Profile sync" description="Refresh the connected profile (name, avatar, bio) now.">
        <ActionButton
          label="Sync profile"
          effect="live"
          targetName={instance.name}
          targetId={id}
          disabledReason={guard}
          run={() => client.instances.syncProfile(id)}
        />
      </Panel>

      <Panel title="Start sync job" description="Backfill messages, contacts, or groups over a time window.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={type} onChange={(e) => setType(e.target.value as StartSyncBody['type'])} style={selectStyle}>
            {SYNC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={depth}
            onChange={(e) => setDepth(e.target.value as NonNullable<StartSyncBody['depth']>)}
            style={selectStyle}
          >
            {SYNC_DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.fg }}>
            <input type="checkbox" checked={downloadMedia} onChange={(e) => setDownloadMedia(e.target.checked)} />
            download media
          </label>
          <ActionButton
            label="Start sync"
            effect="live"
            targetName={instance.name}
            targetId={id}
            disabledReason={guard}
            onDone={() => void jobs.refetch()}
            run={() => client.instances.startSync(id, { type, depth, downloadMedia })}
          />
        </div>
      </Panel>

      <Panel
        title="Sync jobs"
        description="Recent sync jobs, polled live."
        actions={<span style={{ fontSize: 12, color: T.muted }}>{jobs.data?.items?.length ?? 0} jobs</span>}
      >
        <DataTable
          columns={jobColumns}
          rows={jobs.data?.items ?? []}
          getRowKey={(j) => j.jobId}
          loading={jobs.isLoading}
          error={jobs.error ? (jobs.error as Error).message : null}
          emptyTitle="No sync jobs"
        />
      </Panel>
    </div>
  );
}
