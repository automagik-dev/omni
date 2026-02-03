/**
 * Config Module Unit Tests
 *
 * Note: File-based config operations are tested via CLI integration tests
 * because the config module caches paths at import time.
 * These tests focus on pure functions and validation logic.
 */

import { describe, expect, test } from 'bun:test';

import { CONFIG_KEYS, type ConfigKey, isValidConfigKey } from '../config';

describe('Config Validation', () => {
  describe('isValidConfigKey', () => {
    test('returns true for valid keys', () => {
      expect(isValidConfigKey('apiUrl')).toBe(true);
      expect(isValidConfigKey('apiKey')).toBe(true);
      expect(isValidConfigKey('defaultInstance')).toBe(true);
      expect(isValidConfigKey('format')).toBe(true);
    });

    test('returns false for invalid keys', () => {
      expect(isValidConfigKey('invalidKey')).toBe(false);
      expect(isValidConfigKey('')).toBe(false);
      expect(isValidConfigKey('API_KEY')).toBe(false); // case sensitive
      expect(isValidConfigKey('APIURL')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isValidConfigKey(null as unknown as string)).toBe(false);
      expect(isValidConfigKey(undefined as unknown as string)).toBe(false);
    });
  });

  describe('CONFIG_KEYS', () => {
    test('has all expected keys', () => {
      const keys = Object.keys(CONFIG_KEYS);
      expect(keys).toContain('apiUrl');
      expect(keys).toContain('apiKey');
      expect(keys).toContain('defaultInstance');
      expect(keys).toContain('format');
    });

    test('has descriptions for all keys', () => {
      for (const [_key, meta] of Object.entries(CONFIG_KEYS)) {
        expect(meta.description).toBeDefined();
        expect(typeof meta.description).toBe('string');
        expect(meta.description.length).toBeGreaterThan(0);
      }
    });

    test('format key has valid values defined', () => {
      expect(CONFIG_KEYS.format.values).toBeDefined();
      expect(CONFIG_KEYS.format.values).toContain('human');
      expect(CONFIG_KEYS.format.values).toContain('json');
      expect(CONFIG_KEYS.format.values?.length).toBe(2);
    });

    test('other keys do not have values array', () => {
      expect(CONFIG_KEYS.apiUrl.values).toBeUndefined();
      expect(CONFIG_KEYS.apiKey.values).toBeUndefined();
      expect(CONFIG_KEYS.defaultInstance.values).toBeUndefined();
    });
  });
});

describe('Config Key Types', () => {
  test('ConfigKey type includes all valid keys', () => {
    // This is a compile-time check - if it compiles, it passes
    const validKeys: ConfigKey[] = ['apiUrl', 'apiKey', 'defaultInstance', 'format'];
    expect(validKeys.length).toBe(4);
  });
});
