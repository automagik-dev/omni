'use client';

/**
 * Persons — the cross-channel identity graph. Search/list, an inline detail with
 * editable profile fields (PATCH with read-back), live presence, and a
 * cross-channel event timeline. The destructive identity operations
 * (link / unlink / merge) are fully wired behind LIVE typed-phrase confirms —
 * every person here is production data, so these are operator-driven only and
 * never exercised by automated validation.
 */
import { Button, Input, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import type { PersonRow } from '../../api/ext';
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
  SchemaForm,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg } from './shared';

const profileSchema = z.object({
  displayName: z.string().optional().describe('Display name'),
  primaryPhone: z.string().optional().describe('Primary phone (E.164)'),
  primaryEmail: z.string().optional().describe('Primary email'),
  avatarUrl: z.string().optional().describe('Avatar URL'),
});

type IdentityOp = 'link' | 'unlink' | 'merge' | null;

export function PersonsPage() {
  const { ext } = useOmniClient();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Identity-op form state (never auto-run; operator confirms each).
  const [linkA, setLinkA] = useState('');
  const [linkB, setLinkB] = useState('');
  const [unlinkId, setUnlinkId] = useState('');
  const [unlinkReason, setUnlinkReason] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [pendingOp, setPendingOp] = useState<IdentityOp>(null);

  const list = useOmniQuery(['persons', 'list', submitted], () =>
    ext.persons.list({ limit: 100, ...(submitted ? { search: submitted } : {}) }),
  );
  const detail = useOmniQuery(['persons', selectedId], () => ext.persons.get(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });
  const presence = useOmniQuery(['persons', selectedId, 'presence'], () => ext.persons.presence(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });
  const timeline = useOmniQuery(
    ['persons', selectedId, 'timeline'],
    () => ext.persons.timeline(selectedId ?? '', { limit: 25 }),
    {
      enabled: Boolean(selectedId),
    },
  );

  const patch = useOmniMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) => ext.persons.patch(vars.id, vars.body),
    invalidate: [['persons', 'list']],
    readBack: (_d, vars) => ext.persons.get(vars.id),
  });
  const identity = useOmniMutation({
    mutationFn: (op: IdentityOp): Promise<unknown> => {
      if (op === 'link') return ext.persons.link(linkA, linkB);
      if (op === 'unlink') return ext.persons.unlink(unlinkId, unlinkReason);
      if (op === 'merge') return ext.persons.merge(mergeSource, mergeTarget);
      return Promise.reject(new Error('no op'));
    },
    invalidate: [['persons', 'list']],
  });

  const selected = detail.data?.data;

  const columns: ColumnDef<PersonRow>[] = [
    {
      key: 'displayName',
      header: 'Name',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.displayName ?? '(unnamed)'}</span>,
    },
    { key: 'primaryPhone', header: 'Phone', mono: true, accessor: (r) => r.primaryPhone ?? '—' },
    { key: 'primaryEmail', header: 'Email', accessor: (r) => r.primaryEmail ?? '—' },
    { key: 'id', header: 'ID', mono: true, width: 260 },
  ];

  return (
    <PageShell
      eyebrow="Messaging"
      title="Persons"
      description="Cross-channel identity graph — search, presence, timeline, and identity ops."
    >
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No persons"
        onRowClick={(r) => {
          setSelectedId(r.id);
          patch.reset();
        }}
        toolbar={
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(search.trim());
            }}
          >
            <Input
              placeholder="Search by name, email, or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button size="small" variant="secondary" typeName="submit">
              Search
            </Button>
          </form>
        }
      />

      {selectedId && (
        <SectionCard padding="md">
          <ResourceDetail title={selected?.displayName ?? '(unnamed)'} id={selectedId} subtitle="Person identity">
            <ResourceDetail.Section title="Profile" description="Edit and re-read to prove the write landed.">
              <SchemaForm
                key={selectedId}
                schema={profileSchema}
                value={{
                  displayName: selected?.displayName ?? undefined,
                  primaryPhone: selected?.primaryPhone ?? undefined,
                  primaryEmail: selected?.primaryEmail ?? undefined,
                  avatarUrl: selected?.avatarUrl ?? undefined,
                }}
                submitLabel="Save profile"
                onSubmit={(data) => patch.mutate({ id: selectedId, body: { ...data } })}
              />
              {(patch.readBackData || patch.error) && (
                <div style={{ marginTop: 12 }}>
                  <MutationResult
                    effect="live"
                    request={{ method: 'PATCH', path: `/persons/${selectedId}` }}
                    before={selected}
                    after={patch.readBackData?.data}
                    error={errMsg(patch.error)}
                  />
                </div>
              )}
            </ResourceDetail.Section>

            <ResourceDetail.Section title="Presence">
              {presence.isLoading ? (
                <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
              ) : (
                <>
                  <FieldGrid
                    fields={[
                      { label: 'Identities', value: presence.data?.data?.identities?.length ?? 0 },
                      { label: 'Channels', value: Object.keys(presence.data?.data?.byChannel ?? {}).join(', ') || '—' },
                    ]}
                  />
                  {presence.data?.data && (
                    <div style={{ marginTop: 10 }}>
                      <JsonInspector value={presence.data.data} />
                    </div>
                  )}
                </>
              )}
            </ResourceDetail.Section>

            <ResourceDetail.Section
              title={`Timeline (${timeline.data?.items?.length ?? 0})`}
              description="Cross-channel events for this person."
            >
              {timeline.isLoading ? (
                <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
              ) : (timeline.data?.items ?? []).length === 0 ? (
                <Note type="default">No timeline events.</Note>
              ) : (
                <JsonInspector
                  value={(timeline.data?.items ?? []).map((e) => ({
                    eventType: e.eventType,
                    direction: e.direction,
                    text: e.textContent,
                    receivedAt: e.receivedAt,
                  }))}
                />
              )}
            </ResourceDetail.Section>
          </ResourceDetail>
        </SectionCard>
      )}

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: T.fg }}>Identity operations</h3>
        <Note type="warning" label="LIVE · destructive">
          Link, unlink, and merge permanently rewrite the identity graph. Every person here is production data — each op
          requires a typed-phrase confirm and is never run by automated validation.
        </Note>
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            marginTop: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontSize: 13, color: T.fg }}>Link two identities</strong>
            <Input placeholder="identityA (uuid)" value={linkA} onChange={(e) => setLinkA(e.target.value)} />
            <Input placeholder="identityB (uuid)" value={linkB} onChange={(e) => setLinkB(e.target.value)} />
            <Button size="small" variant="warning" disabled={!linkA || !linkB} onClick={() => setPendingOp('link')}>
              Link…
            </Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontSize: 13, color: T.fg }}>Unlink identity</strong>
            <Input placeholder="identityId (uuid)" value={unlinkId} onChange={(e) => setUnlinkId(e.target.value)} />
            <Input placeholder="reason" value={unlinkReason} onChange={(e) => setUnlinkReason(e.target.value)} />
            <Button
              size="small"
              variant="warning"
              disabled={!unlinkId || !unlinkReason}
              onClick={() => setPendingOp('unlink')}
            >
              Unlink…
            </Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontSize: 13, color: T.fg }}>Merge persons</strong>
            <Input
              placeholder="sourcePersonId (deleted)"
              value={mergeSource}
              onChange={(e) => setMergeSource(e.target.value)}
            />
            <Input
              placeholder="targetPersonId (kept)"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
            />
            <Button
              size="small"
              variant="error"
              disabled={!mergeSource || !mergeTarget}
              onClick={() => setPendingOp('merge')}
            >
              Merge…
            </Button>
          </div>
        </div>
        {(identity.data || identity.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult effect="live" response={identity.data} error={errMsg(identity.error)} />
          </div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pendingOp !== null}
        onClose={() => setPendingOp(null)}
        onConfirm={() => {
          identity.mutate(pendingOp);
          setPendingOp(null);
        }}
        title={`Confirm ${pendingOp ?? ''}`}
        targetName={pendingOp === 'merge' ? mergeTarget : pendingOp === 'unlink' ? unlinkId : `${linkA} + ${linkB}`}
        targetId={pendingOp === 'merge' ? mergeSource : pendingOp === 'unlink' ? unlinkId : linkA}
        effect="live"
        destructive
        confirmLabel={`Run ${pendingOp ?? ''}`}
        description="This permanently rewrites the identity graph on production data."
      />
    </PageShell>
  );
}
