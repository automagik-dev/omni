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
  describeActiveServer,
  getConfigValue,
  isServersConfigKey,
  isValidConfigKey,
  maskConfigApiKey,
  setConfigValue,
} from '../config.js';
import * as output from '../output.js';

/**
 * Reject `servers` / `servers.*` keys with a pointer to `omni server`.
 *
 * The registry is deliberately NOT part of `ConfigKey`: that union is closed
 * and its masking is keyed on the literal `apiKey`, so dynamic
 * `servers.<name>.apiKey` keys would print credentials unmasked. Exits the
 * process (via `output.error`) when the key belongs to the registry.
 */
function rejectServersKey(key: string): void {
  if (!isServersConfigKey(key)) return;
  output.error(`Config key '${key}' is managed by 'omni server', not 'omni config'`, {
    use: ['omni server list', 'omni server add <name> <url> --api-key <key>', 'omni server use <name>'],
  });
}

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
      const items = Object.entries(CONFIG_KEYS).map(([key, meta]) => {
        const raw: string = getConfigValue(key as ConfigKey) ?? '-';
        // Mask API key for security — never echo a full key, however short.
        const value = key === 'apiKey' && raw !== '-' ? maskConfigApiKey(raw) : raw;

        return {
          key,
          value,
          description: meta.description,
        };
      });

      // Read-only view of the remote-server registry (Decision 10): one row,
      // key masked, managed exclusively by `omni server`.
      const active = describeActiveServer();
      items.push({
        key: 'servers.active',
        value: `${active.name} (${active.url}) key=${active.maskedKey}`,
        description: 'Active server entry (read-only — manage with: omni server)',
      });

      output.data(items);
    });

  // omni config get <key>
  config
    .command('get <key>')
    .description('Get a configuration value')
    .option('--raw', 'Output only the value (no key label, no formatting)')
    .action((key: string, options: { raw?: boolean }) => {
      rejectServersKey(key);
      if (!isValidConfigKey(key)) {
        output.error(`Unknown config key: ${key}`, {
          availableKeys: Object.keys(CONFIG_KEYS),
        });
      }

      const value = getConfigValue(key as ConfigKey);

      if (value === undefined) {
        output.error(`Config key '${key}' is not set`, undefined, 1);
      }

      if (options.raw) {
        output.raw(String(value));
        return;
      }

      output.data({ key, value });
    });

  // omni config set <key> [<value>]
  config
    .command('set <key> [value]')
    .description('Set or unset a configuration value')
    .action((key: string, value?: string) => {
      rejectServersKey(key);
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
      rejectServersKey(key);
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
