'use client';

/**
 * Turns — the agent turn ledger (admin). Stats cards, a status-filtered list, an
 * inline detail, and the force-close / close-all admin actions. Closing a turn is
 * a production mutation, so both are LIVE typed-phrase gated; validation reads
 * list + stats only.
 */
import { Badge, Button, Input, MetricDisplay, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { TurnItem } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  MutationResult,
  PageShell,
  ResourceDetail,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

export function TurnsPage() {
  const { ext } = useOmniClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<TurnItem | null>(null);
  const [confirmClose, setConfirmClose] = useState<TurnItem | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [closeReason, setCloseReason] = useState('');

  const stats = useOmniQuery(['turns', 'stats'], () => ext.turns.stats(), { refetchInterval: 15_000 });
  const list = useOmniQuery(['turns', 'list', statusFilter], () =>
    ext.turns.list({ limit: 100, ...(statusFilter ? { status: statusFilter } : {}) }),
  );

  const forceClose = useOmniMutation({
    mutationFn: (id: string) => ext.turns.forceClose(id, closeReason || 'khal-ui admin close'),
    invalidate: [
      ['turns', 'list', statusFilter],
      ['turns', 'stats'],
    ],
  });
  const closeAll = useOmniMutation({
    mutationFn: () => ext.turns.closeAll(closeReason || 'khal-ui admin close-all'),
    invalidate: [
      ['turns', 'list', statusFilter],
      ['turns', 'stats'],
    ],
  });

  const s = stats.data?.data;

  const columns: ColumnDef<TurnItem>[] = [
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => (
        <Badge variant={r.status === 'open' ? 'green' : r.status === 'timeout' ? 'red' : 'gray'}>{r.status}</Badge>
      ),
    },
    { key: 'chatId', header: 'Chat', mono: true, accessor: (r) => r.chatId },
    { key: 'agentId', header: 'Agent', mono: true, accessor: (r) => r.agentId },
    { key: 'nudgeCount', header: 'Nudges', width: 80, align: 'right' },
    { key: 'startedAt', header: 'Started', width: 180, mono: true, accessor: (r) => fmtTime(r.startedAt) },
  ];

  return (
    <PageShell
      eyebrow="Configuration"
      title="Turns"
      description="Agent turn ledger and admin controls."
      actions={
        <Button size="small" variant="error" onClick={() => setConfirmCloseAll(true)}>
          Close all open…
        </Button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <SectionCard padding="md">
          <MetricDisplay value={s?.openCount ?? 0} label="Open" accentColor={T.ok} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={s?.totalCount ?? 0} label="Total" />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={s?.avgDurationMs != null ? `${Math.round(s.avgDurationMs)}ms` : '—'}
            label="Avg duration"
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={s?.timeoutRate != null ? `${Math.round(s.timeoutRate * 100)}%` : '—'}
            label="Timeout rate"
            accentColor={T.warn}
          />
        </SectionCard>
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No turns"
        onRowClick={(r) => setSelected(r)}
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
              {['open', 'done', 'timeout'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </span>
        }
      />

      {selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={`Turn ${selected.id.slice(0, 8)}`}
            id={selected.id}
            status={<Badge variant={selected.status === 'open' ? 'green' : 'gray'}>{selected.status}</Badge>}
            actions={
              selected.status === 'open' ? (
                <Button size="small" variant="error" onClick={() => setConfirmClose(selected)}>
                  Force close
                </Button>
              ) : undefined
            }
          >
            <ResourceDetail.Section title="Fields">
              <FieldGrid
                fields={[
                  { label: 'Instance', value: selected.instanceId, mono: true },
                  { label: 'Chat', value: selected.chatId, mono: true },
                  { label: 'Agent', value: selected.agentId, mono: true },
                  { label: 'Action', value: selected.action ?? '—' },
                  { label: 'Nudges', value: selected.nudgeCount },
                  { label: 'Messages sent', value: selected.messagesSent },
                  { label: 'Started', value: fmtTime(selected.startedAt), mono: true },
                  { label: 'Closed', value: fmtTime(selected.closedAt), mono: true },
                ]}
              />
            </ResourceDetail.Section>
            {(forceClose.data || forceClose.error) && (
              <MutationResult effect="live" response={forceClose.data} error={errMsg(forceClose.error)} />
            )}
          </ResourceDetail>
        </SectionCard>
      )}

      {(closeAll.data || closeAll.error) && (
        <SectionCard padding="md">
          <MutationResult
            effect="live"
            request={{ method: 'POST', path: '/turns/close-all' }}
            response={closeAll.data}
            error={errMsg(closeAll.error)}
          />
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmClose !== null}
        onClose={() => setConfirmClose(null)}
        onConfirm={() => {
          if (confirmClose) forceClose.mutate(confirmClose.id);
          setConfirmClose(null);
        }}
        title="Force-close turn"
        targetName={confirmClose?.chatId ?? ''}
        targetId={confirmClose?.id ?? ''}
        effect="live"
        destructive
        confirmLabel="Force close"
        description={
          <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>Reason (optional)</span>
            <Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
          </span>
        }
      />
      <ConfirmDialog
        open={confirmCloseAll}
        onClose={() => setConfirmCloseAll(false)}
        onConfirm={() => {
          closeAll.mutate(undefined);
          setConfirmCloseAll(false);
        }}
        title="Close ALL open turns"
        targetName="all open turns"
        targetId="/turns/close-all"
        effect="live"
        destructive
        confirmLabel="Close all"
        description="Admin bulk action — closes every currently-open turn."
      />
    </PageShell>
  );
}
