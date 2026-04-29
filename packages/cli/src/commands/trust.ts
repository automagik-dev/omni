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

import { Command } from 'commander';
import { hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';

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

async function callApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(trustEndpoint(path), {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
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
