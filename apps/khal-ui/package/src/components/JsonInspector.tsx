'use client';

/**
 * Collapsible JSON tree, redacted by default. Values under credential-looking
 * keys ({@link redactDeep}) are masked so a payload can be shown or screenshotted
 * safely; a "raw" toggle reveals them for the current operator, and the copy
 * button always emits the *redacted* form so secrets never leave on the
 * clipboard by accident.
 */
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { REDACTION_MASK, isSensitiveKey, redactDeep, redactedJson } from './json-inspector/redact';
import { T } from './tokens';

export interface JsonInspectorProps {
  value: unknown;
  /** Collapse nested nodes below this depth by default (default 1). */
  collapseBelowDepth?: number;
  /** Start with raw (unredacted) values shown (default false). */
  defaultRaw?: boolean;
}

const KEY_COLOR = T.accentBlue;

function scalarColor(value: unknown): string {
  if (typeof value === 'string') return 'var(--ds-green-700, #16a34a)';
  if (typeof value === 'number') return 'var(--ds-amber-700, #d97706)';
  if (typeof value === 'boolean') return 'var(--ds-blue-700, #2563eb)';
  return T.muted;
}

function scalarText(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

interface NodeProps {
  nodeKey?: string;
  value: unknown;
  depth: number;
  collapseBelowDepth: number;
  /** True when an ancestor key was sensitive — its whole subtree is masked. */
  masked: boolean;
}

function JsonNode({ nodeKey, value, depth, collapseBelowDepth, masked }: NodeProps) {
  const isSensitive = masked || (nodeKey !== undefined && isSensitiveKey(nodeKey));
  const isObject = value !== null && typeof value === 'object' && !isSensitive;
  const [open, setOpen] = useState(depth < collapseBelowDepth);

  const keyLabel =
    nodeKey !== undefined ? (
      <span style={{ color: KEY_COLOR }}>
        {nodeKey}
        <span style={{ color: T.muted }}>: </span>
      </span>
    ) : null;

  if (!isObject) {
    const shown = isSensitive ? REDACTION_MASK : value;
    return (
      <div style={{ paddingLeft: depth * 14, fontFamily: T.mono, fontSize: 12, lineHeight: 1.7 }}>
        {keyLabel}
        <span style={{ color: isSensitive ? T.warn : scalarColor(shown) }}>
          {isSensitive ? REDACTION_MASK : scalarText(shown)}
        </span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const brace = Array.isArray(value) ? ['[', ']'] : ['{', '}'];

  return (
    <div style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.7 }}>
      <div style={{ paddingLeft: depth * 14, cursor: 'pointer', userSelect: 'none' }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            marginRight: 4,
            color: T.muted,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {open ? '▾' : '▸'}
        </button>
        {keyLabel}
        <span style={{ color: T.muted }}>
          {brace[0]}
          {!open && ` ${entries.length} ${entries.length === 1 ? 'item' : 'items'} ${brace[1]}`}
        </span>
      </div>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode
              key={k}
              nodeKey={k}
              value={v}
              depth={depth + 1}
              collapseBelowDepth={collapseBelowDepth}
              masked={isSensitive}
            />
          ))}
          <div style={{ paddingLeft: depth * 14, color: T.muted }}>{brace[1]}</div>
        </>
      )}
    </div>
  );
}

export function JsonInspector({ value, collapseBelowDepth = 1, defaultRaw = false }: JsonInspectorProps) {
  const [raw, setRaw] = useState(defaultRaw);
  const [copied, setCopied] = useState(false);
  // When raw, render the original; otherwise the pre-redacted copy (defense in depth).
  const display = useMemo(() => (raw ? value : redactDeep(value)), [raw, value]);

  const copyRedacted = async () => {
    try {
      await navigator.clipboard.writeText(redactedJson(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: T.radius,
        background: T.cell,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 12px',
          borderBottom: `1px solid ${T.border}`,
          background: T.chrome,
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontWeight: 650,
            color: T.tertiary,
          }}
        >
          JSON {raw ? '(raw)' : '(redacted)'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => setRaw((r) => !r)} style={miniButton}>
            {raw ? 'Redact' : 'Show raw'}
          </button>
          <button type="button" onClick={copyRedacted} style={miniButton}>
            {copied ? 'Copied' : 'Copy redacted'}
          </button>
        </div>
      </div>
      <div style={{ padding: 10, overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
        <JsonNode value={display} depth={0} collapseBelowDepth={collapseBelowDepth} masked={false} />
      </div>
    </div>
  );
}

const miniButton: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 6,
  border: `1px solid ${T.border}`,
  background: 'transparent',
  color: T.fg,
  cursor: 'pointer',
};
