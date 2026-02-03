/**
 * Output Module Unit Tests
 *
 * Note: Most output functionality is best tested via CLI integration tests.
 * These tests verify the exported functions exist and have correct types.
 */

import { describe, expect, test } from 'bun:test';

import {
  type OutputFormat,
  areColorsEnabled,
  data,
  dim,
  disableColors,
  error,
  getCurrentFormat,
  header,
  info,
  keyValue,
  list,
  raw,
  success,
  warn,
} from '../output';

describe('Output Module Exports', () => {
  test('exports color control functions', () => {
    expect(typeof disableColors).toBe('function');
    expect(typeof areColorsEnabled).toBe('function');
  });

  test('exports format function', () => {
    expect(typeof getCurrentFormat).toBe('function');
  });

  test('exports output functions', () => {
    expect(typeof success).toBe('function');
    expect(typeof error).toBe('function');
    expect(typeof warn).toBe('function');
    expect(typeof info).toBe('function');
    expect(typeof data).toBe('function');
    expect(typeof list).toBe('function');
    expect(typeof keyValue).toBe('function');
    expect(typeof header).toBe('function');
    expect(typeof dim).toBe('function');
    expect(typeof raw).toBe('function');
  });
});

describe('areColorsEnabled', () => {
  test('returns a boolean', () => {
    const result = areColorsEnabled();
    expect(typeof result).toBe('boolean');
  });
});

describe('getCurrentFormat', () => {
  test('returns human or json', () => {
    const format = getCurrentFormat();
    expect(['human', 'json']).toContain(format);
  });

  test('return type is OutputFormat', () => {
    const format: OutputFormat = getCurrentFormat();
    expect(format).toBeDefined();
  });
});

describe('disableColors', () => {
  test('can be called without error', () => {
    expect(() => disableColors()).not.toThrow();
  });
});
