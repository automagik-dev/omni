'use client';

/**
 * Handoffs — the agent-to-agent handoff log (read-only). List with an inline
 * detail showing the handoff fields and any extra payload.
 */
import { Button, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { HandoffRecord } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, FieldGrid, JsonInspector, PageShell, ResourceDetail } from '../../components';
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
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No handoffs"
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
