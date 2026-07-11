'use client';

/**
 * Platform identities linked to this agent. Lists the current links and offers a
 * gated link form (POST /agents/:id/identities/link). Linking is a LIVE write,
 * so it flows through {@link ActionButton}'s confirm gate.
 */
import { useState } from 'react';
import { z } from 'zod';
import type { AgentIdentityRow, AgentRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { SchemaForm } from '../../../components/SchemaForm';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../../instances/components';

const linkSchema = z.object({
  platformIdentityId: z.string().uuid().describe('Platform identity UUID'),
  linkReason: z.string().optional().describe('Why this link exists'),
  confidence: z.number().min(0).max(1).optional().describe('0–1 confidence'),
  linkedBy: z.string().optional().describe('Who/what created the link'),
});

export function AgentIdentitiesTab({ agent }: { agent: AgentRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);

  const identities = useOmniQuery(['agents', agent.id, 'identities'], () => ext.agents.identities(agent.id));

  const columns: ColumnDef<AgentIdentityRow>[] = [
    {
      key: 'platformIdentityId',
      header: 'Platform identity',
      mono: true,
      accessor: (r) => r.platformIdentityId ?? r.id ?? '—',
    },
    { key: 'id', header: 'Link id', mono: true, accessor: (r) => r.id ?? '—' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel
        title="Identities"
        description="Platform identities routed to this agent."
        actions={<span style={{ fontSize: 12, color: T.muted }}>{identities.data?.items?.length ?? 0}</span>}
      >
        <DataTable
          columns={columns}
          rows={identities.data?.items ?? []}
          getRowKey={(r) => r.id ?? r.platformIdentityId ?? JSON.stringify(r)}
          loading={identities.isLoading}
          error={identities.error ? (identities.error as Error).message : null}
          emptyTitle="No linked identities"
        />
      </Panel>

      <Panel title="Link an identity" description="Bind a platform identity to this agent (live).">
        {error && <span style={{ fontSize: 12, color: T.danger }}>{error}</span>}
        <SchemaForm
          schema={linkSchema}
          submitLabel="Review link"
          onSubmit={(data) => {
            setError(null);
            const body: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
              if (v !== undefined && v !== '') body[k] = v;
            }
            setPending(body);
          }}
        />
        {pending && (
          <ActionButton
            label="Confirm link"
            effect="live"
            targetName={agent.name}
            targetId={agent.id}
            confirmDescription="Links the platform identity to this agent."
            onDone={() => {
              setPending(null);
              void identities.refetch();
            }}
            run={() => ext.agents.linkIdentity(agent.id, pending)}
          />
        )}
      </Panel>
    </div>
  );
}
