'use client';

/**
 * A compact definition-list for an entity's scalar fields. Every detail view in
 * the agents-automation vertical uses it to render "all the fields the schema
 * exposes" consistently — with sane formatting for booleans, timestamps, ids,
 * arrays, and null. Object/array values are summarised; render those through
 * {@link JsonInspector} separately when the full tree matters.
 */
import type { ReactNode } from 'react';
import { T } from './tokens';

export interface FieldSpec {
  label: string;
  /** Pre-rendered node wins; else `value` is formatted. */
  node?: ReactNode;
  value?: unknown;
  /** Render the value in monospace (ids, timestamps). */
  mono?: boolean;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') return `{ ${Object.keys(value as object).length} keys }`;
  return String(value);
}

export function FieldGrid({ fields }: { fields: FieldSpec[] }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, max-content) 1fr',
        gap: '6px 16px',
        margin: 0,
      }}
    >
      {fields.map((f) => (
        <div key={f.label} style={{ display: 'contents' }}>
          <dt style={{ fontSize: 12, color: T.muted }}>{f.label}</dt>
          <dd
            style={{
              margin: 0,
              fontSize: 13,
              color: T.fg,
              fontFamily: f.mono ? T.mono : undefined,
              wordBreak: 'break-word',
            }}
          >
            {f.node ?? formatValue(f.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
