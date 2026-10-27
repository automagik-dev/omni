/**
 * API Key service - manages API key validation and lifecycle
 *
 * Primary Key:
 * - Auto-generated on first API start if OMNI_API_KEY not set in .env
 * - Full key shown ONLY on first generation, masked thereafter
 * - If OMNI_API_KEY is set in .env, that becomes the primary key (shown masked)
 * - Primary key cannot be deleted from database
 *
 * Caching:
 * - Validated API keys are cached with 60s TTL
 * - Cache is invalidated on key update/revoke/delete
 *
 * Chat keys (wish: omni-chat-threads):
 * - A root key may mint `cs` children, each locked to one chat (`mintChild`)
 * - A child is never wider or longer-lived than its parent: the parent's revoke,
 *   delete and authority PATCH revoke or clamp its children in the same transaction
 * - Every child change publishes `access.key_minted` / `access.key_revoked` /
 *   `access.key_updated` when the service has an event bus
 */

import {
  type AccessKeyRevokeReason,
  ERROR_CODES,
  type EventBus,
  type EventPayloadMap,
  OmniError,
  createLogger,
} from '@omni/core';
import type { ApiKeyProfile, ApiKeyProfileOverrides, Database } from '@omni/db';
import { type ApiKey, type NewApiKey, apiKeys } from '@omni/db';
import { type SQL, and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CacheKeys, CacheTTL, type CachedApiKey, apiKeyCache, authCacheTtlMs } from '../cache';
import { SCOPE_IMPLIED_BY } from '../constants/scopes';
import { resolveProfile } from '../lib/resolve-profile';

const log = createLogger('api-keys');

/**
 * API key prefix
 */
const API_KEY_PREFIX = 'omni_sk_';

/**
 * Primary key name (used to identify it in database)
 */
const PRIMARY_KEY_NAME = '__primary__';

/**
 * Validated API key data
 */
export interface ValidatedApiKey {
  id: string;
  name: string;
  scopes: string[];
  instanceIds: string[] | null;
  rateLimit: number | null;
  profile: string | null;
  chatAllowlist: string[];
  instanceAllowlist: string[];
  outboundRecipientAllowlist: string[];
  profileOverrides: ApiKeyProfileOverrides | null;
}

/**
 * Options for creating an API key
 */
export interface CreateApiKeyOptions {
  name: string;
  description?: string;
  scopes: string[];
  instanceIds?: string[];
  rateLimit?: number;
  expiresAt?: Date;
  createdBy?: string;
  profile?: ApiKeyProfile | null;
  profileOverrides?: ApiKeyProfileOverrides;
  chatAllowlist?: string[];
  instanceAllowlist?: string[];
  outboundRecipientAllowlist?: string[];
}

/**
 * Result of creating an API key
 */
export interface CreateApiKeyResult {
  key: ApiKey;
  plainTextKey: string; // Only returned once at creation
}

/**
 * Options for updating an API key
 */
export interface UpdateApiKeyOptions {
  name?: string;
  description?: string | null;
  scopes?: string[];
  instanceIds?: string[] | null;
  rateLimit?: number | null;
  expiresAt?: Date | null;
  /** Context: active instance for turn-based agents */
  contextInstanceId?: string | null;
  /** Context: active chat for turn-based agents */
  contextChatId?: string | null;
  /** Context: trigger message ID for turn-based agents */
  contextMessageId?: string | null;
}

export type ApiKeyAuthorityGuard = (current: ApiKey, next: ApiKey) => boolean | Promise<boolean>;

export type GuardedApiKeyUpdateResult =
  | { status: 'updated'; key: ApiKey }
  | { status: 'not_found' }
  | { status: 'denied' };

/** At most this many live children per parent key. */
export const MAX_LIVE_CHILDREN = 500;

/** The `cs` scopes a chat key gets, cut to what its parent holds. */
export const CS_CHILD_SCOPES = ['messages:send', 'chats:read', 'context:write', 'turns:close'] as const;

/** A chat key needs these to work at all; a parent that cannot grant both mints nothing. */
const REQUIRED_CHILD_SCOPES: readonly string[] = ['messages:send', 'chats:read'];

export type ChildRevokeReason = AccessKeyRevokeReason;

/** The chat a child key is locked to. */
export interface ChildChat {
  /** The chat row's id. */
  id: string;
  /** The chat's id on its channel (a WhatsApp JID). */
  externalId: string;
  instanceId: string;
}

export type MintChildResult =
  | { ok: true; child: ApiKey; plainTextKey: string; replacedKeyId: string | null }
  | { ok: false; code: 'not_mintable' | 'missing_scope' | 'child_limit'; message: string };

export type RevokeChildResult = { status: 'revoked' | 'already_revoked' | 'not_found' | 'not_own_child' };

export type RevokeSelfResult = { status: 'revoked' | 'already_revoked' | 'not_a_child' };

export interface ApiKeyServiceOptions {
  /** Publishes the chat-key events; without one, children still cascade, silently. */
  eventBus?: EventBus | null;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** What a transaction did to child keys, settled (cache cleared, events published) after it commits. */
type ChildChange =
  | { kind: 'revoked'; child: ApiKey; reason: ChildRevokeReason }
  | { kind: 'clamped'; child: ApiKey }
  | { kind: 'minted'; child: ApiKey; chat: ChildChat; replacedKeyId: string | null };

const KeyIdSchema = z.string().uuid();

/** The chat a child is minted for; anything else mints nothing. */
const ChildChatSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().min(1).max(256),
  instanceId: z.string().uuid(),
});

/** Events published per batch when settling child changes. */
const CHILD_EVENT_BATCH = 50;

/** A PATCH that can narrow what a key covers, so its children must be checked. */
function touchesChildAuthority(options: UpdateApiKeyOptions): boolean {
  return options.scopes !== undefined || options.instanceIds !== undefined || options.expiresAt !== undefined;
}

function isLive(key: Pick<ApiKey, 'status' | 'expiresAt'>, now: number): boolean {
  return key.status === 'active' && (key.expiresAt === null || key.expiresAt.getTime() > now);
}

/** Why a key cannot mint children, or null when it can. */
function notMintableReason(parent: ApiKey | undefined): string | null {
  if (!parent) return 'parent key not found';
  if (!isLive(parent, Date.now())) return 'parent key is not active';
  if (parent.parentKeyId !== null) return 'a child key cannot mint children';
  if (parent.chatAllowlist.length > 0 || parent.instanceAllowlist.length > 0) {
    return 'a chat- or instance-locked key cannot mint children';
  }
  if (parent.outboundRecipientAllowlist.length > 0) return 'a recipient-locked key cannot mint children';
  return null;
}

/** The instances a child is locked to. */
function childInstances(child: ApiKey): string[] {
  return child.instanceIds ?? child.instanceAllowlist;
}

/** Whether the parent still covers every scope and instance the child holds. */
function parentCoversChild(parent: ApiKey, child: ApiKey): boolean {
  if (!child.scopes.every((scope) => ApiKeyService.scopeAllows(parent.scopes, scope))) return false;
  // A child without a legacy instance list reaches every instance on the routes that read only that list.
  if (child.instanceIds === null && parent.instanceIds !== null) return false;
  return [...(child.instanceIds ?? []), ...child.instanceAllowlist].every((instanceId) =>
    parentCoversInstance(parent, instanceId),
  );
}

function parentCoversInstance(parent: ApiKey, instanceId: string): boolean {
  return (
    ApiKeyService.instanceAllowed(parent.instanceIds, instanceId) &&
    (parent.instanceAllowlist.length === 0 || parent.instanceAllowlist.includes(instanceId))
  );
}

/** Whether a child's post-update row stays inside its parent: scopes, instances and expiry. */
function childWithinParent(parent: ApiKey | null, child: ApiKey): boolean {
  if (!parent) return false;
  if (!parentCoversChild(parent, child)) return false;
  if (parent.expiresAt === null) return true;
  return child.expiresAt !== null && child.expiresAt.getTime() <= parent.expiresAt.getTime();
}

/** A child outliving its parent's expiry is clamped to it; one already narrower is left alone. */
function needsClamp(parent: ApiKey, child: ApiKey): boolean {
  if (parent.expiresAt === null) return false;
  return child.expiresAt === null || child.expiresAt.getTime() > parent.expiresAt.getTime();
}

function childEventBase(child: ApiKey): { keyId: string; parentKeyId: string; chatId: string; instanceId: string } {
  return {
    keyId: child.id,
    parentKeyId: child.parentKeyId ?? '',
    chatId: child.chatAllowlist[0] ?? '',
    instanceId: childInstances(child)[0] ?? '',
  };
}

export class ApiKeyService {
  private readonly eventBus: EventBus | null;

  constructor(
    private db: Database,
    options: ApiKeyServiceOptions = {},
  ) {
    this.eventBus = options.eventBus ?? null;
  }

  /**
   * Generate a secure random API key
   */
  private generateKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomValues = new Uint8Array(32);
    crypto.getRandomValues(randomValues);
    for (const value of randomValues) {
      result += chars[value % chars.length];
    }
    return `${API_KEY_PREFIX}${result}`;
  }

  /**
   * Hash an API key using SHA-256
   */
  private async hashKey(key: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Extract key prefix for identification
   */
  private getKeyPrefix(key: string): string {
    // Return first 8 chars after omni_sk_
    return key.substring(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8);
  }

  /**
   * Validate an API key and return its data if valid
   * Uses caching to avoid database lookup on every request.
   */
  async validate(key: string, ip?: string): Promise<ValidatedApiKey | null> {
    // Basic format check
    if (!key.startsWith(API_KEY_PREFIX)) {
      log.debug('Invalid key format');
      return null;
    }

    // Hash the key
    const keyHash = await this.hashKey(key);
    const cacheKey = CacheKeys.apiKey(keyHash);

    // Check cache first
    const cached = await apiKeyCache.get<CachedApiKey>(cacheKey);
    if (cached) {
      // Verify cached key is still valid (status and expiration)
      if (cached.status !== 'active') {
        await apiKeyCache.delete(cacheKey);
        return null;
      }
      if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
        await apiKeyCache.delete(cacheKey);
        return null;
      }

      // Update usage asynchronously (fire and forget)
      this.updateUsageAsync(cached.id, ip);

      return {
        id: cached.id,
        name: cached.name,
        scopes: cached.scopes,
        instanceIds: cached.instanceIds,
        rateLimit: null, // Rate limit checked separately
        profile: cached.profile ?? null,
        chatAllowlist: cached.chatAllowlist ?? [],
        instanceAllowlist: cached.instanceAllowlist ?? [],
        outboundRecipientAllowlist: cached.outboundRecipientAllowlist ?? [],
        profileOverrides: (cached.profileOverrides as ApiKeyProfileOverrides | null | undefined) ?? null,
      };
    }

    // Cache miss - look up the key in database
    const [apiKey] = await this.db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, keyHash),
          eq(apiKeys.status, 'active'),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
        ),
      )
      .limit(1);

    if (!apiKey) {
      log.debug('Key not found or invalid');
      return null;
    }

    // Cache the validated key
    const cachedData: CachedApiKey = {
      id: apiKey.id,
      name: apiKey.name,
      status: apiKey.status,
      expiresAt: apiKey.expiresAt,
      scopes: apiKey.scopes,
      instanceIds: apiKey.instanceIds,
      profile: apiKey.profile,
      chatAllowlist: apiKey.chatAllowlist,
      instanceAllowlist: apiKey.instanceAllowlist,
      outboundRecipientAllowlist: apiKey.outboundRecipientAllowlist,
      profileOverrides: apiKey.profileOverrides ?? null,
    };
    // G5 (RELEASE_SLOS auth_cache_invalidation_seconds_max): clamped to the
    // revocation ceiling when multitenancy is enabled; legacy TTL flag-off.
    await apiKeyCache.set(cacheKey, cachedData, authCacheTtlMs(CacheTTL.API_KEY));

    // Update usage asynchronously
    this.updateUsageAsync(apiKey.id, ip);

    return {
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      instanceIds: apiKey.instanceIds,
      rateLimit: apiKey.rateLimit,
      profile: apiKey.profile,
      chatAllowlist: apiKey.chatAllowlist ?? [],
      instanceAllowlist: apiKey.instanceAllowlist ?? [],
      outboundRecipientAllowlist: apiKey.outboundRecipientAllowlist ?? [],
      profileOverrides: apiKey.profileOverrides ?? null,
    };
  }

  /**
   * Update API key usage (fire and forget)
   */
  private updateUsageAsync(keyId: string, ip?: string): void {
    const updates: Record<string, unknown> = {
      lastUsedAt: new Date(),
      usageCount: sql`${apiKeys.usageCount} + 1`,
      updatedAt: new Date(),
    };
    if (ip) {
      updates.lastUsedIp = ip;
    }

    this.db
      .update(apiKeys)
      .set(updates)
      .where(eq(apiKeys.id, keyId))
      .then(() => {})
      .catch((err) => log.error('Failed to update key usage', { error: String(err) }));
  }

  /**
   * Invalidate cache for a specific key (by ID)
   */
  async invalidateCacheForKey(id: string): Promise<void> {
    // We need to find the key's hash to invalidate, but we don't have it.
    // Instead, we invalidate by looking up the key and using its hash.
    const key = await this.getById(id);
    if (key) {
      // We only have the prefix, not the hash. Clear all caches with pattern.
      // For now, this is a limitation - we rely on TTL expiration.
      // In production with Redis, we'd use key prefixes or scan.
      log.debug('Cache invalidation requested for key', { id });
    }
  }

  /**
   * Create a new API key
   */
  async create(options: CreateApiKeyOptions): Promise<CreateApiKeyResult> {
    const plainTextKey = this.generateKey();
    const keyHash = await this.hashKey(plainTextKey);
    const keyPrefix = this.getKeyPrefix(plainTextKey);

    const data: NewApiKey = {
      name: options.name,
      description: options.description,
      keyPrefix,
      keyHash,
      scopes: options.scopes,
      instanceIds: options.instanceIds,
      rateLimit: options.rateLimit,
      expiresAt: options.expiresAt,
      createdBy: options.createdBy,
      profile: options.profile ?? null,
      ...(options.profileOverrides !== undefined ? { profileOverrides: options.profileOverrides } : {}),
      ...(options.chatAllowlist !== undefined ? { chatAllowlist: options.chatAllowlist } : {}),
      ...(options.instanceAllowlist !== undefined ? { instanceAllowlist: options.instanceAllowlist } : {}),
      ...(options.outboundRecipientAllowlist !== undefined
        ? { outboundRecipientAllowlist: options.outboundRecipientAllowlist }
        : {}),
    };

    const [created] = await this.db.insert(apiKeys).values(data).returning();

    if (!created) {
      throw new Error('Failed to create API key');
    }

    log.info('API key created', { id: created.id, name: created.name });

    return {
      key: created,
      plainTextKey, // Only returned once!
    };
  }

  /**
   * Update an API key
   */
  async update(id: string, options: UpdateApiKeyOptions): Promise<ApiKey | null> {
    // Prevent renaming primary key
    if (options.name !== undefined && (await this.isPrimaryKey(id))) {
      throw new Error('Cannot rename primary API key');
    }

    const updates = this.buildUpdateValues(options);

    if (!touchesChildAuthority(options)) {
      const [updated] = await this.db.update(apiKeys).set(updates).where(eq(apiKeys.id, id)).returning();
      if (updated) {
        await apiKeyCache.delete(CacheKeys.apiKey(updated.keyHash));
        log.info('API key updated', { id, fields: Object.keys(options) });
      }
      return updated ?? null;
    }

    // The key's row (and a child's parent before it) is locked first, so a
    // concurrent mint waits for this transaction and then sees the narrowed parent.
    const { updated, changes } = await this.db.transaction(async (tx) => {
      const { current, parent } = await this.lockKeyForUpdate(tx, id);
      if (!current) return { updated: null, changes: [] as ChildChange[] };
      if (current.parentKeyId !== null && !childWithinParent(parent, { ...current, ...updates } as ApiKey)) {
        throw new OmniError({
          code: ERROR_CODES.FORBIDDEN,
          message: 'A child key cannot exceed its parent key',
          context: { keyId: id },
        });
      }
      const [row] = await tx.update(apiKeys).set(updates).where(eq(apiKeys.id, id)).returning();
      if (!row) return { updated: null, changes: [] as ChildChange[] };
      return { updated: row, changes: await this.reconcileChildren(tx, row) };
    });

    if (updated) {
      await apiKeyCache.delete(CacheKeys.apiKey(updated.keyHash));
      log.info('API key updated', { id, fields: Object.keys(options) });
    }
    await this.settleChildChanges(changes);

    return updated;
  }

  /**
   * Atomically update an API key after validating its complete post-update
   * authority. The target row remains locked from the initial read through the
   * guard and write, so concurrent partial authority PATCHes cannot compose
   * against the same stale snapshot.
   */
  async updateWithAuthorityGuard(
    id: string,
    options: UpdateApiKeyOptions,
    guard: ApiKeyAuthorityGuard,
  ): Promise<GuardedApiKeyUpdateResult> {
    const changes: ChildChange[] = [];
    const result = await this.db.transaction(async (tx): Promise<GuardedApiKeyUpdateResult> => {
      const { current, parent } = await this.lockKeyForUpdate(tx, id);

      if (!current) return { status: 'not_found' };

      if (options.name !== undefined && current.name === PRIMARY_KEY_NAME) {
        throw new Error('Cannot rename primary API key');
      }

      const updates = this.buildUpdateValues(options);
      const next = { ...current, ...updates } as ApiKey;
      if (!(await guard(current, next))) return { status: 'denied' };
      // A child is never wider or longer-lived than its parent, whoever asks.
      if (current.parentKeyId !== null && touchesChildAuthority(options) && !childWithinParent(parent, next)) {
        return { status: 'denied' };
      }

      const [updated] = await tx.update(apiKeys).set(updates).where(eq(apiKeys.id, id)).returning();
      if (!updated) return { status: 'not_found' };

      if (touchesChildAuthority(options)) changes.push(...(await this.reconcileChildren(tx, updated)));
      return { status: 'updated', key: updated };
    });

    if (result.status === 'updated') {
      await apiKeyCache.delete(CacheKeys.apiKey(result.key.keyHash));
      log.info('API key updated', { id, fields: Object.keys(options) });
      await this.settleChildChanges(changes);
    }

    return result;
  }

  /**
   * Lock a key's row for an update; for a child, its parent's row first (the
   * order every lineage path takes) and return it too.
   */
  private async lockKeyForUpdate(tx: Tx, id: string): Promise<{ current?: ApiKey; parent: ApiKey | null }> {
    const [peek] = await tx
      .select({ parentKeyId: apiKeys.parentKeyId })
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);
    if (!peek) return { parent: null };
    const parent = peek.parentKeyId
      ? ((await tx.select().from(apiKeys).where(eq(apiKeys.id, peek.parentKeyId)).limit(1).for('update'))[0] ?? null)
      : null;
    const [current] = await tx.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1).for('update');
    return { current, parent };
  }

  private buildUpdateValues(options: UpdateApiKeyOptions): Record<string, unknown> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (options.name !== undefined) updates.name = options.name;
    if (options.description !== undefined) updates.description = options.description;
    if (options.scopes !== undefined) updates.scopes = options.scopes;
    if (options.instanceIds !== undefined) updates.instanceIds = options.instanceIds;
    if (options.rateLimit !== undefined) updates.rateLimit = options.rateLimit;
    if (options.expiresAt !== undefined) updates.expiresAt = options.expiresAt;
    if (options.contextInstanceId !== undefined) updates.contextInstanceId = options.contextInstanceId;
    if (options.contextChatId !== undefined) updates.contextChatId = options.contextChatId;
    if (options.contextMessageId !== undefined) updates.contextMessageId = options.contextMessageId;
    if (
      options.contextInstanceId !== undefined ||
      options.contextChatId !== undefined ||
      options.contextMessageId !== undefined
    ) {
      updates.contextUpdatedAt = new Date();
    }
    return updates;
  }

  /**
   * List all API keys (without revealing the actual keys)
   */
  async list(): Promise<ApiKey[]> {
    return this.db.select().from(apiKeys).orderBy(apiKeys.createdAt);
  }

  /**
   * Get an API key by ID
   */
  async getById(id: string): Promise<ApiKey | null> {
    const [result] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    return result ?? null;
  }

  /**
   * Find an API key by name
   */
  async findByName(name: string): Promise<ApiKey | null> {
    const [result] = await this.db.select().from(apiKeys).where(eq(apiKeys.name, name)).limit(1);
    return result ?? null;
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string, reason?: string, revokedBy?: string): Promise<ApiKey | null> {
    // The UPDATE locks the parent row first, so a concurrent mint either lands
    // before it (and its child is revoked below) or sees the parent revoked.
    const { revoked, changes } = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(apiKeys)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy,
          revokeReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(apiKeys.id, id))
        .returning();
      if (!row) return { revoked: null, changes: [] as ChildChange[] };
      return { revoked: row, changes: await this.revokeLiveChildren(tx, id, 'parent_revoked', revokedBy ?? null) };
    });

    if (revoked) {
      // Invalidate cache using the stored keyHash
      await apiKeyCache.delete(CacheKeys.apiKey(revoked.keyHash));
      log.info('API key revoked', { id, reason });
    }
    await this.settleChildChanges(changes);

    return revoked;
  }

  // ==========================================================================
  // Chat keys: children of a key, each locked to one chat
  // ==========================================================================

  /**
   * Mint a `cs` child of `parentId` locked to one chat. The parent row is locked
   * for the whole transaction, so the cap and the one-live-child-per-chat rule
   * hold under concurrent mints; a re-mint for the same chat revokes the
   * previous child first. The parent must be an active root key with no chat,
   * instance or recipient lock; the caller's own checks (scope, tenancy,
   * instance ceiling) belong to the route.
   */
  async mintChild(parentId: string, chat: ChildChat): Promise<MintChildResult> {
    if (!ChildChatSchema.safeParse(chat).success) {
      return { ok: false, code: 'not_mintable', message: 'invalid chat' };
    }
    const plainTextKey = this.generateKey();
    const keyHash = await this.hashKey(plainTextKey);
    const keyPrefix = this.getKeyPrefix(plainTextKey);
    const changes: ChildChange[] = [];

    const result = await this.db.transaction(async (tx): Promise<MintChildResult> => {
      const [parent] = KeyIdSchema.safeParse(parentId).success
        ? await tx.select().from(apiKeys).where(eq(apiKeys.id, parentId)).limit(1).for('update')
        : [];
      const refusal = notMintableReason(parent);
      if (refusal || !parent) return { ok: false, code: 'not_mintable', message: refusal ?? 'parent key not found' };
      // Read from the locked row, never from the caller's (possibly cached) view of it.
      if (!parentCoversInstance(parent, chat.instanceId)) {
        return {
          ok: false,
          code: 'not_mintable',
          message: "the chat's instance is outside the parent key's instances",
        };
      }

      const scopes: string[] = CS_CHILD_SCOPES.filter((scope) => ApiKeyService.scopeAllows(parent.scopes, scope));
      const missing = REQUIRED_CHILD_SCOPES.filter((scope) => !scopes.includes(scope));
      if (missing.length > 0) {
        return { ok: false, code: 'missing_scope', message: `parent key lacks ${missing.join(' and ')}` };
      }

      const active = await tx
        .select({
          id: apiKeys.id,
          chatAllowlist: apiKeys.chatAllowlist,
          expiresAt: apiKeys.expiresAt,
          status: apiKeys.status,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.parentKeyId, parent.id), eq(apiKeys.status, 'active')));
      const now = Date.now();
      const sameChat = active.filter((child) => child.chatAllowlist.includes(chat.id));
      const liveElsewhere = active.filter((child) => isLive(child, now) && !child.chatAllowlist.includes(chat.id));
      if (liveElsewhere.length >= MAX_LIVE_CHILDREN) {
        return {
          ok: false,
          code: 'child_limit',
          message: `parent key already has ${MAX_LIVE_CHILDREN} live chat keys`,
        };
      }

      const replaced = await this.revokeKeys(
        tx,
        sameChat.map((child) => child.id),
        'remint',
        null,
      );
      changes.push(...replaced);

      const resolved = resolveProfile({
        profile: 'cs',
        chatAllowlist: [chat.id, chat.externalId],
        instanceAllowlist: [chat.instanceId],
        outboundRecipientAllowlist: [chat.externalId],
      });
      const [child] = await tx
        .insert(apiKeys)
        .values({
          name: `chat:${chat.id}`,
          description: `Chat key for ${chat.externalId}`,
          keyPrefix,
          keyHash,
          scopes,
          profile: resolved.profile,
          profileOverrides: resolved.profileOverrides,
          chatAllowlist: resolved.chatAllowlist,
          instanceAllowlist: resolved.instanceAllowlist,
          outboundRecipientAllowlist: resolved.outboundRecipientAllowlist,
          instanceIds: [chat.instanceId],
          rateLimit: parent.rateLimit,
          expiresAt: parent.expiresAt,
          parentKeyId: parent.id,
          createdBy: parent.name,
        })
        .returning();
      if (!child) throw new Error('Failed to create chat key');

      const replacedKeyId = replaced[0]?.child.id ?? null;
      changes.push({ kind: 'minted', child, chat, replacedKeyId });
      return { ok: true, child, plainTextKey, replacedKeyId };
    });

    if (result.ok) log.info('Chat key minted', { id: result.child.id, parentKeyId: parentId, chatId: chat.id });
    await this.settleChildChanges(changes);
    return result;
  }

  /**
   * Revoke one of the caller's own children. Ownership is the child's
   * `parent_key_id`, never `createdBy`.
   */
  async revokeChild(callerId: string, childId: string, revokedBy: string): Promise<RevokeChildResult> {
    if (!KeyIdSchema.safeParse(childId).success) return { status: 'not_found' };
    if (!KeyIdSchema.safeParse(callerId).success) return { status: 'not_own_child' };
    const changes: ChildChange[] = [];

    const result = await this.db.transaction(async (tx): Promise<RevokeChildResult> => {
      // Parent before child, the order every lineage path takes.
      await tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, callerId)).limit(1).for('update');
      const [child] = await tx.select().from(apiKeys).where(eq(apiKeys.id, childId)).limit(1).for('update');
      if (!child) return { status: 'not_found' };
      if (child.parentKeyId !== callerId) return { status: 'not_own_child' };
      if (child.status !== 'active') return { status: 'already_revoked' };
      changes.push(...(await this.revokeKeys(tx, [child.id], 'own_child', revokedBy)));
      return { status: 'revoked' };
    });

    await this.settleChildChanges(changes);
    return result;
  }

  /** A child key revokes itself; it names no target, so it can never reach another key. */
  async revokeSelf(child: Pick<ValidatedApiKey, 'id' | 'name'>): Promise<RevokeSelfResult> {
    const changes: ChildChange[] = [];

    const result = await this.db.transaction(async (tx): Promise<RevokeSelfResult> => {
      const [row] = await tx
        .select({ parentKeyId: apiKeys.parentKeyId })
        .from(apiKeys)
        .where(eq(apiKeys.id, child.id))
        .limit(1);
      if (!row?.parentKeyId) return { status: 'not_a_child' };
      await tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, row.parentKeyId)).limit(1).for('update');
      const [locked] = await tx.select().from(apiKeys).where(eq(apiKeys.id, child.id)).limit(1).for('update');
      // Gone meanwhile: its parent was deleted, and the key with it.
      if (!locked || locked.status !== 'active') return { status: 'already_revoked' };
      changes.push(...(await this.revokeKeys(tx, [locked.id], 'self', child.name)));
      return { status: 'revoked' };
    });

    await this.settleChildChanges(changes);
    return result;
  }

  /** Revoke every active child of `parentId`. */
  private async revokeLiveChildren(
    tx: Tx,
    parentId: string,
    reason: ChildRevokeReason,
    revokedBy: string | null,
  ): Promise<ChildChange[]> {
    return this.revokeWhere(tx, eq(apiKeys.parentKeyId, parentId), reason, revokedBy);
  }

  /** Revoke the given keys, those still active. */
  private async revokeKeys(
    tx: Tx,
    ids: string[],
    reason: ChildRevokeReason,
    revokedBy: string | null,
  ): Promise<ChildChange[]> {
    if (ids.length === 0) return [];
    return this.revokeWhere(tx, inArray(apiKeys.id, ids), reason, revokedBy);
  }

  /** Revoke the still-active keys matching `target`. */
  private async revokeWhere(
    tx: Tx,
    target: SQL,
    reason: ChildRevokeReason,
    revokedBy: string | null,
  ): Promise<ChildChange[]> {
    const now = new Date();
    const revoked = await tx
      .update(apiKeys)
      .set({ status: 'revoked', revokedAt: now, revokedBy, revokeReason: reason, updatedAt: now })
      .where(and(target, eq(apiKeys.status, 'active')))
      .returning();
    return revoked.map((child) => ({ kind: 'revoked', child, reason }));
  }

  /**
   * After a parent changed: revoke each active child holding a scope or
   * instance the parent no longer covers, and clamp the others' expiry to a
   * shortened or newly set parent expiry. A lengthened or removed parent
   * expiry changes no child: the children stay narrower.
   */
  private async reconcileChildren(tx: Tx, parent: ApiKey): Promise<ChildChange[]> {
    // The parent row is locked by the caller's UPDATE; every path that changes a
    // child takes that lock first, so the children need none of their own.
    const children = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.parentKeyId, parent.id), eq(apiKeys.status, 'active')));
    if (children.length === 0) return [];

    const uncovered = children.filter((child) => !parentCoversChild(parent, child));
    const changes = await this.revokeKeys(
      tx,
      uncovered.map((child) => child.id),
      'parent_narrowed',
      null,
    );

    const toClamp = children.filter((child) => !uncovered.includes(child) && needsClamp(parent, child));
    if (toClamp.length > 0 && parent.expiresAt !== null) {
      const clamped = await tx
        .update(apiKeys)
        .set({ expiresAt: parent.expiresAt, updatedAt: new Date() })
        .where(
          and(
            inArray(
              apiKeys.id,
              toClamp.map((child) => child.id),
            ),
            eq(apiKeys.status, 'active'),
          ),
        )
        .returning();
      changes.push(...clamped.map((child): ChildChange => ({ kind: 'clamped', child })));
    }
    return changes;
  }

  /**
   * Clear each touched child's cache entry on this process, then publish the
   * events in batches. A mint publishes after the revokes and clamps it follows, so a
   * re-mint's `access.key_revoked` precedes its `access.key_minted`. Runs after the
   * commit; a failed publish is logged, never raised.
   */
  private async settleChildChanges(changes: ChildChange[]): Promise<void> {
    for (const change of changes) {
      await apiKeyCache.delete(CacheKeys.apiKey(change.child.keyHash));
    }
    await this.publishInBatches(changes.filter((change) => change.kind !== 'minted'));
    await this.publishInBatches(changes.filter((change) => change.kind === 'minted'));
  }

  private async publishInBatches(changes: ChildChange[]): Promise<void> {
    for (let i = 0; i < changes.length; i += CHILD_EVENT_BATCH) {
      await Promise.allSettled(
        changes.slice(i, i + CHILD_EVENT_BATCH).map((change) => this.publishChildChange(change)),
      );
    }
  }

  private async publishChildChange(change: ChildChange): Promise<void> {
    const base = childEventBase(change.child);
    if (change.kind === 'revoked') {
      log.info('Chat key revoked', { id: change.child.id, parentKeyId: base.parentKeyId, reason: change.reason });
      await this.publishChildEvent(
        'access.key_revoked',
        { ...base, reason: change.reason, revokedBy: change.child.revokedBy },
        base.instanceId,
      );
    } else if (change.kind === 'clamped' && change.child.expiresAt) {
      await this.publishChildEvent(
        'access.key_updated',
        { ...base, expiresAt: change.child.expiresAt.getTime() },
        base.instanceId,
      );
    } else if (change.kind === 'minted') {
      await this.publishChildEvent(
        'access.key_minted',
        {
          ...base,
          chatId: change.chat.id,
          chatExternalId: change.chat.externalId,
          instanceId: change.chat.instanceId,
          scopes: change.child.scopes,
          expiresAt: change.child.expiresAt?.getTime() ?? null,
          replacedKeyId: change.replacedKeyId,
        },
        change.chat.instanceId,
      );
    }
  }

  private async publishChildEvent<T extends 'access.key_minted' | 'access.key_revoked' | 'access.key_updated'>(
    type: T,
    payload: EventPayloadMap[T],
    instanceId: string,
  ): Promise<void> {
    if (!this.eventBus) return;
    try {
      await this.eventBus.publish(type, payload, instanceId ? { instanceId } : {});
    } catch (error) {
      // The change is committed; a lost event must not turn it into an error.
      log.warn('Failed to publish chat key event', { type, keyId: payload.keyId, error: String(error) });
    }
  }

  /**
   * Check if a scope allows access
   */
  static scopeAllows(scopes: string[], requiredScope: string): boolean {
    // Wildcard access
    if (scopes.includes('*')) return true;

    // Exact match
    if (scopes.includes(requiredScope)) return true;

    // Namespace wildcard (e.g., "instances:*" allows "instances:read")
    const [namespace] = requiredScope.split(':');
    if (scopes.includes(`${namespace}:*`)) return true;

    // A broader scope that grants this one (e.g., "system:admin" allows "system:update")
    return (SCOPE_IMPLIED_BY[requiredScope] ?? []).some((broader) => scopes.includes(broader));
  }

  /**
   * Check if an API key has access to a specific instance
   */
  static instanceAllowed(instanceIds: string[] | null, targetInstanceId: string): boolean {
    // Null means access to all instances
    if (instanceIds === null) return true;
    return instanceIds.includes(targetInstanceId);
  }

  /**
   * Initialize primary key on API startup
   * Returns info about the primary key for display in startup panel
   */
  async initializePrimaryKey(): Promise<{
    isNew: boolean;
    isFromEnv: boolean;
    displayKey: string; // Full key if new, masked if existing
    keyId: string;
  }> {
    const envKey = process.env.OMNI_API_KEY;

    // Check if primary key already exists in database
    const [existingMaster] = await this.db.select().from(apiKeys).where(eq(apiKeys.name, PRIMARY_KEY_NAME)).limit(1);

    if (existingMaster) {
      // Primary key exists - show masked
      const maskedKey = `${API_KEY_PREFIX}${existingMaster.keyPrefix}${'*'.repeat(24)}`;
      return {
        isNew: false,
        isFromEnv: false,
        displayKey: maskedKey,
        keyId: existingMaster.id,
      };
    }

    // No primary key exists - create one
    let plainTextKey: string;
    let keyHash: string;
    let keyPrefix: string;
    let isFromEnv = false;

    if (envKey?.startsWith(API_KEY_PREFIX)) {
      // Use the key from environment
      plainTextKey = envKey;
      keyHash = await this.hashKey(envKey);
      keyPrefix = this.getKeyPrefix(envKey);
      isFromEnv = true;
      log.info('Using primary API key from OMNI_API_KEY environment variable');
    } else {
      // Generate a new key
      plainTextKey = this.generateKey();
      keyHash = await this.hashKey(plainTextKey);
      keyPrefix = this.getKeyPrefix(plainTextKey);
      log.info('Generated new primary API key');
    }

    // Create primary key in database
    const data: NewApiKey = {
      name: PRIMARY_KEY_NAME,
      description: 'Primary API key - auto-generated on first start. Cannot be deleted.',
      keyPrefix,
      keyHash,
      scopes: ['*'], // Full access
      instanceIds: null, // All instances
      createdBy: 'system',
    };

    const [created] = await this.db.insert(apiKeys).values(data).returning();

    if (!created) {
      throw new Error('Failed to create primary API key');
    }

    // Return full key if newly generated (not from env), masked if from env
    const displayKey = isFromEnv ? `${API_KEY_PREFIX}${keyPrefix}${'*'.repeat(24)}` : plainTextKey;

    return {
      isNew: !isFromEnv,
      isFromEnv,
      displayKey,
      keyId: created.id,
    };
  }

  /**
   * Check if a key is the primary key (cannot be deleted)
   */
  async isPrimaryKey(id: string): Promise<boolean> {
    const [key] = await this.db.select({ name: apiKeys.name }).from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    return key?.name === PRIMARY_KEY_NAME;
  }

  /**
   * Delete an API key permanently (fails for primary key)
   */
  async delete(id: string): Promise<boolean> {
    // Check if this is the primary key
    if (await this.isPrimaryKey(id)) {
      throw new Error('Cannot delete primary API key');
    }

    // Children are revoked first, each with its event and cache clear; the FK
    // cascade then removes their rows with the parent's.
    const { result, changes } = await this.db.transaction(async (tx) => {
      await tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, id)).limit(1).for('update');
      const revoked = await this.revokeLiveChildren(tx, id, 'parent_deleted', null);
      const deleted = await tx.delete(apiKeys).where(eq(apiKeys.id, id)).returning();
      return { result: deleted, changes: deleted.length > 0 ? revoked : [] };
    });

    // Invalidate cache if we have the keyHash
    if (result.length > 0 && result[0]?.keyHash) {
      await apiKeyCache.delete(CacheKeys.apiKey(result[0].keyHash));
    }
    await this.settleChildChanges(changes);

    return result.length > 0;
  }

  /**
   * Mask an API key for display
   */
  static maskKey(keyPrefix: string): string {
    return `${API_KEY_PREFIX}${keyPrefix}${'*'.repeat(24)}`;
  }
}
