/**
 * Config Module Unit Tests
 *
 * File-based tests are sandboxed with `OMNI_CONFIG_DIR`, which
 * `getConfigDir()` reads on EVERY call — nothing is cached at import time —
 * so pointing it at a temp dir per test fully isolates these tests from the
 * developer's real `~/.omni`. Every test that touches the filesystem must go
 * through `withSandbox()`; without it, `loadServerConfig()` and friends read
 * (and `save*` would write) the real user config.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CONFIG_KEYS,
  type Config,
  type ConfigKey,
  DEFAULT_SERVER_CONFIG,
  DEFAULT_SERVER_NAME,
  type ServerConfig,
  clearRuntimeServer,
  deleteConfigValue,
  describeActiveServer,
  getConfigPath,
  isServersConfigKey,
  isValidConfigKey,
  loadConfig,
  loadLocalRuntimeConfig,
  loadServerConfig,
  maskConfigApiKey,
  resetConfigWarnings,
  saveConfig,
  saveLocalRuntimeConfig,
  setConfigValue,
  setRuntimeServer,
} from '../config.js';
import { buildRuntimeEnv } from '../runtime-env.js';

// ----------------------------------------------------------------------------
// Sandbox: temp OMNI_CONFIG_DIR + full env save/restore
// ----------------------------------------------------------------------------

/** Env vars mutated by these tests — saved before and restored after each. */
const MANAGED_ENV = ['OMNI_CONFIG_DIR', '__OMNI_RUNTIME_SERVER', 'OMNI_DB_ENFORCEMENT'] as const;

let savedEnv: Record<string, string | undefined> = {};
let sandboxDir: string | undefined;

function withSandbox(): void {
  beforeEach(() => {
    savedEnv = {};
    for (const key of MANAGED_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    sandboxDir = mkdtempSync(join(tmpdir(), 'omni-config-test-'));
    process.env.OMNI_CONFIG_DIR = sandboxDir;
    // The warning dedupe set is module-global and never expires — reset it so
    // one test's warning is not swallowed for every test that follows.
    resetConfigWarnings();
  });

  afterEach(() => {
    if (sandboxDir) {
      rmSync(sandboxDir, { recursive: true, force: true });
      sandboxDir = undefined;
    }
    for (const key of MANAGED_ENV) {
      const previous = savedEnv[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });
}

/** Write a raw config.json into the sandbox. */
function writeRawConfig(raw: unknown): void {
  writeFileSync(getConfigPath(), JSON.stringify(raw, null, 2));
}

/** Read the raw config.json back from the sandbox. */
function readRawConfigFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(getConfigPath(), 'utf-8')) as Record<string, unknown>;
}

const LOCAL_KEY = 'omni_sk_localaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REMOTE_KEY = 'omni_sk_remotebbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** Two-entry registry with the REMOTE entry active. */
function writeTwoServerConfig(): void {
  writeRawConfig({
    apiUrl: 'http://localhost:8882',
    apiKey: LOCAL_KEY,
    format: 'human',
    servers: {
      active: 'prod',
      list: {
        [DEFAULT_SERVER_NAME]: { url: 'http://localhost:8882', apiKey: LOCAL_KEY },
        prod: { url: 'https://omni.example.com', apiKey: REMOTE_KEY },
      },
    },
  });
}

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
  // `loadServerConfig()` below hits the filesystem — sandbox it so it never
  // reads the developer's real ~/.omni/config.json.
  withSandbox();

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

  test('loadServerConfig returns a complete ServerConfig with all required fields', () => {
    const config = loadServerConfig();
    // All fields must be present (defaults merged with any config.json overrides)
    expect(typeof config.port).toBe('number');
    expect(typeof config.databaseUrl).toBe('string');
    expect(typeof config.dataDir).toBe('string');
    expect(typeof config.logLevel).toBe('string');
    expect(typeof config.nodeEnv).toBe('string');
    expect(config.dataDir.length).toBeGreaterThan(0);
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

// ============================================================================
// Multi-server registry
// ============================================================================

describe('Server registry keys are not config keys', () => {
  test('isServersConfigKey matches the registry namespace only', () => {
    expect(isServersConfigKey('servers')).toBe(true);
    expect(isServersConfigKey('servers.prod.apiKey')).toBe(true);
    expect(isServersConfigKey('servers.foo.apiKey')).toBe(true);
    expect(isServersConfigKey('server.port')).toBe(false);
    expect(isServersConfigKey('apiKey')).toBe(false);
  });

  test('servers.* keys are rejected by the closed ConfigKey union', () => {
    // `omni config set servers.foo.apiKey x` must not be routable — the
    // command layer turns this into an error pointing at `omni server`.
    expect(isValidConfigKey('servers.foo.apiKey')).toBe(false);
    expect(isValidConfigKey('servers')).toBe(false);
    expect(Object.keys(CONFIG_KEYS).some((k) => k.startsWith('servers'))).toBe(false);
  });

  test('maskConfigApiKey never returns the full key', () => {
    expect(maskConfigApiKey(LOCAL_KEY)).toBe(`${LOCAL_KEY.slice(0, 12)}...`);
    expect(maskConfigApiKey(LOCAL_KEY)).not.toContain(LOCAL_KEY);
    // Short keys collapse entirely rather than being echoed.
    expect(maskConfigApiKey('short')).toBe('***');
    expect(maskConfigApiKey(undefined)).toBe('-');
  });
});

describe('Server registry migration', () => {
  withSandbox();

  test('lifts legacy flat apiUrl/apiKey into a default entry', () => {
    writeRawConfig({ apiUrl: 'http://legacy.local:9000', apiKey: LOCAL_KEY, format: 'human' });

    const config = loadConfig();

    expect(config.servers?.active).toBe(DEFAULT_SERVER_NAME);
    expect(config.servers?.list[DEFAULT_SERVER_NAME]).toEqual({
      url: 'http://legacy.local:9000',
      apiKey: LOCAL_KEY,
    });
    // Effective values are unchanged for the ~30 call sites reading them.
    expect(config.apiUrl).toBe('http://legacy.local:9000');
    expect(config.apiKey).toBe(LOCAL_KEY);
  });

  test('a flat config round-trips through load -> save -> load unchanged', () => {
    writeRawConfig({ apiUrl: 'http://legacy.local:9000', apiKey: LOCAL_KEY, format: 'human' });

    const first = loadConfig();
    saveConfig(first);
    const second = loadConfig();

    expect(second.apiUrl).toBe(first.apiUrl);
    expect(second.apiKey).toBe(first.apiKey);
    expect(second.servers).toEqual(first.servers);
    // The migration is now persisted, and the flat fields stay as a mirror
    // for older CLI builds reading the same file.
    const onDisk = readRawConfigFile();
    expect(onDisk.servers).toBeDefined();
    expect(onDisk.apiUrl).toBe('http://legacy.local:9000');
  });

  test('a config with no file at all still yields a default entry', () => {
    const config = loadConfig();
    expect(config.servers?.active).toBe(DEFAULT_SERVER_NAME);
    expect(config.apiUrl).toBe('http://localhost:8882');
    expect(config.apiKey).toBeUndefined();
  });

  test('migration is idempotent — an existing block is preserved', () => {
    writeTwoServerConfig();
    const config = loadConfig();
    expect(config.servers?.active).toBe('prod');
    expect(Object.keys(config.servers?.list ?? {}).sort()).toEqual(['default', 'prod']);
  });
});

describe('Server registry resolution', () => {
  withSandbox();

  test('resolves the active entry into effective apiUrl/apiKey', () => {
    writeTwoServerConfig();
    const config = loadConfig();
    expect(config.apiUrl).toBe('https://omni.example.com');
    expect(config.apiKey).toBe(REMOTE_KEY);
  });

  test('the env-transported override wins for one invocation and is never persisted', () => {
    writeTwoServerConfig();
    setRuntimeServer(DEFAULT_SERVER_NAME);

    const overridden = loadConfig();
    expect(overridden.apiUrl).toBe('http://localhost:8882');
    expect(overridden.apiKey).toBe(LOCAL_KEY);
    // The persisted pointer is untouched, even after a save.
    saveConfig(overridden);
    expect((readRawConfigFile().servers as { active: string }).active).toBe('prod');

    clearRuntimeServer();
    expect(loadConfig().apiKey).toBe(REMOTE_KEY);
  });

  test('an unknown override falls back to the persisted active entry', () => {
    writeTwoServerConfig();
    setRuntimeServer('nope');
    expect(loadConfig().apiKey).toBe(REMOTE_KEY);
  });

  test('saving writes credentials into the targeted entry, not just the flat fields', () => {
    writeTwoServerConfig();
    const config = loadConfig();
    config.apiKey = 'omni_sk_rotatedccccccccccccccccccccccccc';
    saveConfig(config);

    const servers = readRawConfigFile().servers as { list: Record<string, { apiKey?: string }> };
    expect(servers.list.prod.apiKey).toBe('omni_sk_rotatedccccccccccccccccccccccccc');
    // The local entry is untouched by a save made against the active remote.
    expect(servers.list.default.apiKey).toBe(LOCAL_KEY);
  });

  test('describeActiveServer reports the active entry with a masked key', () => {
    writeTwoServerConfig();
    const active = describeActiveServer();
    expect(active.name).toBe('prod');
    expect(active.url).toBe('https://omni.example.com');
    expect(active.maskedKey).not.toBe(REMOTE_KEY);
    expect(active.maskedKey).toBe(`${REMOTE_KEY.slice(0, 12)}...`);
  });
});

describe('Server registry validation fallback', () => {
  withSandbox();

  test('a non-object servers block falls back to the legacy flat fields', () => {
    writeRawConfig({ apiUrl: 'http://legacy.local:9000', apiKey: LOCAL_KEY, servers: 'not-an-object' });

    const config = loadConfig();

    expect(config.apiUrl).toBe('http://legacy.local:9000');
    expect(config.apiKey).toBe(LOCAL_KEY);
    expect(config.servers?.active).toBe(DEFAULT_SERVER_NAME);
  });

  test('individual malformed entries are dropped, valid ones survive', () => {
    writeRawConfig({
      apiUrl: 'http://localhost:8882',
      servers: {
        active: 'good',
        list: {
          good: { url: 'https://good.example.com', apiKey: LOCAL_KEY },
          missingUrl: { apiKey: REMOTE_KEY },
          wrongType: { url: 1234 },
        },
      },
    });

    const config = loadConfig();

    expect(Object.keys(config.servers?.list ?? {})).toEqual(['good']);
    expect(config.apiUrl).toBe('https://good.example.com');
  });

  test('an active pointer naming a dropped entry falls back to a surviving one', () => {
    writeRawConfig({
      servers: { active: 'ghost', list: { [DEFAULT_SERVER_NAME]: { url: 'http://localhost:8882' } } },
    });

    const config = loadConfig();

    expect(config.servers?.active).toBe(DEFAULT_SERVER_NAME);
    expect(config.apiUrl).toBe('http://localhost:8882');
  });

  test('unparseable JSON falls back to defaults instead of crashing', () => {
    writeFileSync(getConfigPath(), '{ this is not json');
    const config = loadConfig();
    expect(config.apiUrl).toBe('http://localhost:8882');
    expect(config.servers?.active).toBe(DEFAULT_SERVER_NAME);
  });
});

describe('Local runtime isolation', () => {
  withSandbox();

  test('loadLocalRuntimeConfig reads the default entry while a remote is active', () => {
    writeTwoServerConfig();

    expect(loadConfig().apiKey).toBe(REMOTE_KEY);
    expect(loadLocalRuntimeConfig().apiKey).toBe(LOCAL_KEY);
    expect(loadLocalRuntimeConfig().apiUrl).toBe('http://localhost:8882');
  });

  test('buildRuntimeEnv never hands the active remote key to the local process', () => {
    writeTwoServerConfig();

    // Default parameter — the structural guarantee: a caller that passes no
    // cliConfig still gets the LOCAL entry.
    expect(buildRuntimeEnv(loadServerConfig()).OMNI_API_KEY).toBe(LOCAL_KEY);
    // Explicit accessor — how every call site is wired.
    expect(buildRuntimeEnv(loadServerConfig(), loadLocalRuntimeConfig()).OMNI_API_KEY).toBe(LOCAL_KEY);
    expect(buildRuntimeEnv(loadServerConfig()).OMNI_API_KEY).not.toBe(REMOTE_KEY);
  });

  test('the server.* local runtime namespace is untouched by the registry', () => {
    writeRawConfig({
      apiUrl: 'http://localhost:8882',
      apiKey: LOCAL_KEY,
      server: { port: 9999, logLevel: 'debug' },
      servers: {
        active: 'prod',
        list: {
          [DEFAULT_SERVER_NAME]: { url: 'http://localhost:9999', apiKey: LOCAL_KEY },
          prod: { url: 'https://omni.example.com', apiKey: REMOTE_KEY },
        },
      },
    });

    const serverConfig = loadServerConfig();
    expect(serverConfig.port).toBe(9999);
    expect(serverConfig.logLevel).toBe('debug');
    expect(buildRuntimeEnv(serverConfig).API_PORT).toBe('9999');
    // Saving through the client-facing accessor must not rewrite server.*
    saveConfig(loadConfig());
    expect(readRawConfigFile().server).toEqual({ port: 9999, logLevel: 'debug' });
  });

  test('saveLocalRuntimeConfig writes to the default entry while a remote is active', () => {
    writeTwoServerConfig();

    const local: Config = loadLocalRuntimeConfig();
    local.apiKey = 'omni_sk_recoveredddddddddddddddddddddddd';
    saveLocalRuntimeConfig(local);

    const servers = readRawConfigFile().servers as { active: string; list: Record<string, { apiKey?: string }> };
    expect(servers.list.default.apiKey).toBe('omni_sk_recoveredddddddddddddddddddddddd');
    expect(servers.list.prod.apiKey).toBe(REMOTE_KEY);
    expect(servers.active).toBe('prod');
  });
});

describe('Flat back-compat mirror never carries remote credentials', () => {
  withSandbox();

  test('saving against an active remote leaves the flat fields mirroring default', () => {
    writeTwoServerConfig();

    // A save made through the client-facing accessor while `prod` is active.
    saveConfig(loadConfig());

    const onDisk = readRawConfigFile();
    expect(onDisk.apiKey).toBe(LOCAL_KEY);
    expect(onDisk.apiKey).not.toBe(REMOTE_KEY);
    expect(onDisk.apiUrl).toBe('http://localhost:8882');
    // And the local accessor still resolves the local entry.
    expect(loadLocalRuntimeConfig().apiKey).toBe(LOCAL_KEY);
  });

  test('rotating the active remote key does not leak it into the flat mirror', () => {
    writeTwoServerConfig();
    const config = loadConfig();
    config.apiKey = 'omni_sk_rotatedccccccccccccccccccccccccc';
    saveConfig(config);

    const onDisk = readRawConfigFile();
    expect(onDisk.apiKey).toBe(LOCAL_KEY);
    expect(onDisk.apiUrl).toBe('http://localhost:8882');
  });

  test('a registry without a default entry yields no local credential at all', () => {
    // Reachable by hand-editing config.json today, and by `omni server remove
    // default` once that command lands.
    writeRawConfig({
      apiUrl: 'https://omni.example.com',
      apiKey: REMOTE_KEY,
      servers: { active: 'prod', list: { prod: { url: 'https://omni.example.com', apiKey: REMOTE_KEY } } },
    });

    const local = loadLocalRuntimeConfig();
    expect(local.apiUrl).toBe('http://localhost:8882');
    expect(local.apiKey).toBeUndefined();
    expect(buildRuntimeEnv(loadServerConfig()).OMNI_API_KEY).toBe('');
  });
});

describe('config unset', () => {
  withSandbox();

  test('unset apiUrl reverts the effective URL to the default', () => {
    setConfigValue('apiUrl', 'http://custom.local:9100');
    expect(loadConfig().apiUrl).toBe('http://custom.local:9100');

    deleteConfigValue('apiUrl');

    expect(loadConfig().apiUrl).toBe('http://localhost:8882');
    const servers = readRawConfigFile().servers as { list: Record<string, { url: string }> };
    expect(servers.list.default.url).toBe('http://localhost:8882');
  });

  test('unset apiKey still clears the key', () => {
    setConfigValue('apiKey', LOCAL_KEY);
    expect(loadConfig().apiKey).toBe(LOCAL_KEY);

    deleteConfigValue('apiKey');

    expect(loadConfig().apiKey).toBeUndefined();
    expect(readRawConfigFile().apiKey).toBeUndefined();
  });
});

describe('Config warnings', () => {
  withSandbox();

  test('a malformed server entry is reported on stderr', () => {
    writeRawConfig({
      apiUrl: 'http://localhost:8882',
      servers: {
        active: 'good',
        list: {
          good: { url: 'https://good.example.com' },
          broken: { apiKey: REMOTE_KEY },
        },
      },
    });

    const original = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      loadConfig();
    } finally {
      process.stderr.write = original;
    }

    expect(captured.join('')).toContain('dropping invalid server entry "broken"');
    // The dropped entry's key is never echoed in the warning.
    expect(captured.join('')).not.toContain(REMOTE_KEY);
  });
});
