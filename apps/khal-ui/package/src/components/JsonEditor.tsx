'use client';

/**
 * A controlled JSON textarea with live parse feedback. Used wherever a value is
 * genuinely free-form JSON that {@link SchemaForm} can't render as native
 * controls — A2A agent cards, automation actions/conditions (a discriminated
 * union), arbitrary metadata, and the agent-state debug payload.
 *
 * It surfaces the current parse state ({@link JsonEditorState}) to the parent so
 * a submit/validate button can be gated on `ok`, and never swallows errors: a
 * malformed document shows the parser's message inline instead of silently
 * dropping keystrokes.
 */
import { useEffect, useMemo, useState } from 'react';
import { T } from './tokens';

export interface JsonEditorState {
  /** The raw text currently in the editor. */
  text: string;
  /** True when the text parses as JSON (empty counts as `undefined`, still ok). */
  ok: boolean;
  /** The parsed value when `ok`, else undefined. */
  value: unknown;
  /** Parser message when not `ok`. */
  error: string | null;
}

export interface JsonEditorProps {
  label?: string;
  description?: string;
  /** Initial document (object/array/primitive) or a raw string. */
  value?: unknown;
  onChange?: (state: JsonEditorState) => void;
  rows?: number;
  disabled?: boolean;
  /** Placeholder shown when empty. */
  placeholder?: string;
}

function initialText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Parse `text` into a {@link JsonEditorState}. Empty text is valid (undefined). */
export function parseJsonEditor(text: string): JsonEditorState {
  const trimmed = text.trim();
  if (!trimmed) return { text, ok: true, value: undefined, error: null };
  try {
    return { text, ok: true, value: JSON.parse(trimmed), error: null };
  } catch (err) {
    return { text, ok: false, value: undefined, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

export function JsonEditor({ label, description, value, onChange, rows = 10, disabled, placeholder }: JsonEditorProps) {
  const initial = useMemo(() => initialText(value), [value]);
  const [text, setText] = useState(initial);
  // Re-seed when the source document identity changes (e.g. detail re-fetch).
  useEffect(() => setText(initial), [initial]);

  const state = parseJsonEditor(text);

  const update = (next: string) => {
    setText(next);
    onChange?.(parseJsonEditor(next));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {label && (
        <span style={{ fontSize: 12, fontWeight: 600, color: T.fg }}>
          {label}
          {description && <span style={{ fontWeight: 400, color: T.muted }}> — {description}</span>}
        </span>
      )}
      <textarea
        value={text}
        disabled={disabled}
        placeholder={placeholder ?? '{ }'}
        spellCheck={false}
        onChange={(e) => update(e.target.value)}
        rows={rows}
        style={{
          fontFamily: T.mono,
          fontSize: 12,
          lineHeight: 1.5,
          padding: '8px 10px',
          borderRadius: 8,
          border: `1px solid ${state.ok ? T.border : T.danger}`,
          background: T.sunken,
          color: T.fg,
          resize: 'vertical',
          minWidth: 0,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <span style={{ fontSize: 11, color: state.ok ? T.muted : T.danger, minHeight: 14 }}>
        {state.ok ? (state.value === undefined ? 'empty' : 'valid JSON') : `parse error: ${state.error}`}
      </span>
    </div>
  );
}
