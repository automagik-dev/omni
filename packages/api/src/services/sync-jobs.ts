/**
 * Sync job service - manages history sync operations
 *
 * @see history-sync wish
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type JobStatus,
  type NewSyncJob,
  type SyncJob,
  type SyncJobConfig,
  type SyncJobProgress,
  type SyncJobType,
  syncJobs,
} from '@omni/db';
import { and, desc, eq, inArray } from 'drizzle-orm';

export interface CreateSyncJobOptions {
  instanceId: string;
  type: SyncJobType;
  config?: SyncJobConfig;
}

export interface ListSyncJobsOptions {
  instanceId?: string;
  type?: SyncJobType[];
  status?: JobStatus[];
  limit?: number;
  cursor?: string;
}

export interface SyncJobWithStats extends SyncJob {
  progressPercent?: number;
}

export class SyncJobService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * Create a new sync job
   */
  async create(options: CreateSyncJobOptions): Promise<SyncJob> {
    const { instanceId, type, config = {} } = options;

    const jobData: NewSyncJob = {
      instanceId,
      type,
      status: 'pending',
      config,
      progress: { fetched: 0, stored: 0, duplicates: 0, mediaDownloaded: 0 },
    };

    const [created] = await this.db.insert(syncJobs).values(jobData).returning();

    if (!created) {
      throw new Error('Failed to create sync job');
    }

    // Emit sync.started event
    if (this.eventBus) {
      await this.eventBus.publish('sync.started', {
        jobId: created.id,
        instanceId,
        type,
        config,
      });
    }

    return created;
  }

  /**
   * Get sync job by ID
   */
  async getById(id: string): Promise<SyncJob> {
    const [result] = await this.db.select().from(syncJobs).where(eq(syncJobs.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('SyncJob', id);
    }

    return result;
  }

  /**
   * Get sync job with calculated progress percent
   */
  async getByIdWithStats(id: string): Promise<SyncJobWithStats> {
    const job = await this.getById(id);
    return this.addProgressPercent(job);
  }

  /**
   * List sync jobs with filtering
   */
  async list(options: ListSyncJobsOptions = {}): Promise<{
    items: SyncJobWithStats[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const { instanceId, type, status, limit = 50, cursor } = options;

    let query = this.db.select().from(syncJobs).$dynamic();

    const conditions = [];

    if (instanceId) {
      conditions.push(eq(syncJobs.instanceId, instanceId));
    }

    if (type?.length) {
      conditions.push(inArray(syncJobs.type, type));
    }

    if (status?.length) {
      conditions.push(inArray(syncJobs.status, status));
    }

    if (cursor) {
      conditions.push(eq(syncJobs.id, cursor));
    }

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    const items = await query.orderBy(desc(syncJobs.createdAt)).limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const itemsWithStats = items.map((item) => this.addProgressPercent(item));

    const lastItem = items[items.length - 1];
    return {
      items: itemsWithStats,
      hasMore,
      cursor: lastItem?.id,
    };
  }

  /**
   * Start a sync job (set status to running)
   */
  async start(id: string): Promise<SyncJob> {
    const [updated] = await this.db
      .update(syncJobs)
      .set({
        status: 'running',
        startedAt: new Date(),
      })
      .where(eq(syncJobs.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    return updated;
  }

  /**
   * Update job progress
   */
  async updateProgress(id: string, progress: Partial<SyncJobProgress>): Promise<SyncJob> {
    const job = await this.getById(id);
    const currentProgress = (job.progress as SyncJobProgress) ?? {
      fetched: 0,
      stored: 0,
      duplicates: 0,
      mediaDownloaded: 0,
    };

    const updatedProgress: SyncJobProgress = {
      ...currentProgress,
      ...progress,
    };

    const [updated] = await this.db
      .update(syncJobs)
      .set({ progress: updatedProgress })
      .where(eq(syncJobs.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    // Emit progress event
    if (this.eventBus) {
      await this.eventBus.publish('sync.progress', {
        jobId: id,
        instanceId: job.instanceId,
        type: job.type,
        progress: updatedProgress,
      });
    }

    return updated;
  }

  /**
   * Complete a sync job successfully
   */
  async complete(id: string): Promise<SyncJob> {
    const job = await this.getById(id);

    const [updated] = await this.db
      .update(syncJobs)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(syncJobs.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    // Emit completed event
    if (this.eventBus) {
      await this.eventBus.publish('sync.completed', {
        jobId: id,
        instanceId: job.instanceId,
        type: job.type,
        progress: job.progress,
      });
    }

    return updated;
  }

  /**
   * Fail a sync job with error message
   */
  async fail(id: string, errorMessage: string): Promise<SyncJob> {
    const job = await this.getById(id);

    const [updated] = await this.db
      .update(syncJobs)
      .set({
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(syncJobs.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    // Emit failed event
    if (this.eventBus) {
      await this.eventBus.publish('sync.failed', {
        jobId: id,
        instanceId: job.instanceId,
        type: job.type,
        error: errorMessage,
      });
    }

    return updated;
  }

  /**
   * Cancel a sync job
   */
  async cancel(id: string): Promise<SyncJob> {
    const [updated] = await this.db
      .update(syncJobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(eq(syncJobs.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    return updated;
  }

  /**
   * Get active jobs for an instance
   */
  async getActiveForInstance(instanceId: string): Promise<SyncJob[]> {
    return this.db
      .select()
      .from(syncJobs)
      .where(and(eq(syncJobs.instanceId, instanceId), inArray(syncJobs.status, ['pending', 'running'] as JobStatus[])));
  }

  /**
   * Check if there's an active job of a specific type for an instance
   */
  async hasActiveJob(instanceId: string, type: SyncJobType): Promise<boolean> {
    const [job] = await this.db
      .select()
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.instanceId, instanceId),
          eq(syncJobs.type, type),
          inArray(syncJobs.status, ['pending', 'running'] as JobStatus[]),
        ),
      )
      .limit(1);

    return !!job;
  }

  /**
   * Add progress percent to a job
   */
  private addProgressPercent(job: SyncJob): SyncJobWithStats {
    const progress = job.progress as SyncJobProgress;
    let progressPercent: number | undefined;

    if (progress?.totalEstimated && progress.totalEstimated > 0) {
      progressPercent = Math.min(100, Math.round((progress.fetched / progress.totalEstimated) * 100));
    } else if (job.status === 'completed') {
      progressPercent = 100;
    }

    return { ...job, progressPercent };
  }
}
