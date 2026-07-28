/**
 * The documented shape of the credential-class exposure
 * (wish: omni-full-multitenancy, Group G4; WISH "Compatibility").
 *
 * The WISH requires the exposure to be visible in the OpenAPI document, not
 * only in the response. Two separate things are asserted, because they fail
 * separately:
 *
 *   * The RESPONSE SCHEMA documents the `credential` object, so a generated
 *     client gets the fields typed instead of losing them at the boundary.
 *   * A vendor extension, `x-omni-credential-exposure`, publishes the exact
 *     list of field names the route may return. That list is the machine-
 *     checkable contract: this suite compares it against the schema and against
 *     a "never key material" predicate, so a future field that leaks a hash
 *     cannot be added quietly on either side.
 *
 * The extension is deliberately a LIST OF NAMES rather than prose. Prose in a
 * description is not a thing a test can hold, and this exposure is exactly the
 * surface where "we documented that we don't leak secrets" is worth less than
 * an assertion that we don't.
 */

import { describe, expect, test } from 'bun:test';
import { openApiSpec } from '../routes/openapi';

type Operation = Record<string, unknown> & {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

function validateOperation(): Operation {
  const path = (openApiSpec.paths as Record<string, Record<string, Operation>> | undefined)?.['/auth/validate'];
  if (!path?.post) throw new Error('POST /auth/validate is missing from the OpenAPI document');
  return path.post;
}

/** Resolve the `data` object schema of the 200 response, following the $ref. */
function successDataSchema(): Record<string, unknown> {
  const raw = validateOperation().responses?.['200']?.content?.['application/json']?.schema as
    | Record<string, unknown>
    | undefined;
  if (!raw) throw new Error('no 200 application/json schema');

  const resolved = (() => {
    const ref = raw.$ref as string | undefined;
    if (!ref) return raw;
    const name = ref.split('/').pop() as string;
    const schemas = (openApiSpec.components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
    return schemas[name] ?? {};
  })();

  const properties = resolved.properties as Record<string, Record<string, unknown>> | undefined;
  const data = properties?.data;
  if (!data) throw new Error('the 200 schema has no `data` object');
  return data;
}

/** The `credential` sub-schema, or a hard failure — never a silent undefined. */
function credentialSchema(): Record<string, unknown> {
  const properties = successDataSchema().properties as Record<string, Record<string, unknown>> | undefined;
  const credential = properties?.credential;
  if (!credential) throw new Error('the validate response schema has no `credential` object');
  return credential;
}

const EXPECTED_FIELDS = [
  'class',
  'tenantId',
  'tenantSlug',
  'role',
  'scopes',
  'constraints',
  'expiresAt',
  'delegationDepth',
];

describe('OpenAPI documents the credential-class exposure', () => {
  test('the validate response schema carries a `credential` object', () => {
    expect(credentialSchema()).toBeDefined();
  });

  test('the documented credential fields are exactly the ones the route returns', () => {
    const fields = Object.keys((credentialSchema().properties ?? {}) as Record<string, unknown>);
    expect(fields.sort()).toEqual([...EXPECTED_FIELDS].sort());
  });

  test('the credential block is OPTIONAL, because a legacy caller has none', () => {
    // If it were required, a generated client would treat the legacy world as a
    // contract violation — the dual-world invariant expressed in the document.
    const data = successDataSchema();
    expect((data.required as string[] | undefined) ?? []).not.toContain('credential');
  });
});

describe('the x-omni-credential-exposure extension is a checkable contract', () => {
  test('the operation publishes the exposed field list', () => {
    expect(validateOperation()['x-omni-credential-exposure']).toEqual(EXPECTED_FIELDS);
  });

  test('the published list matches the response schema exactly', () => {
    // Two independent sources of truth that must agree: if someone adds a field
    // to one and forgets the other, this is where it is caught.
    const schemaFields = Object.keys((credentialSchema().properties ?? {}) as Record<string, unknown>).sort();
    const published = [...(validateOperation()['x-omni-credential-exposure'] as string[])].sort();
    expect(published).toEqual(schemaFields);
  });

  test('no published field name reads like key material', () => {
    const published = validateOperation()['x-omni-credential-exposure'] as string[];
    for (const field of published) {
      expect(field).not.toMatch(/secret|hash|keyMaterial|plainText|password|token/i);
    }
  });

  test('x-omni-scope is still emitted on the same operation', () => {
    // Guards against the new extension being added by replacing the annotation
    // pass rather than extending it.
    expect(validateOperation()['x-omni-scope']).toBe('auth:validate');
  });
});
