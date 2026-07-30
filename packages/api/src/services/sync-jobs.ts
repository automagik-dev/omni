/**
 * Sync job service - manages history sync operations
 *
 * @see history-sync wish
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
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
import { scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';

export interface CreateSyncJobOptions {
  instanceId: string;
  channelType: ChannelType;
  type: SyncJobType;
  config?: SyncJobConfig;
  /**
   * The work item's trusted tenant (G5, ADR-0008), threaded by a worker caller:
   * the scheduler's per-tenant fan-out or the `sync.started` consumer's
   * envelope. Derived from persisted ownership or producer-stamped metadata,
   * NEVER from a payload claim. Omitted by route callers, which already run
   * inside their own request scope, and by the flag-off world.
   */
  tenantId?: string | null;
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
  /**
   * The handle every query in this service uses.
   *
   * Inside a tenant-scoped request this is the request's tenant-stamped
   * transaction (wish: omni-full-multitenancy, G4 — see `tenancy/tenant-scope.ts`);
   * for a legacy credential, a worker, or the CLI it is the ambient pool and
   * the query issued is byte-for-byte the one issued before the conversion.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  /**
   * Run one discrete DB block in the work item's world (G5, ADR-0008).
   *
   * Every mutating method here writes the database AND publishes a `sync.*`
   * event, so a worker caller cannot wrap the whole call in a scope: a worker
   * transaction held across a publish would make the event a pre-commit side
   * effect — a phantom on rollback. Instead the caller THREADS its trusted
   * tenant and each DB block scopes itself; the publish sits between blocks.
   *
   * With nothing threaded this passes straight through, so a route caller stays
   * on its own request transaction and a legacy/flag-off worker keeps the exact
   * pre-G5 ambient query.
   */
  private workDb<T>(trustedTenantId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    return runTenantWorkDb(this.pool, trustedTenantId, fn);
  }

  constructor(
    private readonly pool: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * Create a new sync job
   */
  async create(options: CreateSyncJobOptions): Promise<SyncJob> {
    const { instanceId, channelType, type, config = {}, tenantId } = options;

    const jobData: NewSyncJob = {
      instanceId,
      channel: channelType,
      type,
      status: 'pending',
      config,
      progress: { fetched: 0, stored: 0, duplicates: 0, mediaDownloaded: 0 },
    };

    // `sync_jobs` derives its tenant from the REQUIRED `instance_id` parent, so
    // this insert is RLS-stamped under the threaded tenant and REFUSED outright
    // if it names another tenant's instance.
    const [created] = await this.workDb(tenantId, () => this.db.insert(syncJobs).values(jobData).returning());

    if (!created) {
      throw new Error('Failed to create sync job');
    }

    // Emit sync.started event with proper metadata for hierarchical subjects.
    // The publish sits OUTSIDE the DB block above and carries the job's tenant
    // EXPLICITLY (G5, ADR-0008): `created.tenantId` is what the row was actually
    // stamped with by the derivation trigger, so the `sync.started` consumer
    // derives its worker scope from persisted ownership rather than from
    // whatever ambient scope happened to be active at publish time.
    if (this.eventBus) {
      await this.eventBus.publish(
        'sync.started',
        {
          jobId: created.id,
          instanceId,
          type,
          config,
        },
        { instanceId, channelType, tenantId: created.tenantId ?? undefined },
      );
    }

    return created;
  }

  /**
   * Get sync job by ID.
   *
   * `trustedTenantId` (G5, ADR-0008) is threaded by worker callers; a route
   * caller omits it and stays on its own request scope. Under enforcement a job
   * belonging to another tenant is invisible, so this raises `NotFoundError`
   * rather than leaking its existence.
   */
  async getById(id: string, trustedTenantId?: string | null): Promise<SyncJob> {
    const [result] = await this.workDb(trustedTenantId, () =>
      this.db.select().from(syncJobs).where(eq(syncJobs.id, id)).limit(1),
    );

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
  async start(id: string, trustedTenantId?: string | null): Promise<SyncJob> {
    const [updated] = await this.workDb(trustedTenantId, () =>
      this.db
        .update(syncJobs)
        .set({
          status: 'running',
          startedAt: new Date(),
        })
        .where(eq(syncJobs.id, id))
        .returning(),
    );

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    return updated;
  }

  /**
   * Update job progress
   */
  async updateProgress(
    id: string,
    progress: Partial<SyncJobProgress>,
    trustedTenantId?: string | null,
  ): Promise<SyncJob> {
    const job = await this.getById(id, trustedTenantId);
    const currentProgress = (job.progress as SyncJobProgress) ?? {
      fetched: 0,
      stored: 0,
      duplicates: 0,
      mediaDownloaded: 0,
    };

    const updatedProgress: SyncJobProgress = {
      ...currentProgress,
      ...progress,
      lastProgressAt: new Date().toISOString(),
    };

    const [updated] = await this.workDb(trustedTenantId, () =>
      this.db.update(syncJobs).set({ progress: updatedProgress }).where(eq(syncJobs.id, id)).returning(),
    );

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    // Emit progress event with proper metadata for hierarchical subjects
    if (this.eventBus) {
      await this.eventBus.publish(
        'sync.progress',
        {
          jobId: id,
          instanceId: job.instanceId,
          type: job.type,
          progress: updatedProgress,
        },
        { instanceId: job.instanceId, channelType: job.channel, tenantId: updated.tenantId ?? undefined },
      );
    }

    return updated;
  }

  /**
   * Complete a sync job successfully
   */
  async complete(id: string, trustedTenantId?: string | null): Promise<SyncJob> {
    const job = await this.getById(id, trustedTenantId);

    const [updated] = await this.workDb(trustedTenantId, () =>
      this.db
        .update(syncJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
        })
        .where(eq(syncJobs.id, id))
        .returning(),
    );

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    // Emit completed event with proper metadata for hierarchical subjects
    if (this.eventBus) {
      await this.eventBus.publish(
        'sync.completed',
        {
          jobId: id,
          instanceId: job.instanceId,
          type: job.type,
          progress: job.progress,
        },
        { instanceId: job.instanceId, channelType: job.channel, tenantId: updated.tenantId ?? undefined },
      );
    }

    return updated;
  }

  /**
   * Fail a sync job with error message
   */
  async fail(id: string, errorMessage: string, trustedTenantId?: string | null): Promise<SyncJob> {
    const job = await this.getById(id, trustedTenantId);

    const [updated] = await this.workDb(trustedTenantId, () =>
      this.db
        .update(syncJobs)
        .set({
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        })
        .where(eq(syncJobs.id, id))
        .returning(),
    );

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    // Emit failed event with proper metadata for hierarchical subjects
    if (this.eventBus) {
      await this.eventBus.publish(
        'sync.failed',
        {
          jobId: id,
          instanceId: job.instanceId,
          type: job.type,
          error: errorMessage,
        },
        { instanceId: job.instanceId, channelType: job.channel, tenantId: updated.tenantId ?? undefined },
      );
    }

    return updated;
  }

  /**
   * Cancel a sync job
   */
  async cancel(id: string, trustedTenantId?: string | null): Promise<SyncJob> {
    const [updated] = await this.workDb(trustedTenantId, () =>
      this.db
        .update(syncJobs)
        .set({
          status: 'cancelled',
          completedAt: new Date(),
        })
        .where(eq(syncJobs.id, id))
        .returning(),
    );

    if (!updated) {
      throw new NotFoundError('SyncJob', id);
    }

    return updated;
  }

  /**
   * Get active jobs for an instance
   */
  async getActiveForInstance(instanceId: string, trustedTenantId?: string | null): Promise<SyncJob[]> {
    return this.workDb(trustedTenantId, () =>
      this.db
        .select()
        .from(syncJobs)
        .where(
          and(eq(syncJobs.instanceId, instanceId), inArray(syncJobs.status, ['pending', 'running'] as JobStatus[])),
        ),
    );
  }

  /**
   * Check if there's an active job of a specific type for an instance
   */
  async hasActiveJob(instanceId: string, type: SyncJobType, trustedTenantId?: string | null): Promise<boolean> {
    const [job] = await this.workDb(trustedTenantId, () =>
      this.db
        .select()
        .from(syncJobs)
        .where(
          and(
            eq(syncJobs.instanceId, instanceId),
            eq(syncJobs.type, type),
            inArray(syncJobs.status, ['pending', 'running'] as JobStatus[]),
          ),
        )
        .limit(1),
    );

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
