'use client';

/**
 * Capabilities — a live view of the generated capability inventory (bundled
 * `capabilities.json`). Shows coverage totals and a filterable table of every
 * backend capability the UI tracks, so later groups can see at a glance what's
 * still dark. Data is static/bundled, so filtering is local.
 */
import { Input, MetricDisplay, PillBadge, SectionCard } from '@khal-os/ui';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Capability } from '../../capabilities';
import { capabilityInventory } from '../../capabilities';
import { evidenceSummary } from '../../capabilities/evidence';
import { DataTable } from '../../components/DataTable';
import type { ColumnDef } from '../../components/DataTable';
import { PageShell } from '../../components/PageShell';
import { SectionHead } from '../../components/ResourceDetail';
import { T } from '../../components/tokens';

/**
 * Maps each capability's resource family to the UI page that exposes it, so every
 * row in the inventory links to where an operator can actually drive it. Families
 * with no dedicated page (auth, internal, root wildcards) resolve to null.
 */
const RESOURCE_ROUTES: Record<string, string> = {
  access: '/access-rules',
  'agent-tasks': '/agents',
  auth: '/health',
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
  {
    key: 'note',
    header: 'Note',
    width: 240,
    render: (c) =>
      c.note ? (
        <span
          style={{
            display: 'inline-flex',
            gap: 6,
            alignItems: 'flex-start',
            padding: '4px 8px',
            borderRadius: 8,
            border: `1px solid ${T.warn}`,
            background: `color-mix(in oklch, ${T.warn} 12%, transparent)`,
            color: T.warn,
            fontSize: 11,
            lineHeight: 1.35,
          }}
        >
          <span aria-hidden>⚠</span>
          <span>{c.note}</span>
        </span>
      ) : (
        <span style={{ color: T.muted, fontSize: 12 }}>—</span>
      ),
  },
];

function fmtEvidenceTime(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 'never' : new Date(t).toLocaleString();
}

/**
 * Last-run evidence per capability family, sourced from the committed, key-free
 * `evidence-summary.json` that `bun run evidence` regenerates. Shows when each
 * validator last proved its slice against the live backend.
 */
function EvidencePanel() {
  const fams = evidenceSummary.families;
  const rows: Array<[string, typeof fams.instances]> = [
    ['instances', fams.instances],
    ['agents', fams.agents],
    ['coverage', fams.coverage],
    ['chat', fams.chat],
  ];
  return (
    <SectionCard padding="md">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionHead>Live evidence</SectionHead>
        <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>
          {evidenceSummary.generatedAt
            ? `last run ${fmtEvidenceTime(evidenceSummary.generatedAt)}`
            : 'not yet run — `bun run evidence`'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {rows.map(([name, fam]) => (
          <div
            key={name}
            style={{ padding: 10, borderRadius: 8, border: `1px solid ${T.border}`, background: T.sunken }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: fam.ok === true ? T.ok : fam.ok === false ? T.danger : T.muted,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: T.fg }}>{name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: T.muted }}>{fam.checks} checks</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: T.muted, fontFamily: T.mono }}>
              {fmtEvidenceTime(fam.ranAt)}
            </div>
            {fam.note && <div style={{ marginTop: 4, fontSize: 11, color: T.warn }}>{fam.note}</div>}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

const pillButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  cursor: 'pointer',
};

export function CapabilitiesPage() {
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<string | null>(null);
  const totals = capabilityInventory.totals;

  /** Distinct resource families with their counts, busiest first — filter chips. */
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of capabilityInventory.capabilities) counts.set(c.resource, (counts.get(c.resource) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return capabilityInventory.capabilities.filter((c) => {
      if (family && c.resource !== family) return false;
      if (!q) return true;
      return (
        c.route.toLowerCase().includes(q) ||
        c.resource.toLowerCase().includes(q) ||
        (c.scope ?? '').toLowerCase().includes(q)
      );
    });
  }, [query, family]);

  return (
    <PageShell
      eyebrow="Configuration"
      title="Capabilities"
      description="Coverage of the Omni backend surface tracked by this UI."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        <SectionCard padding="md">
          <MetricDisplay value={totals.total} label="Capabilities" description={`${totals.offSpec} off-spec`} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={totals.byUiStatus.none ?? 0}
            label="Dark"
            description="no UI yet"
            accentColor={T.danger}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={totals.byUiStatus.exposed ?? 0} label="Exposed" description="visible, read-only" />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={totals.byUiStatus.operable ?? 0}
            label="Operable"
            description="drivable"
            accentColor={T.accentBlue}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={totals.byUiStatus['live-verified'] ?? 0}
            label="Live-verified"
            description="proven vs backend"
            accentColor={T.ok}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={totals.byUiStatus['ux-complete'] ?? 0}
            label="UX-complete"
            description="khalos-native"
            accentColor={T.accent}
          />
        </SectionCard>
      </div>

      <EvidencePanel />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(c) => c.key}
        emptyTitle="No matching capabilities"
        toolbar={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Input
              placeholder="Filter by route, resource, or scope…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setFamily(null)} style={pillButtonStyle}>
                <PillBadge size="sm" variant={family === null ? 'accent' : 'muted'}>
                  all · {capabilityInventory.capabilities.length}
                </PillBadge>
              </button>
              {families.map(([fam, count]) => (
                <button key={fam} type="button" onClick={() => setFamily(fam)} style={pillButtonStyle}>
                  <PillBadge size="sm" variant={family === fam ? 'accent' : 'muted'}>
                    {fam} · {count}
                  </PillBadge>
                </button>
              ))}
            </div>
          </div>
        }
      />
    </PageShell>
  );
}
