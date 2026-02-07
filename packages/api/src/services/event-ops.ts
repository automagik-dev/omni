/**
 * Event Operations Service
 *
 * Provides replay, metrics, and cleanup functionality for events.
 * Coordinates dead letter auto-retry and payload cleanup.
 *
 * @see events-ops wish
 */

import {
  type EventBus,
  type ReplayOptions,
  type ReplayResult,
  type ReplaySession,
  createLogger,
  createReplayCompletedPayload,
  createReplayStartedPayload,
  validateReplayOptions,
} from '@omni/core';
import type { Database, OmniEvent } from '@omni/db';
import { omniEvents } from '@omni/db';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { DeadLetterService } from './dead-letters';
import type { PayloadStoreService } from './payload-store';

const log = createLogger('event-ops');

/**
 * Event metrics summary
 */
export interface EventMetrics {
  // Volume metrics
  totalEvents: number;
  eventsLast24h: number;
  eventsLast7d: number;
  eventsLastHour: number;

  // Rate metrics
  eventsPerHour: number;
  eventsPerMinute: number;

  // Status breakdown
  completed: number;
  failed: number;
  pending: number;

  // Performance metrics
  avgProcessingTimeMs: number | null;
  avgAgentLatencyMs: number | null;
  p95ProcessingTimeMs: number | null;

  // Error analysis
  failureRate: number;
  errorsByStage: Record<string, number>;

  // Dead letter stats
  deadLettersPending: number;
  deadLettersResolved: number;

  // Storage stats
  payloadsStored: number;
  storageSizeBytes: number;
}

/**
 * Event Operations Service class
 */
export class EventOpsService {
  private replaySessions = new Map<string, ReplaySession>();
  private activeReplayId: string | null = null;

  constructor(
    private db: Database,
    private eventBus: EventBus | null,
    private deadLetterService: DeadLetterService,
    private payloadStoreService: PayloadStoreService,
  ) {}

  // ===========================================================================
  // REPLAY OPERATIONS
  // ===========================================================================

  /**
   * Start a replay session
   */
  async startReplay(options: ReplayOptions): Promise<ReplaySession> {
    // Validate options
    const validation = validateReplayOptions(options);
    if (!validation.valid) {
      throw new Error(`Invalid replay options: ${validation.error}`);
    }

    // Check if another replay is running
    if (this.activeReplayId) {
      throw new Error('Another replay is already running');
    }

    const sessionId = crypto.randomUUID();
    const now = new Date();

    // Count total events to replay
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(omniEvents)
      .where(this.buildReplayWhereClause(options));

    const total = countResult?.count ?? 0;

    const session: ReplaySession = {
      id: sessionId,
      options,
      status: 'running',
      progress: {
        total,
        processed: 0,
        skipped: 0,
        errors: 0,
        startedAt: now,
      },
      startedAt: now,
      dryRun: options.dryRun ?? false,
    };

    this.replaySessions.set(sessionId, session);
    this.activeReplayId = sessionId;

    // Publish system event
    if (this.eventBus) {
      try {
        const payload = createReplayStartedPayload(sessionId, options);
        await this.eventBus.publishGeneric(
          'system.replay.started',
          { ...payload },
          {
            source: 'event-ops',
          },
        );
      } catch (err) {
        log.error('Failed to publish replay started event', { error: String(err) });
      }
    }

    // Start replay in background
    this.executeReplay(sessionId, options).catch((err) => {
      log.error('Replay failed', { sessionId, error: String(err) });
    });

    log.info('Replay started', { sessionId, total, options });
    return session;
  }

  /**
   * Get replay session status
   */
  getReplaySession(sessionId: string): ReplaySession | undefined {
    return this.replaySessions.get(sessionId);
  }

  /**
   * List all replay sessions
   */
  listReplaySessions(): ReplaySession[] {
    return Array.from(this.replaySessions.values());
  }

  /**
   * Cancel a running replay
   */
  cancelReplay(sessionId: string): boolean {
    const session = this.replaySessions.get(sessionId);
    if (!session || session.status !== 'running') {
      return false;
    }

    session.status = 'cancelled';
    if (this.activeReplayId === sessionId) {
      this.activeReplayId = null;
    }

    log.info('Replay cancelled', { sessionId });
    return true;
  }

  // ===========================================================================
  // METRICS
  // ===========================================================================

  /**
   * Get comprehensive event metrics
   */
  async getMetrics(): Promise<EventMetrics> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    // Volume and status metrics
    const [volumeStats] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${omniEvents.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${omniEvents.status} = 'failed')::int`,
        pending: sql<number>`count(*) filter (where ${omniEvents.status} = 'pending')::int`,
        avgProcessingTime: sql<number>`avg(${omniEvents.processingTimeMs})::int`,
        avgAgentLatency: sql<number>`avg(${omniEvents.agentLatencyMs})::int`,
        p95ProcessingTime: sql<number>`percentile_cont(0.95) within group (order by ${omniEvents.processingTimeMs})::int`,
      })
      .from(omniEvents);

    // 24h count
    const [last24hStats] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(omniEvents)
      .where(gte(omniEvents.receivedAt, last24h));

    // 7d count
    const [last7dStats] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(omniEvents)
      .where(gte(omniEvents.receivedAt, last7d));

    // 1h count
    const [lastHourStats] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(omniEvents)
      .where(gte(omniEvents.receivedAt, lastHour));

    // Error stages
    const errorStages = await this.db
      .select({
        stage: omniEvents.errorStage,
        count: sql<number>`count(*)::int`,
      })
      .from(omniEvents)
      .where(sql`${omniEvents.errorStage} is not null`)
      .groupBy(omniEvents.errorStage);

    // Dead letter stats
    const dlStats = await this.deadLetterService.getStats();

    // Payload stats
    const payloadStats = await this.payloadStoreService.getStats();

    const total = volumeStats?.total ?? 0;
    const failed = volumeStats?.failed ?? 0;
    const eventsLast24hCount = last24hStats?.count ?? 0;
    const eventsLastHourCount = lastHourStats?.count ?? 0;

    return {
      totalEvents: total,
      eventsLast24h: eventsLast24hCount,
      eventsLast7d: last7dStats?.count ?? 0,
      eventsLastHour: eventsLastHourCount,

      eventsPerHour: eventsLast24hCount / 24,
      eventsPerMinute: eventsLastHourCount / 60,

      completed: volumeStats?.completed ?? 0,
      failed,
      pending: volumeStats?.pending ?? 0,

      avgProcessingTimeMs: volumeStats?.avgProcessingTime ?? null,
      avgAgentLatencyMs: volumeStats?.avgAgentLatency ?? null,
      p95ProcessingTimeMs: volumeStats?.p95ProcessingTime ?? null,

      failureRate: total > 0 ? (failed / total) * 100 : 0,
      errorsByStage: Object.fromEntries(
        errorStages
          .filter((e): e is typeof e & { stage: NonNullable<typeof e.stage> } => e.stage != null)
          .map((e) => [e.stage, e.count]),
      ),

      deadLettersPending: dlStats.pending,
      deadLettersResolved: dlStats.resolved,

      payloadsStored: payloadStats.totalPayloads,
      storageSizeBytes: payloadStats.totalSizeCompressed,
    };
  }

  // ===========================================================================
  // SCHEDULED OPERATIONS
  // ===========================================================================

  /**
   * Run all scheduled operations (called by scheduler every 15 minutes)
   */
  async runScheduledOps(): Promise<{
    autoRetry: { processed: number; succeeded: number; failed: number };
    payloadCleanup: number;
    deadLetterCleanup: number;
  }> {
    log.info('Running scheduled event ops');

    const [autoRetry, payloadCleanup, deadLetterCleanup] = await Promise.all([
      this.deadLetterService.processAutoRetries(),
      this.payloadStoreService.cleanupExpired(),
      this.deadLetterService.cleanupExpired(),
    ]);

    log.info('Scheduled event ops completed', {
      autoRetry,
      payloadCleanup,
      deadLetterCleanup,
    });

    return { autoRetry, payloadCleanup, deadLetterCleanup };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Build WHERE clause for replay queries
   */
  private buildReplayWhereClause(options: ReplayOptions) {
    const conditions = [gte(omniEvents.receivedAt, options.since)];

    if (options.until) {
      conditions.push(lte(omniEvents.receivedAt, options.until));
    }

    if (options.eventTypes?.length) {
      conditions.push(inArray(omniEvents.eventType, options.eventTypes as OmniEvent['eventType'][]));
    }

    if (options.instanceId) {
      conditions.push(eq(omniEvents.instanceId, options.instanceId));
    }

    return and(...conditions);
  }

  /**
   * Execute replay in background
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Replay execution is inherently complex
  private async executeReplay(sessionId: string, options: ReplayOptions): Promise<void> {
    const session = this.replaySessions.get(sessionId);
    if (!session) return;

    const errors: Array<{ eventId: string; error: string }> = [];
    const batchSize = 100;
    let offset = 0;

    try {
      while (session.status === 'running') {
        // Fetch batch of events
        const events = await this.db
          .select()
          .from(omniEvents)
          .where(this.buildReplayWhereClause(options))
          .orderBy(asc(omniEvents.receivedAt))
          .limit(batchSize)
          .offset(offset);

        if (events.length === 0) break;

        for (const event of events) {
          if (session.status !== 'running') break;

          // Check limit
          if (options.limit && session.progress.processed >= options.limit) {
            session.status = 'completed';
            break;
          }

          // Skip already processed if requested
          if (options.skipProcessed && event.status === 'completed') {
            session.progress.skipped++;
            continue;
          }

          // Handle dry-run mode (count but don't publish)
          if (options.dryRun) {
            session.progress.processed++;
            session.progress.currentEventTime = event.receivedAt;
            continue;
          }

          // Replay the event (non dry-run)
          if (this.eventBus) {
            try {
              // Reconstruct event from stored data
              const replayPayload = {
                instanceId: event.instanceId,
                channel: event.channel,
                textContent: event.textContent,
                // Mark as replayed
                _replay: true,
                _replaySessionId: sessionId,
                _originalEventId: event.id,
              };

              await this.eventBus.publishGeneric(event.eventType, replayPayload as Record<string, unknown>, {
                source: 'replay',
              });

              session.progress.processed++;
              session.progress.currentEventTime = event.receivedAt;
            } catch (err) {
              session.progress.errors++;
              errors.push({
                eventId: event.id,
                error: String(err),
              });
            }
          }

          // Apply speed multiplier (simulate real-time if > 0)
          const speedMult = options.speedMultiplier;
          if (speedMult && speedMult > 0) {
            // This would need the actual time difference between events
            // Simplified: just add a small delay
            await new Promise((resolve) => setTimeout(resolve, 10 / speedMult));
          }
        }

        offset += batchSize;
      }

      // Mark completed if not cancelled
      if (session.status === 'running') {
        session.status = 'completed';
      }
    } catch (err) {
      session.status = 'failed';
      session.error = String(err);
      log.error('Replay execution failed', { sessionId, error: String(err) });
    } finally {
      session.completedAt = new Date();
      this.activeReplayId = null;

      // Calculate result
      const durationMs = session.completedAt.getTime() - session.startedAt.getTime();

      const result: ReplayResult = {
        success: session.status === 'completed',
        eventsProcessed: session.progress.processed,
        eventsSkipped: session.progress.skipped,
        errors: session.progress.errors,
        durationMs,
        errorDetails: errors.length > 0 ? errors.slice(0, 100) : undefined,
      };

      // Publish completion event
      if (this.eventBus) {
        try {
          const payload = createReplayCompletedPayload(sessionId, result);
          await this.eventBus.publishGeneric(
            'system.replay.completed',
            { ...payload },
            {
              source: 'event-ops',
            },
          );
        } catch (err) {
          log.error('Failed to publish replay completed event', { error: String(err) });
        }
      }

      log.info('Replay completed', {
        sessionId,
        status: session.status,
        processed: session.progress.processed,
        skipped: session.progress.skipped,
        errors: session.progress.errors,
        durationMs,
      });
    }
  }
}
