/**
 * Config Module Unit Tests
 *
 * Note: File-based config operations are tested via CLI integration tests
 * because the config module caches paths at import time.
 * These tests focus on pure functions and validation logic.
 */

import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  CONFIG_KEYS,
  type ConfigKey,
  DEFAULT_SERVER_CONFIG,
  type ServerConfig,
  isValidConfigKey,
  loadServerConfig,
} from '../config';

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

describe('ServerConfig', () => {
  test('ServerConfig type has all required fields', () => {
    // Compile-time check - if it compiles, the type is correct
    const config: ServerConfig = {
      port: 8882,
      databaseUrl: 'postgresql://localhost/test',
      dataDir: '/tmp/data',
      logLevel: 'info',
      nodeEnv: 'production',
    };
    expect(config.port).toBe(8882);
    expect(config.databaseUrl).toBe('postgresql://localhost/test');
    expect(config.dataDir).toBe('/tmp/data');
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('production');
  });

  test('DEFAULT_SERVER_CONFIG has correct production defaults', () => {
    expect(DEFAULT_SERVER_CONFIG.port).toBe(8882);
    expect(DEFAULT_SERVER_CONFIG.databaseUrl).toBe('postgresql://postgres:postgres@localhost:5432/omni');
    expect(DEFAULT_SERVER_CONFIG.dataDir).toBe(join(homedir(), '.omni', 'data'));
    expect(DEFAULT_SERVER_CONFIG.logLevel).toBe('info');
    expect(DEFAULT_SERVER_CONFIG.nodeEnv).toBe('production');
  });

  test('loadServerConfig returns defaults when no server section exists', () => {
    // loadServerConfig should return defaults if config.json has no server section
    const config = loadServerConfig();
    expect(config.port).toBe(DEFAULT_SERVER_CONFIG.port);
    expect(config.databaseUrl).toBe(DEFAULT_SERVER_CONFIG.databaseUrl);
    expect(config.dataDir).toBe(DEFAULT_SERVER_CONFIG.dataDir);
    expect(config.logLevel).toBe(DEFAULT_SERVER_CONFIG.logLevel);
    expect(config.nodeEnv).toBe(DEFAULT_SERVER_CONFIG.nodeEnv);
  });
});

describe('Server Config Keys', () => {
  test('server.* keys are in CONFIG_KEYS', () => {
    expect(CONFIG_KEYS['server.port' as ConfigKey]).toBeDefined();
    expect(CONFIG_KEYS['server.databaseUrl' as ConfigKey]).toBeDefined();
    expect(CONFIG_KEYS['server.dataDir' as ConfigKey]).toBeDefined();
    expect(CONFIG_KEYS['server.logLevel' as ConfigKey]).toBeDefined();
    expect(CONFIG_KEYS['server.nodeEnv' as ConfigKey]).toBeDefined();
  });

  test('server.* keys have descriptions', () => {
    for (const key of ['server.port', 'server.databaseUrl', 'server.dataDir', 'server.logLevel', 'server.nodeEnv']) {
      const meta = CONFIG_KEYS[key as ConfigKey];
      expect(meta.description).toBeDefined();
      expect(typeof meta.description).toBe('string');
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  test('isValidConfigKey returns true for server.* keys', () => {
    expect(isValidConfigKey('server.port')).toBe(true);
    expect(isValidConfigKey('server.databaseUrl')).toBe(true);
    expect(isValidConfigKey('server.dataDir')).toBe(true);
    expect(isValidConfigKey('server.logLevel')).toBe(true);
    expect(isValidConfigKey('server.nodeEnv')).toBe(true);
  });
});
