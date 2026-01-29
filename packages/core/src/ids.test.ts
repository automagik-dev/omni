import { describe, expect, test } from 'bun:test';
import {
  ID_PREFIXES,
  extractPrefix,
  extractTimestampFromCorrelationId,
  generateCorrelationId,
  generateId,
  generatePrefixedId,
  generateShortId,
  isValidUuid,
} from './ids';

describe('ids', () => {
  describe('generateId', () => {
    test('generates valid UUID', () => {
      const id = generateId();
      expect(isValidUuid(id)).toBe(true);
    });

    test('generates unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateCorrelationId', () => {
    test('generates correlation ID with default prefix', () => {
      const id = generateCorrelationId();
      expect(id).toMatch(/^corr-[a-z0-9]+-[a-z0-9]+$/);
    });

    test('generates correlation ID with custom prefix', () => {
      const id = generateCorrelationId('test');
      expect(id).toMatch(/^test-[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('generateShortId', () => {
    test('generates 8 character ID', () => {
      const id = generateShortId();
      expect(id.length).toBe(8);
    });
  });

  describe('isValidUuid', () => {
    test('validates correct UUID', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    test('rejects invalid UUID', () => {
      expect(isValidUuid('not-a-uuid')).toBe(false);
      expect(isValidUuid('')).toBe(false);
    });
  });

  describe('extractTimestampFromCorrelationId', () => {
    test('extracts timestamp from correlation ID', () => {
      const before = Date.now();
      const id = generateCorrelationId();
      const after = Date.now();

      const timestamp = extractTimestampFromCorrelationId(id);
      expect(timestamp).not.toBeNull();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    test('returns null for invalid format', () => {
      expect(extractTimestampFromCorrelationId('invalid')).toBeNull();
    });
  });

  describe('generatePrefixedId', () => {
    test('generates ID with correct prefix', () => {
      const id = generatePrefixedId(ID_PREFIXES.person);
      expect(id).toMatch(/^per_[a-f0-9-]+$/);
    });
  });

  describe('extractPrefix', () => {
    test('extracts prefix from prefixed ID', () => {
      const id = generatePrefixedId(ID_PREFIXES.event);
      expect(extractPrefix(id)).toBe(ID_PREFIXES.event);
    });

    test('returns null for invalid format', () => {
      expect(extractPrefix('no-prefix-here')).toBeNull();
      expect(extractPrefix('invalid_prefix_id')).toBeNull();
    });
  });
});
