/**
 * Output Module Unit Tests
 *
 * Note: Most output functionality is best tested via CLI integration tests.
 * These tests verify the exported functions exist and have correct types.
 */

import { describe, expect, test } from 'bun:test';

import type { OutputFormat } from '../output.js';
import * as output from '../output.js';

describe('Output Module Exports', () => {
  test('exports color control functions', () => {
    expect(typeof output.disableColors).toBe('function');
    expect(typeof output.areColorsEnabled).toBe('function');
  });

  test('exports format function', () => {
    expect(typeof output.getCurrentFormat).toBe('function');
  });

  test('exports output functions', () => {
    expect(typeof output.success).toBe('function');
    expect(typeof output.error).toBe('function');
    expect(typeof output.warn).toBe('function');
    expect(typeof output.info).toBe('function');
    expect(typeof output.data).toBe('function');
    expect(typeof output.list).toBe('function');
    expect(typeof output.keyValue).toBe('function');
    expect(typeof output.header).toBe('function');
    expect(typeof output.dim).toBe('function');
    expect(typeof output.raw).toBe('function');
  });

  test('exports flushStdout', () => {
    expect(typeof output.flushStdout).toBe('function');
  });
});

describe('areColorsEnabled', () => {
  test('returns a boolean', () => {
    const result = output.areColorsEnabled();
    expect(typeof result).toBe('boolean');
  });
});

describe('getCurrentFormat', () => {
  test('returns human or json', () => {
    const format = output.getCurrentFormat();
    expect(['human', 'json']).toContain(format);
  });

  test('return type is OutputFormat', () => {
    const format: OutputFormat = output.getCurrentFormat();
    expect(format).toBeDefined();
  });
});

describe('disableColors', () => {
  test('can be called without error', () => {
    expect(() => output.disableColors()).not.toThrow();
  });
});

describe('flushStdout', () => {
  test('returns a promise that resolves', async () => {
    const result = output.flushStdout();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  test('resolves after pending writes', async () => {
    await expect(output.flushStdout()).resolves.toBeUndefined();
  });
});
