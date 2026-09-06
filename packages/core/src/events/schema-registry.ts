/**
 * Event schema registry primitives (issue #959, RFC #925 G1).
 *
 * The registry stores JSON Schema artifacts per event_type (Zod-first: core
 * definitions export to JSON Schema via `zodToEventJsonSchema`; external
 * registrations arrive as JSON Schema and are stored as-is). Validation runs
 * on ONE engine — Ajv over the stored artifact — for both origins.
 *
 * These helpers are deliberately storage-agnostic: the API's
 * EventSchemaService owns the `event_schemas` table and calls into here, so
 * the gates (webhook ingress, automation emit_event) and the tests all share
 * the same engine and the same evolution rules.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Dead-letter reason for payloads refused by a validation gate. The DLQ row's
 * `error` column starts with this token so operators can filter on it.
 */
export const SCHEMA_VALIDATION_FAILED = 'schema_validation_failed';

/** A JSON Schema artifact as stored in `event_schemas.schema`. */
export type EventJsonSchema = Record<string, unknown>;

export interface EventSchemaValidation {
  valid: boolean;
  /** Human-readable `instancePath: message` lines; empty when valid. */
  errors: string[];
}

export interface SchemaCompatibility {
  compatible: boolean;
  /** One line per violated evolution rule; empty when compatible. */
  reasons: string[];
}

/**
 * One engine for every gate. `strict: false` because externally registered
 * schemas may carry annotation keywords Ajv's strict mode rejects;
 * `validateFormats: false` keeps the dependency surface at plain ajv (no
 * ajv-formats) — `format` keywords are annotations, not gates, for now.
 */
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

/**
 * Compiled-validator cache keyed on artifact object identity. Callers that
 * cache the schema row (the API service does) get compile-once behavior; a
 * fresh object per call merely recompiles.
 */
const compiled = new WeakMap<EventJsonSchema, ValidateFunction>();

/** True when `schema` is itself a well-formed JSON Schema Ajv can compile. */
export function isValidJsonSchema(schema: EventJsonSchema): { ok: boolean; error?: string } {
  try {
    // validateSchema catches structural problems; compiling catches the rest
    // (e.g. a bad regex in `pattern`). Compile results are cached below.
    if (!ajv.validateSchema(schema)) {
      return { ok: false, error: ajv.errorsText(ajv.errors ?? undefined) };
    }
    getValidator(schema);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function getValidator(schema: EventJsonSchema): ValidateFunction {
  let validator = compiled.get(schema);
  if (!validator) {
    validator = ajv.compile(schema);
    compiled.set(schema, validator);
  }
  return validator;
}

/**
 * Validate a payload against a registered JSON Schema artifact.
 *
 * A schema that fails to compile reports invalid with the compile error —
 * fail-closed for a REGISTERED type is the contract (an unregistered type
 * never reaches this function; the registry is opt-in per type).
 */
export function validateEventPayload(schema: EventJsonSchema, payload: unknown): EventSchemaValidation {
  let validator: ValidateFunction;
  try {
    validator = getValidator(schema);
  } catch (error) {
    return { valid: false, errors: [`schema failed to compile: ${error instanceof Error ? error.message : error}`] };
  }
  if (validator(payload)) {
    return { valid: true, errors: [] };
  }
  const errors = (validator.errors ?? []).map((e) => `${e.instancePath || '/'}: ${e.message ?? 'invalid'}`);
  return { valid: false, errors: errors.length > 0 ? errors : ['payload does not match schema'] };
}

/**
 * JSON-ish structural equality, key-order agnostic. Exposed because stored
 * jsonb artifacts come back with normalized key order — byte comparison would
 * call an unchanged schema "different" (and bump its version on re-register).
 */
export function jsonEquals(a: unknown, b: unknown): boolean {
  return deepEqual(a, b);
}

/** JSON-ish structural equality for property definitions (key order agnostic). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a !== 'object') return false;
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  if (keysA.length !== Object.keys(objB).length) return false;
  return keysA.every((key) => deepEqual(objA[key], objB[key]));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The evolution rule, enforced at register time (issue #959 §6): replacing an
 * event_type's schema is allowed only when every payload valid under the
 * previous schema stays valid — additive-optional. Anything else must ship as
 * a new versioned event_type (`custom.github.push.v2`), never as a silent
 * mutation.
 *
 * Checked, conservatively, on the top-level object contract:
 *   - declared `type` must not change;
 *   - a property declared before must keep a structurally identical
 *     definition (narrowing or reshaping it would invalidate old payloads);
 *   - no NEW required property (previously-required may become optional —
 *     that widens);
 *   - `additionalProperties` must not tighten to `false`.
 */
export function checkSchemaCompatibility(previous: EventJsonSchema, next: EventJsonSchema): SchemaCompatibility {
  const reasons: string[] = [];

  if (previous.type !== undefined && next.type !== undefined && !deepEqual(previous.type, next.type)) {
    reasons.push(`type changed from ${JSON.stringify(previous.type)} to ${JSON.stringify(next.type)}`);
  }

  const prevProps = asRecord(previous.properties);
  const nextProps = asRecord(next.properties);
  for (const [name, definition] of Object.entries(prevProps)) {
    if (!(name in nextProps)) {
      reasons.push(`property '${name}' was removed`);
    } else if (!deepEqual(definition, nextProps[name])) {
      reasons.push(`property '${name}' changed definition`);
    }
  }

  const prevRequired = new Set(asStringArray(previous.required));
  for (const name of asStringArray(next.required)) {
    if (!prevRequired.has(name)) {
      reasons.push(`property '${name}' became required`);
    }
  }

  const prevAdditional = previous.additionalProperties;
  if (next.additionalProperties === false && prevAdditional !== false) {
    reasons.push('additionalProperties tightened to false');
  }

  return { compatible: reasons.length === 0, reasons };
}

/**
 * Export a Zod definition as the stored/registered JSON Schema artifact —
 * the Zod-first path of the RFC decision. Core event contracts defined in Zod
 * are ALWAYS registered through this exporter, never hand-duplicated as JSON
 * Schema.
 *
 * `$refStrategy: 'none'` inlines everything: the stored artifact must be
 * self-contained (no `definitions` lookups at validation time).
 */
export function zodToEventJsonSchema(schema: z.ZodType<unknown>, name?: string): EventJsonSchema {
  const artifact = zodToJsonSchema(schema, { $refStrategy: 'none' }) as EventJsonSchema;
  if (name !== undefined) {
    artifact.title = name;
  }
  return artifact;
}
