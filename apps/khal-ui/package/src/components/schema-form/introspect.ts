/**
 * Zod-schema introspection for {@link SchemaForm}.
 *
 * Turns an arbitrary Zod schema into a render-friendly field tree, derives
 * initial form values, coerces raw string inputs back to typed values, and
 * flattens validation errors to a `path → message` map. Kept pure and
 * DOM-free — the form is a thin renderer over these functions, and all the
 * tricky schema semantics live here where they can be unit-tested.
 *
 * Supports: string, number, boolean, enum (Zod enum / native enum / literal /
 * union-of-literals), array, nested object, and record — through optional,
 * nullable, default, and effect (refine/transform) wrappers.
 */
import type { z } from 'zod';

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'record' | 'unknown';

export interface FieldNode {
  kind: FieldKind;
  optional: boolean;
  nullable: boolean;
  /** Present when the schema declared a default. */
  defaultValue?: unknown;
  description?: string;
  /** enum: allowed string options. */
  options?: string[];
  /** array: the element field. */
  element?: FieldNode;
  /** object: ordered child fields. */
  fields?: FieldEntry[];
  /** record: the value field (keys are freeform strings). */
  valueType?: FieldNode;
}

export interface FieldEntry {
  key: string;
  node: FieldNode;
}

// Zod stores its first-party kind on `_def.typeName`; these are its enum values.
interface ZodDefLike {
  typeName?: string;
  innerType?: unknown;
  schema?: unknown;
  type?: unknown;
  valueType?: unknown;
  defaultValue?: () => unknown;
  description?: string;
  values?: unknown;
  value?: unknown;
  shape?: () => Record<string, unknown>;
  options?: unknown;
}

function def(schema: unknown): ZodDefLike {
  return ((schema as { _def?: ZodDefLike })?._def ?? {}) as ZodDefLike;
}

interface Unwrapped {
  inner: unknown;
  optional: boolean;
  nullable: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  description?: string;
}

function unwrap(schema: unknown): Unwrapped {
  let current = schema;
  let optional = false;
  let nullable = false;
  let hasDefault = false;
  let defaultValue: unknown;
  let description = def(current).description;

  for (;;) {
    const d = def(current);
    if (d.typeName === 'ZodOptional') {
      optional = true;
      current = d.innerType;
    } else if (d.typeName === 'ZodNullable') {
      nullable = true;
      current = d.innerType;
    } else if (d.typeName === 'ZodDefault') {
      hasDefault = true;
      defaultValue = d.defaultValue?.();
      current = d.innerType;
    } else if (d.typeName === 'ZodEffects') {
      current = d.schema;
    } else if (d.typeName === 'ZodBranded') {
      current = d.type;
    } else {
      break;
    }
    description = description ?? def(current).description;
  }

  return { inner: current, optional, nullable, hasDefault, defaultValue, description };
}

function enumOptionsFromUnion(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null;
  const values: string[] = [];
  for (const opt of options) {
    const d = def(opt);
    if (d.typeName === 'ZodLiteral' && (typeof d.value === 'string' || typeof d.value === 'number')) {
      values.push(String(d.value));
    } else {
      return null;
    }
  }
  return values;
}

/** Introspect a Zod schema into a render-friendly {@link FieldNode}. */
export function introspect(schema: z.ZodTypeAny): FieldNode {
  const { inner, optional, nullable, hasDefault, defaultValue, description } = unwrap(schema);
  const base = { optional, nullable, description, ...(hasDefault ? { defaultValue } : {}) };
  const d = def(inner);

  switch (d.typeName) {
    case 'ZodString':
      return { kind: 'string', ...base };
    case 'ZodNumber':
      return { kind: 'number', ...base };
    case 'ZodBoolean':
      return { kind: 'boolean', ...base };
    case 'ZodEnum':
      return { kind: 'enum', options: (d.values as string[]) ?? [], ...base };
    case 'ZodNativeEnum':
      return {
        kind: 'enum',
        options: Object.values(d.values as Record<string, unknown>).filter((v): v is string => typeof v === 'string'),
        ...base,
      };
    case 'ZodLiteral':
      return { kind: 'enum', options: [String(d.value)], ...base };
    case 'ZodUnion': {
      const opts = enumOptionsFromUnion(d.options);
      return opts ? { kind: 'enum', options: opts, ...base } : { kind: 'unknown', ...base };
    }
    case 'ZodArray':
      return { kind: 'array', element: introspect(d.type as z.ZodTypeAny), ...base };
    case 'ZodObject': {
      const shape = d.shape?.() ?? {};
      const fields: FieldEntry[] = Object.entries(shape).map(([key, child]) => ({
        key,
        node: introspect(child as z.ZodTypeAny),
      }));
      return { kind: 'object', fields, ...base };
    }
    case 'ZodRecord':
      return { kind: 'record', valueType: introspect(d.valueType as z.ZodTypeAny), ...base };
    default:
      return { kind: 'unknown', ...base };
  }
}

/** Initial, fully-defined form value for a field (defaults win; else empty-by-kind). */
export function initialValue(node: FieldNode): unknown {
  if (node.defaultValue !== undefined) return structuredCloneSafe(node.defaultValue);
  switch (node.kind) {
    case 'string':
      return '';
    case 'number':
      return '';
    case 'boolean':
      return false;
    case 'enum':
      return node.optional ? '' : (node.options?.[0] ?? '');
    case 'array':
      return [];
    case 'record':
      return {};
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const { key, node: child } of node.fields ?? []) out[key] = initialValue(child);
      return out;
    }
    default:
      return null;
  }
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Coerce raw form values (strings from inputs) back to the types the schema
 * expects, guided by the field tree, before validation. Empty optional values
 * become `undefined` so optional schemas pass.
 */
export function coerce(node: FieldNode, value: unknown): unknown {
  switch (node.kind) {
    case 'number': {
      if (value === '' || value === null || value === undefined) return node.optional ? undefined : value;
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true';
    case 'string':
    case 'enum':
      if ((value === '' || value === undefined) && node.optional) return undefined;
      return value;
    case 'array':
      return Array.isArray(value) && node.element
        ? value.map((item) => coerce(node.element as FieldNode, item))
        : value;
    case 'object': {
      if (value === null || typeof value !== 'object') return value;
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const { key, node: child } of node.fields ?? []) out[key] = coerce(child, src[key]);
      return out;
    }
    case 'record': {
      if (value === null || typeof value !== 'object' || !node.valueType) return value;
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) out[k] = coerce(node.valueType, v);
      return out;
    }
    default:
      return value;
  }
}

export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  /** Dotted-path → first error message. */
  errors: Record<string, string>;
}

/** Coerce then `safeParse`, returning typed data or a path→message error map. */
export function validate<T>(schema: z.ZodType<T>, rootNode: FieldNode, rawValues: unknown): ValidationResult<T> {
  const coerced = coerce(rootNode, rawValues);
  const result = schema.safeParse(coerced);
  if (result.success) return { success: true, data: result.data, errors: {} };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '(root)';
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { success: false, errors };
}
