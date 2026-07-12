'use client';

/**
 * Webhook Sources — inbound webhook registrations. List, create (defaults to
 * disabled), an inline detail with enable/disable and a destructive delete. The
 * create-disabled → delete round-trip is the sanctioned validation path.
 */
import { Badge, Button, Input, SectionCard, Toggle } from '@khal-os/ui';
import { useState } from 'react';
import type { WebhookSourceRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  MutationResult,
  PageShell,
  ResourceDetail,
  SectionHead,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

export function WebhookSourcesPage() {
  const { ext } = useOmniClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const list = useOmniQuery(['webhook-sources', 'list'], () => ext.webhookSources.list());
  const detail = useOmniQuery(['webhook-sources', selectedId], () => ext.webhookSources.get(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });

  const create = useOmniMutation({
    mutationFn: () => ext.webhookSources.create({ name, description: description || undefined, enabled }),
    invalidate: [['webhook-sources', 'list']],
  });
  const patch = useOmniMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      ext.webhookSources.patch(vars.id, { enabled: vars.enabled }),
    invalidate: [['webhook-sources', 'list']],
    readBack: (_d, vars) => ext.webhookSources.get(vars.id),
  });
  const remove = useOmniMutation({
    mutationFn: (id: string) => ext.webhookSources.remove(id),
    invalidate: [['webhook-sources', 'list']],
  });

  const selected = detail.data?.data;

  const columns: ColumnDef<WebhookSourceRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.name}</span> },
    {
      key: 'enabled',
      header: 'Enabled',
      width: 110,
      render: (r) => <Badge variant={r.enabled ? 'green' : 'gray'}>{r.enabled ? 'enabled' : 'disabled'}</Badge>,
    },
    { key: 'description', header: 'Description', accessor: (r) => r.description ?? '—' },
    { key: 'createdAt', header: 'Created', width: 180, mono: true, accessor: (r) => fmtTime(r.createdAt) },
  ];

  return (
    <PageShell eyebrow="Channels & Access" title="Webhook Sources" description="Inbound webhook registrations.">
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No webhook sources"
        onRowClick={(r) => {
          setSelectedId(r.id);
          patch.reset();
        }}
      />

      <SectionCard padding="md">
        <div style={{ marginBottom: 10 }}>
          <SectionHead>New source</SectionHead>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}>
            enabled
            <Toggle checked={enabled} onChange={setEnabled} />
          </span>
          <Button
            size="small"
            variant="default"
            disabled={!name || create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            Create
          </Button>
        </div>
        {(create.data || create.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/webhook-sources' }}
              response={create.data}
              error={errMsg(create.error)}
            />
          </div>
        )}
      </SectionCard>

      {selectedId && selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={selected.name}
            id={selectedId}
            status={
              <Badge variant={selected.enabled ? 'green' : 'gray'}>{selected.enabled ? 'enabled' : 'disabled'}</Badge>
            }
            actions={
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => patch.mutate({ id: selectedId, enabled: !selected.enabled })}
                >
                  {selected.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button size="small" variant="error" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            }
          >
            <ResourceDetail.Section title="Fields">
              <FieldGrid
                fields={[
                  { label: 'Description', value: selected.description ?? '—' },
                  { label: 'Enabled', value: selected.enabled },
                  { label: 'Created', value: fmtTime(selected.createdAt), mono: true },
                ]}
              />
            </ResourceDetail.Section>
            {(patch.readBackData || patch.error) && (
              <MutationResult
                effect="live"
                request={{ method: 'PATCH', path: `/webhook-sources/${selectedId}` }}
                after={patch.readBackData?.data}
                error={errMsg(patch.error)}
              />
            )}
          </ResourceDetail>
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (selectedId) remove.mutate(selectedId);
          setConfirmDelete(false);
          setSelectedId(null);
        }}
        title="Delete webhook source"
        targetName={selected?.name ?? ''}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Delete"
      />
    </PageShell>
  );
}
