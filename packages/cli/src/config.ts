/**
 * CLI Configuration Management
 *
 * Stores config in ~/.omni/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/** Command visibility categories */
export type CommandCategory = 'core' | 'standard' | 'advanced' | 'debug';

/** Server-side configuration */
export interface ServerConfig {
  port: number;
  databaseUrl: string;
  dataDir: string;
  logLevel: string;
  nodeEnv: string;
  /**
   * When true, omni-api connects to an externally-managed canonical pgserve
   * (the one registered by `pgserve install` from pgserve@^2.1.0) and SKIPS
   * its embedded pgserve startup path. Persisted by `omni install` (default
   * true on fresh installs; preserved on reinstalls) and by
   * `omni doctor --fix` when migrating an embedded install onto canonical.
   *
   * Default behavior on legacy configs (field absent): treated as false →
   * embedded mode continues. Operators migrate via `omni doctor --fix`.
   */
  useCanonicalPgserve?: boolean;
}

/** Valid config keys (top-level and dot-notation server.* keys) */
export type ConfigKey =
  | 'apiUrl'
  | 'apiKey'
  | 'defaultInstance'
  | 'format'
  | 'showCommands'
  | 'telemetry'
  | 'updateChannel'
  | 'server.port'
  | 'server.databaseUrl'
  | 'server.dataDir'
  | 'server.logLevel'
  | 'server.nodeEnv';

/**
 * A single named REMOTE target (an Omni API server the CLI talks to).
 *
 * NOTE the naming trap: `ServerEntry` / the `servers` block is the *remote
 * target registry*. The unrelated `ServerConfig` / `server.*` namespace above
 * is the **local** omni-api runtime (port, database, data dir) that gets fed
 * to PM2 by `runtime-env.ts`. They must never be conflated — restarting the
 * local API with a remote server's API key is the failure mode this split
 * exists to prevent.
 */
export interface ServerEntry {
  url: string;
  apiKey?: string;
}

/** Named remote-server registry plus the active pointer */
export interface ServersConfig {
  active: string;
  list: Record<string, ServerEntry>;
}

/** Name of the entry that always maps to the LOCAL omni-api runtime */
export const DEFAULT_SERVER_NAME = 'default';

/** Zod schema for a single server entry (config.json is user-editable) */
const ServerEntrySchema = z.object({
  url: z.string().min(1),
  apiKey: z.string().optional(),
});

/** Zod schema for the whole `servers` block */
const ServersConfigSchema = z.object({
  active: z.string().min(1),
  list: z.record(z.string(), ServerEntrySchema),
});

/** Config file structure */
export interface Config {
  apiUrl?: string;
  apiKey?: string;
  defaultInstance?: string;
  format?: 'human' | 'json';
  showCommands?: string; // 'all' or comma-separated categories
  telemetry?: string; // 'true' or 'false' — error telemetry via Sentry
  updateChannel?: 'latest' | 'next';
  server?: Partial<ServerConfig>;
  /**
   * Remote-server registry. Managed exclusively by `omni server` — never by
   * `omni config set` (see {@link isServersConfigKey}), because `ConfigKey` is
   * a closed union whose masking rules are literal-keyed and dynamic
   * `servers.<name>.apiKey` entries would print unmasked.
   */
  servers?: ServersConfig;
}

/** Default API base URL — the locally managed omni-api */
const DEFAULT_API_URL = 'http://localhost:8882';

/** Default config values */
const DEFAULT_CONFIG: Config = {
  apiUrl: DEFAULT_API_URL,
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
  telemetry: {
    description: 'Error telemetry via Sentry (default: true)',
    values: ['true', 'false'],
  },
  updateChannel: {
    description: 'Update track for omni update (latest=stable, next=dev builds)',
    values: ['latest', 'next'],
  },
  'server.port': { description: 'Server port (default: 8882)' },
  'server.databaseUrl': { description: 'PostgreSQL connection URL' },
  'server.dataDir': { description: 'Data directory for pgserve (PostgreSQL) and media storage' },
  'server.logLevel': {
    description: 'Log level',
    values: ['debug', 'info', 'warn', 'error'],
  },
  'server.nodeEnv': {
    description: 'Node environment',
    values: ['production', 'development'],
  },
};

/** Get config directory path */
export function getConfigDir(): string {
  return process.env.OMNI_CONFIG_DIR ?? join(homedir(), '.omni');
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

// ----------------------------------------------------------------------------
// Server registry: validation, migration, resolution
// ----------------------------------------------------------------------------

/**
 * Env key carrying the per-invocation `--server <name>` override.
 *
 * Uses `process.env` rather than a module-level variable for the same reason
 * as {@link setRuntimeFormat}: the CLI is bundled and this module can end up
 * duplicated, so a module-scoped value set by the entrypoint would not be seen
 * by the copy a command imports.
 */
const RUNTIME_SERVER_ENV = '__OMNI_RUNTIME_SERVER';

/** Warnings are emitted at most once per process — `loadConfig()` is hot. */
const warnedMessages = new Set<string>();

/**
 * Clear the once-per-process warning dedupe set.
 *
 * Test-only: the set is module-global, so without this a warning asserted by
 * one test is swallowed in every later test in the same process.
 */
export function resetConfigWarnings(): void {
  warnedMessages.clear();
}

/**
 * Emit a config warning on stderr.
 *
 * Deliberately does NOT use `output.ts`: `output.ts` imports `getOutputFormat`
 * from this module, so importing it here would be a cycle. stderr keeps
 * `--json` stdout parseable.
 */
function warnConfig(message: string): void {
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);
  process.stderr.write(`omni: config warning — ${message}\n`);
}

/**
 * Validate the raw `servers` block, dropping individual invalid entries rather
 * than failing the whole load. Returns undefined when nothing salvageable is
 * left, in which case the caller falls back to the legacy flat fields.
 */
function sanitizeServers(raw: unknown): ServersConfig | undefined {
  if (raw === undefined || raw === null) return undefined;

  const whole = ServersConfigSchema.safeParse(raw);
  if (whole.success && whole.data.list[whole.data.active]) {
    return whole.data;
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnConfig('"servers" is not an object — ignoring it and using the legacy apiUrl/apiKey fields');
    return undefined;
  }

  const rec = raw as { active?: unknown; list?: unknown };
  const list: Record<string, ServerEntry> = {};
  if (rec.list && typeof rec.list === 'object' && !Array.isArray(rec.list)) {
    for (const [name, entry] of Object.entries(rec.list as Record<string, unknown>)) {
      const parsed = ServerEntrySchema.safeParse(entry);
      if (name.length > 0 && parsed.success) {
        list[name] = parsed.data;
      } else {
        warnConfig(`dropping invalid server entry "${name}" from ~/.omni/config.json`);
      }
    }
  }

  const names = Object.keys(list);
  if (names.length === 0) {
    warnConfig('"servers" has no valid entries — falling back to the legacy apiUrl/apiKey fields');
    return undefined;
  }

  if (typeof rec.active === 'string' && list[rec.active]) {
    return { active: rec.active, list };
  }
  const active = list[DEFAULT_SERVER_NAME] ? DEFAULT_SERVER_NAME : names[0];
  warnConfig(`active server "${String(rec.active)}" is unknown — falling back to "${active}"`);
  return { active, list };
}

/**
 * Lazy migration: derive the `servers` block from a config that predates it by
 * lifting the flat `apiUrl`/`apiKey` into a `default` entry. Idempotent — an
 * already-migrated config is returned as-is.
 */
function deriveServers(config: Config): ServersConfig {
  if (config.servers?.list[config.servers.active]) {
    return config.servers;
  }
  const entry: ServerEntry = { url: config.apiUrl ?? DEFAULT_API_URL };
  if (config.apiKey) entry.apiKey = config.apiKey;
  return { active: DEFAULT_SERVER_NAME, list: { [DEFAULT_SERVER_NAME]: entry } };
}

/** Set the per-invocation server override (from the global `--server` flag) */
export function setRuntimeServer(name: string): void {
  process.env[RUNTIME_SERVER_ENV] = name;
}

/** Read the per-invocation server override, if any (internal to this module) */
function getRuntimeServer(): string | undefined {
  const name = process.env[RUNTIME_SERVER_ENV];
  return name && name.length > 0 ? name : undefined;
}

/** Clear the per-invocation server override (tests / long-lived processes) */
export function clearRuntimeServer(): void {
  delete process.env[RUNTIME_SERVER_ENV];
}

/**
 * Name of the entry commands should talk to: the `--server` override when it
 * names a known entry, otherwise the persisted active pointer. The override is
 * never written back to disk.
 */
function resolveActiveName(servers: ServersConfig): string {
  const override = getRuntimeServer();
  if (override) {
    if (servers.list[override]) return override;
    warnConfig(`unknown server "${override}" — using the active entry "${servers.active}" instead`);
  }
  return servers.list[servers.active] ? servers.active : DEFAULT_SERVER_NAME;
}

/** Read + parse the config file with defaults merged. No server resolution. */
function readRawConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Config;
    const merged: Config = { ...DEFAULT_CONFIG, ...parsed };
    const servers = sanitizeServers((parsed as { servers?: unknown }).servers);
    if (servers) {
      merged.servers = servers;
    } else {
      merged.servers = undefined;
    }
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Project the named entry onto the effective flat `apiUrl`/`apiKey` fields. */
function projectEntry(raw: Config, servers: ServersConfig, name: string): Config {
  const entry = servers.list[name];
  if (!entry) {
    // Only reachable for the LOCAL accessor when `default` was removed. The
    // on-disk flat fields are not trustworthy here (an older file may mirror
    // whatever entry was active when it was written), so fall back to the
    // local defaults with NO credential rather than risk handing a remote key
    // to the local runtime.
    return { ...raw, servers, apiUrl: DEFAULT_API_URL, apiKey: undefined };
  }
  return { ...raw, servers, apiUrl: entry.url, apiKey: entry.apiKey };
}

/**
 * Load config with the ACTIVE server entry resolved into `apiUrl`/`apiKey`.
 *
 * This is the accessor for every client-facing path: the ~30 call sites that
 * read `config.apiUrl` / `config.apiKey` directly become multi-server-aware
 * without changing. Local-runtime paths must use
 * {@link loadLocalRuntimeConfig} instead.
 */
export function loadConfig(): Config {
  const raw = readRawConfig();
  const servers = deriveServers(raw);
  return projectEntry(raw, servers, resolveActiveName(servers));
}

/**
 * Load config with the LOCAL (`default`) entry resolved into
 * `apiUrl`/`apiKey`, regardless of which server is active.
 *
 * Use this for anything that configures or probes the locally managed
 * omni-api process — `buildRuntimeEnv`, `start`, `restart`, `update`,
 * `install`, `doctor`, `auth recover`. Resolving the active entry there would
 * bake a remote server's key into the local PM2 process and make doctor's
 * env-drift check report permanent drift.
 */
export function loadLocalRuntimeConfig(): Config {
  const raw = readRawConfig();
  const servers = deriveServers(raw);
  return projectEntry(raw, servers, DEFAULT_SERVER_NAME);
}

/**
 * Canonical form of a server base URL: trimmed, trailing slashes removed.
 *
 * Duplicated from `signing.ts:normalizeServerUrl` on purpose — `signing.ts`
 * imports THIS module (`loadLocalRuntimeConfig`), so importing back would be a
 * cycle. The two must stay byte-identical in behavior: signing looks a server
 * up by its normalized URL, so an entry saved with a different spelling
 * (`https://api.example.com/` vs `…com`) silently stops being signed.
 */
function normalizeEntryUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Write the effective `apiUrl`/`apiKey` back into the named server entry. */
function syncEffectiveIntoEntry(config: Config, name: string): Config {
  const servers = deriveServers(config);
  const previous = servers.list[name];
  // `omni config unset apiUrl` DELETES the key (see {@link deleteConfigValue}),
  // and an absent key is an explicit clear: reverting to `previous.url` here
  // would silently restore the value the operator just unset.
  const cleared = !('apiUrl' in config);
  const entry: ServerEntry = {
    url: normalizeEntryUrl(cleared ? DEFAULT_API_URL : (config.apiUrl ?? previous?.url ?? DEFAULT_API_URL)),
  };
  if (config.apiKey) entry.apiKey = config.apiKey;
  const list = { ...servers.list, [name]: entry };
  // The flat fields are a back-compat mirror for older CLI builds — which feed
  // them straight into the LOCAL runtime — so they must always mirror the
  // `default` entry and never a remote one, whatever entry this save targeted.
  const local = list[DEFAULT_SERVER_NAME];
  return {
    ...config,
    apiUrl: local?.url ?? DEFAULT_API_URL,
    apiKey: local?.apiKey,
    // `active` is intentionally carried over untouched: a `--server` override
    // targets an entry for one invocation and must never be persisted.
    servers: { active: servers.active, list },
  };
}

function writeConfigFile(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Save config, mirroring the effective `apiUrl`/`apiKey` into the entry the
 * command was targeting (active entry, or the `--server` override). The flat
 * fields are kept on disk as a back-compat mirror for older CLI builds — of
 * the `default` (local) entry only, never of a remote one.
 */
export function saveConfig(config: Config): void {
  const servers = deriveServers(config);
  writeConfigFile(syncEffectiveIntoEntry(config, resolveActiveName(servers)));
}

/**
 * Save config, mirroring `apiUrl`/`apiKey` into the LOCAL (`default`) entry.
 * Counterpart of {@link loadLocalRuntimeConfig} — used by `install` and
 * `doctor`'s key rotation, which configure the local runtime and must not
 * write to whichever remote server happens to be active.
 */
export function saveLocalRuntimeConfig(config: Config): void {
  writeConfigFile(syncEffectiveIntoEntry(config, DEFAULT_SERVER_NAME));
}

/**
 * Read the remote-server registry (sanitized, with the legacy flat fields
 * lifted into a `default` entry when the config predates the block).
 *
 * Accessor for `omni server` — every other path should go through
 * {@link loadConfig} / {@link loadLocalRuntimeConfig}.
 */
export function loadServers(): ServersConfig {
  return deriveServers(readRawConfig());
}

/**
 * Persist the remote-server registry wholesale.
 *
 * Counterpart of {@link loadServers}, used by `omni server add/use/remove`.
 * Mirrors the flat `apiUrl`/`apiKey` fields from the `default` entry only —
 * same back-compat contract as {@link saveConfig}, so a remote key can never
 * leak into the local runtime.
 */
export function saveServers(servers: ServersConfig): void {
  const raw = readRawConfig();
  const local = servers.list[DEFAULT_SERVER_NAME];
  writeConfigFile({
    ...raw,
    apiUrl: local?.url ?? DEFAULT_API_URL,
    apiKey: local?.apiKey,
    servers,
  });
}

/**
 * Name of the entry commands are currently targeting — the `--server`
 * override when set, otherwise the persisted active pointer.
 */
export function getTargetServerName(): string {
  return resolveActiveName(loadServers());
}

/** True when a `--server` override is in effect for this invocation. */
export function hasRuntimeServerOverride(): boolean {
  return getRuntimeServer() !== undefined;
}

/**
 * Mask an API key for display. Never returns the full key: values too short to
 * carry a recognizable prefix collapse to `***` rather than being echoed.
 */
export function maskConfigApiKey(key: string | undefined): string {
  if (!key) return '-';
  if (key.length <= 12) return '***';
  return `${key.slice(0, 12)}...`;
}

/** Active server entry with its key masked — for read-only display. */
export function describeActiveServer(): { name: string; url: string; maskedKey: string } {
  const raw = readRawConfig();
  const servers = deriveServers(raw);
  const name = resolveActiveName(servers);
  const entry = servers.list[name];
  return {
    name,
    url: entry?.url ?? DEFAULT_API_URL,
    maskedKey: maskConfigApiKey(entry?.apiKey),
  };
}

/**
 * True for keys that belong to the remote-server registry. These are rejected
 * by `omni config get/set/unset` — see {@link Config.servers}.
 */
export function isServersConfigKey(key: string): boolean {
  return key === 'servers' || key.startsWith('servers.');
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

  return config[key as keyof Omit<Config, 'server' | 'servers'>];
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

/** Validate a value against CONFIG_KEYS allowed values */
function validateConfigValue(key: ConfigKey, value: string): void {
  const meta = CONFIG_KEYS[key];
  if (!meta?.values) return;

  // showCommands accepts comma-separated categories
  if (key === 'showCommands') {
    const categories = value.split(',').map((c) => c.trim());
    for (const cat of categories) {
      if (!meta.values.includes(cat)) {
        throw new Error(`Invalid category: ${cat}. Valid: ${meta.values.join(', ')}`);
      }
    }
    return;
  }

  if (!meta.values.includes(value)) {
    throw new Error(`Invalid value for ${key}: ${value}. Must be one of: ${meta.values.join(', ')}`);
  }
}

/** Set a top-level config field */
function setTopLevelField(config: Config, key: ConfigKey, value: string): void {
  validateConfigValue(key, value);
  (config as Record<string, unknown>)[key] = value;
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

  // DELETE rather than assign undefined: `syncEffectiveIntoEntry` treats an
  // absent `apiUrl` key as an explicit clear (an assigned-undefined key is
  // indistinguishable from "not provided" and would be restored from the entry).
  delete (config as Record<string, unknown>)[key];
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
