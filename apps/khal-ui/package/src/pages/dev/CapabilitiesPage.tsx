'use client';

/**
 * Capabilities — a live view of the generated capability inventory (bundled
 * `capabilities.json`). Shows coverage totals and a filterable table of every
 * backend capability the UI tracks, so later groups can see at a glance what's
 * still dark. Data is static/bundled, so filtering is local.
 */
import { Input, MetricDisplay, PillBadge, SectionCard } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { Capability } from '../../capabilities';
import { capabilityInventory } from '../../capabilities';
import { DataTable } from '../../components/DataTable';
import type { ColumnDef } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';

const columns: ColumnDef<Capability>[] = [
  { key: 'resource', header: 'Resource', width: 150 },
  { key: 'method', header: 'Method', width: 80, mono: true },
  { key: 'route', header: 'Route', mono: true },
  { key: 'scope', header: 'Scope', width: 160, mono: true, accessor: (c) => c.scope ?? '—' },
  {
    key: 'flags',
    header: 'Flags',
    width: 150,
    accessor: (c) => {
      const flags = [c.mutating && 'mut', c.destructive && 'destr', c.realtime && 'rt'].filter(Boolean).join(' · ');
      return flags || '—';
    },
  },
  {
    key: 'uiStatus',
    header: 'UI',
    width: 120,
    render: (c) => (
      <PillBadge size="sm" variant={c.uiStatus === 'none' ? 'muted' : 'default'}>
        {c.uiStatus}
      </PillBadge>
    ),
  },
];

export function CapabilitiesPage() {
  const [query, setQuery] = useState('');
  const totals = capabilityInventory.totals;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return capabilityInventory.capabilities;
    return capabilityInventory.capabilities.filter(
      (c) =>
        c.route.toLowerCase().includes(q) ||
        c.resource.toLowerCase().includes(q) ||
        (c.scope ?? '').toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <PageShell
      eyebrow="Configuration"
      title="Capabilities"
      description="Coverage of the Omni backend surface tracked by this UI."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        <SectionCard padding="md">
          <MetricDisplay value={totals.total} label="Capabilities" />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={totals.inSpec} label="In-spec" description={`${totals.offSpec} off-spec`} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={totals.destructive} label="Destructive" accentColor={T.danger} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={totals.darkFamilyCount}
            label="Dark families"
            description={totals.darkFamilies.join(', ')}
          />
        </SectionCard>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(c) => c.key}
        emptyTitle="No matching capabilities"
        toolbar={
          <Input
            placeholder="Filter by route, resource, or scope…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      />
    </PageShell>
  );
}
