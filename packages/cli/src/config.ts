/**
 * CLI Configuration Management
 *
 * Stores config in ~/.omni/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Command visibility categories */
export type CommandCategory = 'core' | 'standard' | 'advanced' | 'debug';

/** Server-side configuration */
export interface ServerConfig {
  port: number;
  databaseUrl: string;
  dataDir: string;
  logLevel: string;
  nodeEnv: string;
}

/** Valid config keys (top-level and dot-notation server.* keys) */
export type ConfigKey =
  | 'apiUrl'
  | 'apiKey'
  | 'defaultInstance'
  | 'format'
  | 'showCommands'
  | 'updateChannel'
  | 'server.port'
  | 'server.databaseUrl'
  | 'server.dataDir'
  | 'server.logLevel'
  | 'server.nodeEnv';

/** Config file structure */
export interface Config {
  apiUrl?: string;
  apiKey?: string;
  defaultInstance?: string;
  format?: 'human' | 'json';
  showCommands?: string; // 'all' or comma-separated categories
  updateChannel?: 'main' | 'dev';
  server?: Partial<ServerConfig>;
}

/** Default config values */
const DEFAULT_CONFIG: Config = {
  apiUrl: 'http://localhost:8882',
  format: 'human',
};

/** Default server config with production defaults */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 8882,
  databaseUrl: 'postgresql://postgres:postgres@localhost:5432/omni',
  dataDir: join(homedir(), '.omni', 'data'),
  logLevel: 'info',
  nodeEnv: 'production',
};

/** Valid config keys with descriptions */
export const CONFIG_KEYS: Record<ConfigKey, { description: string; values?: string[] }> = {
  apiUrl: { description: 'API base URL (e.g., http://localhost:8882)' },
  apiKey: { description: 'API key for authentication' },
  defaultInstance: { description: 'Default instance ID for commands' },
  format: { description: 'Output format', values: ['human', 'json'] },
  showCommands: {
    description: 'Which command categories to show in help',
    values: ['all', 'core', 'standard', 'advanced', 'debug'],
  },
  updateChannel: {
    description: 'Update track for omni update',
    values: ['main', 'dev'],
  },
  'server.port': { description: 'Server port (default: 8882)' },
  'server.databaseUrl': { description: 'PostgreSQL connection URL' },
  'server.dataDir': { description: 'Data directory for PGlite and media storage' },
  'server.logLevel': {
    description: 'Log level',
    values: ['debug', 'info', 'warn', 'error'],
  },
  'server.nodeEnv': {
    description: 'Node environment',
    values: ['production', 'development'],
  },
};

/** Default visible categories (core + standard) */
const DEFAULT_VISIBLE_CATEGORIES: CommandCategory[] = ['core', 'standard'];

/** Get which command categories should be visible */
export function getVisibleCategories(): CommandCategory[] | 'all' {
  // Environment variable override
  const envShow = process.env.OMNI_SHOW_COMMANDS;
  if (envShow) {
    if (envShow === 'all') return 'all';
    return envShow.split(',').map((c) => c.trim()) as CommandCategory[];
  }

  // Config file
  const config = loadConfig();
  if (config.showCommands) {
    if (config.showCommands === 'all') return 'all';
    return config.showCommands.split(',').map((c) => c.trim()) as CommandCategory[];
  }

  return DEFAULT_VISIBLE_CATEGORIES;
}

/** Check if a category should be visible */
export function isCategoryVisible(category: CommandCategory): boolean {
  const visible = getVisibleCategories();
  if (visible === 'all') return true;
  return visible.includes(category);
}

/** Get config directory path */
export function getConfigDir(): string {
  return join(homedir(), '.omni');
}

/** Get config file path */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/** Ensure config directory exists */
function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/** Load config from file */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Config;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save config to file */
export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Get a single config value */
export function getConfigValue(key: ConfigKey): string | undefined {
  const config = loadConfig();

  // Handle dot-notation server.* keys
  if (key.startsWith('server.')) {
    const field = key.slice('server.'.length) as keyof ServerConfig;
    if (config.server && config.server[field] !== undefined) {
      return String(config.server[field]);
    }
    // Return default if not explicitly set
    return String(DEFAULT_SERVER_CONFIG[field]);
  }

  return config[key as keyof Omit<Config, 'server'>];
}

/** Set a server.* config field */
function setServerField(config: Config, field: keyof ServerConfig, value: string): void {
  if (!config.server) {
    config.server = {};
  }
  if (field === 'port') {
    const numValue = Number(value);
    if (Number.isNaN(numValue) || numValue <= 0 || numValue > 65535) {
      throw new Error(`Invalid port value: ${value}. Must be a number between 1 and 65535.`);
    }
    config.server.port = numValue;
  } else {
    (config.server as Record<string, unknown>)[field] = value;
  }
}

/** Set a top-level config field */
function setTopLevelField(config: Config, key: ConfigKey, value: string): void {
  if (key === 'format') {
    if (value !== 'human' && value !== 'json') {
      throw new Error(`Invalid format value: ${value}. Must be 'human' or 'json'.`);
    }
    config.format = value;
  } else if (key === 'showCommands') {
    const validCategories = ['all', 'core', 'standard', 'advanced', 'debug'];
    const categories = value.split(',').map((c) => c.trim());
    for (const cat of categories) {
      if (!validCategories.includes(cat)) {
        throw new Error(`Invalid category: ${cat}. Valid: ${validCategories.join(', ')}`);
      }
    }
    config.showCommands = value;
  } else if (key === 'updateChannel') {
    if (value !== 'main' && value !== 'dev') {
      throw new Error(`Invalid updateChannel: ${value}. Must be 'main' or 'dev'.`);
    }
    config.updateChannel = value;
  } else {
    (config as Record<string, unknown>)[key] = value;
  }
}

/** Set a single config value */
export function setConfigValue(key: ConfigKey, value: string): void {
  const config = loadConfig();

  if (key.startsWith('server.')) {
    setServerField(config, key.slice('server.'.length) as keyof ServerConfig, value);
  } else {
    setTopLevelField(config, key, value);
  }
  saveConfig(config);
}

/** Delete a config value */
export function deleteConfigValue(key: ConfigKey): void {
  const config = loadConfig();

  // Handle dot-notation server.* keys
  if (key.startsWith('server.')) {
    const field = key.slice('server.'.length) as keyof ServerConfig;
    if (config.server) {
      (config.server as Record<string, unknown>)[field] = undefined;
      // Clean up empty server object
      if (Object.values(config.server).every((v) => v === undefined)) {
        config.server = undefined;
      }
    }
    saveConfig(config);
    return;
  }

  (config as Record<string, unknown>)[key] = undefined;
  saveConfig(config);
}

/** Check if config key is valid */
export function isValidConfigKey(key: string): key is ConfigKey {
  return key in CONFIG_KEYS;
}

/** Set runtime format override (e.g., from --json flag) */
export function setRuntimeFormat(format: 'human' | 'json'): void {
  process.env.__OMNI_RUNTIME_FORMAT = format;
}

/** Get output format based on precedence: --json flag > ENV > Config > TTY */
export function getOutputFormat(): 'human' | 'json' {
  // 0. Runtime override (--json flag) — uses process.env to avoid bundler module duplication
  const runtimeFormat = process.env.__OMNI_RUNTIME_FORMAT;
  if (runtimeFormat === 'human' || runtimeFormat === 'json') {
    return runtimeFormat;
  }

  // 1. Environment variable
  const envFormat = process.env.OMNI_FORMAT;
  if (envFormat === 'human' || envFormat === 'json') {
    return envFormat;
  }

  // 2. Config file
  const config = loadConfig();
  if (config.format) {
    return config.format;
  }

  // 3. TTY auto-detection
  return process.stdout.isTTY ? 'human' : 'json';
}

/** Load server config with production defaults merged */
export function loadServerConfig(): ServerConfig {
  const config = loadConfig();
  return { ...DEFAULT_SERVER_CONFIG, ...config.server };
}

/** Save partial server config (merges with defaults and existing config) */
export function saveServerConfig(partial: Partial<ServerConfig>): void {
  const config = loadConfig();
  config.server = { ...DEFAULT_SERVER_CONFIG, ...config.server, ...partial };
  saveConfig(config);
}

/** Check if auth is configured */
export function hasAuth(): boolean {
  const config = loadConfig();
  return Boolean(config.apiKey);
}
