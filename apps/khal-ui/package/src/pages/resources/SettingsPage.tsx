'use client';

/**
 * Settings — grouped key/value platform config. Keys are grouped by prefix; each
 * shows its type, description, and documented default. A selected key gets an
 * editor (PUT + read-back), a change-history timeline, and a restore flow (PUT a
 * chosen value + read-back). Secret-typed values arrive masked and are never
 * echoed. Deleting a key is destructive and typed-phrase gated.
 */
import { Badge, Button, Input, Note, PillBadge, SectionCard } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { SettingHistoryRow, SettingRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  MutationResult,
  PageShell,
  ResourceDetail,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg, fmtTime } from './shared';

function groupOf(key: string): string {
  const dot = key.indexOf('.');
  if (dot > 0) return key.slice(0, dot);
  const us = key.indexOf('_');
  return us > 0 ? key.slice(0, us) : 'general';
}

/** Parse a value string the way the API's type auto-detect expects: JSON if it parses, else the raw string. */
function coerceValue(text: string): unknown {
  const t = text.trim();
  if (!t) return '';
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

function displayValue(s: SettingRow): string {
  if (s.isSecret) return '••••••••';
  if (s.value === null || s.value === undefined) return '—';
  return typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value);
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

  const settingColumns: ColumnDef<SettingRow>[] = [
    {
      key: 'key',
      header: 'Key',
      mono: true,
      render: (s) => <span style={{ fontWeight: 600, color: T.fg }}>{s.key}</span>,
    },
    { key: 'value', header: 'Value', mono: true, accessor: (s) => displayValue(s) },
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

  const historyColumns: ColumnDef<SettingHistoryRow>[] = [
    { key: 'changedAt', header: 'When', width: 180, mono: true, accessor: (h) => fmtTime(h.changedAt) },
    { key: 'changedBy', header: 'By', accessor: (h) => h.changedBy ?? '—' },
    { key: 'changeReason', header: 'Reason', accessor: (h) => h.changeReason ?? '—' },
    { key: 'newValue', header: 'New', mono: true, accessor: (h) => String(h.newValue ?? '(redacted)') },
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
        <SectionCard key={group} padding="md">
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>{group}</h3>
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
        </SectionCard>
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
              <FieldGrid
                fields={[
                  { label: 'Type', value: selected.valueType },
                  { label: 'Category', value: selected.category ?? '—' },
                  { label: 'Description', value: selected.description ?? '—' },
                  {
                    label: 'Default',
                    value: selected.defaultValue === undefined ? '—' : String(selected.defaultValue),
                    mono: true,
                  },
                  { label: 'Current', value: displayValue(selected), mono: true },
                  { label: 'Updated', value: fmtTime(selected.updatedAt), mono: true },
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
                  disabled={put.isPending}
                  onClick={() =>
                    put.mutate({ key: selected.key, value: coerceValue(editValue), reason: 'khal-ui edit' })
                  }
                >
                  Save
                </Button>
              </div>
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
              <DataTable
                columns={historyColumns}
                rows={history.data?.items ?? []}
                getRowKey={(h) => `${h.changedAt}-${h.changedBy}`}
                loading={history.isLoading}
                emptyTitle="No change history"
              />
            </ResourceDetail.Section>
          </ResourceDetail>
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        onConfirm={() => {
          if (selectedKey)
            put.mutate({ key: selectedKey, value: coerceValue(restoreValue), reason: 'khal-ui restore' });
          setConfirmRestore(false);
        }}
        title="Restore a value"
        targetName={selectedKey ?? ''}
        targetId={selectedKey ?? ''}
        effect="live"
        confirmLabel="Restore"
        description={
          <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>Value to restore (JSON auto-detected)</span>
            <Input value={restoreValue} onChange={(e) => setRestoreValue(e.target.value)} placeholder="value" />
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
