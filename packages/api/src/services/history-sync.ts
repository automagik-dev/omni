/**
 * History sync service - handles message history synchronization
 *
 * @see history-sync wish
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import { NotFoundError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type SyncJobProgress, syncJobs } from '@omni/db';
import { eq } from 'drizzle-orm';

const log = createLogger('services:history-sync');

/**
 * Rate limiter configuration per platform
 */
export interface RateLimitConfig {
  messagesPerMinute: number;
  cooldownOnError: number; // ms
  maxRetries: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'whatsapp-baileys': {
    messagesPerMinute: 30,
    cooldownOnError: 60000,
    maxRetries: 3,
  },
  discord: {
    messagesPerMinute: 50,
    cooldownOnError: 60000,
    maxRetries: 3,
  },
  default: {
    messagesPerMinute: 20,
    cooldownOnError: 60000,
    maxRetries: 3,
  },
};

export class HistorySyncService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
    private _channelRegistry: ChannelRegistry,
  ) {}

  /**
   * Process a sync job
   */
  async processJob(jobId: string): Promise<void> {
    // Get job
    const [job] = await this.db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);

    if (!job) {
      throw new NotFoundError('SyncJob', jobId);
    }

    // Update to running
    await this.db.update(syncJobs).set({ status: 'running', startedAt: new Date() }).where(eq(syncJobs.id, jobId));

    try {
      // For now, we mark job as completed since the actual sync
      // happens via Baileys events (messaging-history.set)
      // This infrastructure is ready to process messages as they come in

      await this.db
        .update(syncJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          progress: { fetched: 0, stored: 0, duplicates: 0, mediaDownloaded: 0 } as SyncJobProgress,
        })
        .where(eq(syncJobs.id, jobId));

      log.info('Sync job completed', { jobId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.db
        .update(syncJobs)
        .set({ status: 'failed', errorMessage, completedAt: new Date() })
        .where(eq(syncJobs.id, jobId));

      log.error('Sync job failed', { jobId, error: errorMessage });
      throw error;
    }
  }

  /**
   * Update job progress
   */
  async updateProgress(jobId: string, progress: Partial<SyncJobProgress>): Promise<void> {
    const [job] = await this.db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);

    if (!job) return;

    const currentProgress = (job.progress as SyncJobProgress) ?? {
      fetched: 0,
      stored: 0,
      duplicates: 0,
      mediaDownloaded: 0,
    };

    const updatedProgress: SyncJobProgress = {
      fetched: progress.fetched ?? currentProgress.fetched,
      stored: progress.stored ?? currentProgress.stored,
      duplicates: progress.duplicates ?? currentProgress.duplicates,
      mediaDownloaded: progress.mediaDownloaded ?? currentProgress.mediaDownloaded,
      totalEstimated: progress.totalEstimated ?? currentProgress.totalEstimated,
    };

    await this.db.update(syncJobs).set({ progress: updatedProgress }).where(eq(syncJobs.id, jobId));

    // Emit progress event
    if (this.eventBus && job.instanceId) {
      await this.eventBus.publish('sync.progress', {
        jobId,
        instanceId: job.instanceId,
        type: job.type,
        progress: updatedProgress,
      });
    }
  }

  /**
   * Get rate limit config for a channel
   */
  getRateLimits(channelType: string): RateLimitConfig {
    const config = RATE_LIMITS[channelType];
    if (config) return config;
    return RATE_LIMITS.default as RateLimitConfig;
  }
}
