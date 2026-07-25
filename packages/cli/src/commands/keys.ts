/**
 * API Key Management Commands
 *
 * Create, list, update, revoke, and delete API keys.
 *
 * Profile-based creation (`--profile`) delegates scope resolution and lock
 * validation to the API. The `--profile admin` path is the single exception:
 * the API route refuses admin keys unconditionally (god-keys are human-gated
 * by construction), so the CLI handles admin creation directly against the
 * database and only after the operator types `I UNDERSTAND` on an
 * interactive TTY. Any non-TTY invocation (pipe, redirect, CI) is refused.
 */

import type { ApiKeyRecord, ApiKeyStatus, OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveKeyId } from '../resolve.js';

// ============================================================================
// TYPES
// ============================================================================

type ProfileFlag = 'cs' | 'personal' | 'scout' | 'coworker' | 'admin';

interface CreateOptions {
  name: string;
  scopes?: string;
  instances?: string;
  description?: string;
  rateLimit?: number;
  expires?: string;
  profile?: ProfileFlag;
  lockChat?: string[];
  lockInstance?: string[];
  owner?: string;
  denylistPreset?: string;
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

const ADMIN_CONFIRMATION_PHRASE = 'I UNDERSTAND';
const ADMIN_PROMPT_TEXT = `\nAdmin keys grant FULL access to every instance, every chat, and every verb.\nRedaction middleware is bypassed. Revocation is manual.\n\nType "${ADMIN_CONFIRMATION_PHRASE}" (exactly, case-sensitive) to proceed, anything else to abort:\n> `;

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

function collectRepeated(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

async function readLineFromStdin(): Promise<string> {
  return await new Promise<string>((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer | string): void => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx >= 0) {
        process.stdin.off('data', onData);
        process.stdin.pause();
        resolve(buffer.slice(0, newlineIdx).replace(/\r$/, ''));
      }
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

async function promptAdminConfirmation(): Promise<boolean> {
  process.stdout.write(ADMIN_PROMPT_TEXT);
  const answer = await readLineFromStdin();
  return answer === ADMIN_CONFIRMATION_PHRASE;
}

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Direct-to-database admin creation path. Bypasses the HTTP API because the
 * `POST /keys` route refuses `profile: 'admin'` unconditionally — there is
 * no HTTP surface that can mint a god-key, by design. Emits the
 * `key.admin_created` audit event so operators have a record.
 */
async function handleAdminCreate(options: CreateOptions): Promise<void> {
  // Enforcement world: refuse to mint or print a data-plane god key at all
  // (wish: omni-full-multitenancy, G4; WISH line 180, Success Criterion 19).
  //
  // This is checked FIRST — before the TTY test, before the confirmation
  // prompt, before the DB layer is imported and before any key material is
  // generated — so that under enforcement no god key is ever constructed, not
  // even transiently in memory.
  //
  // It is consistent with what the database already does under enforcement:
  // G3 REVOKEs ALL on `auth_credentials` from the runtime role, so a key minted
  // here would be unusable by the serving process anyway. Refusing here turns
  // an obscure runtime authorization failure into an explicit, explained one.
  //
  // The literal-`on` comparison mirrors `resolveEnforcementMode` in
  // `@omni/db/tenancy-startup` exactly — `1`, `true`, and `ON` are NOT
  // enforcement, so a stray environment variable can neither half-activate nor
  // half-deactivate a security boundary. It is inlined rather than imported
  // because this module deliberately keeps `@omni/db` off the CLI cold path
  // (see the dynamic imports below); the shared semantics are pinned by
  // `__tests__/keys-godkey-refusal.test.ts`.
  if (process.env.OMNI_DB_ENFORCEMENT === 'on') {
    output.error(
      'refusing to create an admin (god) key while OMNI_DB_ENFORCEMENT=on — a plaintext data-plane key with ' +
        'every scope is not an admissible bootstrap under enforcement. Create a platform-class credential and ' +
        'delegate a tenant-scoped key from it instead.',
      undefined,
      1,
    );
    return;
  }

  if (!process.stdin.isTTY) {
    output.error('admin keys require a TTY — run this command interactively', undefined, 1);
    return;
  }

  const confirmed = await promptAdminConfirmation();
  if (!confirmed) {
    output.error('admin confirmation failed — no key created', undefined, 1);
    return;
  }

  // Dynamic imports keep the CLI startup cold-path (SDK-only) fast. The
  // admin path is rare and loads the DB layer lazily.
  const [adminMod, coreMod] = await Promise.all([import('@omni/api/admin'), import('@omni/core').catch(() => null)]);
  const { createDb, closeDb, ApiKeyService, resolveProfile } = adminMod;

  const db = createDb();
  const service = new ApiKeyService(db);

  const resolved = resolveProfile({
    profile: 'admin',
    chatAllowlist: options.lockChat,
    instanceAllowlist: options.lockInstance,
    owner: options.owner,
    denylistPresetKey: options.denylistPreset,
  });

  const createdBy = process.env.USER ?? process.env.USERNAME ?? 'cli-admin';
  const result = await service.create({
    name: options.name,
    description: options.description,
    scopes: resolved.scopes,
    instanceIds: options.instances ? parseCommaSeparated(options.instances) : undefined,
    rateLimit: options.rateLimit,
    expiresAt: options.expires ? new Date(options.expires) : undefined,
    createdBy,
    profile: resolved.profile,
    profileOverrides: resolved.profileOverrides,
    chatAllowlist: resolved.chatAllowlist,
    instanceAllowlist: resolved.instanceAllowlist,
    outboundRecipientAllowlist: resolved.outboundRecipientAllowlist,
  });

  // Emit audit event. Best-effort: if NATS isn't reachable we warn but the
  // key is already persisted and the success path continues.
  if (coreMod && typeof coreMod.connectEventBus === 'function') {
    try {
      const bus = await coreMod.connectEventBus();
      try {
        await bus.publishGeneric('key.admin_created' as never, {
          keyId: result.key.id,
          keyName: result.key.name,
          operator: createdBy,
          createdAt: result.key.createdAt,
        });
      } finally {
        const maybeClose = (bus as { close?: () => Promise<void> }).close;
        if (typeof maybeClose === 'function') await maybeClose.call(bus).catch(() => {});
      }
    } catch (err) {
      output.warn(`key.admin_created event emission failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  output.success(`Admin API key created: ${result.key.name}`);

  // biome-ignore lint/suspicious/noConsole: CLI output — plaintext key display
  console.log(`\n  API Key (save this — it will NOT be shown again):\n\n  ${result.plainTextKey}\n`);

  output.info(`ID: ${result.key.id}`);
  output.info('Profile: admin');
  output.info(`Scopes: ${result.key.scopes.join(', ')}`);

  await closeDb().catch(() => {});
}

async function handleCreate(client: OmniClient, options: CreateOptions): Promise<void> {
  // Admin is a special case — handled before any HTTP call.
  if (options.profile === 'admin') {
    await handleAdminCreate(options);
    return;
  }

  // Profile-based flow: the API resolves scopes + lock columns for us.
  if (options.profile) {
    const body: Record<string, unknown> = {
      name: options.name,
      description: options.description,
      profile: options.profile,
      rateLimit: options.rateLimit,
      expiresAt: options.expires,
    };
    if (options.lockChat && options.lockChat.length > 0) body.chatAllowlist = options.lockChat;
    if (options.lockInstance && options.lockInstance.length > 0) {
      body.instanceAllowlist = options.lockInstance;
      body.instanceIds = options.lockInstance;
    }
    if (options.owner) body.owner = options.owner;
    if (options.denylistPreset) body.denylistPresetKey = options.denylistPreset;

    // biome-ignore lint/suspicious/noExplicitAny: SDK types predate profile fields; body is validated server-side.
    const result = await client.keys.create(body as any);

    output.success(`API key created: ${result.name}`);

    // biome-ignore lint/suspicious/noConsole: CLI output — plaintext key display
    console.log(`\n  API Key (save this — it will NOT be shown again):\n\n  ${result.plainTextKey}\n`);

    output.info(`ID: ${result.id}`);
    output.info(`Profile: ${options.profile}`);
    output.info(`Scopes: ${result.scopes.join(', ')}`);
    if (result.instanceIds) {
      output.info(`Instances: ${result.instanceIds.join(', ')}`);
    }
    return;
  }

  // Legacy path — caller supplied raw `--scopes`.
  if (!options.scopes) {
    output.error('Either --profile or --scopes is required', undefined, 1);
    return;
  }

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
    .description('Create a new API key (optionally from a profile template)')
    .requiredOption('--name <name>', 'Key name')
    .option('--profile <name>', 'Profile template: cs | personal | scout | coworker | admin')
    .option(
      '--scopes <scopes>',
      'Comma-separated scopes (legacy — omit when --profile is set; scopes derive from the profile)',
    )
    .option('--lock-chat <jid>', 'Lock this key to a chat (repeat for multiple)', collectRepeated)
    .option('--lock-instance <id>', 'Lock this key to an instance (repeat for multiple)', collectRepeated)
    .option('--owner <jid>', 'Scout: owner JID — populates outboundRecipientAllowlist')
    .option('--denylist-preset <key>', 'Coworker: denylist preset key (overrides profile default)')
    .option('--instances <ids>', 'Comma-separated instance IDs to restrict access (legacy)')
    .option('--description <desc>', 'Key description')
    .option('--rate-limit <n>', 'Rate limit (requests/minute)', Number.parseInt)
    .option('--expires <date>', 'Expiration date (ISO 8601)')
    .action(async (options: CreateOptions) => {
      const needsClient = options.profile !== 'admin';
      const client = needsClient ? getClient() : (null as unknown as OmniClient);
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

/**
 * Exported for tests — lets us exercise the TTY/confirmation/admin path and
 * the profile-flag handling without reaching into Commander internals.
 */
export const __testables = {
  ADMIN_CONFIRMATION_PHRASE,
  ADMIN_PROMPT_TEXT,
  handleCreate,
  handleAdminCreate,
  promptAdminConfirmation,
};
