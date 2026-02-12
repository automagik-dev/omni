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

/** Valid config keys */
export type ConfigKey = 'apiUrl' | 'apiKey' | 'defaultInstance' | 'format' | 'showCommands';

/** Config file structure */
export interface Config {
  apiUrl?: string;
  apiKey?: string;
  defaultInstance?: string;
  format?: 'human' | 'json';
  showCommands?: string; // 'all' or comma-separated categories
}

/** Default config values */
const DEFAULT_CONFIG: Config = {
  apiUrl: 'http://localhost:8882',
  format: 'human',
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
  return config[key];
}

/** Set a single config value */
export function setConfigValue(key: ConfigKey, value: string): void {
  const config = loadConfig();
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
  } else {
    config[key] = value;
  }
  saveConfig(config);
}

/** Delete a config value */
export function deleteConfigValue(key: ConfigKey): void {
  const config = loadConfig();
  delete config[key];
  saveConfig(config);
}

/** Check if config key is valid */
export function isValidConfigKey(key: string): key is ConfigKey {
  return key in CONFIG_KEYS;
}

/** Runtime format override (set by --json flag) */
let runtimeFormat: 'human' | 'json' | undefined;

/** Set runtime format override (e.g., from --json flag) */
export function setRuntimeFormat(format: 'human' | 'json'): void {
  runtimeFormat = format;
}

/** Get output format based on precedence: --json flag > ENV > Config > TTY */
export function getOutputFormat(): 'human' | 'json' {
  // 0. Runtime override (--json flag)
  if (runtimeFormat) {
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

/** Check if auth is configured */
export function hasAuth(): boolean {
  const config = loadConfig();
  return Boolean(config.apiKey);
}
