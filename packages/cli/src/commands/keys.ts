/**
 * API Key Management Commands
 *
 * Create, list, update, revoke, and delete API keys.
 */

import type { ApiKeyRecord, ApiKeyStatus, OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveKeyId } from '../resolve.js';

// ============================================================================
// TYPES
// ============================================================================

interface CreateOptions {
  name: string;
  scopes: string;
  instances?: string;
  description?: string;
  rateLimit?: number;
  expires?: string;
}

interface ListOptions {
  status?: ApiKeyStatus;
  limit?: number;
}

interface UpdateOptions {
  name?: string;
  description?: string;
  scopes?: string;
  instances?: string;
  rateLimit?: number;
  expires?: string;
}

interface RevokeOptions {
  reason?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatKeyRow(key: ApiKeyRecord): Record<string, string> {
  return {
    id: key.id.slice(0, 8),
    name: key.name,
    status: key.status,
    scopes: key.scopes.join(', '),
    instances: key.instanceIds ? `${key.instanceIds.length} restricted` : 'all',
    created: new Date(key.createdAt).toLocaleDateString(),
    lastUsed: key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'never',
  };
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ============================================================================
// HANDLERS
// ============================================================================

async function handleCreate(client: OmniClient, options: CreateOptions): Promise<void> {
  const scopes = parseCommaSeparated(options.scopes);
  const instanceIds = options.instances ? parseCommaSeparated(options.instances) : undefined;

  const result = await client.keys.create({
    name: options.name,
    description: options.description,
    scopes,
    instanceIds,
    rateLimit: options.rateLimit,
    expiresAt: options.expires,
  });

  output.success(`API key created: ${result.name}`);

  // biome-ignore lint/suspicious/noConsole: CLI output — plaintext key display
  console.log(`\n  API Key (save this — it will NOT be shown again):\n\n  ${result.plainTextKey}\n`);

  output.info(`ID: ${result.id}`);
  output.info(`Scopes: ${result.scopes.join(', ')}`);
  if (result.instanceIds) {
    output.info(`Instances: ${result.instanceIds.join(', ')}`);
  }
  if (result.expiresAt) {
    output.info(`Expires: ${result.expiresAt}`);
  }
}

async function handleList(client: OmniClient, options: ListOptions): Promise<void> {
  const result = await client.keys.list({
    status: options.status,
    limit: options.limit,
  });

  if (result.items.length === 0) {
    output.info('No API keys found.');
    return;
  }

  const rows = result.items.map(formatKeyRow);
  output.list(rows);
}

async function handleGet(client: OmniClient, id: string): Promise<void> {
  const keyId = await resolveKeyId(id);
  const key = await client.keys.get(keyId);
  output.data(key);
}

async function handleUpdate(client: OmniClient, id: string, options: UpdateOptions): Promise<void> {
  const keyId = await resolveKeyId(id);
  const body: Record<string, unknown> = {};
  if (options.name !== undefined) body.name = options.name;
  if (options.description !== undefined) body.description = options.description;
  if (options.scopes !== undefined) body.scopes = parseCommaSeparated(options.scopes);
  if (options.instances !== undefined) {
    body.instanceIds = options.instances === '' ? null : parseCommaSeparated(options.instances);
  }
  if (options.rateLimit !== undefined) body.rateLimit = options.rateLimit;
  if (options.expires !== undefined) body.expiresAt = options.expires === '' ? null : options.expires;

  if (Object.keys(body).length === 0) {
    output.warn('No fields to update. Use --name, --scopes, --instances, etc.');
    return;
  }

  const updated = await client.keys.update(keyId, body);
  output.success(`API key updated: ${updated.name}`);
  output.data(updated);
}

async function handleRevoke(client: OmniClient, id: string, options: RevokeOptions): Promise<void> {
  const keyId = await resolveKeyId(id);
  const revoked = await client.keys.revoke(keyId, {
    reason: options.reason,
  });
  output.success(`API key revoked: ${revoked.name}`);
  if (options.reason) {
    output.info(`Reason: ${options.reason}`);
  }
}

async function handleDelete(client: OmniClient, id: string): Promise<void> {
  const keyId = await resolveKeyId(id);
  await client.keys.delete(keyId);
  output.success(`API key deleted: ${keyId}`);
}

// ============================================================================
// COMMAND
// ============================================================================

export function createKeysCommand(): Command {
  const keys = new Command('keys').description('Manage API keys');

  keys
    .command('create')
    .description('Create a new API key')
    .requiredOption('--name <name>', 'Key name')
    .requiredOption('--scopes <scopes>', 'Comma-separated scopes (e.g. messages:read,instances:write)')
    .option('--instances <ids>', 'Comma-separated instance IDs to restrict access')
    .option('--description <desc>', 'Key description')
    .option('--rate-limit <n>', 'Rate limit (requests/minute)', Number.parseInt)
    .option('--expires <date>', 'Expiration date (ISO 8601)')
    .action(async (options: CreateOptions) => {
      const client = getClient();
      try {
        await handleCreate(client, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create key: ${message}`);
      }
    });

  keys
    .command('list')
    .description('List API keys')
    .option('--status <status>', 'Filter by status (active, revoked, expired)')
    .option('--limit <n>', 'Max results', Number.parseInt)
    .action(async (options: ListOptions) => {
      const client = getClient();
      try {
        await handleList(client, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list keys: ${message}`);
      }
    });

  keys
    .command('get <id>')
    .description('Get API key details')
    .action(async (id: string) => {
      const client = getClient();
      try {
        await handleGet(client, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get key: ${message}`);
      }
    });

  keys
    .command('update <id>')
    .description('Update an API key')
    .option('--name <name>', 'New key name')
    .option('--description <desc>', 'New description')
    .option('--scopes <scopes>', 'New scopes (comma-separated)')
    .option('--instances <ids>', 'New instance IDs (comma-separated, empty string to unrestrict)')
    .option('--rate-limit <n>', 'New rate limit', Number.parseInt)
    .option('--expires <date>', 'New expiration (ISO 8601, empty string to clear)')
    .action(async (id: string, options: UpdateOptions) => {
      const client = getClient();
      try {
        await handleUpdate(client, id, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update key: ${message}`);
      }
    });

  keys
    .command('revoke <id>')
    .description('Revoke an API key')
    .option('--reason <reason>', 'Reason for revocation')
    .action(async (id: string, options: RevokeOptions) => {
      const client = getClient();
      try {
        await handleRevoke(client, id, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to revoke key: ${message}`);
      }
    });

  keys
    .command('delete <id>')
    .description('Permanently delete an API key')
    .action(async (id: string) => {
      const client = getClient();
      try {
        await handleDelete(client, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete key: ${message}`);
      }
    });

  return keys;
}
