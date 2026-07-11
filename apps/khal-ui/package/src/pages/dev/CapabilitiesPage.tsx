'use client';

/**
 * Capabilities — a live view of the generated capability inventory (bundled
 * `capabilities.json`). Shows coverage totals and a filterable table of every
 * backend capability the UI tracks, so later groups can see at a glance what's
 * still dark. Data is static/bundled, so filtering is local.
 */
import { Input, MetricDisplay, PillBadge, SectionCard } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Capability } from '../../capabilities';
import { capabilityInventory } from '../../capabilities';
import { DataTable } from '../../components/DataTable';
import type { ColumnDef } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';

/**
 * Maps each capability's resource family to the UI page that exposes it, so every
 * row in the inventory links to where an operator can actually drive it. Families
 * with no dedicated page (auth, internal, root wildcards) resolve to null.
 */
const RESOURCE_ROUTES: Record<string, string> = {
  access: '/access-rules',
  'agent-tasks': '/agents',
  agents: '/agents',
  'automation-logs': '/automations',
  'automation-metrics': '/automations',
  automations: '/automations',
  'batch-jobs': '/batch-jobs',
  chats: '/chat',
  context: '/context',
  conversations: '/conversations',
  'dead-letters': '/dead-letters',
  'event-ops': '/event-ops',
  events: '/events',
  'follow-up': '/agents',
  handoffs: '/handoffs',
  health: '/health',
  info: '/api-info',
  instances: '/instances',
  journeys: '/journeys',
  keys: '/api-keys',
  logs: '/logs',
  media: '/media-console',
  messages: '/chat',
  metrics: '/metrics',
  'payload-config': '/payload-config',
  'payload-stats': '/payload-config',
  persons: '/persons',
  providers: '/providers',
  routes: '/routing',
  settings: '/settings',
  trust: '/trust-hosts',
  turns: '/turns',
  voice: '/voice',
  'webhook-sources': '/webhook-sources',
  webhooks: '/webhook-sources',
  a2a: '/a2a',
  'agent-state': '/dev/agent-state',
};

const columns: ColumnDef<Capability>[] = [
  { key: 'resource', header: 'Resource', width: 150 },
  { key: 'method', header: 'Method', width: 80, mono: true },
  { key: 'route', header: 'Route', mono: true },
  { key: 'scope', header: 'Scope', width: 140, mono: true, accessor: (c) => c.scope ?? '—' },
  {
    key: 'flags',
    header: 'Flags',
    width: 130,
    accessor: (c) => {
      const flags = [c.mutating && 'mut', c.destructive && 'destr', c.realtime && 'rt'].filter(Boolean).join(' · ');
      return flags || '—';
    },
  },
  {
    key: 'uiStatus',
    header: 'UI',
    width: 110,
    render: (c) => (
      <PillBadge size="sm" variant={c.uiStatus === 'none' ? 'muted' : 'default'}>
        {c.uiStatus}
      </PillBadge>
    ),
  },
  {
    key: 'page',
    header: 'Page',
    width: 130,
    render: (c) => {
      const route = RESOURCE_ROUTES[c.resource];
      return route ? (
        <Link to={route} style={{ color: T.accentBlue, fontSize: 12, fontFamily: T.mono, textDecoration: 'none' }}>
          {route} →
        </Link>
      ) : (
        <span style={{ color: T.muted, fontSize: 12 }}>—</span>
      );
    },
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
          <MetricDisplay
            value={totals.total - (totals.byUiStatus.none ?? 0)}
            label="Exposed+"
            description={`${totals.byUiStatus.none ?? 0} still dark`}
            accentColor={T.ok}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={
              (totals.byUiStatus.operable ?? 0) +
              (totals.byUiStatus['live-verified'] ?? 0) +
              (totals.byUiStatus['ux-complete'] ?? 0)
            }
            label="Operable+"
            description={`${totals.byUiStatus['live-verified'] ?? 0} live-verified`}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={totals.destructive} label="Destructive" accentColor={T.danger} />
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
