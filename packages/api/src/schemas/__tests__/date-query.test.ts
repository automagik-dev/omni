/**
 * Unit tests for the shared date-query validators
 * (packages/api/src/schemas/date-query.ts).
 *
 * These tests exercise the helpers directly (not through Hono),
 * because the helpers are the single source of truth for the
 * route-level regression tests in routes/v2/__tests__/*-date-validation.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { optionalDateParam, requiredDateParam } from '../date-query';

describe('optionalDateParam', () => {
  const schema = z.object({ since: optionalDateParam('since') });

  test('returns undefined when input is omitted', () => {
    const parsed = schema.parse({});
    expect(parsed.since).toBeUndefined();
  });

  test('returns undefined when input is the empty string', () => {
    const parsed = schema.parse({ since: '' });
    expect(parsed.since).toBeUndefined();
  });

  test('returns a Date for a valid ISO 8601 string', () => {
    const parsed = schema.parse({ since: '2024-01-01T00:00:00.000Z' });
    expect(parsed.since).toBeInstanceOf(Date);
    expect(parsed.since?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  test('rejects a UUID with a parameter-named error', () => {
    const result = schema.safeParse({ since: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('invalid since parameter');
    }
  });

  test('rejects arbitrary garbage', () => {
    const result = schema.safeParse({ since: 'not-a-date-at-all' });
    expect(result.success).toBe(false);
  });

  test('error message includes the raw input', () => {
    const result = schema.safeParse({ since: 'oops' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('"oops"');
    }
  });
});

describe('requiredDateParam', () => {
  const schema = z.object({ since: requiredDateParam('since') });

  test('rejects when the field is omitted', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('rejects the empty string', () => {
    const result = schema.safeParse({ since: '' });
    expect(result.success).toBe(false);
  });

  test('returns a Date for a valid ISO 8601 string', () => {
    const parsed = schema.parse({ since: '2024-01-01T00:00:00.000Z' });
    expect(parsed.since).toBeInstanceOf(Date);
    expect(parsed.since.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  test('rejects a UUID', () => {
    const result = schema.safeParse({ since: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.success).toBe(false);
  });
});
