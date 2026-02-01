/**
 * API Key service - manages API key validation and lifecycle
 *
 * Primary Key:
 * - Auto-generated on first API start if OMNI_API_KEY not set in .env
 * - Full key shown ONLY on first generation, masked thereafter
 * - If OMNI_API_KEY is set in .env, that becomes the primary key (shown masked)
 * - Primary key cannot be deleted from database
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type ApiKey, type NewApiKey, apiKeys } from '@omni/db';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

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
}

/**
 * Result of creating an API key
 */
export interface CreateApiKeyResult {
  key: ApiKey;
  plainTextKey: string; // Only returned once at creation
}

export class ApiKeyService {
  constructor(private db: Database) {}

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
   */
  async validate(key: string): Promise<ValidatedApiKey | null> {
    // Basic format check
    if (!key.startsWith(API_KEY_PREFIX)) {
      log.debug('Invalid key format');
      return null;
    }

    // Hash the key
    const keyHash = await this.hashKey(key);

    // Look up the key
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

    // Update last used timestamp and usage count (fire and forget)
    this.db
      .update(apiKeys)
      .set({
        lastUsedAt: new Date(),
        usageCount: sql`${apiKeys.usageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, apiKey.id))
      .then(() => {})
      .catch((err) => log.error('Failed to update key usage', { error: String(err) }));

    return {
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      instanceIds: apiKey.instanceIds,
      rateLimit: apiKey.rateLimit,
    };
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
   * Revoke an API key
   */
  async revoke(id: string, reason?: string, revokedBy?: string): Promise<ApiKey | null> {
    const [revoked] = await this.db
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

    if (revoked) {
      log.info('API key revoked', { id, reason });
    }

    return revoked ?? null;
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

    return false;
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

    const result = await this.db.delete(apiKeys).where(eq(apiKeys.id, id)).returning();
    return result.length > 0;
  }

  /**
   * Mask an API key for display
   */
  static maskKey(keyPrefix: string): string {
    return `${API_KEY_PREFIX}${keyPrefix}${'*'.repeat(24)}`;
  }
}
