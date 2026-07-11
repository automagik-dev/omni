'use client';

/**
 * Per-batch-job detail. Polls the lightweight status endpoint while the job is
 * active, shows the full record and any per-item errors, and offers a gated
 * cancel (LIVE) for running jobs.
 */
import { Badge, Button, MetricDisplay, Note, Spinner } from '@khal-os/ui';
import { useNavigate, useParams } from 'react-router-dom';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { FieldGrid } from '../../components/FieldGrid';
import { JsonInspector } from '../../components/JsonInspector';
import { PageShell } from '../../components/PageShell';
import { ResourceDetail } from '../../components/ResourceDetail';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../instances/components';
import { formatUsd, isActiveStatus, jobStatusVariant } from './batch-helpers';

export function BatchJobDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { ext } = useOmniClient();

  const detail = useOmniQuery(['batch-jobs', id, 'detail'], () => ext.batchJobs.get(id), { enabled: Boolean(id) });
  const job = detail.data?.data;
  const active = isActiveStatus(job?.status);

  // Lightweight status poll while the job is active.
  const status = useOmniQuery(['batch-jobs', id, 'status'], () => ext.batchJobs.status(id), {
    enabled: Boolean(id) && active,
    refetchInterval: active ? 3000 : undefined,
  });
  const live = status.data?.data;

  if (detail.isLoading) {
    return (
      <PageShell eyebrow="Agents & Automation" title="Batch job">
        <Spinner size="md" />
      </PageShell>
    );
  }

  if (detail.error || !job) {
    return (
      <PageShell
        eyebrow="Agents & Automation"
        title="Batch job"
        actions={
          <Button size="small" variant="secondary" onClick={() => navigate('/batch-jobs')}>
            Back
          </Button>
        }
      >
        <Note type="error">{detail.error ? (detail.error as Error).message : 'Job not found.'}</Note>
      </PageShell>
    );
  }

  const shown = { ...job, ...(live ?? {}) };
  const errors = Array.isArray(job.errors) ? job.errors : [];

  return (
    <PageShell eyebrow="Agents & Automation" title="Batch job">
      <ResourceDetail
        title={job.jobType}
        id={job.id}
        subtitle={`instance ${job.instanceId}`}
        status={<Badge variant={jobStatusVariant(shown.status)}>{shown.status}</Badge>}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" variant="secondary" onClick={() => navigate('/batch-jobs')}>
              Back
            </Button>
            <Button size="small" variant="secondary" onClick={() => void detail.refetch()}>
              Refresh
            </Button>
            <ActionButton
              label="Cancel job"
              effect="live"
              destructive
              targetName={job.jobType}
              targetId={job.id}
              disabledReason={active ? undefined : 'Only running/pending jobs can be cancelled'}
              confirmDescription="Gracefully stops this job after the current item."
              onDone={() => void detail.refetch()}
              run={() => ext.batchJobs.cancel(job.id)}
            />
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Panel title="Progress" description={active ? 'Live · polling every 3s.' : 'Final.'}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <MetricDisplay value={shown.processedItems ?? 0} label="Processed" />
              <MetricDisplay value={shown.totalItems ?? 0} label="Total" />
              <MetricDisplay
                value={shown.failedItems ?? 0}
                label="Failed"
                accentColor={(shown.failedItems ?? 0) > 0 ? T.warn : undefined}
              />
              <MetricDisplay value={shown.skippedItems ?? 0} label="Skipped" />
              <MetricDisplay value={`${shown.progressPercent ?? 0}%`} label="Progress" />
              <MetricDisplay value={formatUsd(shown.totalCostUsd)} label="Cost" />
              <MetricDisplay value={shown.totalTokens ?? 0} label="Tokens" />
            </div>
          </Panel>

          <Panel title="Record">
            <FieldGrid
              fields={[
                { label: 'Type', value: job.jobType },
                { label: 'Instance', value: job.instanceId, mono: true },
                { label: 'Status', value: shown.status },
                { label: 'Current item', value: shown.currentItem ?? '—', mono: true },
                { label: 'Created', value: job.createdAt ?? '—', mono: true },
                { label: 'Started', value: job.startedAt ?? '—', mono: true },
                { label: 'Completed', value: job.completedAt ?? '—', mono: true },
                { label: 'Error', value: job.errorMessage ?? '—' },
              ]}
            />
          </Panel>

          {job.requestParams && (
            <Panel title="Request params">
              <JsonInspector value={job.requestParams} />
            </Panel>
          )}

          {errors.length > 0 && (
            <Panel title="Item errors" actions={<span style={{ fontSize: 12, color: T.muted }}>{errors.length}</span>}>
              <JsonInspector value={errors} />
            </Panel>
          )}
        </div>
      </ResourceDetail>
    </PageShell>
  );
}
