'use client';

/**
 * Access Rules — allow/deny routing policy. List (filterable by instance/type),
 * a create form (rule type + action + one of phone/user/person), an inline detail
 * with enable/disable and a destructive delete, and a live access-check tester
 * that explains the decision for a given user.
 */
import { Badge, Button, Input, Note, SectionCard, Toggle } from '@khal-os/ui';
import { useState } from 'react';
import type { AccessRuleRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  LiveTestResult,
  type LiveTestStatus,
  MutationResult,
  PageShell,
  ResourceDetail,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { InstancePicker, errMsg, fmtTime } from './shared';

const selectStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
};

export function AccessRulesPage() {
  const { ext } = useOmniClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Create form.
  const [ruleType, setRuleType] = useState('deny');
  const [action, setAction] = useState('block');
  const [phonePattern, setPhonePattern] = useState('');
  const [enabled, setEnabled] = useState(true);

  // Access checker.
  const [checkInstance, setCheckInstance] = useState('');
  const [checkUser, setCheckUser] = useState('');
  const [checkChannel, setCheckChannel] = useState('whatsapp-baileys');

  const list = useOmniQuery(['access', 'rules'], () => ext.access.rules());
  const detail = useOmniQuery(['access', 'rule', selectedId], () => ext.access.rule(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });

  const create = useOmniMutation({
    mutationFn: () => ext.access.createRule({ ruleType, action, phonePattern, enabled }),
    invalidate: [['access', 'rules']],
  });
  const patch = useOmniMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => ext.access.patchRule(vars.id, { enabled: vars.enabled }),
    invalidate: [['access', 'rules']],
    readBack: (_d, vars) => ext.access.rule(vars.id),
  });
  const remove = useOmniMutation({
    mutationFn: (id: string) => ext.access.removeRule(id),
    invalidate: [['access', 'rules']],
  });
  const check = useOmniMutation({
    mutationFn: () => ext.access.check({ instanceId: checkInstance, platformUserId: checkUser, channel: checkChannel }),
  });

  const selected = detail.data?.data;
  const checkStatus: LiveTestStatus = check.isPending
    ? 'pending'
    : check.data
      ? check.data.data?.allowed
        ? 'pass'
        : 'fail'
      : 'pending';

  const columns: ColumnDef<AccessRuleRow>[] = [
    {
      key: 'ruleType',
      header: 'Type',
      width: 90,
      render: (r) => <Badge variant={r.ruleType === 'deny' ? 'red' : 'green'}>{r.ruleType}</Badge>,
    },
    { key: 'action', header: 'Action', width: 120, accessor: (r) => r.action ?? '—' },
    {
      key: 'match',
      header: 'Match',
      mono: true,
      accessor: (r) => r.phonePattern ?? r.platformUserId ?? r.personId ?? '—',
    },
    {
      key: 'enabled',
      header: 'Enabled',
      width: 100,
      render: (r) => <Badge variant={r.enabled ? 'green' : 'gray'}>{r.enabled ? 'on' : 'off'}</Badge>,
    },
    { key: 'priority', header: 'Prio', width: 70, align: 'right', accessor: (r) => r.priority ?? 0 },
  ];

  return (
    <PageShell
      eyebrow="Channels & Access"
      title="Access Rules"
      description="Allow/deny routing policy and a live access checker."
    >
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No access rules"
        onRowClick={(r) => {
          setSelectedId(r.id);
          patch.reset();
        }}
      />

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>New rule</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value)} style={selectStyle}>
            <option value="deny">deny</option>
            <option value="allow">allow</option>
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={selectStyle}>
            <option value="block">block</option>
            <option value="allow">allow</option>
            <option value="silent_block">silent_block</option>
          </select>
          <Input
            placeholder="phonePattern (e.g. 5511*)"
            value={phonePattern}
            onChange={(e) => setPhonePattern(e.target.value)}
          />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}>
            enabled
            <Toggle checked={enabled} onChange={setEnabled} />
          </span>
          <Button
            size="small"
            variant="default"
            disabled={!phonePattern || create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            Create
          </Button>
        </div>
        {(create.data || create.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/access/rules' }}
              response={create.data}
              error={errMsg(create.error)}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: T.fg }}>Access checker</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <InstancePicker value={checkInstance} onChange={setCheckInstance} />
          <Input
            placeholder="platformUserId (e.g. 5511999999999)"
            value={checkUser}
            onChange={(e) => setCheckUser(e.target.value)}
          />
          <Input placeholder="channel" value={checkChannel} onChange={(e) => setCheckChannel(e.target.value)} />
          <Button
            size="small"
            variant="secondary"
            disabled={!checkInstance || !checkUser}
            onClick={() => check.mutate(undefined)}
          >
            Check
          </Button>
        </div>
        {(check.data || check.error) && (
          <div style={{ marginTop: 12 }}>
            <LiveTestResult
              name={`access.check(${checkUser})`}
              effect="read-only"
              status={check.error ? 'fail' : checkStatus}
              message={check.error ? (errMsg(check.error) ?? undefined) : check.data?.data?.reason}
              evidence={check.data?.data}
            />
          </div>
        )}
      </SectionCard>

      {selectedId && selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={`${selected.ruleType} rule`}
            id={selectedId}
            status={<Badge variant={selected.enabled ? 'green' : 'gray'}>{selected.enabled ? 'on' : 'off'}</Badge>}
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
                  { label: 'Instance', value: selected.instanceId ?? 'all', mono: true },
                  { label: 'Action', value: selected.action },
                  { label: 'Phone pattern', value: selected.phonePattern ?? '—', mono: true },
                  { label: 'Platform user', value: selected.platformUserId ?? '—', mono: true },
                  { label: 'Priority', value: selected.priority ?? 0 },
                  { label: 'Reason', value: selected.reason ?? '—' },
                  { label: 'Expires', value: fmtTime(selected.expiresAt), mono: true },
                ]}
              />
            </ResourceDetail.Section>
            {(patch.readBackData || patch.error) && (
              <MutationResult
                effect="live"
                request={{ method: 'PATCH', path: `/access/rules/${selectedId}` }}
                after={patch.readBackData?.data}
                error={errMsg(patch.error)}
              />
            )}
          </ResourceDetail>
        </SectionCard>
      )}

      {list.data?.items?.length === 0 && (
        <Note type="default">No access rules configured — all traffic is allowed by default.</Note>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (selectedId) remove.mutate(selectedId);
          setConfirmDelete(false);
          setSelectedId(null);
        }}
        title="Delete access rule"
        targetName={selected?.phonePattern ?? selected?.ruleType ?? 'rule'}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Delete"
      />
    </PageShell>
  );
}
