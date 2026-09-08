/**
 * Event schema registry primitives (issue #959, RFC #925 G1).
 *
 * One engine for both artifact origins: externally registered JSON Schema and
 * Zod-exported core contracts validate through the same Ajv path, and the
 * additive-optional evolution rule is what register time enforces.
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  SCHEMA_VALIDATION_FAILED,
  checkSchemaCompatibility,
  isValidJsonSchema,
  jsonEquals,
  validateEventPayload,
  zodToEventJsonSchema,
} from '../schema-registry';

const PUSH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ref: { type: 'string' },
    commits: { type: 'array', items: { type: 'object' } },
    forced: { type: 'boolean' },
  },
  required: ['ref', 'commits'],
};

describe('validateEventPayload', () => {
  test('accepts a conforming payload', () => {
    const verdict = validateEventPayload(PUSH_SCHEMA, { ref: 'refs/heads/main', commits: [], forced: false });
    expect(verdict.valid).toBe(true);
    expect(verdict.errors).toEqual([]);
  });

  test('rejects a payload missing a required field, with a readable error', () => {
    const verdict = validateEventPayload(PUSH_SCHEMA, { ref: 'refs/heads/main' });
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.length).toBeGreaterThan(0);
    expect(verdict.errors[0]).toContain('commits');
  });

  test('rejects a payload with a wrong-typed field, pointing at the path', () => {
    const verdict = validateEventPayload(PUSH_SCHEMA, { ref: 42, commits: [] });
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.startsWith('/ref'))).toBe(true);
  });

  test('an uncompilable schema fails closed for its (registered) type', () => {
    const verdict = validateEventPayload({ type: 'object', properties: { a: { pattern: '[' } } }, { a: 'x' });
    expect(verdict.valid).toBe(false);
    expect(verdict.errors[0]).toContain('schema failed to compile');
  });
});

describe('isValidJsonSchema', () => {
  test('accepts a normal draft-07 object schema', () => {
    expect(isValidJsonSchema(PUSH_SCHEMA).ok).toBe(true);
  });

  test('rejects a structurally broken schema', () => {
    const verdict = isValidJsonSchema({ type: 123 });
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toBeTruthy();
  });

  test('rejects a schema that validates structurally but cannot compile', () => {
    expect(isValidJsonSchema({ type: 'string', pattern: '[' }).ok).toBe(false);
  });
});

describe('checkSchemaCompatibility (additive-optional evolution rule)', () => {
  test('adding an optional property is compatible', () => {
    const next = {
      ...PUSH_SCHEMA,
      properties: { ...(PUSH_SCHEMA.properties as object), pusher: { type: 'string' } },
    };
    expect(checkSchemaCompatibility(PUSH_SCHEMA, next)).toEqual({ compatible: true, reasons: [] });
  });

  test('making a previously-required property optional widens and is compatible', () => {
    const next = { ...PUSH_SCHEMA, required: ['ref'] };
    expect(checkSchemaCompatibility(PUSH_SCHEMA, next).compatible).toBe(true);
  });

  test('a new required property is refused', () => {
    const next = {
      ...PUSH_SCHEMA,
      properties: { ...(PUSH_SCHEMA.properties as object), pusher: { type: 'string' } },
      required: ['ref', 'commits', 'pusher'],
    };
    const verdict = checkSchemaCompatibility(PUSH_SCHEMA, next);
    expect(verdict.compatible).toBe(false);
    expect(verdict.reasons[0]).toContain("'pusher' became required");
  });

  test('removing a property is refused', () => {
    const next = { ...PUSH_SCHEMA, properties: { ref: { type: 'string' } }, required: ['ref'] };
    const verdict = checkSchemaCompatibility(PUSH_SCHEMA, next);
    expect(verdict.compatible).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('removed'))).toBe(true);
  });

  test('reshaping an existing property definition is refused', () => {
    const next = {
      ...PUSH_SCHEMA,
      properties: { ...(PUSH_SCHEMA.properties as object), ref: { type: 'number' } },
    };
    const verdict = checkSchemaCompatibility(PUSH_SCHEMA, next);
    expect(verdict.compatible).toBe(false);
    expect(verdict.reasons.some((r) => r.includes("'ref' changed definition"))).toBe(true);
  });

  test('changing the top-level type is refused', () => {
    const verdict = checkSchemaCompatibility(PUSH_SCHEMA, { type: 'array' });
    expect(verdict.compatible).toBe(false);
  });

  test('tightening additionalProperties to false is refused', () => {
    const verdict = checkSchemaCompatibility(PUSH_SCHEMA, { ...PUSH_SCHEMA, additionalProperties: false });
    expect(verdict.compatible).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('additionalProperties'))).toBe(true);
  });
});

describe('zodToEventJsonSchema (Zod-first export path)', () => {
  const ZodContract = z.object({
    ref: z.string(),
    commits: z.array(z.object({ id: z.string() })),
    forced: z.boolean().optional(),
  });

  test('the exported artifact validates through the same engine as external JSON Schema', () => {
    const artifact = zodToEventJsonSchema(ZodContract, 'custom.github.push');
    expect(artifact.title).toBe('custom.github.push');
    expect(isValidJsonSchema(artifact).ok).toBe(true);

    expect(validateEventPayload(artifact, { ref: 'refs/heads/main', commits: [{ id: 'abc' }] }).valid).toBe(true);
    const refused = validateEventPayload(artifact, { ref: 'refs/heads/main' });
    expect(refused.valid).toBe(false);
  });

  test('the artifact is self-contained (no $ref indirection to resolve at validation time)', () => {
    const artifact = zodToEventJsonSchema(ZodContract);
    expect(JSON.stringify(artifact)).not.toContain('"$ref"');
  });
});

describe('jsonEquals', () => {
  test('is key-order agnostic — safe against jsonb key normalization', () => {
    expect(jsonEquals({ a: 1, b: { c: 2, d: [1, 2] } }, { b: { d: [1, 2], c: 2 }, a: 1 })).toBe(true);
  });

  test('detects real structural differences', () => {
    expect(jsonEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEquals({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(jsonEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('SCHEMA_VALIDATION_FAILED', () => {
  test('is the stable dead-letter reason token', () => {
    expect(SCHEMA_VALIDATION_FAILED).toBe('schema_validation_failed');
  });
});
