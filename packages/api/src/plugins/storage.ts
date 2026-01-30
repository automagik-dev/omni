/**
 * In-memory storage implementation for plugins
 *
 * Simple storage that plugins can use for QR codes, auth state, etc.
 * For production, this should be replaced with Redis or similar.
 */

import type { PluginStorage } from '@omni/channel-sdk';

interface StoredValue {
  value: unknown;
  expiresAt?: number;
}

/**
 * In-memory storage for plugin data
 */
export class InMemoryPluginStorage implements PluginStorage {
  private data = new Map<string, StoredValue>();
  private readonly prefix: string;

  constructor(pluginId: string) {
    this.prefix = `plugin:${pluginId}:`;
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private isExpired(stored: StoredValue): boolean {
    return stored.expiresAt !== undefined && Date.now() > stored.expiresAt;
  }

  async get<T>(key: string): Promise<T | null> {
    const stored = this.data.get(this.getKey(key));
    if (!stored) return null;

    if (this.isExpired(stored)) {
      this.data.delete(this.getKey(key));
      return null;
    }

    return stored.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const stored: StoredValue = {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    };
    this.data.set(this.getKey(key), stored);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(this.getKey(key));
  }

  async has(key: string): Promise<boolean> {
    const stored = this.data.get(this.getKey(key));
    if (!stored) return false;

    if (this.isExpired(stored)) {
      this.data.delete(this.getKey(key));
      return false;
    }

    return true;
  }

  async keys(pattern?: string): Promise<string[]> {
    const result: string[] = [];
    const now = Date.now();

    for (const [key, stored] of this.data.entries()) {
      // Skip expired entries
      if (stored.expiresAt && now > stored.expiresAt) {
        this.data.delete(key);
        continue;
      }

      // Check if key matches prefix
      if (!key.startsWith(this.prefix)) continue;

      // Get key without prefix
      const keyWithoutPrefix = key.slice(this.prefix.length);

      // Check pattern if provided
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
 * Global storage instances keyed by plugin ID
 */
const storageInstances = new Map<string, InMemoryPluginStorage>();

/**
 * Get or create storage for a plugin
 */
export function getPluginStorage(pluginId: string): PluginStorage {
  let storage = storageInstances.get(pluginId);
  if (!storage) {
    storage = new InMemoryPluginStorage(pluginId);
    storageInstances.set(pluginId, storage);
  }
  return storage;
}
