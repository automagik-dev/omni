'use client';

/**
 * Contacts tab: the channel address book (read-only DataTable), a number-check
 * tool, the blocklist (list / block / unblock), and a per-user profile lookup.
 * Reads work on every instance including production; writes (block/unblock) are
 * blocked on production.
 */
import type { Contact } from '@omni/sdk';
import { useState } from 'react';
import type { BlocklistEntry } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel, ToolRow } from '../components';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

const contactColumns: ColumnDef<Contact>[] = [
  { key: 'displayName', header: 'Name', accessor: (c) => c.displayName ?? '—' },
  { key: 'phone', header: 'Phone', mono: true, accessor: (c) => c.phone ?? '—' },
  { key: 'platformUserId', header: 'User ID', mono: true },
  { key: 'isGroup', header: 'Group', width: 80, accessor: (c) => (c.isGroup ? 'yes' : 'no') },
  { key: 'isBusiness', header: 'Business', width: 90, accessor: (c) => (c.isBusiness ? 'yes' : 'no') },
];

const searchInputStyle = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
  maxWidth: 280,
} as const;

export function ContactsTab({ instance, isProduction }: InstanceTabProps) {
  const { client } = useOmniClient();
  const id = instance.id;
  const [search, setSearch] = useState('');
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;

  const contacts = useOmniQuery(['instances', id, 'contacts', search], () =>
    client.instances.listContacts(id, { limit: 100, search: search || undefined }),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <DataTable
        columns={contactColumns}
        rows={contacts.data?.items ?? []}
        getRowKey={(c) => c.platformUserId}
        loading={contacts.isLoading}
        error={contacts.error ? (contacts.error as Error).message : null}
        emptyTitle="No contacts"
        toolbar={
          <input
            value={search}
            placeholder="Search contacts…"
            onChange={(e) => setSearch(e.target.value)}
            style={searchInputStyle}
          />
        }
      />

      <CheckNumbers instanceId={id} instanceName={instance.name} />
      <Blocklist instanceId={id} instanceName={instance.name} guard={guard} />
      <UserProfileLookup instanceId={id} instanceName={instance.name} />
    </div>
  );
}

function CheckNumbers({ instanceId, instanceName }: { instanceId: string; instanceName: string }) {
  const { ext } = useOmniClient();
  return (
    <Panel title="Check numbers" description="Check whether phone numbers are reachable on this channel.">
      <ToolRow
        label="Phone numbers (comma-separated)"
        placeholder="+5511999999999, +5511888888888"
        buttonLabel="Check"
        effect="read-only"
        targetName={instanceName}
        targetId={instanceId}
        run={(value) => {
          const phones = value
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
          return ext.instances.checkNumber(instanceId, phones);
        }}
      />
    </Panel>
  );
}

function Blocklist({ instanceId, instanceName, guard }: { instanceId: string; instanceName: string; guard?: string }) {
  const { ext } = useOmniClient();
  const blocklist = useOmniQuery(['instances', instanceId, 'blocklist'], () => ext.instances.blocklist(instanceId));
  const columns: ColumnDef<BlocklistEntry>[] = [
    { key: 'jid', header: 'JID / ID', mono: true, accessor: (b) => String(b.jid ?? b.id ?? '—') },
    { key: 'name', header: 'Name', accessor: (b) => (b.name ? String(b.name) : '—') },
    {
      key: 'actions',
      header: '',
      width: 130,
      render: (b) => (
        <ActionButton
          label="Unblock"
          effect="live"
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={guard}
          onDone={() => void blocklist.refetch()}
          run={() => ext.instances.unblock(instanceId, String(b.jid ?? b.id ?? ''))}
        />
      ),
    },
  ];
  return (
    <Panel
      title="Blocklist"
      description="Blocked contacts on this channel."
      actions={<span style={{ fontSize: 12, color: T.muted }}>{blocklist.data?.items?.length ?? 0} blocked</span>}
    >
      <ToolRow
        label="Block a contact"
        placeholder="contact JID or phone"
        buttonLabel="Block"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        run={async (value) => {
          const r = await ext.instances.block(instanceId, value);
          void blocklist.refetch();
          return r;
        }}
      />
      <DataTable
        columns={columns}
        rows={blocklist.data?.items ?? []}
        getRowKey={(b) => String(b.jid ?? b.id ?? Math.random())}
        loading={blocklist.isLoading}
        error={blocklist.error ? (blocklist.error as Error).message : null}
        emptyTitle="Blocklist empty"
      />
    </Panel>
  );
}

function UserProfileLookup({ instanceId, instanceName }: { instanceId: string; instanceName: string }) {
  const { client } = useOmniClient();
  return (
    <Panel title="User profile lookup" description="Fetch a single user's channel profile.">
      <ToolRow
        label="User ID"
        placeholder="platform user id / JID"
        buttonLabel="Look up"
        effect="read-only"
        targetName={instanceName}
        targetId={instanceId}
        run={(value) => client.instances.getUserProfile(instanceId, value)}
      />
    </Panel>
  );
}
