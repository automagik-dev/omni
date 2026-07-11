'use client';

/**
 * API Keys — key management. List (status-filtered), an inline detail with the
 * per-key audit log, and create / patch / revoke / delete. The create response
 * carries the raw key exactly ONCE — it is shown in a copy-once panel and never
 * re-fetchable. The `admin` profile is refused server-side; that refusal is
 * surfaced honestly.
 */
import { Badge, Button, Input, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { ApiKeyAuditRow, ApiKeyRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, ConfirmDialog, DataTable, MutationResult, PageShell, ResourceDetail } from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { CardSection, DataRowList, errMsg, fmtTime } from './shared';

const PROFILES = ['', 'cs', 'personal', 'scout', 'coworker', 'admin'];

export function ApiKeysPage() {
  const { ext } = useOmniClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Create form.
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('metrics:read');
  const [profile, setProfile] = useState('');
  const [instanceIds, setInstanceIds] = useState('');

  const list = useOmniQuery(['keys', 'list', statusFilter], () =>
    ext.keys.list({ limit: 100, ...(statusFilter ? { status: statusFilter } : {}) }),
  );
  const detail = useOmniQuery(['keys', selectedId], () => ext.keys.get(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });
  const audit = useOmniQuery(['keys', selectedId, 'audit'], () => ext.keys.audit(selectedId ?? '', { limit: 50 }), {
    enabled: Boolean(selectedId),
  });

  const create = useOmniMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name };
      if (profile) body.profile = profile;
      else
        body.scopes = scopes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      const ids = instanceIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) body.instanceIds = ids;
      return ext.keys.create(body);
    },
    invalidate: [['keys', 'list', statusFilter]],
  });
  const revoke = useOmniMutation({
    mutationFn: (id: string) => ext.keys.revoke(id, 'khal-ui revoke'),
    invalidate: [['keys', 'list', statusFilter]],
    readBack: (_d, id) => ext.keys.get(id),
  });
  const remove = useOmniMutation({
    mutationFn: (id: string) => ext.keys.remove(id),
    invalidate: [['keys', 'list', statusFilter]],
  });

  const selected = detail.data?.data;
  const createdKey = create.data?.data?.plainTextKey;

  const columns: ColumnDef<ApiKeyRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.name}</span> },
    { key: 'keyPrefix', header: 'Prefix', mono: true, accessor: (r) => r.keyPrefix ?? '—' },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => <Badge variant={r.status === 'active' ? 'green' : 'gray'}>{r.status ?? '—'}</Badge>,
    },
    {
      key: 'scopes',
      header: 'Scopes',
      accessor: (r) => (r.scopes ?? []).slice(0, 3).join(', ') + ((r.scopes?.length ?? 0) > 3 ? '…' : ''),
    },
    { key: 'lastUsedAt', header: 'Last used', width: 180, mono: true, accessor: (r) => fmtTime(r.lastUsedAt) },
  ];

  const auditColumns: ColumnDef<ApiKeyAuditRow>[] = [
    { key: 'timestamp', header: 'When', width: 180, mono: true, accessor: (r) => fmtTime(r.timestamp) },
    { key: 'method', header: 'Method', width: 80, mono: true },
    { key: 'path', header: 'Path', mono: true },
    { key: 'statusCode', header: 'Code', width: 70, align: 'right', accessor: (r) => r.statusCode ?? '—' },
  ];

  return (
    <PageShell eyebrow="Configuration" title="API Keys" description="Key management, scopes, and per-key audit.">
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No API keys"
        onRowClick={(r) => {
          setSelectedId(r.id);
          revoke.reset();
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
              {['active', 'revoked', 'expired'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </span>
        }
      />

      <CardSection title="Create key">
        <Note type="warning" label="LIVE">
          The raw key is shown once here and never again. The <code style={{ fontFamily: T.mono }}>admin</code> profile
          is refused server-side.
        </Note>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="scopes (comma-sep)" value={scopes} onChange={(e) => setScopes(e.target.value)} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}>
            profile
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                border: `1px solid ${T.border}`,
                background: T.surface,
                color: T.fg,
                fontSize: 13,
              }}
            >
              {PROFILES.map((p) => (
                <option key={p} value={p}>
                  {p || '(scopes)'}
                </option>
              ))}
            </select>
          </span>
          <Input
            placeholder="instanceIds (comma-sep)"
            value={instanceIds}
            onChange={(e) => setInstanceIds(e.target.value)}
          />
          <Button
            size="small"
            variant="default"
            disabled={!name || create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            Create
          </Button>
        </div>
        {createdKey && (
          <div style={{ marginTop: 12 }}>
            <Note type="success" label="Copy this key now">
              <code style={{ fontFamily: T.mono, wordBreak: 'break-all', color: T.fg }}>{createdKey}</code>
            </Note>
          </div>
        )}
        {(create.data || create.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/keys' }}
              response={create.data}
              error={errMsg(create.error)}
            />
          </div>
        )}
      </CardSection>

      {selectedId && selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={selected.name}
            id={selectedId}
            status={<Badge variant={selected.status === 'active' ? 'green' : 'gray'}>{selected.status ?? '—'}</Badge>}
            actions={
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  size="small"
                  variant="warning"
                  disabled={selected.status !== 'active'}
                  onClick={() => setConfirmRevoke(true)}
                >
                  Revoke
                </Button>
                <Button size="small" variant="error" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            }
          >
            <ResourceDetail.Section title="Fields">
              <DataRowList
                rows={[
                  { label: 'Prefix', value: selected.keyPrefix ?? '—' },
                  { label: 'Profile', value: selected.profile ?? '—' },
                  { label: 'Scopes', value: (selected.scopes ?? []).join(', ') || '—' },
                  { label: 'Instances', value: (selected.instanceIds ?? []).join(', ') || 'all' },
                  { label: 'Usage count', value: selected.usageCount ?? 0 },
                  { label: 'Expires', value: fmtTime(selected.expiresAt) },
                  { label: 'Created', value: fmtTime(selected.createdAt) },
                ]}
              />
            </ResourceDetail.Section>
            <ResourceDetail.Section title={`Audit (${audit.data?.items?.length ?? 0})`}>
              <DataTable
                columns={auditColumns}
                rows={audit.data?.items ?? []}
                getRowKey={(r) => r.id ?? `${r.timestamp}-${r.path}`}
                loading={audit.isLoading}
                emptyTitle="No audit entries"
              />
            </ResourceDetail.Section>
            {(revoke.readBackData || revoke.error) && (
              <MutationResult effect="live" after={revoke.readBackData?.data} error={errMsg(revoke.error)} />
            )}
          </ResourceDetail>
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={() => {
          if (selectedId) revoke.mutate(selectedId);
          setConfirmRevoke(false);
        }}
        title="Revoke API key"
        targetName={selected?.name ?? ''}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Revoke"
        description="Disables this key immediately. Existing sessions using it will start failing."
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (selectedId) remove.mutate(selectedId);
          setConfirmDelete(false);
          setSelectedId(null);
        }}
        title="Delete API key"
        targetName={selected?.name ?? ''}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Delete"
        description="Permanently removes this key and its audit trail."
      />
    </PageShell>
  );
}
