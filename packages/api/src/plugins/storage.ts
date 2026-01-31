/**
 * Database-backed storage implementation for plugins
 *
 * Persists plugin data (auth state, credentials, etc.) to PostgreSQL.
 * Data survives API restarts.
 */

import type { PluginStorage } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { pluginStorage } from '@omni/db';
import { and, eq, gt, isNull, like, or, sql } from 'drizzle-orm';

/**
 * Database-backed storage for plugin data
 *
 * Uses PostgreSQL for persistence across API restarts.
 */
export class DatabasePluginStorage implements PluginStorage {
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

    const row = result[0];
    if (!row) return null;

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
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

    let query = this.db
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
          gt(sql`${pluginStorage.expiresAt}`, sql`NULL`),
          sql`${pluginStorage.expiresAt} < NOW()`,
        ),
      )
      .returning({ id: pluginStorage.id });

    return result.length;
  }
}

/**
 * In-memory storage fallback (for testing or when DB is unavailable)
 */
export class InMemoryPluginStorage implements PluginStorage {
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

export function setStorageDatabase(db: Database): void {
  globalDb = db;
}

const storageInstances = new Map<string, PluginStorage>();

/**
 * Get or create storage for a plugin
 *
 * Uses DatabasePluginStorage if database is available, falls back to InMemory
 */
export function getPluginStorage(pluginId: string): PluginStorage {
  let storage = storageInstances.get(pluginId);
  if (!storage) {
    if (globalDb) {
      storage = new DatabasePluginStorage(globalDb, pluginId);
    } else {
      console.warn(`[Storage] Database not available, using in-memory storage for plugin: ${pluginId}`);
      storage = new InMemoryPluginStorage(pluginId);
    }
    storageInstances.set(pluginId, storage);
  }
  return storage;
}
