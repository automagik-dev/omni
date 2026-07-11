'use client';

/**
 * Dead Letters — failed events and their resolution. Stats cards, a status-filtered
 * list, and an inline detail with the error, stack, and stored payload. Retry /
 * resolve / abandon are wired behind confirms (abandon is destructive); validation
 * exercises the read paths only.
 */
import { Badge, Button, Input, MetricDisplay, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { DeadLetterRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  JsonInspector,
  MutationResult,
  PageShell,
  ResourceDetail,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

type PendingAction = { kind: 'retry' | 'resolve' | 'abandon'; row: DeadLetterRow } | null;

const STATUS_VARIANT: Record<string, 'gray' | 'green' | 'red' | 'amber'> = {
  pending: 'amber',
  retrying: 'gray',
  resolved: 'green',
  abandoned: 'red',
};

export function DeadLettersPage() {
  const { ext } = useOmniClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [resolveNote, setResolveNote] = useState('');

  const stats = useOmniQuery(['dead-letters', 'stats'], () => ext.deadLetters.stats(), { refetchInterval: 15_000 });
  const list = useOmniQuery(['dead-letters', 'list', statusFilter], () =>
    ext.deadLetters.list({ limit: 100, ...(statusFilter ? { status: statusFilter } : {}) }),
  );
  const detail = useOmniQuery(['dead-letters', selectedId], () => ext.deadLetters.get(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });

  const action = useOmniMutation({
    mutationFn: (p: NonNullable<PendingAction>): Promise<unknown> => {
      if (p.kind === 'retry') return ext.deadLetters.retry(p.row.id);
      if (p.kind === 'resolve') return ext.deadLetters.resolve(p.row.id, resolveNote || 'resolved via khal-ui');
      return ext.deadLetters.abandon(p.row.id);
    },
    invalidate: [
      ['dead-letters', 'list', statusFilter],
      ['dead-letters', 'stats'],
    ],
  });

  const s = stats.data?.data;
  const selected = detail.data?.data;

  const columns: ColumnDef<DeadLetterRow>[] = [
    {
      key: 'eventType',
      header: 'Event type',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.eventType ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (r) => <Badge variant={STATUS_VARIANT[r.status ?? ''] ?? 'gray'}>{r.status ?? '—'}</Badge>,
    },
    { key: 'error', header: 'Error', accessor: (r) => (r.error ? String(r.error).slice(0, 60) : '—') },
    {
      key: 'autoRetryCount',
      header: 'Retries',
      width: 90,
      align: 'right',
      accessor: (r) => (r.autoRetryCount ?? 0) + (r.manualRetryCount ?? 0),
    },
    { key: 'createdAt', header: 'Created', width: 180, mono: true, accessor: (r) => fmtTime(r.createdAt) },
  ];

  return (
    <PageShell eyebrow="Operations" title="Dead Letters" description="Failed events and their resolution.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
        <SectionCard padding="md">
          <MetricDisplay value={s?.total ?? 0} label="Total" />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={s?.pending ?? 0} label="Pending" accentColor={T.warn} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={s?.resolved ?? 0} label="Resolved" accentColor={T.ok} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={s?.abandoned ?? 0} label="Abandoned" accentColor={T.danger} />
        </SectionCard>
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No dead letters"
        onRowClick={(r) => {
          setSelectedId(r.id);
          action.reset();
        }}
        toolbar={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                border: `1px solid ${T.border}`,
                background: T.surface,
                color: T.fg,
                fontSize: 13,
              }}
            >
              <option value="">all</option>
              {['pending', 'retrying', 'resolved', 'abandoned'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </span>
        }
      />

      {selectedId && selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={selected.eventType ?? 'Dead letter'}
            id={selectedId}
            status={<Badge variant={STATUS_VARIANT[selected.status ?? ''] ?? 'gray'}>{selected.status ?? '—'}</Badge>}
            actions={
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={selected.status === 'resolved'}
                  onClick={() => setPending({ kind: 'retry', row: selected })}
                >
                  Retry
                </Button>
                <Button size="small" variant="secondary" onClick={() => setPending({ kind: 'resolve', row: selected })}>
                  Resolve
                </Button>
                <Button size="small" variant="error" onClick={() => setPending({ kind: 'abandon', row: selected })}>
                  Abandon
                </Button>
              </div>
            }
          >
            <ResourceDetail.Section title="Fields">
              <FieldGrid
                fields={[
                  { label: 'Event ID', value: selected.eventId, mono: true },
                  { label: 'Subject', value: selected.subject, mono: true },
                  { label: 'Auto retries', value: selected.autoRetryCount },
                  { label: 'Manual retries', value: selected.manualRetryCount },
                  { label: 'Created', value: fmtTime(selected.createdAt), mono: true },
                  { label: 'Resolved by', value: selected.resolvedBy ?? '—' },
                ]}
              />
            </ResourceDetail.Section>
            <ResourceDetail.Section title="Error">
              <Note type="error">{selected.error ?? 'no error text'}</Note>
              {selected.stack && (
                <pre
                  style={{
                    marginTop: 8,
                    fontFamily: T.mono,
                    fontSize: 11,
                    color: T.muted,
                    overflowX: 'auto',
                    maxHeight: 200,
                  }}
                >
                  {String(selected.stack)}
                </pre>
              )}
            </ResourceDetail.Section>
            {selected.payload !== undefined && (
              <ResourceDetail.Section title="Payload">
                <JsonInspector value={selected.payload} />
              </ResourceDetail.Section>
            )}
            {(action.data || action.error) && (
              <MutationResult effect="live" response={action.data} error={errMsg(action.error)} />
            )}
          </ResourceDetail>
        </SectionCard>
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending) action.mutate(pending);
          setPending(null);
        }}
        title={`${pending?.kind ?? ''} dead letter`}
        targetName={pending?.row.eventType ?? 'dead letter'}
        targetId={pending?.row.id ?? ''}
        effect="live"
        destructive={pending?.kind === 'abandon'}
        confirmLabel={pending?.kind ?? 'Confirm'}
        description={
          pending?.kind === 'resolve' ? (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: T.muted }}>Resolution note</span>
              <Input value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="reason" />
            </span>
          ) : pending?.kind === 'abandon' ? (
            'Permanently abandons this failed event — it will not be retried.'
          ) : (
            'Re-enqueues this failed event for processing.'
          )
        }
      />
    </PageShell>
  );
}
