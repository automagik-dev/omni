'use client';

/**
 * A2A — agent-to-agent discovery (read-only). Lists discoverable agents and
 * loads a selected agent's card. Feature-flag aware: if discovery is disabled or
 * an agent has no active A2A instance, the state is shown honestly rather than
 * blanked.
 */
import { Button, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, JsonInspector, PageShell, ResourceDetail } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg } from './shared';

interface A2AAgent {
  [key: string]: unknown;
}

function agentId(a: A2AAgent): string {
  return String(a.agentId ?? a.id ?? a.name ?? '');
}

export function A2APage() {
  const { ext } = useOmniClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const agents = useOmniQuery(['a2a', 'agents'], () => ext.a2a.agents());
  const card = useOmniQuery(['a2a', 'card', selectedId], () => ext.a2a.card(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });

  const list = (agents.data?.items ?? []) as A2AAgent[];

  const columns: ColumnDef<A2AAgent>[] = [
    {
      key: 'name',
      header: 'Agent',
      render: (a) => <span style={{ fontWeight: 600, color: T.fg }}>{String(a.name ?? agentId(a))}</span>,
    },
    { key: 'id', header: 'ID', mono: true, accessor: (a) => agentId(a) },
    { key: 'description', header: 'Description', accessor: (a) => String(a.description ?? '—') },
  ];

  return (
    <PageShell
      eyebrow="Configuration"
      title="A2A"
      description="Agent-to-agent discovery and cards."
      actions={
        <Button size="small" variant="secondary" onClick={() => void agents.refetch()}>
          Refresh
        </Button>
      }
    >
      {agents.error && (
        <Note type="warning" label="Discovery unavailable">
          {errMsg(agents.error)} — A2A discovery may be disabled or unconfigured.
        </Note>
      )}

      <DataTable
        columns={columns}
        rows={list}
        getRowKey={(a) => agentId(a) || JSON.stringify(a)}
        loading={agents.isLoading}
        emptyTitle="No discoverable agents"
        emptyDescription="No agents are configured for A2A discovery."
        onRowClick={(a) => setSelectedId(agentId(a))}
      />

      {selectedId && (
        <SectionCard padding="md">
          <ResourceDetail title="Agent card" id={selectedId}>
            <ResourceDetail.Section title="Card">
              {card.isLoading ? (
                <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
              ) : card.error ? (
                <Note type="warning" label="Not configured">
                  {errMsg(card.error)}
                </Note>
              ) : (
                <JsonInspector value={card.data?.data ?? {}} />
              )}
            </ResourceDetail.Section>
          </ResourceDetail>
        </SectionCard>
      )}
    </PageShell>
  );
}
