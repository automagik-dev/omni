/**
 * Trust Commands — manage genie host fingerprint registrations.
 *
 *   omni trust list                            List active genie hosts
 *   omni trust get <id>                        Show one host (active or revoked)
 *   omni trust update <id> --scope <a,b,c>     Replace host scopes wholesale
 *   omni trust revoke <id>                     Soft-delete (stamps revoked_at)
 *
 * Wish: omni-host-fingerprint-trust, Group 1.2. Talks to the
 * `/api/v2/trust/hosts` endpoints landed in Group 1.1 (#556).
 *
 * Why raw fetch instead of the OmniClient SDK: trust types aren't in the
 * OpenAPI spec yet (the SDK is generated from there). Adding them requires
 * a regen + version bump; out of scope for this PR. We use the same
 * baseUrl / apiKey the SDK uses, so behavior is identical.
 */

import { hostname as osHostname } from 'node:os';
import { Command } from 'commander';
import { exitNotAuthenticated } from '../client.js';
import { getTargetServerName, hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';
import {
  type OmniHostMetadata,
  bindingForServer,
  boundServerBindings,
  boundServerUrls,
  generateAndStoreKeypair,
  loadHostMetadata,
  loadSigningContextForServer,
  normalizeServerUrl,
  writeHostMetadata,
} from '../signing.js';

interface TrustHost {
  id: string;
  pubkey: string;
  hostname: string;
  capabilities: Record<string, unknown>;
  scopes: string[];
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Helpers
// ============================================================================

/** Base URL of the server this invocation targets (active entry or `--server`). */
function targetBaseUrl(): string {
  return normalizeServerUrl(loadConfig().apiUrl ?? 'http://localhost:8882');
}

function trustEndpoint(path: string): string {
  if (!hasAuth()) {
    exitNotAuthenticated();
  }
  return `${targetBaseUrl()}/api/v2/trust${path}`;
}

function authHeaders(): Record<string, string> {
  const config = loadConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

/**
 * If the operator has run `omni trust handshake` AGAINST THE TARGET SERVER,
 * this returns the signing context that adds the X-Genie-* headers to every
 * call. When no keypair exists locally — or the target server has never seen
 * this pubkey — it returns null and we go bearer-only, matching the behavior
 * before P0b shipped.
 *
 * Pulled out as a module-level lazy cache so we don't re-read the key
 * file on every API call within a single CLI invocation. The target server
 * cannot change mid-invocation (`--server` is resolved once, pre-Commander),
 * so a single-slot cache is sound.
 */
let _cachedSigningContext: ReturnType<typeof loadSigningContextForServer> | undefined;
function getSigningContextOnce(): ReturnType<typeof loadSigningContextForServer> {
  if (_cachedSigningContext === undefined) {
    _cachedSigningContext = loadSigningContextForServer(targetBaseUrl());
  }
  return _cachedSigningContext;
}

async function callApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = trustEndpoint(path);
  const bodyString = body === undefined ? '' : JSON.stringify(body);
  const headers = authHeaders();

  // Sign when keys are available. The verifier accepts the bearer alone
  // OR bearer + signature; the latter unlocks per-host scopes (group 5)
  // and per-instance lockdown (group 6). Trust handshake itself is
  // exempt from auth so we don't sign that one.
  const ctx = getSigningContextOnce();
  if (ctx && !path.startsWith('/handshake')) {
    const reqPath = new URL(url).pathname + new URL(url).search;
    const sigHeaders = ctx.signRequest(method, reqPath, bodyString);
    Object.assign(headers, sigHeaders);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : bodyString,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return (await res.json()) as T;
}

function formatHostRow(host: TrustHost): Record<string, string> {
  return {
    id: host.id.slice(0, 8),
    hostname: host.hostname,
    scopes: host.scopes.join(', ') || '(none)',
    pubkeyPrefix: `${host.pubkey.slice(0, 12)}…`,
    lastSeen: host.lastSeenAt ? new Date(host.lastSeenAt).toISOString().replace('T', ' ').slice(0, 16) : 'never',
    status: host.revokedAt ? 'revoked' : 'active',
  };
}

// ============================================================================
// Subcommand actions
// ============================================================================

async function handleList(): Promise<void> {
  try {
    const { items } = await callApi<{ items: TrustHost[] }>('GET', '/hosts');
    output.list(items.map(formatHostRow), {
      emptyMessage: 'No genie hosts registered. Run `genie omni handshake` from a genie installation to register one.',
      rawData: items,
    });
  } catch (err) {
    output.error(`Failed to list genie hosts: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

async function handleGet(id: string): Promise<void> {
  try {
    const { data } = await callApi<{ data: TrustHost }>('GET', `/hosts/${encodeURIComponent(id)}`);
    output.data(data);
  } catch (err) {
    output.error(`Failed to get genie host: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

async function handleUpdate(id: string, options: { scope: string }): Promise<void> {
  // Wholesale replace: operators provide the FULL new scope set.
  // Comma-separated string keeps the CLI ergonomic; the API takes an array.
  const scopes = options.scope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (scopes.length === 0) {
    output.error('--scope must contain at least one scope (use `omni trust revoke <id>` to deny everything).');
  }
  try {
    const { data } = await callApi<{ data: TrustHost }>('PATCH', `/hosts/${encodeURIComponent(id)}`, { scopes });
    output.success(`Updated genie host ${data.id} scopes: ${data.scopes.join(', ')}`);
    output.data(data);
  } catch (err) {
    output.error(`Failed to update genie host: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * POST the pubkey to the target server's handshake route.
 *
 * We DO NOT sign this request — the server-side handshake route is auth-exempt
 * by design (it's how new hosts bootstrap) and idempotent, so re-posting an
 * existing pubkey to a second server registers it there without rotating.
 */
async function registerPubkey(
  pubkey: string,
  hostname: string,
): Promise<{ id: string; pubkey: string; hostname: string }> {
  try {
    const res = await callApi<{ data: { id: string; pubkey: string; hostname: string } }>('POST', '/handshake', {
      pubkey,
      hostname,
      capabilities: {
        client: 'omni-cli',
        platform: process.platform,
        nodeVersion: process.version,
      },
    });
    return res.data;
  } catch (err) {
    return output.error(`Handshake failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleHandshake(options: { rotate?: boolean; hostname?: string }): Promise<void> {
  const targetUrl = targetBaseUrl();
  const serverName = getTargetServerName();
  const existing = loadHostMetadata();

  if (existing && !options.rotate) {
    const bindings = boundServerBindings(existing);
    const bound = boundServerUrls(existing);
    const alreadyBound = bindingForServer(existing, targetUrl);

    // Already bound to THIS server — nothing to do. Say which servers are
    // covered: signing is per-server, so an operator with several entries must
    // know that the rest are still going out bearer-only.
    if (alreadyBound) {
      output.success(
        `Already handshook as host ${alreadyBound.hostId} for server '${serverName}' (${targetUrl}). Bound servers: ${bound.join(', ')} (each with its own host id). Requests to any other server entry are sent UNSIGNED (bearer only) — run \`omni trust handshake --server <name>\` there to bind it. Pass --rotate to issue a new keypair.`,
      );
      return;
    }

    // New server, existing key: register the SAME pubkey. Rotating here would
    // invalidate the keypair on every server already bound to it. The id this
    // server issues is stored ON THE BINDING — the top-level `hostId` belongs
    // to the first server and stamping this one over it would make every
    // request to the servers already bound 401 as an unknown host.
    const registered = await registerPubkey(existing.pubkey, options.hostname ?? existing.hostname);
    const meta: OmniHostMetadata = {
      ...existing,
      pubkey: registered.pubkey,
      boundServers: [...bindings, { url: targetUrl, hostId: registered.id }],
    };
    writeHostMetadata(meta);

    output.success(`Bound existing host key to server '${serverName}' (${targetUrl}) — no rotation.`);
    output.data({
      hostId: registered.id,
      hostname: meta.hostname,
      pubkey: meta.pubkey,
      boundServers: meta.boundServers,
      rotated: false,
    });
    return;
  }

  // Generate the keypair (overwrites prior keys when --rotate is set —
  // intentional; rotation is "revoke + re-register with a new key" per
  // the wish's decision record). Rotation resets the binding list: servers
  // bound to the OLD key have never seen this one.
  const { pubkeyB64Url } = generateAndStoreKeypair();
  const hostname = options.hostname ?? osHostname();
  const registered = await registerPubkey(pubkeyB64Url, hostname);

  const meta: OmniHostMetadata = {
    hostId: registered.id,
    pubkey: registered.pubkey,
    hostname: registered.hostname,
    registeredAt: new Date().toISOString(),
    boundServers: [{ url: targetUrl, hostId: registered.id }],
  };
  writeHostMetadata(meta);

  output.success(`Operator-host registered: ${meta.hostId} (server: ${serverName})`);
  output.data({
    hostId: meta.hostId,
    hostname: meta.hostname,
    pubkey: meta.pubkey,
    boundServers: meta.boundServers,
    keysDir: '~/.omni/keys/',
    nextStep: `Calls to '${serverName}' will now be signed automatically; other server entries stay bearer-only until you run \`omni trust handshake --server <name>\` against them. Run \`omni trust list\` to verify (lastSeenAt should advance after subsequent calls).`,
  });
}

async function handleRevoke(id: string): Promise<void> {
  try {
    const { data } = await callApi<{ data: TrustHost }>('DELETE', `/hosts/${encodeURIComponent(id)}`);
    output.success(`Revoked genie host ${data.id} (${data.hostname}). Tombstone kept for audit.`);
    output.data(data);
  } catch (err) {
    output.error(`Failed to revoke genie host: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// ============================================================================
// Command factory
// ============================================================================

export function createTrustCommand(): Command {
  const trust = new Command('trust').description('Manage genie host fingerprint registrations');

  trust
    .command('handshake')
    .description(
      'Register THIS omni CLI as a host with the targeted server (mints ed25519 keypair in ~/.omni/keys/ on first run; later servers reuse it).',
    )
    .addHelpText(
      'after',
      `
Signing is per-server: only servers you have handshaken against recognize this
keypair, so calls to other entries stay bearer-only. Bind another one with:
  omni trust handshake --server <name>
`,
    )
    .option('--rotate', 'Issue a new keypair even if one already exists (unbinds every previously bound server)')
    .option('--hostname <name>', 'Override the hostname reported to omni (defaults to os.hostname())')
    .action(handleHandshake);

  trust.command('list').description('List active (non-revoked) genie hosts').action(handleList);

  trust.command('get <id>').description('Show details for one genie host (active or revoked)').action(handleGet);

  trust
    .command('update <id>')
    .description('Replace a genie host scopes (comma-separated)')
    .requiredOption('--scope <list>', 'Comma-separated scope list, e.g. "agents:write,providers:write"')
    .action(handleUpdate);

  trust
    .command('revoke <id>')
    .description('Revoke a genie host (irreversible — re-register with a fresh keypair to restore trust)')
    .action(handleRevoke);

  return trust;
}
