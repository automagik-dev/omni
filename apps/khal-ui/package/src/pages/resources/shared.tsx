'use client';

/**
 * Small shared helpers for the horizontal-coverage pages (Group F). Kept
 * deliberately thin — the real work stays in the shared primitives; these just
 * remove the boilerplate every list/detail page repeats (instance picker, error
 * text, timestamp formatting, the production-instance read-only guard).
 */
import { DataRow, SectionCard } from '@khal-os/ui';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { InstanceRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { SectionHead } from '../../components/ResourceDetail';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';

/** The two live production instances — reads only, never mutated from the UI. */
export const PRODUCTION_INSTANCE_IDS = ['506377b1-eb79-4ae3-abc1-80bd00986f6b', '11c1a3e2-bb53-45df-aac8-0418f44ea5d5'];

export function isProductionInstance(id?: string | null): boolean {
  return Boolean(id && PRODUCTION_INSTANCE_IDS.includes(id));
}

/** Normalise a TanStack Query error into a display string (or null). */
export function errMsg(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

/** Compact absolute timestamp, tolerant of epoch-ms numbers and ISO strings. */
export function fmtTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export function useInstances() {
  const { ext } = useOmniClient();
  return useOmniQuery(['instances', 'list', 'coverage'], () => ext.instances.list(), { staleTime: 30_000 });
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
  minWidth: 220,
};

/** Instance selector used by the per-instance fan-in pages (contacts, groups). */
export function InstancePicker({
  value,
  onChange,
  includeAll,
  label = 'Instance',
}: {
  value: string;
  onChange: (id: string) => void;
  includeAll?: boolean;
  label?: string;
}) {
  const instances = useInstances();
  const items = instances.data?.items ?? [];
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {includeAll && <option value="">All instances</option>}
        {!value && !includeAll && <option value="">Select…</option>}
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} ({i.channel}){isProductionInstance(i.id) ? ' · prod' : ''}
          </option>
        ))}
      </select>
    </span>
  );
}

/** All instances, memoised as an id → row map, for cross-instance fan-in pages. */
export function useInstanceMap(): { instances: InstanceRow[]; byId: Map<string, InstanceRow>; loading: boolean } {
  const q = useInstances();
  const instances = useMemo(() => q.data?.items ?? [], [q.data]);
  const byId = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);
  return { instances, byId, loading: q.isLoading };
}

/**
 * Standalone titled content card — a SectionCard fronted by the mono, uppercase
 * KhalOS section eyebrow ({@link SectionHead}). The horizontal-coverage pages use
 * this for their editor / trigger / snapshot panels so every card head reads the
 * same as the detail-view sections, instead of an ad-hoc bold `<h3>`. It is the
 * resources-vertical analog of the instances slice's `Panel`, kept local so these
 * pages don't cross-import from the flagship instances components.
 */
export function CardSection({
  title,
  actions,
  description,
  children,
  padding = 'md',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}) {
  return (
    <SectionCard padding={padding}>
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: description ? 4 : 12,
          }}
        >
          {title ? <SectionHead>{title}</SectionHead> : <span />}
          {actions}
        </div>
      )}
      {description && <p style={{ margin: '0 0 12px', fontSize: 12.5, color: T.muted }}>{description}</p>}
      {children}
    </SectionCard>
  );
}

export interface DataRowSpec {
  label: string;
  /** String/number renders as DataRow's mono tabular value; any other node is
   *  rendered on the right as custom children (badges, links, dot rows). */
  value?: ReactNode;
  accentColor?: string;
  statusDot?: boolean;
  dotColor?: string;
  tag?: string;
  tagColor?: string;
}

/**
 * A stack of {@link DataRow}s — the mono key/value workhorse for config and field
 * lists. Reads more KhalOS-native than a plain definition grid: every value is
 * mono + tabular, rows carry hairline rules, and a value can gain a status dot or
 * an IF/THEN tag. Prefer this over {@link FieldGrid} for settings/config/trust
 * surfaces where the mono treatment fits.
 */
export function DataRowList({
  rows,
  variant = 'rule',
}: {
  rows: DataRowSpec[];
  variant?: 'default' | 'inline' | 'rule';
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => {
        const scalar = typeof r.value === 'string' || typeof r.value === 'number' ? String(r.value) : undefined;
        return (
          <DataRow
            key={r.label}
            variant={variant}
            label={r.label}
            value={scalar}
            accentColor={r.accentColor}
            statusDot={r.statusDot}
            dotColor={r.dotColor}
            tag={r.tag}
            tagColor={r.tagColor}
          >
            {scalar === undefined && r.value !== undefined ? r.value : null}
          </DataRow>
        );
      })}
    </div>
  );
}
