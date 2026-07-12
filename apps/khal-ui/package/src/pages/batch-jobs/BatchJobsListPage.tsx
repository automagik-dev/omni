'use client';

/**
 * Batch jobs list — historical media processing (transcription, extraction,
 * re-download). A live table that polls while any job is active, with a create
 * wizard (estimate → confirmed create). Rows link into the per-job detail.
 */
import { Badge, Button, ProgressBar, StatusDot } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BatchJobRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { CreateBatchJobWizard } from './CreateBatchJobWizard';
import { formatUsd, isActiveStatus, jobStatusVariant } from './batch-helpers';

export function BatchJobsListPage() {
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const jobs = useOmniQuery(['batch-jobs', 'list'], () => ext.batchJobs.list({ limit: 50 }), { refetchInterval: 5000 });
  const rows = jobs.data?.items ?? [];
  const anyActive = rows.some((j) => isActiveStatus(j.status));

  const columns: ColumnDef<BatchJobRow>[] = [
    { key: 'jobType', header: 'Type', accessor: (j) => j.jobType },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (j) => <Badge variant={jobStatusVariant(j.status)}>{j.status}</Badge>,
    },
    {
      key: 'progress',
      header: 'Progress',
      width: 180,
      render: (j) => {
        const pct = j.progressPercent ?? 0;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 150 }}>
            <ProgressBar value={pct} max={100} color={j.failedItems ? T.warn : T.accent} size="sm" />
            <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
              {j.processedItems ?? 0}/{j.totalItems ?? 0}
              {j.failedItems ? ` · ${j.failedItems} failed` : ''} · {pct}%
            </span>
          </div>
        );
      },
    },
    { key: 'cost', header: 'Cost', width: 90, accessor: (j) => formatUsd(j.totalCostUsd) },
    { key: 'instanceId', header: 'Instance', mono: true, width: 200, accessor: (j) => j.instanceId },
    { key: 'createdAt', header: 'Created', mono: true, width: 200, accessor: (j) => j.createdAt ?? '—' },
  ];

  return (
    <PageShell
      eyebrow="Agents & Automation"
      title="Batch Jobs"
      description="Transcription and extraction batches over historical media."
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {anyActive && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot state="live" size="sm" pulse />
              <span style={{ fontSize: 11, color: T.accent, fontFamily: T.mono }}>polling</span>
            </span>
          )}
          <Button size="small" variant="secondary" onClick={() => void jobs.refetch()}>
            Refresh
          </Button>
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New job
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(j) => j.id}
        loading={jobs.isLoading}
        error={jobs.error ? (jobs.error as Error).message : null}
        emptyTitle="No batch jobs"
        onRowClick={(j) => navigate(`/batch-jobs/${j.id}`)}
      />

      <CreateBatchJobWizard
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void jobs.refetch();
          navigate(`/batch-jobs/${id}`);
        }}
      />
    </PageShell>
  );
}
