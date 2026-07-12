import { describe, expect, test } from 'bun:test';
import { coerceValue, displayValue, groupOf, isSecretWipe } from './settings-helpers';

describe('groupOf', () => {
  test('groups by dotted prefix', () => {
    expect(groupOf('elevenlabs.api_key')).toBe('elevenlabs');
  });
  test('groups by underscore prefix when there is no dot', () => {
    expect(groupOf('rate_limit')).toBe('rate');
  });
  test('falls back to general for a bare key', () => {
    expect(groupOf('debug')).toBe('general');
  });
});

describe('coerceValue', () => {
  test('parses JSON when possible', () => {
    expect(coerceValue('42')).toBe(42);
    expect(coerceValue('true')).toBe(true);
    expect(coerceValue('{"a":1}')).toEqual({ a: 1 });
  });
  test('keeps a non-JSON string raw', () => {
    expect(coerceValue('hello world')).toBe('hello world');
  });
  test('empty input coerces to empty string', () => {
    expect(coerceValue('   ')).toBe('');
  });
});

describe('displayValue', () => {
  test('masks secrets', () => {
    expect(displayValue({ isSecret: true, value: 'sk-real-secret' })).toBe('••••••••');
  });
  test('shows a dash for null/undefined', () => {
    expect(displayValue({ isSecret: false, value: null })).toBe('—');
  });
  test('stringifies objects', () => {
    expect(displayValue({ isSecret: false, value: { a: 1 } })).toBe('{"a":1}');
  });
});

describe('isSecretWipe (Save guard)', () => {
  test('blocks saving a secret with an empty edit field', () => {
    expect(isSecretWipe({ isSecret: true }, '')).toBe(true);
  });
  test('blocks saving a secret with only whitespace', () => {
    expect(isSecretWipe({ isSecret: true }, '   ')).toBe(true);
  });
  test('allows saving a secret once a value is typed', () => {
    expect(isSecretWipe({ isSecret: true }, 'new-secret')).toBe(false);
  });
  test('never blocks a non-secret, even when empty (empty is a valid value)', () => {
    expect(isSecretWipe({ isSecret: false }, '')).toBe(false);
    expect(isSecretWipe({ isSecret: undefined as unknown as boolean }, '')).toBe(false);
  });
});
