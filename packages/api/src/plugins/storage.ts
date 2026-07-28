/**
 * Database-backed storage implementation for plugins
 *
 * Persists plugin data (auth state, credentials, etc.) to PostgreSQL.
 * Data survives API restarts.
 *
 * TENANT-BOUND SEALING OF PLUGIN CREDENTIALS (G5 deliverable (g); ADR-0008;
 * OWNERSHIP_MANIFEST `filesystem_session_state`)
 * ---------------------------------------------------------------------------
 * The doc comment above says "auth state, credentials" and it means it: the
 * WhatsApp channel stores its entire Baileys session here — `auth:<instanceId>:
 * creds` is the blob that IS the authenticated WhatsApp identity, and
 * `auth:<instanceId>:keys:*` are the Signal protocol keys. ADR-0008 requires
 * this material to be encrypted with tenant-bound context.
 *
 * WHERE THE TENANT COMES FROM
 * ---------------------------
 * `plugin_storage` is a G0-`split` table and carries no `tenant_id`. But every
 * credential key NAMES its instance, and `instances` is the G2 ownership root —
 * so the tenant is derived by parsing the instance id out of the key and asking
 * the instance-owner registry, which is populated only from `instances` ROWS the
 * API layer already loaded. That is the same trusted derivation the publish path
 * uses (`instance-owner-registry.ts`), never a payload or caller hint.
 *
 * DUAL WORLD, WITH NO FLAG CHECK. The registry is empty when every
 * `instances.tenant_id` is NULL, and the codec is the identity function without
 * a master key — so a flag-off deployment writes byte-identical plaintext and
 * this module is inert. Reads are transitional: a legacy plaintext row and a
 * sealed row coexist and each is handled on its own shape, because G5 ships no
 * credential backfill.
 *
 * A key that names no known instance (`global:*`, platform plugin state) seals
 * nothing — there is no tenant to bind it to, and guessing one would be worse
 * than leaving it as it is.
 */

import type { PluginStorage } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { pluginStorage } from '@omni/db';
import { and, eq, gt, isNotNull, isNull, like, lt, or, sql } from 'drizzle-orm';
import { lookupInstanceOwner } from '../tenancy/instance-owner-registry';
import { openCredentialField, sealCredentialField } from '../tenancy/sealed-credentials';

const log = createLogger('api:storage');

/** First UUID appearing in a storage key — the instance it belongs to. */
const INSTANCE_ID_IN_KEY = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/**
 * The tenant a given storage key's value is sealed for, or null when this row
 * is not tenant-owned secret material (no instance in the key, or an instance
 * whose ownership this process has never loaded).
 */
function tenantForStorageKey(fullKey: string): string | null {
  const match = INSTANCE_ID_IN_KEY.exec(fullKey);
  return match ? lookupInstanceOwner(match[0]) : null;
}

/**
 * Database-backed storage for plugin data
 *
 * Uses PostgreSQL for persistence across API restarts.
 */
class DatabasePluginStorage implements PluginStorage {
  private readonly prefix: string;

  constructor(
    private readonly db: Database,
    private readonly pluginId: string,
  ) {
    this.prefix = `plugin:${pluginId}:`;
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);

    const t0 = Date.now();
    const result = await this.db
      .select()
      .from(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, this.pluginId),
          eq(pluginStorage.key, fullKey),
          or(isNull(pluginStorage.expiresAt), gt(pluginStorage.expiresAt, new Date())),
        ),
      )
      .limit(1);

    const elapsed = Date.now() - t0;
    if (elapsed > 500) {
      log.warn('Slow storage.get', {
        pluginId: this.pluginId,
        key: fullKey.slice(-80),
        elapsedMs: elapsed,
      });
    }

    const row = result[0];
    if (!row) return null;

    // Unseal BEFORE parsing: a sealed row's `value` is the envelope, and the
    // plaintext inside it is exactly the string `set` serialized. A row that
    // cannot be opened (sealed for another tenant, or no key configured) is
    // treated as ABSENT — fail-closed. Returning the envelope would hand the
    // caller a blob it would then present to WhatsApp as a session credential.
    const opened = openCredentialField(tenantForStorageKey(fullKey), row.value);
    if (opened == null) return null;

    try {
      return JSON.parse(opened) as T;
    } catch {
      return opened as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const plainValue = typeof value === 'string' ? value : JSON.stringify(value);
    const serializedValue = sealCredentialField(tenantForStorageKey(fullKey), plainValue);
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

    await this.db
      .insert(pluginStorage)
      .values({
        pluginId: this.pluginId,
        key: fullKey,
        value: serializedValue,
        expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pluginStorage.pluginId, pluginStorage.key],
        set: {
          value: serializedValue,
          expiresAt,
          updatedAt: new Date(),
        },
      });
  }

  async delete(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);

    const result = await this.db
      .delete(pluginStorage)
      .where(and(eq(pluginStorage.pluginId, this.pluginId), eq(pluginStorage.key, fullKey)))
      .returning({ id: pluginStorage.id });

    return result.length > 0;
  }

  async has(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);

    const result = await this.db
      .select({ id: pluginStorage.id })
      .from(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, this.pluginId),
          eq(pluginStorage.key, fullKey),
          or(isNull(pluginStorage.expiresAt), gt(pluginStorage.expiresAt, new Date())),
        ),
      )
      .limit(1);

    return result.length > 0;
  }

  async keys(pattern?: string): Promise<string[]> {
    const prefixPattern = `${this.prefix}%`;

    const query = this.db
      .select({ key: pluginStorage.key })
      .from(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, this.pluginId),
          like(pluginStorage.key, prefixPattern),
          or(isNull(pluginStorage.expiresAt), gt(pluginStorage.expiresAt, new Date())),
        ),
      );

    const results = await query;

    // Remove prefix from keys
    let keys = results.map((r) => r.key.slice(this.prefix.length));

    // Filter by pattern if provided
    if (pattern) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      keys = keys.filter((k) => regex.test(k));
    }

    return keys;
  }

  /**
   * Clean up expired entries (can be called periodically)
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.db
      .delete(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, this.pluginId),
          isNotNull(pluginStorage.expiresAt),
          lt(pluginStorage.expiresAt, sql`NOW()`),
        ),
      )
      .returning({ id: pluginStorage.id });

    return result.length;
  }
}

/**
 * In-memory storage fallback (for testing or when DB is unavailable)
 */
class InMemoryPluginStorage implements PluginStorage {
  private data = new Map<string, { value: unknown; expiresAt?: number }>();
  private readonly prefix: string;

  constructor(pluginId: string) {
    this.prefix = `plugin:${pluginId}:`;
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const stored = this.data.get(this.getKey(key));
    if (!stored) return null;
    if (stored.expiresAt && Date.now() > stored.expiresAt) {
      this.data.delete(this.getKey(key));
      return null;
    }
    return stored.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.data.set(this.getKey(key), {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(this.getKey(key));
  }

  async has(key: string): Promise<boolean> {
    const stored = this.data.get(this.getKey(key));
    if (!stored) return false;
    if (stored.expiresAt && Date.now() > stored.expiresAt) {
      this.data.delete(this.getKey(key));
      return false;
    }
    return true;
  }

  async keys(pattern?: string): Promise<string[]> {
    const result: string[] = [];
    const now = Date.now();

    for (const [key, stored] of this.data.entries()) {
      if (stored.expiresAt && now > stored.expiresAt) {
        this.data.delete(key);
        continue;
      }
      if (!key.startsWith(this.prefix)) continue;

      const keyWithoutPrefix = key.slice(this.prefix.length);
      if (pattern) {
        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        if (!regex.test(keyWithoutPrefix)) continue;
      }
      result.push(keyWithoutPrefix);
    }

    return result;
  }
}

/**
 * Storage factory - creates appropriate storage based on available resources
 */
let globalDb: Database | null = null;
const storageInstances = new Map<string, PluginStorage>();

export function setStorageDatabase(db: Database): void {
  globalDb = db;

  // Upgrade previously-created in-memory stores once DB becomes available.
  for (const [pluginId, storage] of storageInstances.entries()) {
    if (storage instanceof InMemoryPluginStorage) {
      storageInstances.set(pluginId, new DatabasePluginStorage(db, pluginId));
    }
  }
}

/**
 * Get or create storage for a plugin
 *
 * Uses DatabasePluginStorage if database is available, falls back to InMemory
 */
/**
 * Test-only constructor for the database-backed store.
 *
 * `getPluginStorage` memoises one instance per plugin id against a module-global
 * database, which the sealing probes cannot use: each case needs its own fresh
 * table stand-in. This exposes the class without widening the production API —
 * `getPluginStorage` remains the only way production code obtains a store.
 */
export function __createPluginStorageForTest(db: Database, pluginId: string): PluginStorage {
  return new DatabasePluginStorage(db, pluginId);
}

export function getPluginStorage(pluginId: string): PluginStorage {
  let storage = storageInstances.get(pluginId);
  if (!storage) {
    if (globalDb) {
      storage = new DatabasePluginStorage(globalDb, pluginId);
    } else {
      log.warn('Database not available, using in-memory storage', { pluginId });
      storage = new InMemoryPluginStorage(pluginId);
    }
    storageInstances.set(pluginId, storage);
  }
  return storage;
}
