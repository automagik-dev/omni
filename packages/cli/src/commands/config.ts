/**
 * Config Commands
 *
 * omni config list
 * omni config get <key>
 * omni config set <key> [<value>]
 */

import { Command } from 'commander';
import {
  CONFIG_KEYS,
  type ConfigKey,
  deleteConfigValue,
  getConfigValue,
  isValidConfigKey,
  loadConfig,
  setConfigValue,
} from '../config.js';
import * as output from '../output.js';

/** Handle config set with value */
function handleSetWithValue(key: ConfigKey, value: string): void {
  const keyMeta = CONFIG_KEYS[key];

  // Validate value if there are specific options
  if (keyMeta.values && !keyMeta.values.includes(value)) {
    output.error(`Invalid value '${value}' for key '${key}'`, {
      validValues: keyMeta.values,
    });
    return;
  }

  try {
    setConfigValue(key, value);
    output.success(`Set ${key} = ${value}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(message);
  }
}

/** Show available values or usage for a key */
function showKeyUsage(key: ConfigKey): void {
  const keyMeta = CONFIG_KEYS[key];
  if (keyMeta.values) {
    output.info(`Available values for '${key}':`);
    for (const v of keyMeta.values) {
      output.raw(`  - ${v}`);
    }
  } else {
    output.info(`Usage: omni config set ${key} <value>`);
    output.dim(keyMeta.description);
  }
}

export function createConfigCommand(): Command {
  const config = new Command('config').description('Manage CLI configuration');

  // omni config list
  config
    .command('list')
    .description('List all configuration values')
    .action(() => {
      const cfg = loadConfig();

      const items = Object.entries(CONFIG_KEYS).map(([key, meta]) => ({
        key,
        value: cfg[key as ConfigKey] ?? '-',
        description: meta.description,
      }));

      output.data(items);
    });

  // omni config get <key>
  config
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      if (!isValidConfigKey(key)) {
        output.error(`Unknown config key: ${key}`, {
          availableKeys: Object.keys(CONFIG_KEYS),
        });
      }

      const value = getConfigValue(key as ConfigKey);

      if (value === undefined) {
        output.error(`Config key '${key}' is not set`, undefined, 1);
      }

      output.data({ key, value });
    });

  // omni config set <key> [<value>]
  config
    .command('set <key> [value]')
    .description('Set or unset a configuration value')
    .action((key: string, value?: string) => {
      if (!isValidConfigKey(key)) {
        output.error(`Unknown config key: ${key}`, {
          availableKeys: Object.keys(CONFIG_KEYS),
        });
        return;
      }

      if (value === undefined) {
        showKeyUsage(key as ConfigKey);
      } else {
        handleSetWithValue(key as ConfigKey, value);
      }
    });

  // omni config unset <key>
  config
    .command('unset <key>')
    .description('Remove a configuration value')
    .action((key: string) => {
      if (!isValidConfigKey(key)) {
        output.error(`Unknown config key: ${key}`, {
          availableKeys: Object.keys(CONFIG_KEYS),
        });
      }

      deleteConfigValue(key as ConfigKey);
      output.success(`Unset ${key}`);
    });

  return config;
}
