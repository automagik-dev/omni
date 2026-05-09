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
import { hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';
import { type OmniHostMetadata, generateAndStoreKeypair, loadSigningContext, writeHostMetadata } from '../signing.js';

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

function trustEndpoint(path: string): string {
  if (!hasAuth()) {
    output.error('Not authenticated. Run: omni auth login --api-key <key>', undefined, 2);
  }
  const config = loadConfig();
  const baseUrl = (config.apiUrl ?? 'http://localhost:8882').replace(/\/+$/, '');
  return `${baseUrl}/api/v2/trust${path}`;
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
 * If the operator has run `omni trust handshake`, this returns the
 * signing context that adds the X-Genie-* headers to every call. When no
 * keypair exists locally, it returns null and we go bearer-only — matches
 * the behavior before P0b shipped, no surprise lockout for operators
 * who haven't migrated yet.
 *
 * Pulled out as a module-level lazy cache so we don't re-read the key
 * file on every API call within a single CLI invocation.
 */
let _cachedSigningContext: ReturnType<typeof loadSigningContext> | undefined;
function getSigningContextOnce(): ReturnType<typeof loadSigningContext> {
  if (_cachedSigningContext === undefined) {
    _cachedSigningContext = loadSigningContext();
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

async function handleHandshake(options: { rotate?: boolean; hostname?: string }): Promise<void> {
  // Refuse to clobber an existing handshake unless --rotate. Quietly
  // re-using the existing one is the right behavior — handshakes are
  // idempotent on the server side too — but we want operators to know
  // when nothing changed.
  const existing = loadSigningContext();
  if (existing && !options.rotate) {
    output.success(`Already handshook as host ${existing.hostId}. Pass --rotate to issue a new keypair.`);
    return;
  }

  // Generate the keypair (overwrites prior keys when --rotate is set —
  // intentional; rotation is "revoke + re-register with a new key" per
  // the wish's decision record).
  const { pubkeyB64Url } = generateAndStoreKeypair();
  const hostname = options.hostname ?? osHostname();
  const capabilities = {
    client: 'omni-cli',
    platform: process.platform,
    nodeVersion: process.version,
  };

  // Hit the handshake endpoint. Note we DO NOT sign this request — the
  // server-side handshake route is auth-exempt by design (it's how new
  // hosts bootstrap), and we don't yet have a host_id to put in the
  // signing headers.
  let registered: { id: string; pubkey: string; hostname: string };
  try {
    registered = await callApi<{ data: { id: string; pubkey: string; hostname: string } }>('POST', '/handshake', {
      pubkey: pubkeyB64Url,
      hostname,
      capabilities,
    }).then((r) => r.data);
  } catch (err) {
    output.error(`Handshake failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const meta: OmniHostMetadata = {
    hostId: registered.id,
    pubkey: registered.pubkey,
    hostname: registered.hostname,
    registeredAt: new Date().toISOString(),
  };
  writeHostMetadata(meta);

  output.success(`Operator-host registered: ${meta.hostId}`);
  output.data({
    hostId: meta.hostId,
    hostname: meta.hostname,
    pubkey: meta.pubkey,
    keysDir: '~/.omni/keys/',
    nextStep:
      'Future omni CLI calls will sign requests automatically. Run `omni trust list` to verify (lastSeenAt should advance after subsequent calls).',
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
      'Register THIS omni CLI as a host (mints ed25519 keypair in ~/.omni/keys/, future API calls auto-sign).',
    )
    .option('--rotate', 'Issue a new keypair even if one already exists')
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
