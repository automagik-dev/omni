'use client';

/**
 * Renders a Zod schema as an editable form. The schema semantics live in the
 * tested {@link introspect} module; this component is the renderer + controlled
 * state around it, covering string, number, boolean, enum, array, nested object,
 * and record fields, with declared defaults, inline validation errors, and a
 * read-only preview mode. Laid out KhalOS-native with `.k-fieldset` surfaces,
 * `.k-form-row` label/control rows, and `.k-helper` hints. This is the workhorse
 * behind every create/edit surface in later waves.
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
        <fieldset className="k-fieldset" style={fieldsetStyle(label)}>
          {label && <div className="k-fieldset-h">{label}</div>}
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
        </fieldset>
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

function FormLabel({ label, node }: { label?: string; node: FieldNode }) {
  if (!label) return null;
  const required = !node.optional && node.defaultValue === undefined;
  return (
    <div className="k-form-label">
      {label}
      {required && <span style={{ color: T.accent }}> *</span>}
      {node.description && <span className="k-form-hint">{node.description}</span>}
    </div>
  );
}

function ScalarField({ node, value, path, update, errors, readOnly, label }: RendererProps) {
  const err = errors[pathKey(path)];
  const isText = node.kind !== 'boolean' && node.kind !== 'enum';

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
        style={{ width: '100%' }}
      />
    );
  })();

  return (
    <div className="k-form-row">
      <FormLabel label={label} node={node} />
      <div
        className="k-form-control"
        style={{ flexDirection: 'column', alignItems: isText ? 'stretch' : 'flex-end', gap: 4 }}
      >
        {control}
        {err && <div className="k-helper k-helper-error">{err}</div>}
      </div>
    </div>
  );
}

function ArrayField({ node, value, path, update, errors, readOnly, label }: RendererProps) {
  const items = Array.isArray(value) ? value : [];
  const element = node.element as FieldNode;
  return (
    <fieldset className="k-fieldset" style={fieldsetStyle(label)}>
      {label && <div className="k-fieldset-h">{label}</div>}
      <div style={blockBody}>
        {items.length === 0 && <span className="k-helper">No items.</span>}
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
      </div>
    </fieldset>
  );
}

function RecordField({ node, value, path, update, errors, readOnly, label }: RendererProps) {
  const entries = value && typeof value === 'object' ? Object.entries(value as Record<string, unknown>) : [];
  const valueType = node.valueType as FieldNode;
  const [newKey, setNewKey] = useState('');
  return (
    <fieldset className="k-fieldset" style={fieldsetStyle(label)}>
      {label && <div className="k-fieldset-h">{label}</div>}
      <div style={blockBody}>
        {entries.length === 0 && <span className="k-helper">No entries.</span>}
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
      </div>
    </fieldset>
  );
}

// Reset the browser fieldset default margins so `.k-fieldset` styling wins
// cleanly; nested groups (those with a head label) get a little top separation.
function fieldsetStyle(label?: string): CSSProperties {
  return { margin: label ? '10px 0 0' : 0, minWidth: 0 };
}
const blockBody: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 16px 12px' };

const selectStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.cell,
  color: T.fg,
  fontSize: 13,
  fontFamily: T.mono,
};
