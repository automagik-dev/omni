'use client';

/**
 * Settings — grouped key/value platform config. Keys are grouped by prefix; each
 * shows its type, description, and documented default. A selected key gets an
 * editor (PUT + read-back), a change-history timeline, and a restore flow (PUT a
 * chosen value + read-back). Secret-typed values arrive masked and are never
 * echoed. Deleting a key is destructive and typed-phrase gated.
 */
import { Badge, Button, Input, Note, PillBadge, SectionCard, StatusDot } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { SettingHistoryRow, SettingRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, ConfirmDialog, DataTable, MutationResult, PageShell, ResourceDetail } from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { coerceValue, displayValue, groupOf, isSecretWipe } from './settings-helpers';
import { CardSection, DataRowList, errMsg, fmtTime } from './shared';

/** Masked secret rendered with a lock glyph so the value column reads as sealed. */
function SecretValue({ setting }: { setting: Pick<SettingRow, 'isSecret' | 'value'> }) {
  if (!setting.isSecret) return <>{displayValue(setting)}</>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.secondary }}>
      <span aria-hidden style={{ fontSize: 11 }}>
        🔒
      </span>
      <span style={{ letterSpacing: '0.15em' }}>••••••••</span>
    </span>
  );
}

/** Change history as a vertical StatusDot timeline — newest first, mono metadata. */
function HistoryTimeline({ rows, loading }: { rows: SettingHistoryRow[]; loading: boolean }) {
  if (loading) return <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>;
  if (rows.length === 0) return <span style={{ fontSize: 12.5, color: T.muted }}>No change history.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((h, i) => (
        <div
          key={`${h.changedAt}-${h.changedBy}-${i}`}
          style={{ position: 'relative', paddingLeft: 22, paddingBottom: i === rows.length - 1 ? 0 : 14 }}
        >
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 6,
              top: 14,
              bottom: i === rows.length - 1 ? undefined : -2,
              height: i === rows.length - 1 ? 0 : undefined,
              width: 1,
              background: T.border,
            }}
          />
          <span style={{ position: 'absolute', left: 2, top: 4 }}>
            <StatusDot state={i === 0 ? 'active' : 'idle'} size="sm" pulse={i === 0} />
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontFamily: T.mono, color: T.secondary, fontVariantNumeric: 'tabular-nums' }}>
              {fmtTime(h.changedAt)}
            </span>
            <span style={{ fontSize: 12.5, color: T.fg, fontWeight: 600 }}>{h.changedBy ?? '—'}</span>
            {h.changeReason && <span style={{ fontSize: 12, color: T.muted }}>· {h.changeReason}</span>}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, fontFamily: T.mono, color: T.tertiary, wordBreak: 'break-all' }}>
            {String(h.newValue ?? '(redacted)')}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { ext } = useOmniClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [restoreValue, setRestoreValue] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const list = useOmniQuery(['settings', 'list'], () => ext.settings.list());
  const detail = useOmniQuery(['settings', selectedKey], () => ext.settings.get(selectedKey ?? ''), {
    enabled: Boolean(selectedKey),
  });
  const history = useOmniQuery(
    ['settings', selectedKey, 'history'],
    () => ext.settings.history(selectedKey ?? '', { limit: 50 }),
    {
      enabled: Boolean(selectedKey),
    },
  );

  const put = useOmniMutation({
    mutationFn: (vars: { key: string; value: unknown; reason: string }) =>
      ext.settings.put(vars.key, vars.value, vars.reason),
    invalidate: [['settings', 'list']],
    readBack: (_d, vars) => ext.settings.get(vars.key),
  });
  const remove = useOmniMutation({
    mutationFn: (key: string) => ext.settings.remove(key),
    invalidate: [['settings', 'list']],
  });

  const groups = useMemo(() => {
    const map = new Map<string, SettingRow[]>();
    for (const s of list.data?.items ?? []) {
      const g = groupOf(s.key);
      const arr = map.get(g) ?? [];
      arr.push(s);
      map.set(g, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list.data]);

  const selected = detail.data?.data;
  const restoreWipe = selected ? isSecretWipe(selected, restoreValue) : false;

  const settingColumns: ColumnDef<SettingRow>[] = [
    {
      key: 'key',
      header: 'Key',
      mono: true,
      render: (s) => <span style={{ fontWeight: 600, color: T.fg }}>{s.key}</span>,
    },
    { key: 'value', header: 'Value', mono: true, render: (s) => <SecretValue setting={s} /> },
    {
      key: 'valueType',
      header: 'Type',
      width: 90,
      render: (s) => <PillBadge size="sm">{s.valueType ?? '—'}</PillBadge>,
    },
    {
      key: 'default',
      header: 'Default',
      mono: true,
      width: 160,
      accessor: (s) => (s.defaultValue === undefined ? '—' : String(s.defaultValue)),
    },
  ];

  return (
    <PageShell
      eyebrow="Configuration"
      title="Settings"
      description="Platform settings, grouped by prefix. Secrets are masked; history values are redacted by the API."
      actions={
        <Button size="small" variant="secondary" onClick={() => void list.refetch()}>
          Refresh
        </Button>
      }
    >
      {list.error && (
        <Note type="error" label="Error">
          {errMsg(list.error)}
        </Note>
      )}

      {groups.map(([group, settings]) => (
        <CardSection key={group} title={group}>
          <DataTable
            columns={settingColumns}
            rows={settings}
            getRowKey={(s) => s.key}
            onRowClick={(s) => {
              setSelectedKey(s.key);
              setEditValue(s.isSecret ? '' : displayValue(s));
              setRestoreValue('');
              put.reset();
            }}
          />
        </CardSection>
      ))}

      {selectedKey && selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={selected.key}
            id={selected.key}
            status={selected.isSecret ? <Badge variant="amber">secret</Badge> : undefined}
            actions={
              <Button size="small" variant="error" onClick={() => setConfirmDelete(true)}>
                Delete key
              </Button>
            }
          >
            <ResourceDetail.Section title="Fields">
              <DataRowList
                rows={[
                  { label: 'Type', value: selected.valueType ?? '—' },
                  { label: 'Category', value: selected.category ?? '—' },
                  { label: 'Description', value: selected.description ?? '—' },
                  {
                    label: 'Default',
                    value: selected.defaultValue === undefined ? '—' : String(selected.defaultValue),
                  },
                  { label: 'Current', value: <SecretValue setting={selected} /> },
                  { label: 'Updated', value: fmtTime(selected.updatedAt) },
                ]}
              />
            </ResourceDetail.Section>

            <ResourceDetail.Section
              title="Edit value"
              description="Sends PUT and re-reads to prove the write landed. JSON is auto-detected."
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  value={editValue}
                  placeholder={selected.isSecret ? 'enter new secret value' : 'value'}
                  onChange={(e) => setEditValue(e.target.value)}
                />
                <Button
                  size="small"
                  variant="default"
                  disabled={put.isPending || isSecretWipe(selected, editValue)}
                  onClick={() =>
                    put.mutate({ key: selected.key, value: coerceValue(editValue), reason: 'khal-ui edit' })
                  }
                >
                  Save
                </Button>
              </div>
              {isSecretWipe(selected, editValue) && (
                <div style={{ marginTop: 6, fontSize: 12, color: T.muted }}>
                  Enter a new value to save — a secret can't be overwritten with an empty string.
                </div>
              )}
              {(put.readBackData || put.error) && (
                <div style={{ marginTop: 12 }}>
                  <MutationResult
                    effect="live"
                    request={{ method: 'PUT', path: `/settings/${selected.key}` }}
                    after={put.readBackData?.data}
                    error={errMsg(put.error)}
                  />
                </div>
              )}
            </ResourceDetail.Section>

            <ResourceDetail.Section
              title={`History (${history.data?.items?.length ?? 0})`}
              description="The API redacts historical values, so restore re-applies a value you supply."
              actions={
                <Button size="small" variant="secondary" onClick={() => setConfirmRestore(true)}>
                  Restore a value…
                </Button>
              }
            >
              <HistoryTimeline rows={history.data?.items ?? []} loading={history.isLoading} />
            </ResourceDetail.Section>
          </ResourceDetail>
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        onConfirm={() => {
          if (selectedKey && !restoreWipe)
            put.mutate({ key: selectedKey, value: coerceValue(restoreValue), reason: 'khal-ui restore' });
          setConfirmRestore(false);
        }}
        title="Restore a value"
        targetName={selectedKey ?? ''}
        targetId={selectedKey ?? ''}
        effect="live"
        confirmLabel="Restore"
        confirmDisabled={restoreWipe}
        description={
          <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>Value to restore (JSON auto-detected)</span>
            <Input value={restoreValue} onChange={(e) => setRestoreValue(e.target.value)} placeholder="value" />
            {restoreWipe && (
              <span style={{ fontSize: 12, color: T.muted }}>
                Enter a value to restore — a secret can't be overwritten with an empty string.
              </span>
            )}
          </span>
        }
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (selectedKey) remove.mutate(selectedKey);
          setConfirmDelete(false);
          setSelectedKey(null);
        }}
        title="Delete setting"
        targetName={selectedKey ?? ''}
        targetId={selectedKey ?? ''}
        effect="live"
        destructive
        confirmLabel="Delete"
        description="Removes this setting key entirely."
      />
    </PageShell>
  );
}
