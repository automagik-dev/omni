'use client';

/**
 * Contacts — the per-instance address book. Pick an instance and the directory
 * fans in from GET /instances/:id/contacts (read-only). Deeper contact actions
 * (block/unblock) live on the instance detail's Contacts tab; this is the
 * cross-cutting browse surface.
 */
import { Badge, Note, SectionCard } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { ContactRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, FieldGrid, JsonInspector, PageShell, ResourceDetail } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { InstancePicker, StatGrid, errMsg } from './shared';

function contactName(r: ContactRow): string {
  return r.displayName ?? '(unnamed)';
}

export function ContactsPage() {
  const { ext } = useOmniClient();
  const [instanceId, setInstanceId] = useState('');
  const [selected, setSelected] = useState<ContactRow | null>(null);

  const contacts = useOmniQuery(['contacts', instanceId], () => ext.instances.contacts(instanceId, { limit: 500 }), {
    enabled: Boolean(instanceId),
  });

  const rows = useMemo(() => contacts.data?.items ?? [], [contacts.data]);
  const counts = useMemo(() => {
    let groups = 0;
    let business = 0;
    for (const r of rows) {
      if (r.isGroup) groups++;
      if (r.isBusiness) business++;
    }
    return { total: rows.length, groups, business, contacts: rows.length - groups - business };
  }, [rows]);

  const columns: ColumnDef<ContactRow>[] = [
    {
      key: 'displayName',
      header: 'Name',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{contactName(r)}</span>,
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
          {rows.length > 0 && (
            <StatGrid
              min={130}
              stats={[
                { label: 'Total', value: counts.total },
                { label: 'Contacts', value: counts.contacts },
                { label: 'Groups', value: counts.groups },
                { label: 'Business', value: counts.business },
              ]}
            />
          )}

          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.platformUserId ?? JSON.stringify(r)}
            loading={contacts.isLoading}
            error={errMsg(contacts.error)}
            emptyTitle="No contacts"
            emptyDescription="This instance returned no contacts, or the channel does not support contact listing."
            onRowClick={(r) => setSelected(r)}
          />

          {selected && (
            <SectionCard padding="md">
              <ResourceDetail
                title={contactName(selected)}
                id={selected.platformUserId ?? undefined}
                status={
                  selected.isGroup ? (
                    <Badge variant="purple">group</Badge>
                  ) : selected.isBusiness ? (
                    <Badge variant="teal">business</Badge>
                  ) : (
                    <Badge variant="gray">contact</Badge>
                  )
                }
              >
                <ResourceDetail.Section title="Fields">
                  <FieldGrid
                    fields={[
                      { label: 'Name', value: selected.displayName ?? '—' },
                      { label: 'Phone', value: selected.phone ?? '—', mono: true },
                      { label: 'Platform ID', value: selected.platformUserId ?? '—', mono: true },
                      { label: 'Group', value: Boolean(selected.isGroup) },
                      { label: 'Business', value: Boolean(selected.isBusiness) },
                    ]}
                  />
                </ResourceDetail.Section>
                <ResourceDetail.Section title="Raw">
                  <JsonInspector value={selected} />
                </ResourceDetail.Section>
              </ResourceDetail>
            </SectionCard>
          )}
        </>
      )}
    </PageShell>
  );
}
