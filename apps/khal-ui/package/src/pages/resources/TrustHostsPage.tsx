'use client';

/**
 * Trust Hosts — the genie A2A trust registry. Read-only list/detail plus scope
 * editing (PATCH, wholesale replace) and revoke (DELETE). Revoking a host breaks
 * its request signing, so both writes are LIVE typed-phrase gated and never
 * exercised by automated validation.
 */
import { Badge, Button, Input, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { TrustHost } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  JsonInspector,
  MutationResult,
  PageShell,
  ResourceDetail,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { DataRowList, errMsg, fmtTime } from './shared';

export function TrustHostsPage() {
  const { ext } = useOmniClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scopesText, setScopesText] = useState('');
  const [confirmScopes, setConfirmScopes] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const list = useOmniQuery(['trust', 'hosts'], () => ext.trust.listHosts());
  const detail = useOmniQuery(['trust', 'host', selectedId], () => ext.trust.getHost(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });

  const patchScopes = useOmniMutation({
    mutationFn: (vars: { id: string; scopes: string[] }) => ext.trust.patchScopes(vars.id, vars.scopes),
    invalidate: [['trust', 'hosts']],
    readBack: (_d, vars) => ext.trust.getHost(vars.id),
  });
  const revoke = useOmniMutation({
    mutationFn: (id: string) => ext.trust.remove(id),
    invalidate: [['trust', 'hosts']],
  });

  const selected = detail.data?.data;

  const columns: ColumnDef<TrustHost>[] = [
    {
      key: 'hostname',
      header: 'Hostname',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{String(r.hostname ?? '—')}</span>,
    },
    { key: 'scopes', header: 'Scopes', accessor: (r) => (r.scopes ?? []).join(', ') || '—' },
    {
      key: 'lastSeenAt',
      header: 'Last seen',
      width: 180,
      mono: true,
      accessor: (r) => fmtTime(r.lastSeenAt as string),
    },
    { key: 'id', header: 'ID', mono: true, width: 240 },
  ];

  return (
    <PageShell
      eyebrow="Configuration"
      title="Trust Hosts"
      description="Genie A2A trust registry. Writes break signing — handle with care."
    >
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No trust hosts"
        onRowClick={(r) => {
          setSelectedId(r.id);
          setScopesText((r.scopes ?? []).join(', '));
          patchScopes.reset();
        }}
      />

      {selectedId && selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={String(selected.hostname ?? 'host')}
            id={selectedId}
            status={selected.revokedAt ? <Badge variant="red">revoked</Badge> : <Badge variant="green">active</Badge>}
            actions={
              <Button
                size="small"
                variant="error"
                disabled={Boolean(selected.revokedAt)}
                onClick={() => setConfirmRevoke(true)}
              >
                Revoke
              </Button>
            }
          >
            <ResourceDetail.Section title="Fields">
              <DataRowList
                rows={[
                  { label: 'Pubkey', value: String(selected.pubkey ?? '—') },
                  { label: 'Scopes', value: (selected.scopes ?? []).join(', ') || '—' },
                  { label: 'Last seen', value: fmtTime(selected.lastSeenAt as string) },
                  { label: 'Created', value: fmtTime(selected.createdAt) },
                ]}
              />
            </ResourceDetail.Section>
            <ResourceDetail.Section
              title="Edit scopes"
              description="Wholesale replace (not merge). LIVE — confirm required."
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  placeholder="scope, scope, …"
                  value={scopesText}
                  onChange={(e) => setScopesText(e.target.value)}
                />
                <Button size="small" variant="warning" onClick={() => setConfirmScopes(true)}>
                  Replace scopes…
                </Button>
              </div>
              {(patchScopes.readBackData || patchScopes.error) && (
                <div style={{ marginTop: 12 }}>
                  <MutationResult
                    effect="live"
                    request={{ method: 'PATCH', path: `/trust/hosts/${selectedId}` }}
                    after={patchScopes.readBackData?.data}
                    error={errMsg(patchScopes.error)}
                  />
                </div>
              )}
            </ResourceDetail.Section>
            {selected.capabilities !== undefined && (
              <ResourceDetail.Section title="Capabilities">
                <JsonInspector value={selected.capabilities} />
              </ResourceDetail.Section>
            )}
          </ResourceDetail>
        </SectionCard>
      )}

      {selectedId && !selected && detail.isLoading && <Note type="default">Loading host…</Note>}

      <ConfirmDialog
        open={confirmScopes}
        onClose={() => setConfirmScopes(false)}
        onConfirm={() => {
          if (selectedId)
            patchScopes.mutate({
              id: selectedId,
              scopes: scopesText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            });
          setConfirmScopes(false);
        }}
        title="Replace host scopes"
        targetName={String(selected?.hostname ?? '')}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Replace scopes"
        description="Replaces this host's entire scope set."
      />
      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={() => {
          if (selectedId) revoke.mutate(selectedId);
          setConfirmRevoke(false);
          setSelectedId(null);
        }}
        title="Revoke trust host"
        targetName={String(selected?.hostname ?? '')}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Revoke"
        description="Revokes trust — this host can no longer sign requests."
      />
    </PageShell>
  );
}
