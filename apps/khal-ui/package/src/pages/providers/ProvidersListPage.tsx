'use client';

/**
 * Providers list — the agent backends Omni dispatches to. A live table (name,
 * schema, base URL, capabilities, active) with a gated create flow; rows link
 * into the detail where health, discovery, and linked agents live.
 */
import { Badge, Button, PillBadge } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProviderRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../components/DataTable';
import { DataTable } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { CreateProviderDialog } from './CreateProviderDialog';

export function ProvidersListPage() {
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const providers = useOmniQuery(['providers', 'list'], () => ext.providers.list());

  const columns: ColumnDef<ProviderRow>[] = [
    { key: 'name', header: 'Name', render: (p) => <span style={{ fontWeight: 600, color: T.fg }}>{p.name}</span> },
    { key: 'schema', header: 'Schema', width: 120, render: (p) => <PillBadge>{p.schema ?? '—'}</PillBadge> },
    { key: 'baseUrl', header: 'Base URL', mono: true, accessor: (p) => p.baseUrl ?? '—' },
    {
      key: 'caps',
      header: 'Capabilities',
      render: (p) => {
        const on = [
          p.supportsStreaming && 'stream',
          p.supportsImages && 'images',
          p.supportsAudio && 'audio',
          p.supportsDocuments && 'docs',
        ].filter(Boolean) as string[];
        return on.length ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {on.map((c) => (
              <PillBadge key={c}>{c}</PillBadge>
            ))}
          </div>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'isActive',
      header: 'Status',
      width: 100,
      render: (p) => (
        <Badge variant={p.isActive === false ? 'gray' : 'green'}>{p.isActive === false ? 'inactive' : 'active'}</Badge>
      ),
    },
    { key: 'id', header: 'ID', mono: true, width: 220 },
  ];

  return (
    <PageShell
      eyebrow="Agents & Automation"
      title="Providers"
      description="Agent provider configuration, health, and discovery."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" variant="secondary" onClick={() => void providers.refetch()}>
            Refresh
          </Button>
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New provider
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        rows={providers.data?.items ?? []}
        getRowKey={(p) => p.id}
        loading={providers.isLoading}
        error={providers.error ? (providers.error as Error).message : null}
        emptyTitle="No providers"
        onRowClick={(p) => navigate(`/providers/${p.id}`)}
      />

      <CreateProviderDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void providers.refetch();
          navigate(`/providers/${id}`);
        }}
      />
    </PageShell>
  );
}
