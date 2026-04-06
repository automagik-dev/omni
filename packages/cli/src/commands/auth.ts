/**
 * Auth Commands
 *
 * omni auth login --api-key <key> [--api-url <url>]
 * omni auth status
 * omni auth logout
 * omni auth recover
 */

import { createOmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { deleteConfigValue, getConfigDir, getConfigPath, loadConfig, loadServerConfig, saveConfig } from '../config.js';
import * as output from '../output.js';
import { PM2_PROCESSES, capturePm2, isPm2Available, runPm2 } from '../pm2.js';
import { buildRuntimeEnv } from '../runtime-env.js';
import { generateApiKey, maskApiKey } from '../utils/keys.js';
import { VERSION } from '../version.js';

// ============================================================================
// TYPES
// ============================================================================

/** PM2 process environment shape (partial) */
interface Pm2ProcessEnv {
  OMNI_API_KEY?: string;
  [key: string]: string | undefined;
}

/** PM2 process list entry shape (partial) */
interface Pm2Process {
  name: string;
  pm2_env?: Pm2ProcessEnv;
}

/** Names to try when looking for the API process in PM2 */
const API_PROCESS_NAMES = ['omni-v2-api', PM2_PROCESSES.api] as const;

// ============================================================================
// HELPERS - PM2
// ============================================================================

/** Parse PM2 jlist output into process list, returns null on failure */
async function getPm2Processes(): Promise<Pm2Process[] | null> {
  const { code, stdout } = await capturePm2('jlist');
  if (code !== 0 || !stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(stdout) as Pm2Process[];
  } catch {
    return null;
  }
}

/**
 * Read OMNI_API_KEY from PM2 env for a known API process.
 * Returns the key if found, null otherwise.
 */
async function readApiKeyFromPm2(): Promise<{ key: string; processName: string } | null> {
  const processes = await getPm2Processes();
  if (!processes) {
    return null;
  }

  for (const name of API_PROCESS_NAMES) {
    const proc = processes.find((p) => p.name === name);
    const key = proc?.pm2_env?.OMNI_API_KEY;
    if (key?.startsWith('omni_sk_')) {
      return { key, processName: name };
    }
  }

  return null;
}

/**
 * Try to restart the API process with a new OMNI_API_KEY env var.
 *
 * Builds a sanitized runtime env from `~/.omni/config.json` (never from the
 * calling shell) and passes it to the pm2 restart command. This prevents a
 * polluted shell `DATABASE_URL` / `OMNI_API_KEY` from leaking into omni-api.
 * See runtime-env.ts for the hermeticity contract.
 *
 * Returns the process name used, or null if no API process found.
 */
async function restartApiWithNewKey(newKey: string): Promise<{ success: boolean; processName: string | null }> {
  const processes = await getPm2Processes();
  if (!processes) {
    return { success: false, processName: null };
  }

  for (const name of API_PROCESS_NAMES) {
    const proc = processes.find((p) => p.name === name);
    if (!proc) {
      continue;
    }

    // Build a sanitized env from config, then override OMNI_API_KEY with the
    // newly generated key. The other fields (DATABASE_URL, PGSERVE_DATA, etc.)
    // come from `~/.omni/config.json`, NOT from the calling shell.
    const serverConfig = loadServerConfig();
    const cliConfig = loadConfig();
    const runtimeEnv = { ...buildRuntimeEnv(serverConfig, cliConfig), OMNI_API_KEY: newKey };

    // Persist the key via `pm2 set` and bounce the process. We intentionally
    // do NOT ask pm2 to re-read the shell env — the env we pass via `runPm2`
    // is already hermetic and derived from config.
    await runPm2(['set', `${name}:OMNI_API_KEY`, newKey]);
    const restartCode = await runPm2(['restart', name], runtimeEnv);

    return { success: restartCode === 0, processName: name };
  }

  return { success: false, processName: null };
}

// ============================================================================
// HELPERS - VALIDATION
// ============================================================================

/** Validate an API key against the API. Returns true if valid. */
async function validateKey(apiUrl: string, apiKey: string): Promise<boolean> {
  const client = createOmniClient({ baseUrl: apiUrl, apiKey, cliVersion: VERSION });
  try {
    const result = await client.auth.validate();
    return result.valid;
  } catch {
    return false;
  }
}

// ============================================================================
// HELPERS - OUTPUT
// ============================================================================

/** Update CLI config with a new API key (and optional URL). */
function updateConfig(apiKey: string, apiUrl?: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  if (apiUrl) {
    config.apiUrl = apiUrl;
  }
  saveConfig(config);
}

/** Print manual recovery instructions when automation fails. */
function printManualInstructions(newKey?: string): void {
  const key = newKey ?? '<your-new-key>';
  output.raw('');
  output.raw('  Manual recovery steps:');
  output.raw('');
  output.raw('  1. Get your API key (one of):');
  output.raw('       pm2 env <process-id> | grep OMNI_API_KEY');
  output.raw('       cat ~/.pm2/dump.pm2 | grep OMNI_API_KEY');
  output.raw('');
  output.raw('  2. Update CLI config:');
  output.raw(`       omni auth login --api-key ${key}`);
  output.raw('');
  output.raw('  3. Or to rotate to a new key:');
  output.raw('     a. Stop the API:  omni stop');
  output.raw('     b. Delete primary key from DB manually');
  output.raw(`     c. Restart:       OMNI_API_KEY=${key} omni start`);
  output.raw(`     d. Login:         omni auth login --api-key ${key}`);
  output.raw('');
}

// ============================================================================
// RECOVER SUBCOMMAND HANDLERS
// ============================================================================

/** Try to recover the existing key from PM2 env. Returns true if successful. */
async function tryRecoverFromPm2Env(apiUrl: string, apiUrlOverride?: string): Promise<boolean> {
  output.raw('  Checking PM2 for existing OMNI_API_KEY...');
  const found = await readApiKeyFromPm2();

  if (!found) {
    output.raw('  No OMNI_API_KEY found in PM2 env. Trying key rotation...');
    output.raw('');
    return false;
  }

  output.raw(`  Found key in PM2 process "${found.processName}".`);
  const valid = await validateKey(apiUrl, found.key);

  if (!valid) {
    output.warn('Key found in PM2 but it does not validate against the API.');
    output.raw('  The API may not be running or the key may be stale.');
    output.raw('  Falling through to key rotation...');
    output.raw('');
    return false;
  }

  updateConfig(found.key, apiUrlOverride);
  output.success('API key recovered successfully!', {
    keyPrefix: maskApiKey(found.key),
    configPath: getConfigPath(),
  });
  output.raw('');
  output.raw('  Run: omni status  (to verify)');
  output.raw('');
  return true;
}

/** Handle a failed PM2 restart during key rotation. */
function handleRotationFailure(newKey: string, processName: string | null, apiUrlOverride?: string): void {
  if (!processName) {
    output.warn('Could not find omni-v2-api or omni-api process in PM2.');
  } else {
    output.warn(`Failed to restart ${processName} with new key.`);
  }
  printManualInstructions(newKey);
  updateConfig(newKey, apiUrlOverride);
  output.warn(`Config updated with new key (${maskApiKey(newKey)}) but API restart failed.`);
  output.raw('  After fixing the DB and restarting the API, run: omni status');
  output.raw('');
}

/** Handle a successful PM2 restart — validate and report. */
async function handleRotationSuccess(
  apiUrl: string,
  newKey: string,
  processName: string,
  apiUrlOverride?: string,
): Promise<void> {
  output.raw(`  API process "${processName}" restarted.`);
  output.raw('  Waiting for API to come online...');

  // Retry validation with exponential backoff: 1s, 2s, 4s
  let valid = false;
  const backoffMs = [1000, 2000, 4000];
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    await Bun.sleep(backoffMs[attempt]);
    valid = await validateKey(apiUrl, newKey);
    if (valid) break;
    if (attempt < backoffMs.length - 1) {
      output.raw(`  Attempt ${attempt + 1} failed, retrying...`);
    }
  }
  updateConfig(newKey, apiUrlOverride);

  if (valid) {
    output.success('API key rotated and recovered successfully!', {
      keyPrefix: maskApiKey(newKey),
      configPath: getConfigPath(),
    });
    output.raw('');
    output.raw('  Run: omni status  (to verify)');
    output.raw('');
    return;
  }

  output.warn('Config updated with new key, but validation failed.');
  output.raw('');
  output.raw('  The API may still be starting up, or the primary key was not deleted from DB.');
  output.raw('  If the primary key row still exists in the database, delete it and run:');
  output.raw('    omni restart');
  output.raw('  Or diagnose with: omni doctor --fix');
  output.raw('  Then verify with: omni status');
  output.raw('');
  // biome-ignore lint/suspicious/noConsole: CLI output — key shown once for manual use
  console.log(`  New key (save this): ${newKey}`);
  output.raw('');
}

/** Rotate to a new API key via PM2 restart. */
async function rotateApiKey(apiUrl: string, apiUrlOverride?: string): Promise<void> {
  const newKey = generateApiKey();
  output.raw(`  Generated new key: ${maskApiKey(newKey)}`);
  output.raw('');
  output.raw('  NOTE: The primary API key in the database must be deleted before');
  output.raw('  the new OMNI_API_KEY env var takes effect on restart.');
  output.raw('  If you have DB access, delete the __primary__ row from api_keys.');
  output.raw('');
  output.raw('  Attempting PM2 restart with new key...');

  const restart = await restartApiWithNewKey(newKey);

  if (!restart.success) {
    handleRotationFailure(newKey, restart.processName, apiUrlOverride);
    return;
  }

  await handleRotationSuccess(apiUrl, newKey, restart.processName ?? 'omni-api', apiUrlOverride);
}

// ============================================================================
// COMMAND
// ============================================================================

export function createAuthCommand(): Command {
  const auth = new Command('auth').description('Manage API authentication');

  // omni auth login
  auth
    .command('login')
    .description('Save API credentials')
    .requiredOption('--api-key <key>', 'API key for authentication')
    .option('--api-url <url>', 'API base URL (default: http://localhost:8882)')
    .action(async (options: { apiKey: string; apiUrl?: string }) => {
      const config = loadConfig();
      config.apiKey = options.apiKey;

      if (options.apiUrl) {
        config.apiUrl = options.apiUrl;
      }

      // Validate the key by calling the API
      const client = createOmniClient({
        baseUrl: config.apiUrl ?? 'http://localhost:8882',
        apiKey: config.apiKey,
        cliVersion: VERSION,
      });

      try {
        const result = await client.auth.validate();

        if (!result.valid) {
          output.error('API key is invalid', undefined, 2);
        }

        // Save config
        saveConfig(config);

        output.success('Logged in successfully', {
          apiUrl: config.apiUrl,
          keyName: result.keyName,
          keyPrefix: result.keyPrefix,
          scopes: result.scopes,
          configPath: getConfigPath(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to validate API key: ${message}`, undefined, 2);
      }
    });

  // omni auth status
  auth
    .command('status')
    .description('Show current authentication status')
    .action(async () => {
      const config = loadConfig();

      if (!config.apiKey) {
        output.error('Not logged in. Run: omni auth login --api-key <key>', undefined, 2);
      }

      // Type guard: output.error is never, so apiKey is guaranteed here
      const apiKey = config.apiKey;

      const client = createOmniClient({
        baseUrl: config.apiUrl ?? 'http://localhost:8882',
        apiKey,
      });

      try {
        const result = await client.auth.validate();

        if (!result.valid) {
          output.error('API key is invalid or expired', undefined, 2);
        }

        output.data({
          status: 'authenticated',
          apiUrl: config.apiUrl,
          keyName: result.keyName,
          keyPrefix: result.keyPrefix,
          scopes: result.scopes,
          configDir: getConfigDir(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to validate API key: ${message}`, undefined, 2);
      }
    });

  // omni auth logout
  auth
    .command('logout')
    .description('Clear stored credentials')
    .action(() => {
      deleteConfigValue('apiKey');
      output.success('Logged out successfully');
    });

  // omni auth recover
  auth
    .command('recover')
    .description('Recover API key when keyValid shows no (requires local PM2 access)')
    .option('--api-url <url>', 'API base URL (default: http://localhost:8882)')
    .option('--rotate', 'Generate a new key instead of recovering the existing one')
    .action(async (options: { apiUrl?: string; rotate?: boolean }) => {
      const config = loadConfig();
      const apiUrl = options.apiUrl ?? config.apiUrl ?? 'http://localhost:8882';
      const shouldRotate = options.rotate === true;

      output.raw('');
      output.raw('  Recovering API key...');
      output.raw('');

      const pm2Available = await isPm2Available();
      if (!pm2Available) {
        output.warn('PM2 is not available in PATH.');
        printManualInstructions();
        output.error('Cannot auto-recover without PM2. Follow manual steps above.', undefined, 1);
      }

      if (!shouldRotate) {
        const recovered = await tryRecoverFromPm2Env(apiUrl, options.apiUrl);
        if (recovered) {
          return;
        }
      }

      await rotateApiKey(apiUrl, options.apiUrl);
    });

  return auth;
}
