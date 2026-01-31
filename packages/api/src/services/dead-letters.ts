/**
 * Dead Letter Service
 *
 * Manages dead letter events - failed events that exceeded max retries.
 * Supports auto-retry with backoff and manual intervention.
 *
 * @see events-ops wish
 */

import {
  type DeadLetterEntry,
  type EventBus,
  type EventType,
  NotFoundError,
  calculateNextAutoRetryAt,
  createDeadLetterSystemPayload,
  createLogger,
  prepareDeadLetterInsert,
} from '@omni/core';
import type { Database, DeadLetterStatus } from '@omni/db';
import { deadLetterEvents } from '@omni/db';
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

const log = createLogger('dead-letters');

/**
 * Filter options for listing dead letters
 */
export interface ListDeadLettersOptions {
  status?: DeadLetterStatus[];
  eventType?: string[];
  since?: Date;
  until?: Date;
  limit?: number;
  cursor?: string;
}

/**
 * Result for manual retry operation
 */
export interface RetryResult {
  success: boolean;
  deadLetterId: string;
  error?: string;
}

/**
 * Dead Letter Service class
 */
export class DeadLetterService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List dead letters with filtering
   */
  async list(options: ListDeadLettersOptions = {}): Promise<{
    items: DeadLetterEntry[];
    hasMore: boolean;
    cursor?: string;
    total?: number;
  }> {
    const { status, eventType, since, until, limit = 50, cursor } = options;

    const conditions = [];

    if (status?.length) {
      conditions.push(inArray(deadLetterEvents.status, status));
    }

    if (eventType?.length) {
      conditions.push(inArray(deadLetterEvents.eventType, eventType));
    }

    if (since) {
      conditions.push(gte(deadLetterEvents.createdAt, since));
    }

    if (until) {
      conditions.push(lte(deadLetterEvents.createdAt, until));
    }

    if (cursor) {
      conditions.push(sql`${deadLetterEvents.createdAt} < ${cursor}`);
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const items = await this.db
      .select()
      .from(deadLetterEvents)
      .where(whereClause)
      .orderBy(desc(deadLetterEvents.createdAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items: items as DeadLetterEntry[],
      hasMore,
      cursor: lastItem?.createdAt.toISOString(),
    };
  }

  /**
   * Get a single dead letter by ID
   */
  async getById(id: string): Promise<DeadLetterEntry> {
    const [result] = await this.db.select().from(deadLetterEvents).where(eq(deadLetterEvents.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('DeadLetterEvent', id);
    }

    return result as DeadLetterEntry;
  }

  /**
   * Create a new dead letter entry
   */
  async create(options: {
    event: Parameters<typeof prepareDeadLetterInsert>[0]['event'];
    subject: string;
    error: Error;
    retryCount: number;
  }): Promise<DeadLetterEntry> {
    const insertData = prepareDeadLetterInsert(options);

    const [result] = await this.db.insert(deadLetterEvents).values(insertData).returning();

    if (!result) {
      throw new Error('Failed to create dead letter entry');
    }

    log.info('Dead letter created', {
      deadLetterId: result.id,
      eventId: result.eventId,
      eventType: result.eventType,
      nextAutoRetryAt: result.nextAutoRetryAt?.toISOString(),
    });

    // Publish system event
    if (this.eventBus) {
      try {
        const systemPayload = createDeadLetterSystemPayload(result.id, result);
        await this.eventBus.publishGeneric(
          'system.dead_letter',
          { ...systemPayload },
          {
            source: 'dead-letter-service',
          },
        );
      } catch (err) {
        log.error('Failed to publish dead letter system event', { error: String(err) });
      }
    }

    return result as DeadLetterEntry;
  }

  /**
   * Manually retry a dead letter
   */
  async retry(id: string): Promise<RetryResult> {
    const deadLetter = await this.getById(id);

    if (deadLetter.status === 'resolved') {
      return { success: false, deadLetterId: id, error: 'Dead letter already resolved' };
    }

    if (deadLetter.status === 'retrying') {
      return { success: false, deadLetterId: id, error: 'Dead letter already retrying' };
    }

    // Update status to retrying
    await this.db
      .update(deadLetterEvents)
      .set({
        status: 'retrying',
        lastRetryAt: new Date(),
      })
      .where(eq(deadLetterEvents.id, id));

    // Try to republish the original event
    if (this.eventBus) {
      try {
        const originalEvent = deadLetter.payload;
        await this.eventBus.publishGeneric(deadLetter.eventType as EventType, originalEvent, {
          source: 'dead-letter-retry',
        });

        // Mark as resolved on successful retry
        await this.db
          .update(deadLetterEvents)
          .set({
            status: 'resolved',
            resolvedAt: new Date(),
            resolvedBy: 'manual-retry',
            manualRetryCount: deadLetter.manualRetryCount + 1,
          })
          .where(eq(deadLetterEvents.id, id));

        log.info('Dead letter manually retried successfully', { deadLetterId: id });
        return { success: true, deadLetterId: id };
      } catch (err) {
        // Update retry count and status back to pending
        const newAutoRetryCount = deadLetter.autoRetryCount;
        await this.db
          .update(deadLetterEvents)
          .set({
            status: 'pending',
            manualRetryCount: deadLetter.manualRetryCount + 1,
            nextAutoRetryAt: calculateNextAutoRetryAt(newAutoRetryCount),
          })
          .where(eq(deadLetterEvents.id, id));

        log.error('Dead letter manual retry failed', { deadLetterId: id, error: String(err) });
        return { success: false, deadLetterId: id, error: String(err) };
      }
    }

    return { success: false, deadLetterId: id, error: 'Event bus not available' };
  }

  /**
   * Mark a dead letter as resolved with a note
   */
  async resolve(id: string, note: string): Promise<DeadLetterEntry> {
    const deadLetter = await this.getById(id);

    if (deadLetter.status === 'resolved') {
      throw new Error('Dead letter already resolved');
    }

    const [updated] = await this.db
      .update(deadLetterEvents)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: note,
        nextAutoRetryAt: null,
      })
      .where(eq(deadLetterEvents.id, id))
      .returning();

    log.info('Dead letter resolved', { deadLetterId: id, note });
    return updated as DeadLetterEntry;
  }

  /**
   * Abandon a dead letter (stop auto-retrying)
   */
  async abandon(id: string): Promise<DeadLetterEntry> {
    const deadLetter = await this.getById(id);

    if (deadLetter.status === 'resolved') {
      throw new Error('Cannot abandon resolved dead letter');
    }

    if (deadLetter.status === 'abandoned') {
      throw new Error('Dead letter already abandoned');
    }

    const [updated] = await this.db
      .update(deadLetterEvents)
      .set({
        status: 'abandoned',
        nextAutoRetryAt: null,
      })
      .where(eq(deadLetterEvents.id, id))
      .returning();

    log.info('Dead letter abandoned', { deadLetterId: id });
    return updated as DeadLetterEntry;
  }

  /**
   * Process due auto-retries
   * Called by scheduler every 15 minutes
   */
  async processAutoRetries(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const now = new Date();
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    // Find pending dead letters with due auto-retry
    const dueForRetry = await this.db
      .select()
      .from(deadLetterEvents)
      .where(and(eq(deadLetterEvents.status, 'pending'), lte(deadLetterEvents.nextAutoRetryAt, now)))
      .limit(100); // Process in batches

    for (const deadLetter of dueForRetry) {
      processed++;

      // Mark as retrying
      await this.db
        .update(deadLetterEvents)
        .set({ status: 'retrying', lastRetryAt: now })
        .where(eq(deadLetterEvents.id, deadLetter.id));

      // Try to republish
      if (this.eventBus) {
        try {
          const originalEvent = deadLetter.payload as Record<string, unknown>;
          await this.eventBus.publishGeneric(deadLetter.eventType as EventType, originalEvent, {
            source: 'dead-letter-auto-retry',
          });

          // Success - mark as resolved
          await this.db
            .update(deadLetterEvents)
            .set({
              status: 'resolved',
              resolvedAt: now,
              resolvedBy: `auto-retry-${deadLetter.autoRetryCount + 1}`,
            })
            .where(eq(deadLetterEvents.id, deadLetter.id));

          succeeded++;
          log.info('Auto-retry succeeded', { deadLetterId: deadLetter.id });
        } catch (err) {
          // Failed - increment retry count and schedule next
          const newRetryCount = deadLetter.autoRetryCount + 1;
          const nextRetry = calculateNextAutoRetryAt(newRetryCount, now);

          await this.db
            .update(deadLetterEvents)
            .set({
              status: 'pending',
              autoRetryCount: newRetryCount,
              nextAutoRetryAt: nextRetry,
              error: `${deadLetter.error}\n[Auto-retry ${newRetryCount}]: ${String(err)}`,
            })
            .where(eq(deadLetterEvents.id, deadLetter.id));

          failed++;
          log.warn('Auto-retry failed', {
            deadLetterId: deadLetter.id,
            retryCount: newRetryCount,
            nextRetryAt: nextRetry?.toISOString() ?? 'manual-only',
          });
        }
      }
    }

    if (processed > 0) {
      log.info('Auto-retry batch completed', { processed, succeeded, failed });
    }

    return { processed, succeeded, failed };
  }

  /**
   * Get count of pending dead letters (for metrics)
   */
  async getPendingCount(): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deadLetterEvents)
      .where(eq(deadLetterEvents.status, 'pending'));

    return result?.count ?? 0;
  }

  /**
   * Get dead letter statistics
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    resolved: number;
    abandoned: number;
    byEventType: Record<string, number>;
  }> {
    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${deadLetterEvents.status} = 'pending')::int`,
        resolved: sql<number>`count(*) filter (where ${deadLetterEvents.status} = 'resolved')::int`,
        abandoned: sql<number>`count(*) filter (where ${deadLetterEvents.status} = 'abandoned')::int`,
      })
      .from(deadLetterEvents);

    const byType = await this.db
      .select({
        eventType: deadLetterEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(deadLetterEvents)
      .groupBy(deadLetterEvents.eventType);

    return {
      total: totals?.total ?? 0,
      pending: totals?.pending ?? 0,
      resolved: totals?.resolved ?? 0,
      abandoned: totals?.abandoned ?? 0,
      byEventType: Object.fromEntries(byType.map((r) => [r.eventType, r.count])),
    };
  }

  /**
   * Cleanup old dead letters (30-day retention)
   */
  async cleanupExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await this.db
      .delete(deadLetterEvents)
      .where(
        and(
          lte(deadLetterEvents.createdAt, cutoff),
          or(eq(deadLetterEvents.status, 'resolved'), eq(deadLetterEvents.status, 'abandoned')),
        ),
      )
      .returning({ id: deadLetterEvents.id });

    if (result.length > 0) {
      log.info('Cleaned up expired dead letters', { count: result.length });
    }

    return result.length;
  }
}
