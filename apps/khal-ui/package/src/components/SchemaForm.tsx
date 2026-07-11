'use client';

/**
 * Renders a Zod schema as an editable form. The schema semantics live in the
 * tested {@link introspect} module; this component is the renderer + controlled
 * state around it, covering string, number, boolean, enum, array, nested object,
 * and record fields, with declared defaults, inline validation errors, and a
 * read-only preview mode. This is the workhorse behind every create/edit surface
 * in later waves.
 */
import { Button, Input, Toggle } from '@khal-os/ui';
import type { CSSProperties, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { z } from 'zod';
import { type FieldNode, initialValue, introspect, validate } from './schema-form/introspect';
import { T } from './tokens';

export interface SchemaFormProps<T> {
  schema: z.ZodType<T>;
  /** Initial values (merged over schema-derived defaults). */
  value?: Partial<T>;
  onSubmit?: (data: T) => void;
  onChange?: (values: unknown) => void;
  submitLabel?: string;
  /** Read-only rendering — fields disabled, no submit. */
  preview?: boolean;
  disabled?: boolean;
}

type Path = (string | number)[];

function getByPath(root: unknown, path: Path): unknown {
  return path.reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), root);
}

function setByPath(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const arr = [...(root as unknown[])];
    const i = head as number;
    arr[i] = setByPath(arr[i], rest, value);
    return arr;
  }
  const obj = { ...(root as Record<string, unknown>) };
  const k = head as string;
  obj[k] = setByPath(obj[k], rest, value);
  return obj;
}

export function SchemaForm<T>({
  schema,
  value,
  onSubmit,
  onChange,
  submitLabel = 'Save',
  preview = false,
  disabled = false,
}: SchemaFormProps<T>) {
  const tree = useMemo(() => introspect(schema as z.ZodTypeAny), [schema]);
  const [values, setValues] = useState<unknown>(() => {
    const base = initialValue(tree);
    return value ? { ...(base as object), ...(value as object) } : base;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const readOnly = preview || disabled;

  const update = (path: Path, next: unknown) => {
    setValues((prev: unknown) => {
      const updated = setByPath(prev, path, next);
      onChange?.(updated);
      return updated;
    });
  };

  const handleSubmit = () => {
    const result = validate(schema, tree, values);
    if (result.success) {
      setErrors({});
      onSubmit?.(result.data as T);
    } else {
      setErrors(result.errors);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}
    >
      <FieldRenderer node={tree} value={values} path={[]} update={update} errors={errors} readOnly={readOnly} />
      {!preview && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Button typeName="submit" variant="default" disabled={disabled}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

interface RendererProps {
  node: FieldNode;
  value: unknown;
  path: Path;
  update: (path: Path, value: unknown) => void;
  errors: Record<string, string>;
  readOnly: boolean;
  label?: string;
}

function pathKey(path: Path): string {
  return path.join('.') || '(root)';
}

function FieldRenderer({ node, value, path, update, errors, readOnly, label }: RendererProps): ReactNode {
  switch (node.kind) {
    case 'object':
      return (
        <FieldGroup label={label} description={node.description} nested={path.length > 0}>
          {(node.fields ?? []).map(({ key, node: child }) => (
            <FieldRenderer
              key={key}
              node={child}
              value={getByPath(value, [key])}
              path={[...path, key]}
              update={update}
              errors={errors}
              readOnly={readOnly}
              label={key}
            />
          ))}
        </FieldGroup>
      );
    case 'array':
      return (
        <ArrayField
          node={node}
          value={value}
          path={path}
          update={update}
          errors={errors}
          readOnly={readOnly}
          label={label}
        />
      );
    case 'record':
      return (
        <RecordField
          node={node}
          value={value}
          path={path}
          update={update}
          errors={errors}
          readOnly={readOnly}
          label={label}
        />
      );
    default:
      return (
        <ScalarField
          node={node}
          value={value}
          path={path}
          update={update}
          errors={errors}
          readOnly={readOnly}
          label={label}
        />
      );
  }
}

function FieldLabel({ label, node }: { label?: string; node: FieldNode }) {
  if (!label) return null;
  // Caption span (not <label>): the control is a sibling rendered by the field,
  // not a nested child, so a <label> here would have no associated control.
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: T.fg, display: 'flex', gap: 6, alignItems: 'baseline' }}>
      {label}
      {!node.optional && node.defaultValue === undefined && <span style={{ color: T.danger }}>*</span>}
      {node.description && <span style={{ fontWeight: 400, color: T.muted }}>— {node.description}</span>}
    </span>
  );
}

function ScalarField({ node, value, path, update, errors, readOnly, label }: RendererProps) {
  const err = errors[pathKey(path)];
  const control = (() => {
    if (node.kind === 'boolean') {
      return (
        <Toggle checked={Boolean(value)} disabled={readOnly} onChange={(checked: boolean) => update(path, checked)} />
      );
    }
    if (node.kind === 'enum') {
      return (
        <select
          value={String(value ?? '')}
          disabled={readOnly}
          onChange={(e) => update(path, e.target.value)}
          style={selectStyle}
        >
          {node.optional && <option value="">— none —</option>}
          {(node.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    return (
      <Input
        value={value === undefined || value === null ? '' : String(value)}
        type={node.kind === 'number' ? 'number' : 'text'}
        readOnly={readOnly}
        onChange={(e) => update(path, e.target.value)}
      />
    );
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <FieldLabel label={label} node={node} />
      {control}
      {err && <span style={{ fontSize: 11, color: T.danger }}>{err}</span>}
    </div>
  );
}

function ArrayField({ node, value, path, update, errors, readOnly, label }: RendererProps) {
  const items = Array.isArray(value) ? value : [];
  const element = node.element as FieldNode;
  return (
    <FieldGroup label={label} description={node.description} nested>
      {items.length === 0 && <span style={{ fontSize: 12, color: T.muted }}>No items.</span>}
      {items.map((item, index) => (
        <div key={`${pathKey(path)}.${index}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldRenderer
              node={element}
              value={item}
              path={[...path, index]}
              update={update}
              errors={errors}
              readOnly={readOnly}
            />
          </div>
          {!readOnly && (
            <Button
              typeName="button"
              size="small"
              variant="secondary"
              onClick={() =>
                update(
                  path,
                  items.filter((_, i) => i !== index),
                )
              }
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div>
          <Button
            typeName="button"
            size="small"
            variant="secondary"
            onClick={() => update(path, [...items, initialValue(element)])}
          >
            Add item
          </Button>
        </div>
      )}
    </FieldGroup>
  );
}

function RecordField({ node, value, path, update, errors, readOnly, label }: RendererProps) {
  const entries = value && typeof value === 'object' ? Object.entries(value as Record<string, unknown>) : [];
  const valueType = node.valueType as FieldNode;
  const [newKey, setNewKey] = useState('');
  return (
    <FieldGroup label={label} description={node.description} nested>
      {entries.length === 0 && <span style={{ fontSize: 12, color: T.muted }}>No entries.</span>}
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ minWidth: 120, fontFamily: T.mono, fontSize: 12, color: T.accentBlue, paddingTop: 8 }}>
            {k}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldRenderer
              node={valueType}
              value={v}
              path={[...path, k]}
              update={update}
              errors={errors}
              readOnly={readOnly}
            />
          </div>
          {!readOnly && (
            <Button
              typeName="button"
              size="small"
              variant="secondary"
              onClick={() => {
                const next = { ...(value as Record<string, unknown>) };
                delete next[k];
                update(path, next);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={newKey} placeholder="new key" onChange={(e) => setNewKey(e.target.value)} />
          <Button
            typeName="button"
            size="small"
            variant="secondary"
            disabled={!newKey}
            onClick={() => {
              update(path, { ...(value as Record<string, unknown>), [newKey]: initialValue(valueType) });
              setNewKey('');
            }}
          >
            Add
          </Button>
        </div>
      )}
    </FieldGroup>
  );
}

function FieldGroup({
  label,
  description,
  nested,
  children,
}: {
  label?: string;
  description?: string;
  nested?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset
      style={{
        border: nested ? `1px solid ${T.border}` : 'none',
        borderRadius: nested ? 8 : 0,
        padding: nested ? 12 : 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
      }}
    >
      {label && (
        <legend style={{ fontSize: 12, fontWeight: 700, color: T.fg, padding: nested ? '0 6px' : 0 }}>
          {label}
          {description && <span style={{ fontWeight: 400, color: T.muted }}> — {description}</span>}
        </legend>
      )}
      {children}
    </fieldset>
  );
}

const selectStyle: CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
};
