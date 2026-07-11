'use client';

/**
 * Contacts — the per-instance address book. Pick an instance and the directory
 * fans in from GET /instances/:id/contacts (read-only). Deeper contact actions
 * (block/unblock) live on the instance detail's Contacts tab; this is the
 * cross-cutting browse surface.
 */
import { Badge, Note } from '@khal-os/ui';
import { useState } from 'react';
import type { ContactRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, JsonInspector, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { InstancePicker, errMsg } from './shared';

export function ContactsPage() {
  const { ext } = useOmniClient();
  const [instanceId, setInstanceId] = useState('');
  const [selected, setSelected] = useState<ContactRow | null>(null);

  const contacts = useOmniQuery(['contacts', instanceId], () => ext.instances.contacts(instanceId, { limit: 500 }), {
    enabled: Boolean(instanceId),
  });

  const columns: ColumnDef<ContactRow>[] = [
    {
      key: 'displayName',
      header: 'Name',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.displayName ?? '(unnamed)'}</span>,
    },
    { key: 'phone', header: 'Phone', mono: true, accessor: (r) => r.phone ?? '—' },
    {
      key: 'kind',
      header: 'Kind',
      width: 120,
      render: (r) => (
        <div style={{ display: 'flex', gap: 4 }}>
          {r.isGroup && <Badge variant="purple">group</Badge>}
          {r.isBusiness && <Badge variant="teal">business</Badge>}
          {!r.isGroup && !r.isBusiness && <Badge variant="gray">contact</Badge>}
        </div>
      ),
    },
    { key: 'platformUserId', header: 'Platform ID', mono: true, width: 260, accessor: (r) => r.platformUserId ?? '—' },
  ];

  return (
    <PageShell
      eyebrow="Messaging"
      title="Contacts"
      description="Per-instance address book, fanned in from the channel."
      actions={<InstancePicker value={instanceId} onChange={setInstanceId} />}
    >
      {!instanceId ? (
        <Note type="default" label="Pick an instance">
          Select an instance above to load its contact directory.
        </Note>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={contacts.data?.items ?? []}
            getRowKey={(r) => r.platformUserId ?? JSON.stringify(r)}
            loading={contacts.isLoading}
            error={errMsg(contacts.error)}
            emptyTitle="No contacts"
            emptyDescription="This instance returned no contacts, or the channel does not support contact listing."
            onRowClick={(r) => setSelected(r)}
          />
          {selected && (
            <div style={{ marginTop: 4 }}>
              <JsonInspector value={selected} />
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
