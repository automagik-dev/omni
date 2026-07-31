/**
 * Server Commands — manage the REMOTE server registry.
 *
 *   omni server add <name> <url> [--api-key <key>]   Register a server
 *   omni server list [--reveal]                      List registered servers
 *   omni server use <name>                           Switch the active server
 *   omni server remove <name> [--force]              Drop a server
 *   omni server current                              Show the targeted server
 *
 * Wish: multi-server-management, Group 2.
 *
 * NAMING TRAP: this command manages the servers the CLI TALKS TO. The
 * unrelated `omni config set server.*` namespace configures the LOCAL
 * omni-api runtime this machine supervises (port, database, data dir). They
 * are never the same thing — see `ServerEntry` vs `ServerConfig` in config.ts.
 *
 * There is deliberately no `omni server health`: reachability is verified as
 * part of `add`, and live status for the targeted server is `omni status`.
 */

import { createOmniClient } from '@omni/sdk';
import { Command } from 'commander';
import {
  DEFAULT_SERVER_NAME,
  type ServerEntry,
  type ServersConfig,
  describeActiveServer,
  hasRuntimeServerOverride,
  loadServers,
  maskConfigApiKey,
  saveServers,
} from '../config.js';
import * as output from '../output.js';
import { normalizeServerUrl } from '../signing.js';
import { VERSION } from '../version.js';

// ============================================================================
// Helpers
// ============================================================================

/** Sorted entry names — used in every "unknown server" error. */
function knownNames(servers: ServersConfig): string[] {
  return Object.keys(servers.list).sort();
}

/** Abort naming the entries that DO exist. Guessing a name is the #1 error. */
function exitUnknownServer(name: string, servers: ServersConfig): never {
  return output.error(`Unknown server '${name}'`, { knownServers: knownNames(servers) });
}

/** Row shape for `list` / `current`, with the key masked unless revealed. */
function toRow(
  name: string,
  entry: ServerEntry,
  servers: ServersConfig,
  reveal: boolean,
): Record<string, string | boolean> {
  return {
    name,
    url: entry.url,
    apiKey: reveal ? (entry.apiKey ?? '-') : maskConfigApiKey(entry.apiKey),
    active: name === servers.active,
  };
}

/**
 * Outcome of probing a candidate server before it is persisted.
 *
 * `unreachable` and `unauthorized` are kept distinct because the operator fix
 * is completely different: a wrong URL / down server versus a wrong key.
 */
type VerifyResult = { ok: true } | { ok: false; kind: 'unreachable' | 'unauthorized'; detail: string };

/**
 * Probe a candidate server: reachability via the (auth-exempt) health endpoint
 * first, then key validity. Ordering matters — a dead host would otherwise
 * surface as "unauthorized" and send the operator hunting for the wrong bug.
 */
/**
 * Reachability probe against the auth-exempt health endpoint, with NO
 * credentials attached.
 *
 * Raw fetch rather than the SDK client on purpose: the client demands a
 * non-empty apiKey, so a keyless `add` used to hand it the literal placeholder
 * 'unset'. It also surfaces every non-2xx as a throw, which flattened an
 * auth-gated health route into "unreachable" and sent the operator hunting for
 * a network problem instead of a key problem.
 */
async function probeHealth(url: string): Promise<VerifyResult> {
  let res: Response;
  try {
    res = await fetch(`${url}/api/v2/health`, {
      // Accept-Encoding: identity mirrors the SDK — Bun/Hono gzip interop.
      headers: { 'Accept-Encoding': 'identity', 'x-omni-cli-version': VERSION },
    });
  } catch (err) {
    return { ok: false, kind: 'unreachable', detail: err instanceof Error ? err.message : String(err) };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: 'unauthorized', detail: `the health endpoint requires credentials (HTTP ${res.status})` };
  }
  if (!res.ok) {
    return { ok: false, kind: 'unreachable', detail: `health check returned HTTP ${res.status} ${res.statusText}` };
  }
  return { ok: true };
}

async function verifyServer(url: string, apiKey: string | undefined): Promise<VerifyResult> {
  const reachable = await probeHealth(url);
  if (!reachable.ok) {
    return reachable;
  }

  if (!apiKey) {
    return { ok: true };
  }

  // Key validity still goes through the SDK, which is the authority on how the
  // CLI authenticates for real requests.
  const client = createOmniClient({ baseUrl: url, apiKey, cliVersion: VERSION });

  try {
    const result = await client.auth.validate();
    if (!result.valid) {
      return { ok: false, kind: 'unauthorized', detail: 'the API reported the key as invalid' };
    }
  } catch (err) {
    return { ok: false, kind: 'unauthorized', detail: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true };
}

/** Abort with a message that distinguishes "wrong URL" from "wrong key". */
function exitVerificationFailed(name: string, url: string, failure: Extract<VerifyResult, { ok: false }>): never {
  const message =
    failure.kind === 'unreachable'
      ? `Server '${name}' is unreachable at ${url}: ${failure.detail}`
      : `Server '${name}' rejected the API key (unauthorized): ${failure.detail}`;
  return output.error(message, {
    hint: 'Fix the value, or pass --skip-verify to register the entry anyway.',
  });
}

// ============================================================================
// Subcommand actions
// ============================================================================

interface AddOptions {
  apiKey?: string;
  skipVerify?: boolean;
  use?: boolean;
}

async function handleAdd(rawName: string, url: string, options: AddOptions): Promise<void> {
  // Trim BEFORE both validation and persistence: storing the untrimmed spelling
  // while validating the trimmed one creates an entry whose name no lookup
  // (`--server`, `use`, `remove`) can ever type.
  const name = rawName.trim();
  if (name.length === 0) {
    output.error('Server name must not be empty');
  }

  const servers = loadServers();
  const normalized = normalizeServerUrl(url);

  if (!options.skipVerify) {
    const verified = await verifyServer(normalized, options.apiKey);
    if (!verified.ok) {
      exitVerificationFailed(name, normalized, verified);
    }
  }

  const entry: ServerEntry = { url: normalized };
  if (options.apiKey) entry.apiKey = options.apiKey;

  const existed = servers.list[name] !== undefined;
  const next: ServersConfig = {
    active: options.use ? name : servers.active,
    list: { ...servers.list, [name]: entry },
  };
  saveServers(next);

  if (!options.apiKey) {
    output.warn(`No API key stored for '${name}'. Run: omni auth login --server ${name} --api-key <key>`);
  }

  output.success(existed ? `Updated server '${name}'` : `Added server '${name}'`, {
    name,
    url: normalized,
    apiKey: maskConfigApiKey(entry.apiKey),
    verified: options.skipVerify !== true,
    active: next.active === name,
  });
}

function handleList(options: { reveal?: boolean }): void {
  const servers = loadServers();
  const rows = knownNames(servers).map((name) => toRow(name, servers.list[name], servers, options.reveal === true));
  // No `rawData`: the masked rows ARE the machine-readable payload. Handing
  // `output.list` the raw entries would leak full keys in --json mode.
  output.list(rows, { emptyMessage: 'No servers registered. Add one with: omni server add <name> <url>' });
}

function handleUse(name: string): void {
  const servers = loadServers();
  if (!servers.list[name]) {
    exitUnknownServer(name, servers);
  }

  saveServers({ active: name, list: servers.list });
  const entry = servers.list[name];
  output.success(`Active server is now '${name}' (${entry.url})`, {
    name,
    url: entry.url,
    apiKey: maskConfigApiKey(entry.apiKey),
  });
}

/** Pick the entry to fall back to when the ACTIVE one is force-removed. */
function pickFallbackActive(remaining: Record<string, ServerEntry>): string {
  if (remaining[DEFAULT_SERVER_NAME]) return DEFAULT_SERVER_NAME;
  return Object.keys(remaining).sort()[0];
}

function handleRemove(name: string, options: { force?: boolean }): void {
  const servers = loadServers();
  if (!servers.list[name]) {
    exitUnknownServer(name, servers);
  }

  const remaining = { ...servers.list };
  delete remaining[name];

  // Removing the last entry would leave the registry empty and force the next
  // load to re-derive one from the legacy flat fields, emitting a warning on
  // every command. Refuse instead — `omni server add` can replace it in place.
  if (Object.keys(remaining).length === 0) {
    output.error(`Cannot remove '${name}': it is the only registered server`, {
      hint: `Point it somewhere else instead: omni server add ${name} <url>`,
    });
  }

  if (name === servers.active && !options.force) {
    output.error(`Cannot remove '${name}': it is the active server`, {
      hint: `Switch first (omni server use <name>), or pass --force to remove it and fall back to '${pickFallbackActive(remaining)}'.`,
    });
  }

  const active = name === servers.active ? pickFallbackActive(remaining) : servers.active;
  saveServers({ active, list: remaining });

  if (name === DEFAULT_SERVER_NAME) {
    output.warn(
      `Removed the '${DEFAULT_SERVER_NAME}' entry — local runtime commands (start/restart/doctor) fall back to http://localhost:8882 with no API key.`,
    );
  }

  output.success(`Removed server '${name}'`, { removed: name, active });
}

function handleCurrent(): void {
  const servers = loadServers();
  const target = describeActiveServer();
  output.data({
    name: target.name,
    url: target.url,
    apiKey: target.maskedKey,
    // The persisted pointer, which a `--server` override does NOT change.
    active: servers.active,
    overridden: hasRuntimeServerOverride(),
  });
}

// ============================================================================
// Command factory
// ============================================================================

export function createServerCommand(): Command {
  const server = new Command('server').description('Manage the registry of Omni servers this CLI talks to').addHelpText(
    'after',
    `
Not to be confused with 'omni config set server.*', which configures the LOCAL
omni-api runtime (port, database, data dir) this machine supervises.

Target one entry for a single command with the global flag:
  omni --server <name> instances list
`,
  );

  server
    .command('add <name> <url>')
    .description('Register a server (verifies reachability and key before saving)')
    .option('--api-key <key>', 'API key for this server')
    .option('--skip-verify', 'Save the entry without probing the server first')
    .option('--use', 'Also make this the active server')
    .action(handleAdd);

  server
    .command('list')
    .description('List registered servers (API keys masked)')
    .option('--reveal', 'Print full API keys instead of masked prefixes')
    .action(handleList);

  server.command('use <name>').description('Set the active server for subsequent commands').action(handleUse);

  server
    .command('remove <name>')
    .alias('rm')
    .description('Remove a registered server')
    .option('--force', 'Remove even when it is the active server (falls back to another entry)')
    .action(handleRemove);

  server.command('current').description('Show the server commands are currently targeting').action(handleCurrent);

  return server;
}
