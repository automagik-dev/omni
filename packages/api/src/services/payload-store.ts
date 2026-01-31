/**
 * Payload Storage Service
 *
 * Manages event payload storage with compression and configurable retention.
 * Supports soft-delete for audit trail.
 *
 * @see events-ops wish
 */

import {
  type PayloadStorageConfig as CorePayloadStorageConfig,
  DEFAULT_STORAGE_CONFIG,
  type PayloadEntry,
  type PayloadStage,
  createLogger,
  decompressPayload,
  preparePayloadInsert,
  shouldStoreStage,
} from '@omni/core';
import type { Database, PayloadStorageConfig as DbPayloadStorageConfig } from '@omni/db';
import { eventPayloads, payloadStorageConfig } from '@omni/db';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';

const log = createLogger('payload-store');

/**
 * Payload with decompressed data
 */
export interface PayloadWithData<T = unknown> extends Omit<PayloadEntry, 'payloadCompressed'> {
  payload: T;
}

/**
 * Payload Storage Service class
 */
export class PayloadStoreService {
  private configCache = new Map<string, CorePayloadStorageConfig>();

  constructor(private db: Database) {}

  /**
   * Get storage config for an event type (with caching)
   */
  async getConfig(eventType: string): Promise<CorePayloadStorageConfig> {
    // Check cache first
    const cached = this.configCache.get(eventType);
    if (cached) {
      return cached;
    }

    // Look up specific config
    const [specific] = await this.db
      .select()
      .from(payloadStorageConfig)
      .where(eq(payloadStorageConfig.eventType, eventType))
      .limit(1);

    if (specific) {
      this.configCache.set(eventType, specific);
      return specific;
    }

    // Look up default config ('*')
    const [defaultConfig] = await this.db
      .select()
      .from(payloadStorageConfig)
      .where(eq(payloadStorageConfig.eventType, '*'))
      .limit(1);

    if (defaultConfig) {
      this.configCache.set(eventType, defaultConfig);
      return defaultConfig;
    }

    // Use hardcoded defaults
    return DEFAULT_STORAGE_CONFIG;
  }

  /**
   * Clear config cache (call when config is updated)
   */
  clearConfigCache(): void {
    this.configCache.clear();
  }

  /**
   * Store a payload
   */
  async store(options: {
    eventId: string;
    eventType: string;
    stage: PayloadStage;
    payload: unknown;
  }): Promise<PayloadEntry | null> {
    const { eventId, eventType, stage, payload } = options;

    // Check if we should store this stage
    const config = await this.getConfig(eventType);
    if (!shouldStoreStage(stage, config)) {
      log.debug('Skipping payload storage', { eventId, eventType, stage, reason: 'config-disabled' });
      return null;
    }

    const insertData = preparePayloadInsert({ eventId, eventType, stage, payload });
    const [result] = await this.db.insert(eventPayloads).values(insertData).returning();

    log.debug('Payload stored', {
      eventId,
      stage,
      originalSize: result?.payloadSizeOriginal,
      compressedSize: result?.payloadSizeCompressed,
    });

    return result as PayloadEntry;
  }

  /**
   * Get payloads for an event
   */
  async getByEventId(eventId: string): Promise<PayloadEntry[]> {
    const results = await this.db
      .select()
      .from(eventPayloads)
      .where(and(eq(eventPayloads.eventId, eventId), isNull(eventPayloads.deletedAt)))
      .orderBy(desc(eventPayloads.timestamp));

    return results as PayloadEntry[];
  }

  /**
   * Get a specific payload by event ID and stage
   */
  async getByStage(eventId: string, stage: PayloadStage): Promise<PayloadWithData | null> {
    const [result] = await this.db
      .select()
      .from(eventPayloads)
      .where(and(eq(eventPayloads.eventId, eventId), eq(eventPayloads.stage, stage), isNull(eventPayloads.deletedAt)))
      .limit(1);

    if (!result) {
      return null;
    }

    const payload = decompressPayload(result.payloadCompressed);
    const { payloadCompressed: _, ...rest } = result;

    return {
      ...rest,
      payload,
    } as PayloadWithData;
  }

  /**
   * Soft-delete payloads for an event
   */
  async softDelete(eventId: string, deletedBy: string, reason: string): Promise<number> {
    const now = new Date();

    const result = await this.db
      .update(eventPayloads)
      .set({
        deletedAt: now,
        deletedBy,
        deleteReason: reason,
        // Clear the actual payload data but keep metadata for audit
        payloadCompressed: '',
      })
      .where(and(eq(eventPayloads.eventId, eventId), isNull(eventPayloads.deletedAt)))
      .returning({ id: eventPayloads.id });

    log.info('Payloads soft-deleted', { eventId, count: result.length, deletedBy, reason });
    return result.length;
  }

  /**
   * List storage configs
   */
  async listConfigs(): Promise<DbPayloadStorageConfig[]> {
    const results = await this.db.select().from(payloadStorageConfig).orderBy(payloadStorageConfig.eventType);

    return results;
  }

  /**
   * Update or create storage config for an event type
   */
  async upsertConfig(eventType: string, config: Partial<CorePayloadStorageConfig>): Promise<DbPayloadStorageConfig> {
    const now = new Date();

    const [result] = await this.db
      .insert(payloadStorageConfig)
      .values({
        eventType,
        ...config,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: payloadStorageConfig.eventType,
        set: {
          ...config,
          updatedAt: now,
        },
      })
      .returning();

    // Clear cache for this type
    this.configCache.delete(eventType);

    log.info('Payload storage config updated', { eventType });

    if (!result) {
      throw new Error('Failed to create/update payload storage config');
    }

    return result;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalPayloads: number;
    totalSizeOriginal: number;
    totalSizeCompressed: number;
    avgCompressionRatio: number;
    byStage: Record<string, number>;
    byEventType: Record<string, number>;
  }> {
    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        totalOriginal: sql<number>`coalesce(sum(${eventPayloads.payloadSizeOriginal}), 0)::bigint`,
        totalCompressed: sql<number>`coalesce(sum(${eventPayloads.payloadSizeCompressed}), 0)::bigint`,
      })
      .from(eventPayloads)
      .where(isNull(eventPayloads.deletedAt));

    const byStage = await this.db
      .select({
        stage: eventPayloads.stage,
        count: sql<number>`count(*)::int`,
      })
      .from(eventPayloads)
      .where(isNull(eventPayloads.deletedAt))
      .groupBy(eventPayloads.stage);

    const byEventType = await this.db
      .select({
        eventType: eventPayloads.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(eventPayloads)
      .where(isNull(eventPayloads.deletedAt))
      .groupBy(eventPayloads.eventType);

    const totalOriginal = Number(totals?.totalOriginal ?? 0);
    const totalCompressed = Number(totals?.totalCompressed ?? 0);

    return {
      totalPayloads: totals?.total ?? 0,
      totalSizeOriginal: totalOriginal,
      totalSizeCompressed: totalCompressed,
      avgCompressionRatio: totalCompressed > 0 ? totalOriginal / totalCompressed : 0,
      byStage: Object.fromEntries(byStage.map((r) => [r.stage, r.count])),
      byEventType: Object.fromEntries(byEventType.map((r) => [r.eventType, r.count])),
    };
  }

  /**
   * Cleanup expired payloads based on retention config
   */
  async cleanupExpired(): Promise<number> {
    // Get all configs for retention
    const configs = await this.listConfigs();
    const defaultRetention = DEFAULT_STORAGE_CONFIG.retentionDays;

    let totalDeleted = 0;

    // For each event type with config, apply specific retention
    for (const config of configs) {
      if (config.eventType === '*') continue;

      const cutoff = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000);

      const deleted = await this.db
        .delete(eventPayloads)
        .where(and(eq(eventPayloads.eventType, config.eventType), lte(eventPayloads.timestamp, cutoff)))
        .returning({ id: eventPayloads.id });

      totalDeleted += deleted.length;
    }

    // Apply default retention to unconfigured types
    const defaultCutoff = new Date(Date.now() - defaultRetention * 24 * 60 * 60 * 1000);
    const configuredTypes = configs.filter((c) => c.eventType !== '*').map((c) => c.eventType);

    if (configuredTypes.length > 0) {
      const deleted = await this.db
        .delete(eventPayloads)
        .where(
          and(
            sql`${eventPayloads.eventType} NOT IN (${sql.join(
              configuredTypes.map((t) => sql`${t}`),
              sql`, `,
            )})`,
            lte(eventPayloads.timestamp, defaultCutoff),
          ),
        )
        .returning({ id: eventPayloads.id });

      totalDeleted += deleted.length;
    } else {
      // No specific configs, apply default to all
      const deleted = await this.db
        .delete(eventPayloads)
        .where(lte(eventPayloads.timestamp, defaultCutoff))
        .returning({ id: eventPayloads.id });

      totalDeleted += deleted.length;
    }

    if (totalDeleted > 0) {
      log.info('Cleaned up expired payloads', { count: totalDeleted });
    }

    return totalDeleted;
  }
}
