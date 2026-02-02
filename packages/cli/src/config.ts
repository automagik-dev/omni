/**
 * CLI Configuration Management
 *
 * Stores config in ~/.omni/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Valid config keys */
export type ConfigKey = 'apiUrl' | 'apiKey' | 'defaultInstance' | 'format';

/** Config file structure */
export interface Config {
  apiUrl?: string;
  apiKey?: string;
  defaultInstance?: string;
  format?: 'human' | 'json';
}

/** Default config values */
const DEFAULT_CONFIG: Config = {
  apiUrl: 'http://localhost:8881',
  format: 'human',
};

/** Valid config keys with descriptions */
export const CONFIG_KEYS: Record<ConfigKey, { description: string; values?: string[] }> = {
  apiUrl: { description: 'API base URL (e.g., http://localhost:8881)' },
  apiKey: { description: 'API key for authentication' },
  defaultInstance: { description: 'Default instance ID for commands' },
  format: { description: 'Output format', values: ['human', 'json'] },
};

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

/** Get output format based on precedence: ENV > Config > TTY */
export function getOutputFormat(): 'human' | 'json' {
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
