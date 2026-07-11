'use client';

/**
 * Event Ops — reprocessing and maintenance. Engine metrics, the replay-session
 * list with create/cancel, and the scheduled-maintenance runner. Replays
 * reprocess real events, so create/cancel/scheduled are all LIVE and
 * typed-phrase-gated; validation asserts the read paths only and never executes.
 */
import { Button, Input, MetricDisplay, Note, SectionCard, Toggle } from '@khal-os/ui';
import { useState } from 'react';
import type { ReplaySession } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, ConfirmDialog, DataTable, JsonInspector, MutationResult, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

export function EventOpsPage() {
  const { ext } = useOmniClient();
  const [since, setSince] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [confirmReplay, setConfirmReplay] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<ReplaySession | null>(null);
  const [confirmScheduled, setConfirmScheduled] = useState(false);

  const metrics = useOmniQuery(['event-ops', 'metrics'], () => ext.eventOps.metrics(), { refetchInterval: 15_000 });
  const replays = useOmniQuery(['event-ops', 'replay'], () => ext.eventOps.replayList(), { refetchInterval: 10_000 });

  const create = useOmniMutation({
    mutationFn: () => ext.eventOps.replayCreate({ since, dryRun }),
    invalidate: [['event-ops', 'replay']],
  });
  const cancel = useOmniMutation({
    mutationFn: (id: string) => ext.eventOps.replayDelete(id),
    invalidate: [['event-ops', 'replay']],
  });
  const scheduled = useOmniMutation({ mutationFn: () => ext.eventOps.scheduled() });

  const m = metrics.data?.data;

  const columns: ColumnDef<ReplaySession>[] = [
    {
      key: 'id',
      header: 'Session',
      mono: true,
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.id}</span>,
    },
    { key: 'status', header: 'Status', width: 110 },
    { key: 'dryRun', header: 'Dry-run', width: 90, accessor: (r) => (r.dryRun ? 'yes' : 'no') },
    { key: 'startedAt', header: 'Started', width: 180, mono: true, accessor: (r) => fmtTime(r.startedAt) },
    {
      key: 'cancel',
      header: '',
      width: 100,
      render: (r) =>
        r.status === 'running' ? (
          <Button size="small" variant="error" onClick={() => setConfirmCancel(r)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <PageShell
      eyebrow="Operations"
      title="Event Ops"
      description="Replay, reprocessing, and scheduled maintenance."
      actions={
        <Button size="small" variant="warning" onClick={() => setConfirmScheduled(true)}>
          Run scheduled maintenance…
        </Button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <SectionCard padding="md">
          <MetricDisplay value={m?.totalEvents ?? 0} label="Total events" />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={m?.pending ?? 0} label="Pending" accentColor={T.warn} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={m?.failed ?? 0} label="Failed" accentColor={T.danger} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={m?.deadLettersPending ?? 0} label="Dead-letters" />
        </SectionCard>
      </div>

      <DataTable
        columns={columns}
        rows={replays.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={replays.isLoading}
        error={errMsg(replays.error)}
        emptyTitle="No replay sessions"
      />

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: T.fg }}>New replay session</h3>
        <Note type="warning" label="LIVE">
          A non-dry-run replay reprocesses real events. Start with dry-run. Confirm required.
        </Note>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: T.muted }}>
            Since (ISO or relative, e.g. 1h)
            <Input placeholder="2026-07-01T00:00:00Z" value={since} onChange={(e) => setSince(e.target.value)} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}>
            Dry-run
            <Toggle checked={dryRun} onChange={setDryRun} />
          </span>
          <Button
            size="small"
            variant={dryRun ? 'default' : 'warning'}
            disabled={!since}
            onClick={() => setConfirmReplay(true)}
          >
            Start replay…
          </Button>
        </div>
        {(create.data || create.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect={dryRun ? 'dry-run' : 'live'}
              request={{ method: 'POST', path: '/event-ops/replay' }}
              response={create.data}
              error={errMsg(create.error)}
            />
          </div>
        )}
      </SectionCard>

      {(scheduled.data || scheduled.error) && (
        <SectionCard padding="md">
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>
            Scheduled maintenance result
          </h3>
          {scheduled.error ? (
            <Note type="error">{errMsg(scheduled.error)}</Note>
          ) : (
            <JsonInspector value={scheduled.data} />
          )}
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmReplay}
        onClose={() => setConfirmReplay(false)}
        onConfirm={() => {
          create.mutate(undefined);
          setConfirmReplay(false);
        }}
        title={dryRun ? 'Start dry-run replay' : 'Start LIVE replay'}
        targetName={`since ${since}`}
        targetId={since}
        effect={dryRun ? 'dry-run' : 'live'}
        destructive={!dryRun}
        confirmLabel="Start replay"
        description={
          dryRun ? 'Simulates the replay without reprocessing.' : 'Reprocesses real events from the given time.'
        }
      />
      <ConfirmDialog
        open={confirmCancel !== null}
        onClose={() => setConfirmCancel(null)}
        onConfirm={() => {
          if (confirmCancel) cancel.mutate(confirmCancel.id);
          setConfirmCancel(null);
        }}
        title="Cancel replay session"
        targetName={confirmCancel?.id ?? ''}
        targetId={confirmCancel?.id ?? ''}
        effect="live"
        destructive
        confirmLabel="Cancel replay"
      />
      <ConfirmDialog
        open={confirmScheduled}
        onClose={() => setConfirmScheduled(false)}
        onConfirm={() => {
          scheduled.mutate(undefined);
          setConfirmScheduled(false);
        }}
        title="Run scheduled maintenance"
        targetName="auto-retry + cleanup"
        targetId="event-ops/scheduled"
        effect="live"
        destructive
        confirmLabel="Run now"
        description="Runs dead-letter auto-retry and payload/dead-letter cleanup immediately."
      />
    </PageShell>
  );
}
