'use client';

/**
 * Small shared helpers for the horizontal-coverage pages (Group F). Kept
 * deliberately thin — the real work stays in the shared primitives; these just
 * remove the boilerplate every list/detail page repeats (instance picker, error
 * text, timestamp formatting, the production-instance read-only guard).
 */
import { useMemo } from 'react';
import type { InstanceRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
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
