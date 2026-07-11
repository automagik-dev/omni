'use client';

/**
 * Handoffs — the agent-to-agent handoff log (read-only). List with an inline
 * detail showing the handoff fields and any extra payload.
 */
import { Button, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { HandoffRecord } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, FieldGrid, JsonInspector, PageShell, ResourceDetail } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

export function HandoffsPage() {
  const { ext } = useOmniClient();
  const [selected, setSelected] = useState<HandoffRecord | null>(null);

  const list = useOmniQuery(['handoffs', 'list'], () => ext.handoffs.list({ limit: 100 }));

  const columns: ColumnDef<HandoffRecord>[] = [
    {
      key: 'toPhone',
      header: 'To',
      mono: true,
      accessor: (r) => String((r as Record<string, unknown>).toPhone ?? '—'),
    },
    {
      key: 'text',
      header: 'Text',
      accessor: (r) => {
        const t = (r as Record<string, unknown>).text;
        return t ? String(t).slice(0, 60) : '—';
      },
    },
    {
      key: 'agentId',
      header: 'Agent',
      mono: true,
      accessor: (r) => String((r as Record<string, unknown>).agentId ?? '—'),
    },
    {
      key: 'sentAt',
      header: 'Sent',
      width: 180,
      mono: true,
      accessor: (r) => fmtTime((r as Record<string, unknown>).sentAt),
    },
  ];

  return (
    <PageShell
      eyebrow="Configuration"
      title="Handoffs"
      description="Agent-to-agent handoff records."
      actions={
        <Button size="small" variant="secondary" onClick={() => void list.refetch()}>
          Refresh
        </Button>
      }
    >
      {list.error && (
        <Note type="error" label="GET /handoffs · 500">
          The handoffs list endpoint returns a <strong>500</strong> — a uuid-cast error where the list route falls into
          the <code style={{ fontFamily: T.mono }}>/handoffs/:id</code> handler on the backend. This is a known backend
          bug, surfaced here rather than hidden.
          <span style={{ display: 'block', marginTop: 6, fontFamily: T.mono, fontSize: 12, color: T.secondary }}>
            {errMsg(list.error)}
          </span>
        </Note>
      )}

      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={null}
        emptyTitle="No handoffs"
        emptyDescription={list.error ? 'List unavailable — see the error above.' : undefined}
        onRowClick={(r) => setSelected(r)}
      />

      {selected && (
        <SectionCard padding="md">
          <ResourceDetail title="Handoff" id={selected.id}>
            <ResourceDetail.Section title="Fields">
              <FieldGrid
                fields={[
                  { label: 'Instance', value: selected.instanceId, mono: true },
                  { label: 'Chat', value: selected.chatId, mono: true },
                  { label: 'Agent', value: selected.agentId, mono: true },
                  { label: 'To', value: (selected as Record<string, unknown>).toPhone, mono: true },
                  { label: 'Sent', value: fmtTime((selected as Record<string, unknown>).sentAt), mono: true },
                ]}
              />
            </ResourceDetail.Section>
            <ResourceDetail.Section title="Raw">
              <JsonInspector value={selected} />
            </ResourceDetail.Section>
          </ResourceDetail>
        </SectionCard>
      )}
    </PageShell>
  );
}
