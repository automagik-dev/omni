'use client';

/**
 * Conversations — the cross-channel conversation records that stitch chats
 * together. Live table with a gated create, an inline detail (fields + the
 * chats linked via /conversations/:id/chats), edit, and a destructive delete
 * behind a typed-phrase confirm. Every write shows read-back evidence.
 */
import { Button, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import type { ConversationRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { requirementReason, useCan } from '../../auth';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  JsonInspector,
  MutationResult,
  PageShell,
  ResourceDetail,
  SchemaForm,
  SectionHead,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

const editSchema = z.object({
  title: z.string().optional().describe('Conversation title'),
  summary: z.string().optional().describe('Short summary'),
});

export function ConversationsPage() {
  const { ext } = useOmniClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Create + edit are operational writes — a read-only `member` may browse the
  // records but not mutate. (Delete stays gated by its ConfirmDialog below.)
  const canOperate = useCan('operate');
  const operateReason = requirementReason('operate');

  const list = useOmniQuery(['conversations', 'list'], () => ext.conversations.list({ limit: 200 }));
  const detail = useOmniQuery(['conversations', selectedId], () => ext.conversations.get(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });
  const chats = useOmniQuery(['conversations', selectedId, 'chats'], () => ext.conversations.chats(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });

  const create = useOmniMutation({
    mutationFn: (body: Record<string, unknown>) => ext.conversations.create(body),
    invalidate: [['conversations', 'list']],
  });
  const patch = useOmniMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) => ext.conversations.patch(vars.id, vars.body),
    invalidate: [['conversations', 'list']],
    readBack: (_d, vars) => ext.conversations.get(vars.id),
  });
  const remove = useOmniMutation({
    mutationFn: (id: string) => ext.conversations.remove(id),
    invalidate: [['conversations', 'list']],
  });

  const selected = detail.data?.data;

  const columns: ColumnDef<ConversationRow>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.title ?? '(untitled)'}</span>,
    },
    { key: 'summary', header: 'Summary', accessor: (r) => r.summary ?? '—' },
    { key: 'createdAt', header: 'Created', width: 180, mono: true, accessor: (r) => fmtTime(r.createdAt) },
    { key: 'id', header: 'ID', mono: true, width: 260 },
  ];

  return (
    <PageShell
      eyebrow="Messaging"
      title="Conversations"
      description="Cross-channel conversation records and the chats linked to them."
      actions={
        <Button size="small" variant="secondary" onClick={() => void list.refetch()}>
          Refresh
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No conversations"
        onRowClick={(r) => {
          setSelectedId(r.id);
          patch.reset();
          remove.reset();
        }}
      />

      <SectionCard padding="md">
        <div style={{ marginBottom: 10 }}>
          <SectionHead>New conversation</SectionHead>
        </div>
        <SchemaForm
          schema={editSchema}
          submitLabel="Create"
          disabled={!canOperate}
          onSubmit={(data) => create.mutate({ ...data })}
        />
        {!canOperate && (
          <Note type="default" label="Read-only role">
            {operateReason}
          </Note>
        )}
        {(create.data || create.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/conversations' }}
              response={create.data}
              error={errMsg(create.error)}
            />
          </div>
        )}
      </SectionCard>

      {selectedId && (
        <SectionCard padding="md">
          <ResourceDetail
            title={selected?.title ?? '(untitled)'}
            id={selectedId}
            subtitle="Conversation record"
            actions={
              <Button size="small" variant="error" disabled={remove.isPending} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            }
          >
            <ResourceDetail.Section title="Fields">
              <FieldGrid
                fields={[
                  { label: 'Title', value: selected?.title },
                  { label: 'Summary', value: selected?.summary },
                  { label: 'Created', value: fmtTime(selected?.createdAt), mono: true },
                  { label: 'Updated', value: fmtTime(selected?.updatedAt), mono: true },
                ]}
              />
            </ResourceDetail.Section>

            <ResourceDetail.Section title="Edit" description="Title and summary. Read-back proves the write landed.">
              <SchemaForm
                key={selectedId}
                schema={editSchema}
                value={{ title: selected?.title ?? undefined, summary: selected?.summary ?? undefined }}
                submitLabel="Save"
                disabled={!canOperate}
                onSubmit={(data) => patch.mutate({ id: selectedId, body: { ...data } })}
              />
              {(patch.readBackData || patch.error) && (
                <div style={{ marginTop: 12 }}>
                  <MutationResult
                    effect="live"
                    request={{ method: 'PATCH', path: `/conversations/${selectedId}` }}
                    after={patch.readBackData?.data}
                    error={errMsg(patch.error)}
                  />
                </div>
              )}
            </ResourceDetail.Section>

            <ResourceDetail.Section title={`Linked chats (${chats.data?.items?.length ?? 0})`}>
              {chats.isLoading ? (
                <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
              ) : (chats.data?.items ?? []).length === 0 ? (
                <Note type="default">No chats linked to this conversation.</Note>
              ) : (
                <JsonInspector
                  value={(chats.data?.items ?? []).map((c) => ({
                    id: c.id,
                    name: c.name,
                    channel: c.channel,
                    lastMessageAt: c.lastMessageAt,
                  }))}
                />
              )}
            </ResourceDetail.Section>

            {selected?.state && (
              <ResourceDetail.Section title="State">
                <JsonInspector value={selected.state} />
              </ResourceDetail.Section>
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
        title="Delete conversation"
        targetName={selected?.title ?? 'conversation'}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Delete"
        description="Permanently deletes this conversation record. Linked chats are not deleted."
      />
    </PageShell>
  );
}
