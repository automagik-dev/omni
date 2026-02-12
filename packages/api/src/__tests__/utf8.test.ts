import { describe, expect, test } from 'bun:test';
import { deepSanitize, sanitizeText } from '../utils/utf8';

describe('sanitizeText', () => {
  test('returns undefined for null/undefined/empty', () => {
    expect(sanitizeText(null)).toBeUndefined();
    expect(sanitizeText(undefined)).toBeUndefined();
    expect(sanitizeText('')).toBeUndefined();
  });

  test('passes through clean strings unchanged', () => {
    expect(sanitizeText('hello world')).toBe('hello world');
    expect(sanitizeText('café ☕ 日本語')).toBe('café ☕ 日本語');
  });

  test('strips null bytes', () => {
    expect(sanitizeText('hello\x00world')).toBe('helloworld');
  });

  test('strips lone surrogates', () => {
    // Lone high surrogate
    expect(sanitizeText('hello\uD800world')).toBe('helloworld');
    // Lone low surrogate
    expect(sanitizeText('hello\uDC00world')).toBe('helloworld');
  });

  test('preserves valid surrogate pairs (emoji)', () => {
    // 🔥 is U+1F525, encoded as surrogate pair \uD83D\uDD25
    expect(sanitizeText('🔥 fire')).toBe('🔥 fire');
  });
});

describe('deepSanitize', () => {
  test('sanitizes strings in nested objects', () => {
    const input = {
      text: 'hello\x00world',
      nested: {
        name: 'test\uD800value',
        count: 42,
      },
      list: ['clean', 'has\x00null'],
    };

    const result = deepSanitize(input);
    expect(result.text).toBe('helloworld');
    expect((result.nested as { name: string }).name).toBe('testvalue');
    expect((result.nested as { count: number }).count).toBe(42);
    expect(result.list).toEqual(['clean', 'hasnull']);
  });

  test('handles non-object types', () => {
    expect(deepSanitize(42)).toBe(42);
    expect(deepSanitize(true)).toBe(true);
    expect(deepSanitize(null)).toBeNull();
  });
});
