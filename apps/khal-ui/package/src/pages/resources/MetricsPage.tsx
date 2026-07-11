'use client';

/**
 * Metrics — the Prometheus exposition text (GET /metrics) parsed into grouped
 * metric families with their samples. A filter narrows the families; consumer
 * lag surfaces as any family whose name mentions `lag`/`consumer`.
 */
import { Button, Input, Note, PillBadge, SectionCard } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg } from './shared';

interface Sample {
  labels: string;
  value: string;
}
interface MetricFamily {
  name: string;
  help?: string;
  type?: string;
  samples: Sample[];
}

/** Minimal Prometheus text-exposition parser (0.0.4). */
function parsePrometheus(text: string): MetricFamily[] {
  const families = new Map<string, MetricFamily>();
  const familyOf = (name: string): MetricFamily => {
    let f = families.get(name);
    if (!f) {
      f = { name, samples: [] };
      families.set(name, f);
    }
    return f;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('# HELP ')) {
      const rest = line.slice(7);
      const sp = rest.indexOf(' ');
      familyOf(sp === -1 ? rest : rest.slice(0, sp)).help = sp === -1 ? '' : rest.slice(sp + 1);
      continue;
    }
    if (line.startsWith('# TYPE ')) {
      const rest = line.slice(7);
      const sp = rest.indexOf(' ');
      familyOf(sp === -1 ? rest : rest.slice(0, sp)).type = sp === -1 ? '' : rest.slice(sp + 1);
      continue;
    }
    if (line.startsWith('#')) continue;
    const braceIdx = line.indexOf('{');
    let name: string;
    let labels = '';
    let valuePart: string;
    if (braceIdx !== -1) {
      const closeIdx = line.indexOf('}');
      name = line.slice(0, braceIdx);
      labels = line.slice(braceIdx, closeIdx + 1);
      valuePart = line.slice(closeIdx + 1).trim();
    } else {
      const sp = line.indexOf(' ');
      name = sp === -1 ? line : line.slice(0, sp);
      valuePart = sp === -1 ? '' : line.slice(sp + 1).trim();
    }
    // Collapse histogram/summary suffixes into their base family for grouping.
    const base = name.replace(/(_bucket|_sum|_count)$/, '');
    familyOf(base).samples.push({
      labels: labels || (name !== base ? name : ''),
      value: valuePart.split(' ')[0] ?? '',
    });
  }
  return [...families.values()].filter((f) => f.samples.length > 0).sort((a, b) => a.name.localeCompare(b.name));
}

function FamilyCard({ family }: { family: MetricFamily }) {
  const columns: ColumnDef<Sample>[] = [
    { key: 'labels', header: 'Labels', mono: true, accessor: (s) => s.labels || '(none)' },
    { key: 'value', header: 'Value', width: 160, mono: true, align: 'right' },
  ];
  return (
    <SectionCard padding="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg, fontFamily: T.mono }}>{family.name}</h3>
        {family.type && <PillBadge size="sm">{family.type}</PillBadge>}
      </div>
      {family.help && <p style={{ margin: '0 0 8px', fontSize: 12, color: T.muted }}>{family.help}</p>}
      <DataTable
        columns={columns}
        rows={family.samples}
        getRowKey={(s) => `${s.labels}=${s.value}`}
        emptyTitle="No samples"
      />
    </SectionCard>
  );
}

export function MetricsPage() {
  const { ext } = useOmniClient();
  const [filter, setFilter] = useState('');

  const metrics = useOmniQuery(['metrics', 'prometheus'], () => ext.metrics.text(), { refetchInterval: 30_000 });
  const families = useMemo(() => parsePrometheus(metrics.data ?? ''), [metrics.data]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? families.filter((f) => f.name.toLowerCase().includes(q) || (f.help ?? '').toLowerCase().includes(q))
    : families;
  const lag = families.filter((f) => /lag|consumer/i.test(f.name));

  return (
    <PageShell
      eyebrow="Operations"
      title="Metrics"
      description="Prometheus exposition parsed into grouped families."
      actions={
        <Button size="small" variant="secondary" onClick={() => void metrics.refetch()}>
          Refresh
        </Button>
      }
    >
      {metrics.error ? (
        <Note type="error" label="Error">
          {errMsg(metrics.error)}
        </Note>
      ) : (
        <>
          <SectionCard padding="md">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input placeholder="Filter metric families…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <span style={{ fontSize: 12, color: T.muted }}>
                {families.length} families · {lag.length} consumer/lag
              </span>
            </div>
          </SectionCard>
          {metrics.isLoading && <span style={{ fontSize: 12, color: T.muted }}>Loading metrics…</span>}
          {shown.length === 0 && !metrics.isLoading && <Note type="default">No matching metric families.</Note>}
          {shown.map((f) => (
            <FamilyCard key={f.name} family={f} />
          ))}
        </>
      )}
    </PageShell>
  );
}
