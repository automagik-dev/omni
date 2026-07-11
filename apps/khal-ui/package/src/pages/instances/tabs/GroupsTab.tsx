'use client';

/**
 * Groups tab: the group list, create/join tools, and — when a group is picked —
 * a detail view with members, subject/description/settings edits, invite link
 * get/revoke, participant mutation, picture set, and leave. Reads are open on
 * every instance; writes are blocked on production.
 */
import type { Group } from '@omni/sdk';
import { useState } from 'react';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel, ToolRow } from '../components';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

// The SDK keeps GroupMember internal (not re-exported); mirror its shape here.
interface GroupMemberRow {
  id: string;
  name?: string;
  role?: 'admin' | 'superadmin' | 'member';
}

const memberColumns: ColumnDef<GroupMemberRow>[] = [
  { key: 'id', header: 'Member', mono: true },
  { key: 'name', header: 'Name', accessor: (m) => m.name ?? '—' },
  { key: 'role', header: 'Role', width: 110, accessor: (m) => m.role ?? 'member' },
];

const PARTICIPANT_ACTIONS = ['add', 'remove', 'promote', 'demote'];
const GROUP_SETTINGS = ['announcement', 'not_announcement', 'locked', 'unlocked'];

export function GroupsTab({ instance, isProduction }: InstanceTabProps) {
  const { client } = useOmniClient();
  const id = instance.id;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Group | null>(null);
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;

  const groups = useOmniQuery(['instances', id, 'groups', search], () =>
    client.instances.listGroups(id, { limit: 100, search: search || undefined }),
  );

  const columns: ColumnDef<Group>[] = [
    { key: 'name', header: 'Name', accessor: (g) => g.name ?? '—' },
    { key: 'memberCount', header: 'Members', width: 100, accessor: (g) => g.memberCount ?? '—' },
    { key: 'externalId', header: 'JID', mono: true },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <DataTable
        columns={columns}
        rows={groups.data?.items ?? []}
        getRowKey={(g) => g.externalId}
        loading={groups.isLoading}
        error={groups.error ? (groups.error as Error).message : null}
        emptyTitle="No groups"
        onRowClick={(g) => setSelected(g)}
        toolbar={
          <input
            value={search}
            placeholder="Search groups…"
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.surface,
              color: T.fg,
              fontSize: 13,
              maxWidth: 280,
            }}
          />
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <CreateGroup instanceId={id} instanceName={instance.name} guard={guard} onDone={() => void groups.refetch()} />
        <JoinGroup instanceId={id} instanceName={instance.name} guard={guard} onDone={() => void groups.refetch()} />
        <ChatInvite instanceId={id} instanceName={instance.name} />
      </div>

      {selected && (
        <GroupDetail
          instanceId={id}
          instanceName={instance.name}
          group={selected}
          guard={guard}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function CreateGroup({
  instanceId,
  instanceName,
  guard,
  onDone,
}: {
  instanceId: string;
  instanceName: string;
  guard?: string;
  onDone: () => void;
}) {
  const { ext } = useOmniClient();
  const [subject, setSubject] = useState('');
  const [participants, setParticipants] = useState('');
  return (
    <Panel title="Create group" description="Subject and initial participants.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={subject}
          placeholder="Group subject"
          onChange={(e) => setSubject(e.target.value)}
          style={fieldStyle}
        />
        <input
          value={participants}
          placeholder="participants (comma-separated JIDs)"
          onChange={(e) => setParticipants(e.target.value)}
          style={fieldStyle}
        />
        <ActionButton
          label="Create group"
          effect="live"
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={
            guard ?? (subject.trim() && participants.trim() ? undefined : 'Subject and participants required')
          }
          onDone={onDone}
          run={() =>
            ext.instances.createGroup(
              instanceId,
              subject.trim(),
              participants
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean),
            )
          }
        />
      </div>
    </Panel>
  );
}

function JoinGroup({
  instanceId,
  instanceName,
  guard,
  onDone,
}: {
  instanceId: string;
  instanceName: string;
  guard?: string;
  onDone: () => void;
}) {
  const { ext } = useOmniClient();
  return (
    <Panel title="Join group" description="Join via an invite code.">
      <ToolRow
        label="Invite code"
        placeholder="invite code from a link"
        buttonLabel="Join"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={async (value) => {
          const r = await ext.instances.joinGroup(instanceId, value);
          onDone();
          return r;
        }}
      />
    </Panel>
  );
}

function ChatInvite({ instanceId, instanceName }: { instanceId: string; instanceName: string }) {
  const { ext } = useOmniClient();
  return (
    <Panel title="Chat invite" description="Fetch the invite link for a chat.">
      <ToolRow
        label="Chat ID"
        placeholder="chat id / JID"
        buttonLabel="Get invite"
        effect="read-only"
        targetName={instanceName}
        targetId={instanceId}
        run={(value) => ext.instances.chatInvite(instanceId, value)}
      />
    </Panel>
  );
}

function GroupDetail({
  instanceId,
  instanceName,
  group,
  guard,
  onClose,
}: {
  instanceId: string;
  instanceName: string;
  group: Group;
  guard?: string;
  onClose: () => void;
}) {
  const { ext, client } = useOmniClient();
  const jid = group.externalId;
  const members = useOmniQuery(['instances', instanceId, 'group-members', jid], () =>
    client.instances.listGroupMembers(instanceId, jid),
  );
  const [setting, setSetting] = useState('announcement');
  const [pAction, setPAction] = useState('add');
  const [pList, setPList] = useState('');

  return (
    <Panel
      title={`Group · ${group.name ?? jid}`}
      description={jid}
      actions={
        <button type="button" onClick={onClose} style={closeStyle}>
          Close
        </button>
      }
    >
      <DataTable
        columns={memberColumns}
        rows={members.data?.members ?? []}
        getRowKey={(m) => m.id}
        loading={members.isLoading}
        error={members.error ? (members.error as Error).message : null}
        emptyTitle="No members"
      />

      <ToolRow
        label="Set subject"
        placeholder="new group subject"
        buttonLabel="Save subject"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={(value) => ext.instances.setGroupSubject(instanceId, jid, value)}
      />
      <ToolRow
        label="Set description"
        placeholder="new group description"
        buttonLabel="Save description"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={(value) => ext.instances.setGroupDescription(instanceId, jid, value)}
      />
      <ToolRow
        label="Set picture (base64)"
        placeholder="data URL or base64 JPEG"
        buttonLabel="Save picture"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={(value) => ext.instances.setGroupPicture(instanceId, jid, value)}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.fg }}>Group setting</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={setting} onChange={(e) => setSetting(e.target.value)} style={selectStyle}>
            {GROUP_SETTINGS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <ActionButton
            label="Apply setting"
            effect="live"
            targetName={instanceName}
            targetId={instanceId}
            disabledReason={guard}
            run={() => ext.instances.setGroupSettings(instanceId, jid, setting)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.fg }}>Participants</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={pAction} onChange={(e) => setPAction(e.target.value)} style={selectStyle}>
            {PARTICIPANT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            value={pList}
            placeholder="JIDs (comma-separated)"
            onChange={(e) => setPList(e.target.value)}
            style={{ ...fieldStyle, minWidth: 220 }}
          />
          <ActionButton
            label="Apply"
            effect="live"
            targetName={instanceName}
            targetId={instanceId}
            disabledReason={guard ?? (pList.trim() ? undefined : 'Enter participants')}
            onDone={() => void members.refetch()}
            run={() =>
              ext.instances.groupParticipants(
                instanceId,
                jid,
                pAction,
                pList
                  .split(',')
                  .map((p) => p.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
        <ActionButton
          label="Get invite link"
          effect="read-only"
          targetName={instanceName}
          targetId={instanceId}
          run={() => ext.instances.groupInvite(instanceId, jid)}
        />
        <ActionButton
          label="Revoke invite"
          effect="live"
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={guard}
          run={() => ext.instances.revokeGroupInvite(instanceId, jid)}
        />
        <ActionButton
          label="Leave group"
          effect="live"
          destructive
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={guard}
          confirmDescription={`Leave "${group.name ?? jid}".`}
          onDone={onClose}
          run={() => ext.instances.leaveGroup(instanceId, jid)}
        />
      </div>
    </Panel>
  );
}

const fieldStyle = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
} as const;

const selectStyle = {
  ...fieldStyle,
  minWidth: 160,
} as const;

const closeStyle = {
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  background: T.surface,
  color: T.muted,
  fontSize: 12,
  padding: '4px 10px',
  cursor: 'pointer',
} as const;
