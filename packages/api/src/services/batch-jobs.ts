/**
 * Batch Job Service - manages batch media processing jobs
 *
 * Provides job lifecycle management for reprocessing historical media:
 * - targeted_chat_sync: All media from a specific chat
 * - time_based_batch: Media from past N days with optional limit
 *
 * Features:
 * - Progress tracking with real-time updates
 * - Cancellation support (graceful stop)
 * - Resumability on restart
 * - Cost aggregation
 *
 * @see media-processing-batch wish
 */

import type { BatchJobProgress, BatchJobType, EventBus } from '@omni/core';
import { NotFoundError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type BatchJob,
  type JobStatus,
  type Message,
  type NewBatchJob,
  batchJobs,
  chats,
  mediaContent,
  messages,
} from '@omni/db';
import {
  GEMINI_AUDIO_MODEL,
  type MediaProcessingService,
  type ProcessingResult,
  type ProcessorConfig,
  createMediaProcessingService,
} from '@omni/media-processing';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { isTenantWorkAdmissible, runForEachActiveTenantRow } from '../tenancy/periodic-tenant-work';
import { currentTenantScope, runDetachedFromTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import { BATCH_PRICING_VERSION, computeEstimatedCostCents } from './batch-pricing';
import { MediaStorageService } from './media-storage';

const log = createLogger('services:batch-jobs');

interface MediaSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | null | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | null | undefined>;
}

/**
 * Content types that can be batch processed
 */
export type ProcessableContentType = 'audio' | 'image' | 'video' | 'document';
const PROCESSABLE_CONTENT_TYPES = new Set<ProcessableContentType>(['audio', 'image', 'video', 'document']);

/**
 * Request parameters for creating a batch job
 */
export interface CreateBatchJobOptions {
  jobType: BatchJobType;
  instanceId: string;
  /** For targeted_chat_sync: the chat ID */
  chatId?: string;
  /** For time_based_batch: days to look back */
  daysBack?: number;
  /** For time_based_batch: max items to process */
  limit?: number;
  /** Content types to process (default: all) */
  contentTypes?: ProcessableContentType[];
  /** Re-process items that already have content (default: false) */
  force?: boolean;
  /** Minimum delay between items in ms (default: 1000) */
  delayMinMs?: number;
  /** Maximum delay between items in ms (default: 3000) */
  delayMaxMs?: number;
}

/**
 * Job with calculated progress
 */
export interface BatchJobWithProgress extends BatchJob {
  skippedItems: number;
  estimatedCompletion?: Date;
}

/**
 * Cost estimation result
 */
export interface CostEstimate {
  totalItems: number;
  audioCount: number;
  imageCount: number;
  videoCount: number;
  documentCount: number;
  estimatedCostCents: number;
  estimatedCostUsd: number;
  estimatedDurationMinutes: number;
}

/**
 * List options for batch jobs
 */
export interface ListBatchJobsOptions {
  instanceId?: string;
  status?: JobStatus[];
  jobType?: BatchJobType[];
  limit?: number;
  cursor?: string;
}

/**
 * Internal state for job processing
 */
interface JobProcessingState {
  processedItems: number;
  failedItems: number;
  totalCostUsd: number;
  totalTokens: number;
  errors: Array<{ itemId: string; error: string }>;
}

/**
 * Batch Job Service
 */
export class BatchJobService {
  private mediaServicePromise: Promise<MediaProcessingService> | null = null;
  private mediaStorage: MediaStorageService;
  /** Track active job executions for cancellation */
  private activeJobs = new Map<string, { cancelled: boolean }>();
  /** Average processing time per item in ms (for estimation) */
  private static readonly AVG_PROCESSING_TIME_MS = 3000;
  /** Default minimum delay between items in ms */
  private static readonly DEFAULT_DELAY_MIN_MS = 1000;
  /** Default maximum delay between items in ms */
  private static readonly DEFAULT_DELAY_MAX_MS = 3000;
  /** Progress update interval (items) */
  private static readonly PROGRESS_UPDATE_INTERVAL = 5;

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
   * The auth-plane read connection, injected after construction by
   * `services/index.ts` (mirrors `followUpSweeper.setAuthPlane`). It is the one
   * runtime-process identity that may read `tenants` under enforcement, so it is
   * where the background executor revalidates a job's tenant is still admissible
   * at DEQUEUE time (see {@link isJobTenantAdmissible}). Legacy deployments and
   * existing tests that never enable multitenancy can omit it — a NULL-tenant
   * job is admissible without any read.
   */
  private authPlaneDb: Database | null = null;

  /**
   * Environment used for the flag/enforcement decisions of the RESUME fan-out.
   * Tests override it; production leaves it undefined and the helper reads
   * `process.env`.
   */
  private resumeEnv: NodeJS.ProcessEnv | undefined;

  constructor(
    private readonly pool: Database,
    private eventBus: EventBus | null,
    private settings?: MediaSettingsReader,
  ) {
    this.mediaStorage = new MediaStorageService(this.pool);
  }

  /**
   * Inject the auth-plane read connection (wired by `services/index.ts`). Used
   * only for dequeue-time tenant revalidation of tenant-owned jobs; NULL-tenant
   * (legacy) jobs never consult it.
   */
  setAuthPlane(authPlaneDb: Database): void {
    this.authPlaneDb = authPlaneDb;
  }

  /** Test seam for {@link resumeJobs}' flag/enforcement decisions. */
  setResumeEnv(env: NodeJS.ProcessEnv | undefined): void {
    this.resumeEnv = env;
  }

  /**
   * Dequeue-time tenant revalidation (RELEASE_SLOS
   * "queued_retry_delayed_dlq_check"). A NULL-tenant (legacy) job is always
   * admissible and never touches the auth plane. A tenant job is admissible only
   * when its tenant is still `active` — a suspension/archival between job
   * creation and this dequeue (or across a restart-resume) makes it inadmissible.
   *
   * Fails CLOSED for a tenant job when no auth-plane connection was injected:
   * the multitenancy world always wires one (`services/index.ts`), so its
   * absence under a tenant job is a misconfiguration we must not run through.
   */
  private async isJobTenantAdmissible(jobTenantId: string | null): Promise<boolean> {
    if (!jobTenantId) return true;
    if (!this.authPlaneDb) {
      log.warn('Batch job has a tenant but no auth-plane connection is wired — refusing to run', { jobTenantId });
      return false;
    }
    return isTenantWorkAdmissible(this.authPlaneDb, jobTenantId);
  }

  private getMediaService(): Promise<MediaProcessingService> {
    if (!this.mediaServicePromise) {
      this.mediaServicePromise = this.createMediaService().catch((error) => {
        this.mediaServicePromise = null;
        throw error;
      });
    }
    return this.mediaServicePromise;
  }

  private async createMediaService(): Promise<MediaProcessingService> {
    let config: Partial<ProcessorConfig> | undefined;
    if (this.settings) {
      const [
        groqApiKey,
        openaiApiKey,
        geminiApiKey,
        defaultLanguage,
        audioProvider,
        audioModel,
        geminiAudioModel,
        audioPrompt,
      ] = await Promise.all([
        this.settings.getSecret('groq.api_key', 'GROQ_API_KEY'),
        this.settings.getSecret('openai.api_key', 'OPENAI_API_KEY'),
        this.settings.getSecret('gemini.api_key', 'GEMINI_API_KEY'),
        this.settings.getString('media.default_language', 'DEFAULT_LANGUAGE', 'pt'),
        this.settings.getString('stt.provider', 'STT_PROVIDER', 'openai'),
        this.settings.getString('stt.openai.model', 'OPENAI_STT_MODEL', 'gpt-audio-mini'),
        this.settings.getString('stt.gemini.model', 'GEMINI_STT_MODEL', GEMINI_AUDIO_MODEL),
        this.settings.getString('prompt.audio_transcription'),
      ]);
      config = {
        groqApiKey: groqApiKey ?? undefined,
        openaiApiKey: openaiApiKey ?? undefined,
        geminiApiKey: geminiApiKey ?? undefined,
        defaultLanguage: defaultLanguage ?? 'pt',
        audioProvider: audioProvider ?? 'openai',
        audioModel: audioModel ?? 'gpt-audio-mini',
        geminiAudioModel: geminiAudioModel ?? GEMINI_AUDIO_MODEL,
        audioPrompt: audioPrompt ?? undefined,
      };
    }

    return createMediaProcessingService(config);
  }

  /**
   * Create and start a batch job.
   *
   * @param trustedTenantId - for NON-request callers only (e.g. the sync worker's
   *   post-sync media backfill, which enqueues from OUTSIDE its per-item worker
   *   scope). It threads the envelope-derived trusted tenant so the row is stamped
   *   and the background executor revalidates the right tenant. A request caller
   *   omits it: the tenant is captured from the active request scope, which is
   *   edge-derived and trusted. Passing `null` explicitly forces a legacy job.
   */
  async create(options: CreateBatchJobOptions, trustedTenantId?: string | null): Promise<BatchJob> {
    const {
      jobType,
      instanceId,
      chatId,
      daysBack,
      limit,
      contentTypes,
      force = false,
      delayMinMs,
      delayMaxMs,
    } = options;

    // Validate based on job type
    if (jobType === 'targeted_chat_sync' && !chatId) {
      throw new Error('chatId is required for targeted_chat_sync jobs');
    }
    if (jobType === 'time_based_batch' && daysBack === undefined) {
      throw new Error('daysBack is required for time_based_batch jobs');
    }

    const requestParams = {
      chatId,
      daysBack,
      limit,
      contentTypes: contentTypes ?? ['audio', 'image', 'video', 'document'],
      force,
      delayMinMs: delayMinMs ?? BatchJobService.DEFAULT_DELAY_MIN_MS,
      delayMaxMs: delayMaxMs ?? BatchJobService.DEFAULT_DELAY_MAX_MS,
      // Stamp the pricing table version used to derive any cost estimate
      // at creation time. Persisted on the batch record via the
      // `request_params` jsonb column for audit + pricing-drift
      // provenance (see #485, follow-up to #477). No dedicated
      // `pricing_version` column — storing alongside requestParams keeps
      // the fix migration-free; a schema column can be added later if
      // filtering/indexing by version becomes useful.
      pricingVersion: BATCH_PRICING_VERSION,
    };

    const jobData: NewBatchJob = {
      jobType,
      instanceId,
      status: 'pending',
      requestParams,
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
      progressPercent: 0,
      totalCostUsd: '0',
      totalTokens: 0,
      errors: [],
    };

    // Capture the TRUSTED tenant for this job BEFORE any detach. A request
    // caller is inside its edge-opened tenant scope, so `currentTenantScope()`
    // is the trusted, edge-derived tenant; a worker caller has no scope here and
    // threads its envelope-derived tenant explicitly via `trustedTenantId`. This
    // value travels into the detached executor as a PARAMETER — the executor
    // never reads ALS (it runs detached, where ALS is empty anyway).
    const activeScope = currentTenantScope();
    const jobTenantId = trustedTenantId !== undefined ? trustedTenantId : (activeScope?.tenantId ?? null);

    // The INSERT stamps tenant ownership (`batch_jobs.tenant_id`) from the tenant
    // transaction it runs in. A request caller is already inside that scope, so
    // the insert joins the request transaction unchanged. A worker caller holds
    // no scope but threaded a tenant, so it opens ONE short worker transaction
    // here to stamp the row. A legacy caller (no tenant) inserts on the ambient
    // pool, byte-identical to pre-G5.
    const insertJob = async (): Promise<BatchJob> => {
      const [row] = await this.db.insert(batchJobs).values(jobData).returning();
      if (!row) {
        throw new Error('Failed to create batch job');
      }
      return row;
    };
    const created =
      activeScope || !jobTenantId ? await insertJob() : await runTenantWorkDb(this.pool, jobTenantId, insertJob);

    log.info('Batch job created', {
      jobId: created.id,
      jobType,
      instanceId,
      pricingVersion: BATCH_PRICING_VERSION,
    });

    // Emit created event
    if (this.eventBus) {
      await this.eventBus.publish(
        'batch-job.created',
        {
          jobId: created.id,
          instanceId,
          jobType,
          requestParams,
        },
        { instanceId },
      );
    }

    // Start execution in background (non-blocking).
    //
    // `create` may be running inside a tenant-scoped request transaction. The
    // executor MUST NOT inherit that scope: it outlives the request, and by the
    // time its queries run the request's transaction has committed and its
    // pooled connection has been released — issuing a query on it would be a
    // use-after-commit. Detaching pins the executor (and every query it makes
    // via `this.db`) to the ambient pool, the worker-context path G5 will own.
    runDetachedFromTenantScope(() => this.executeJob(created.id, jobTenantId)).catch((error) => {
      log.error('Job execution failed', { jobId: created.id, error: String(error) });
    });

    return created;
  }

  /**
   * Get job by ID
   */
  async getById(id: string): Promise<BatchJob> {
    const [result] = await this.db.select().from(batchJobs).where(eq(batchJobs.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('BatchJob', id);
    }

    return result;
  }

  /**
   * Get job status (lightweight - for polling)
   */
  async getStatus(id: string): Promise<BatchJobWithProgress> {
    const job = await this.getById(id);
    return this.enrichWithProgress(job);
  }

  /**
   * List jobs with filtering
   */
  async list(options: ListBatchJobsOptions = {}): Promise<{
    items: BatchJobWithProgress[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const { instanceId, status, jobType, limit = 50, cursor } = options;

    let query = this.db.select().from(batchJobs).$dynamic();

    const conditions = [];

    if (instanceId) {
      conditions.push(eq(batchJobs.instanceId, instanceId));
    }

    if (status?.length) {
      conditions.push(inArray(batchJobs.status, status));
    }

    if (jobType?.length) {
      conditions.push(inArray(batchJobs.jobType, jobType));
    }

    if (cursor) {
      // Cursor-based pagination using createdAt
      const cursorJob = await this.getById(cursor);
      conditions.push(lte(batchJobs.createdAt, cursorJob.createdAt));
    }

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    const items = await query.orderBy(desc(batchJobs.createdAt)).limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const enrichedItems = items.map((item) => this.enrichWithProgress(item));
    const lastItem = items[items.length - 1];

    return {
      items: enrichedItems,
      hasMore,
      cursor: lastItem?.id,
    };
  }

  /**
   * Cancel a running job
   */
  async cancel(id: string): Promise<BatchJob> {
    const job = await this.getById(id);
    const instanceId = this.requireInstanceId(job);

    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
      throw new Error(`Cannot cancel job with status: ${job.status}`);
    }

    // Mark for cancellation in active jobs map
    const activeJob = this.activeJobs.get(id);
    if (activeJob) {
      activeJob.cancelled = true;
    }

    // Update status in database
    const [updated] = await this.db
      .update(batchJobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(eq(batchJobs.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('BatchJob', id);
    }

    log.info('Batch job cancelled', { jobId: id });

    // Emit cancelled event
    if (this.eventBus) {
      await this.eventBus.publish(
        'batch-job.cancelled',
        {
          jobId: id,
          instanceId,
          progress: this.buildProgressPayload(updated),
        },
        { instanceId },
      );
    }

    return updated;
  }

  /**
   * Estimate cost before starting a job
   */
  async estimate(options: Omit<CreateBatchJobOptions, 'force'>): Promise<CostEstimate> {
    const items = await this.queryEligibleItems(options);

    const counts = {
      audioCount: 0,
      imageCount: 0,
      videoCount: 0,
      documentCount: 0,
    };

    for (const item of items) {
      const type = this.getContentTypeFromMime(item.mediaMimeType);
      if (type === 'audio') counts.audioCount++;
      else if (type === 'image') counts.imageCount++;
      else if (type === 'video') counts.videoCount++;
      else if (type === 'document') counts.documentCount++;
    }

    // Cost estimate derived from the declarative provider pricing table
    // (`batch-pricing.ts`, pinned to default Groq STT + Gemini Flash-Lite
    // vision as of 2026-04). See issue #477: the previous hardcoded
    // per-item cents were off by ~150× for that provider mix.
    const estimatedCostCents = computeEstimatedCostCents(counts);
    log.debug('Batch cost estimated', {
      totalItems: items.length,
      estimatedCostCents,
      pricingVersion: BATCH_PRICING_VERSION,
    });

    // Factor in average random delay between items (midpoint of default range)
    const avgDelayMs = (BatchJobService.DEFAULT_DELAY_MIN_MS + BatchJobService.DEFAULT_DELAY_MAX_MS) / 2;
    const estimatedDurationMinutes = Math.ceil(
      (items.length * (BatchJobService.AVG_PROCESSING_TIME_MS + avgDelayMs)) / 60000,
    );

    return {
      totalItems: items.length,
      ...counts,
      estimatedCostCents,
      estimatedCostUsd: estimatedCostCents / 100,
      estimatedDurationMinutes,
    };
  }

  /**
   * Resume jobs that were running when the API restarted.
   *
   * G5 (ADR-0008/ADR-0003): this is restart recovery — no request, no
   * credential, no envelope — and its read is a WHOLE-TABLE scan for
   * `status = 'running'`. Under RLS enforcement that scan is not expressible at
   * all, so recovery must ENUMERATE whose jobs exist (`runForEachActiveTenantRow`,
   * the daily-sync / turn-monitor precedent) instead of scanning globally and
   * sorting ownership out afterwards. Only the discrete READ is scoped; each
   * job's executor is dispatched OUTSIDE it, because `executeJob` is a long
   * fire-and-forget that opens its own short scope per DB block.
   *
   * Each job's trusted tenant is its OWN persisted `tenant_id` (G2, nullable) —
   * never the enumerating pass's, never an ambient/inherited scope. The executor
   * then revalidates that tenant is still admissible at this dequeue
   * (RELEASE_SLOS `queued_retry_delayed_dlq_check`).
   *
   * LEGACY WORLD: with no auth plane wired, or with the flag off, this is the
   * pre-G5 single ambient scan followed by the same dispatch loop — statement
   * for statement.
   */
  async resumeJobs(): Promise<void> {
    const dispatch = (job: { id: string; tenantId: string | null }): void => {
      this.executeJob(job.id, job.tenantId ?? null).catch((error) => {
        log.error('Failed to resume job', { jobId: job.id, error: String(error) });
      });
    };

    if (!this.authPlaneDb) {
      const runningJobs = await this.db.select().from(batchJobs).where(eq(batchJobs.status, 'running'));
      if (runningJobs.length === 0) {
        log.debug('No jobs to resume');
        return;
      }
      log.info('Resuming batch jobs', { count: runningJobs.length });
      for (const job of runningJobs) dispatch(job);
      return;
    }

    let resumed = 0;
    await runForEachActiveTenantRow(
      {
        db: this.pool,
        authPlaneDb: this.authPlaneDb,
        jobName: 'batch-job-resume',
        listActive: () => this.db.select().from(batchJobs).where(eq(batchJobs.status, 'running')),
        env: this.resumeEnv,
      },
      async (job) => {
        resumed += 1;
        dispatch(job);
      },
    );
    if (resumed === 0) log.debug('No jobs to resume');
    else log.info('Resuming batch jobs', { count: resumed });
  }

  /**
   * Execute a batch job (main processing loop).
   *
   * `jobTenantId` is the job's TRUSTED tenant, threaded as a value (never read
   * from ALS): captured from the request scope at `create` time, threaded by a
   * worker caller, or read from the persisted row at resume time. Every discrete
   * DB block below runs in `runTenantWorkDb(this.pool, jobTenantId, ...)` — one
   * short worker transaction per block, never one across the whole job — while
   * downloads, AI calls, and event publishes stay OUTSIDE any scope. A NULL
   * tenant runs every block on the ambient pool, byte-identical to pre-G5.
   */
  private async executeJob(jobId: string, jobTenantId: string | null): Promise<void> {
    // DEQUEUE-TIME REVALIDATION #1 — before any work. A tenant suspended between
    // create/resume and now (RELEASE_SLOS "queued_retry_delayed_dlq_check") must
    // not have its queued job run. An inadmissible tenant STOPS the job with a
    // clear error and performs NO side effects.
    if (!(await this.isJobTenantAdmissible(jobTenantId))) {
      await this.stopForInadmissibleTenant(jobId, jobTenantId);
      return;
    }

    const job = await runTenantWorkDb(this.pool, jobTenantId, () => this.getById(jobId));
    const instanceId = this.requireInstanceId(job);
    const params = (job.requestParams ?? {}) as Partial<CreateBatchJobOptions>;

    // Register job as active
    this.activeJobs.set(jobId, { cancelled: false });

    try {
      const { eligibleItems, totalItems, skippedItems } = await this.prepareJobExecution(
        job,
        instanceId,
        params,
        jobTenantId,
      );

      // DEQUEUE-TIME REVALIDATION #2 — immediately before the durable side-effect
      // batch (status→running, `batch-job.started` publish, and the whole
      // processing loop of media writes + progress publishes). If the tenant was
      // suspended during item preparation, stop here before the first durable
      // effect.
      if (!(await this.isJobTenantAdmissible(jobTenantId))) {
        this.activeJobs.delete(jobId);
        await this.stopForInadmissibleTenant(jobId, jobTenantId);
        return;
      }

      await this.markJobRunning(jobId, instanceId, job.jobType as BatchJobType, totalItems, jobTenantId);

      const state = this.initializeJobState(job);
      const startTime = Date.now();

      const delayMinMs = params.delayMinMs ?? BatchJobService.DEFAULT_DELAY_MIN_MS;
      const delayMaxMs = params.delayMaxMs ?? BatchJobService.DEFAULT_DELAY_MAX_MS;

      await this.processAllItems(
        jobId,
        instanceId,
        eligibleItems,
        totalItems,
        skippedItems,
        state,
        delayMinMs,
        delayMaxMs,
        jobTenantId,
      );

      await this.finalizeJob(
        jobId,
        instanceId,
        job.jobType as BatchJobType,
        totalItems,
        skippedItems,
        state,
        startTime,
        jobTenantId,
      );
    } catch (error) {
      await this.handleJobError(jobId, instanceId, error, jobTenantId);
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Stop a job whose tenant is no longer admissible at dequeue. Marks it
   * `failed` with a clear error and performs NO further side effects (no
   * processing, no downloads, no event publishes). The status write itself runs
   * in the job's tenant scope — a suspended tenant's row is still visible to its
   * own worker transaction (RLS matches on `tenant_id`, not on status).
   */
  private async stopForInadmissibleTenant(jobId: string, jobTenantId: string | null): Promise<void> {
    const message = `Tenant ${jobTenantId} is not admissible (suspended or archived); job stopped at dequeue`;
    log.warn('Batch job stopped — tenant not admissible', { jobId, jobTenantId });
    await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.db
        .update(batchJobs)
        .set({ status: 'failed', completedAt: new Date(), errorMessage: message })
        .where(eq(batchJobs.id, jobId)),
    );
  }

  /**
   * Prepare job execution - query and filter items
   */
  private async prepareJobExecution(
    job: BatchJob,
    instanceId: string,
    params: Partial<CreateBatchJobOptions>,
    jobTenantId: string | null,
  ): Promise<{ eligibleItems: Message[]; totalItems: number; skippedItems: number }> {
    const items = await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.queryEligibleItems({
        jobType: job.jobType as BatchJobType,
        instanceId,
        chatId: params.chatId,
        daysBack: params.daysBack,
        limit: params.limit,
        contentTypes: params.contentTypes as ProcessableContentType[],
      }),
    );

    const eligibleItems = params.force === true ? items : items.filter((item) => !this.hasExistingContent(item));
    const totalItems = eligibleItems.length;
    const skippedItems = items.length - eligibleItems.length;

    return { eligibleItems, totalItems, skippedItems };
  }

  /**
   * Mark job as running and emit started event
   */
  private async markJobRunning(
    jobId: string,
    instanceId: string,
    jobType: BatchJobType,
    totalItems: number,
    jobTenantId: string | null,
  ): Promise<void> {
    // DB block scoped to the job's tenant; the publish stays OUTSIDE the scope.
    await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.db
        .update(batchJobs)
        .set({ status: 'running', startedAt: new Date(), totalItems })
        .where(eq(batchJobs.id, jobId)),
    );

    log.info('Job started', { jobId, totalItems });

    if (this.eventBus) {
      await this.eventBus.publish('batch-job.started', { jobId, instanceId, jobType, totalItems }, { instanceId });
    }
  }

  /**
   * Initialize job processing state from existing job data
   */
  private initializeJobState(job: BatchJob): JobProcessingState {
    return {
      processedItems: job.processedItems,
      failedItems: job.failedItems,
      totalCostUsd: Number(job.totalCostUsd ?? 0),
      totalTokens: job.totalTokens ?? 0,
      errors: (job.errors as Array<{ itemId: string; error: string }>) ?? [],
    };
  }

  /**
   * Process all items in the batch
   */
  private async processAllItems(
    jobId: string,
    instanceId: string,
    eligibleItems: Message[],
    totalItems: number,
    skippedItems: number,
    state: JobProcessingState,
    delayMinMs: number,
    delayMaxMs: number,
    jobTenantId: string | null,
  ): Promise<void> {
    for (let i = 0; i < eligibleItems.length; i++) {
      if (await this.isJobCancelled(jobId, jobTenantId)) break;

      const item = eligibleItems[i];
      if (!item) continue;

      // DB block: mark the current item. External processing follows outside.
      await runTenantWorkDb(this.pool, jobTenantId, () =>
        this.db.update(batchJobs).set({ currentItem: item.id }).where(eq(batchJobs.id, jobId)),
      );
      await this.processSingleItem(instanceId, item, jobId, state, jobTenantId);
      await this.updateProgressIfNeeded(
        jobId,
        instanceId,
        i,
        eligibleItems.length,
        totalItems,
        skippedItems,
        item.id,
        state,
        jobTenantId,
      );
      // Random delay between items to avoid API rate limits and behave humanly
      const delay = delayMinMs + Math.random() * (delayMaxMs - delayMinMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Check if job was cancelled (via memory flag or DB)
   */
  private async isJobCancelled(jobId: string, jobTenantId: string | null): Promise<boolean> {
    const activeJob = this.activeJobs.get(jobId);
    if (activeJob?.cancelled) {
      log.info('Job cancelled by user', { jobId });
      return true;
    }

    const [current] = await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.db.select({ status: batchJobs.status }).from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1),
    );
    if (current?.status === 'cancelled') {
      log.info('Job cancelled (DB check)', { jobId });
      return true;
    }

    return false;
  }

  /**
   * Process a single item and update state
   */
  private async processSingleItem(
    instanceId: string,
    item: Message,
    jobId: string,
    state: JobProcessingState,
    jobTenantId: string | null,
  ): Promise<void> {
    try {
      const result = await this.processItem(instanceId, item, jobId, jobTenantId);
      if (result.success) {
        state.processedItems++;
        state.totalCostUsd += (result.costCents ?? 0) / 100;
        state.totalTokens += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      } else {
        state.failedItems++;
        state.errors.push({ itemId: item.id, error: result.errorMessage ?? 'Unknown error' });
      }
    } catch (error) {
      state.failedItems++;
      state.errors.push({ itemId: item.id, error: String(error) });
      log.warn('Item processing error', { jobId, itemId: item.id, error: String(error) });
    }
  }

  /**
   * Update progress in DB and emit event if interval reached
   */
  private async updateProgressIfNeeded(
    jobId: string,
    instanceId: string,
    index: number,
    total: number,
    totalItems: number,
    skippedItems: number,
    currentItemId: string,
    state: JobProcessingState,
    jobTenantId: string | null,
  ): Promise<void> {
    const isProgressInterval = (index + 1) % BatchJobService.PROGRESS_UPDATE_INTERVAL === 0;
    const isLastItem = index === total - 1;
    if (!isProgressInterval && !isLastItem) return;

    const progressPercent =
      totalItems > 0 ? Math.round(((state.processedItems + state.failedItems) / totalItems) * 100) : 0;

    // DB block scoped to the job's tenant; the progress publish stays outside.
    await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.db
        .update(batchJobs)
        .set({
          processedItems: state.processedItems,
          failedItems: state.failedItems,
          progressPercent,
          totalCostUsd: String(state.totalCostUsd),
          totalTokens: state.totalTokens,
          errors: state.errors,
        })
        .where(eq(batchJobs.id, jobId)),
    );

    if (this.eventBus) {
      await this.eventBus.publish(
        'batch-job.progress',
        {
          jobId,
          instanceId,
          progress: {
            totalItems,
            processedItems: state.processedItems,
            failedItems: state.failedItems,
            skippedItems,
            currentItem: currentItemId,
            progressPercent,
            totalCostCents: Math.round(state.totalCostUsd * 100),
            totalTokens: state.totalTokens,
          },
        },
        { instanceId },
      );
    }
  }

  /**
   * Finalize job - mark completed and emit event
   */
  private async finalizeJob(
    jobId: string,
    instanceId: string,
    jobType: BatchJobType,
    totalItems: number,
    skippedItems: number,
    state: JobProcessingState,
    startTime: number,
    jobTenantId: string | null,
  ): Promise<void> {
    const [finalStatus] = await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.db.select({ status: batchJobs.status }).from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1),
    );
    if (finalStatus?.status === 'cancelled') return;

    const durationMs = Date.now() - startTime;

    // DB block scoped to the job's tenant; the completion publish stays outside.
    await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.db
        .update(batchJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          processedItems: state.processedItems,
          failedItems: state.failedItems,
          progressPercent: 100,
          totalCostUsd: String(state.totalCostUsd),
          totalTokens: state.totalTokens,
          errors: state.errors,
          currentItem: null,
        })
        .where(eq(batchJobs.id, jobId)),
    );

    log.info('Job completed', {
      jobId,
      processedItems: state.processedItems,
      failedItems: state.failedItems,
      durationMs,
    });

    if (this.eventBus) {
      await this.eventBus.publish(
        'batch-job.completed',
        {
          jobId,
          instanceId,
          jobType,
          progress: {
            totalItems,
            processedItems: state.processedItems,
            failedItems: state.failedItems,
            skippedItems,
            progressPercent: 100,
            totalCostCents: Math.round(state.totalCostUsd * 100),
            totalTokens: state.totalTokens,
          },
          durationMs,
        },
        { instanceId },
      );
    }
  }

  /**
   * Handle job execution error
   */
  private async handleJobError(
    jobId: string,
    instanceId: string,
    error: unknown,
    jobTenantId: string | null,
  ): Promise<void> {
    log.error('Job execution failed', { jobId, error: String(error) });

    await runTenantWorkDb(this.pool, jobTenantId, () =>
      this.db
        .update(batchJobs)
        .set({ status: 'failed', completedAt: new Date(), errorMessage: String(error) })
        .where(eq(batchJobs.id, jobId)),
    );

    if (this.eventBus) {
      await this.eventBus.publish('batch-job.failed', { jobId, instanceId, error: String(error) }, { instanceId });
    }
  }

  /**
   * Process a single media item
   */
  private async processItem(
    instanceId: string,
    message: Message,
    batchJobId: string,
    jobTenantId: string | null,
  ): Promise<ProcessingResult> {
    const mimeType = message.mediaMimeType;
    const mediaService = await this.getMediaService();
    if (!mimeType || !mediaService.canProcess(mimeType)) {
      return this.failedResult(`MIME type not processable: ${mimeType}`);
    }

    const resolved = await this.resolveFilePath(instanceId, message, mimeType, jobTenantId);
    if (!resolved.ok) {
      return this.failedResult(resolved.reason);
    }

    // Materialize a readable local path for the stored reference. In local mode
    // this is `{basePath}/{path}` (no copy); in remote mode the reference is an
    // S3 key, so the bytes are fetched into a temp file that MUST be cleaned up.
    const materialized = await this.mediaStorage.materializeForProcessing(resolved.path);
    let result: ProcessingResult;
    try {
      result = await mediaService.process(materialized.path, mimeType, {
        caption: message.textContent ?? undefined,
      });
    } finally {
      // Always remove any temp file fetched for remote processing (no-op in local mode).
      await materialized.cleanup();
    }

    if (result.success && result.content) {
      await this.persistProcessingResult(message.id, result, batchJobId, jobTenantId);
    }

    return result;
  }

  /**
   * Create a failed processing result
   */
  private failedResult(errorMessage: string): ProcessingResult {
    return {
      success: false,
      contentFormat: 'text',
      processingType: 'extraction',
      provider: 'none',
      model: 'none',
      processingTimeMs: 0,
      costCents: 0,
      errorMessage,
    };
  }

  /**
   * Resolve file path - download from URL if needed.
   *
   * Returns a tagged result so callers can surface the real reason a file
   * could not be resolved (missing local path, missing url, download failure).
   * Previously all three paths collapsed into a generic "No media file path
   * available" error, which made #500 diagnosis impossible.
   */
  private async resolveFilePath(
    instanceId: string,
    message: Message,
    mimeType: string,
    jobTenantId: string | null,
  ): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    if (message.mediaLocalPath) {
      return { ok: true, path: message.mediaLocalPath };
    }

    if (!message.mediaUrl) {
      return { ok: false, reason: 'No media_url and no media_local_path on message' };
    }

    try {
      // Download + store is external work; the trusted tenant is threaded so the
      // object lands under the tenant's storage prefix (media-storage `buildKey`).
      const result = await this.mediaStorage.storeFromUrl(
        instanceId,
        message.id,
        message.mediaUrl,
        mimeType,
        message.platformTimestamp ?? undefined,
        undefined,
        jobTenantId ?? undefined,
      );
      // The message write is a discrete DB block — scoped to the job's tenant so
      // it lands under the correct tenant transaction (RLS-policed under
      // enforcement, ambient byte-identical for a legacy job).
      await runTenantWorkDb(this.pool, jobTenantId, () =>
        this.mediaStorage.updateMessageLocalPath(message.id, result.localPath),
      );
      return { ok: true, path: result.localPath };
    } catch (error) {
      const reason = `storeFromUrl failed: ${error instanceof Error ? error.message : String(error)}`;
      log.warn('storeFromUrl failed during batch retrofill', {
        messageId: message.id,
        mediaUrl: message.mediaUrl,
        error: reason,
      });
      return { ok: false, reason };
    }
  }

  /**
   * Persist processing result to DB (called only when result.success && result.content is truthy)
   */
  private async persistProcessingResult(
    messageId: string,
    result: ProcessingResult,
    batchJobId: string,
    jobTenantId: string | null,
  ): Promise<void> {
    // Content is guaranteed by caller check: `if (result.success && result.content)`
    const content = result.content ?? '';

    // One discrete DB block: the media_content insert plus the dependent message
    // update, scoped to the job's tenant so both land in the same short worker
    // transaction (legacy job → ambient, byte-identical).
    await runTenantWorkDb(this.pool, jobTenantId, async () => {
      await this.db.insert(mediaContent).values({
        mediaId: messageId,
        processingType: result.processingType,
        content,
        model: result.model,
        provider: result.provider,
        language: result.language,
        duration: result.duration,
        tokensUsed: result.inputTokens ? result.inputTokens + (result.outputTokens ?? 0) : undefined,
        costUsd: result.costCents != null ? String(Math.round(result.costCents)) : null,
        processingTimeMs: result.processingTimeMs,
        batchJobId,
      });

      const updateData = this.getMessageUpdateForType(result.processingType, content);
      if (updateData) {
        await this.db.update(messages).set(updateData).where(eq(messages.id, messageId));
      }
    });
  }

  /**
   * Query messages eligible for batch processing
   */
  private async queryEligibleItems(options: {
    jobType: BatchJobType;
    instanceId: string;
    chatId?: string;
    daysBack?: number;
    limit?: number;
    contentTypes?: ProcessableContentType[];
  }): Promise<Message[]> {
    const { jobType, instanceId, chatId, daysBack, limit, contentTypes } = options;

    // Build base conditions
    const conditions = [eq(messages.hasMedia, true), isNotNull(messages.mediaMimeType)];

    // Add instance filter via chat join
    // Exclude newsletters, broadcasts, and archived chats — no value in processing these
    const chatConditions = [
      eq(chats.instanceId, instanceId),
      isNull(chats.archivedAt),
      sql`${chats.chatType} NOT IN ('broadcast', 'newsletter')`,
    ];

    if (jobType === 'targeted_chat_sync' && chatId) {
      chatConditions.push(eq(chats.externalId, chatId));
    }

    if (jobType === 'time_based_batch' && daysBack !== undefined) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      // For retroactive sync/backfill, platformTimestamp is the message date; createdAt is ingestion time.
      conditions.push(gte(messages.platformTimestamp, cutoffDate));
    }

    // Query with join
    let query = this.db
      .select({ message: messages })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(...conditions, ...chatConditions))
      .orderBy(desc(messages.platformTimestamp))
      .$dynamic();

    if (limit) {
      query = query.limit(limit);
    }

    const results = await query;

    // Filter by content types
    const allowedTypes = new Set(contentTypes ?? PROCESSABLE_CONTENT_TYPES);
    return results
      .map((r) => r.message)
      .filter((m) => {
        const type = this.getContentTypeFromMime(m.mediaMimeType);
        return type && allowedTypes.has(type);
      });
  }

  /**
   * Check if message already has processed content
   */
  private hasExistingContent(message: Message): boolean {
    return !!(
      message.transcription ||
      message.imageDescription ||
      message.videoDescription ||
      message.documentExtraction
    );
  }

  /**
   * Get content type from MIME type
   */
  private getContentTypeFromMime(mimeType: string | null): ProcessableContentType | null {
    if (!mimeType) return null;
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType === 'application/pdf' || mimeType.includes('document') || mimeType.includes('text/')) {
      return 'document';
    }
    return null;
  }

  /**
   * Get message update object for processing type
   */
  private getMessageUpdateForType(
    processingType: 'transcription' | 'description' | 'extraction',
    content: string,
  ): Partial<Message> | null {
    switch (processingType) {
      case 'transcription':
        return { transcription: content };
      case 'description':
        return { imageDescription: content };
      case 'extraction':
        return { documentExtraction: content };
      default:
        return null;
    }
  }

  /**
   * Require instanceId from job (throws if null)
   */
  private requireInstanceId(job: BatchJob): string {
    if (!job.instanceId) {
      throw new Error(`Job ${job.id} has no instanceId`);
    }
    return job.instanceId;
  }

  /**
   * Build progress payload for events
   */
  private buildProgressPayload(job: BatchJob): BatchJobProgress {
    return {
      totalItems: job.totalItems,
      processedItems: job.processedItems,
      failedItems: job.failedItems,
      skippedItems: 0, // Not stored in DB
      currentItem: job.currentItem ?? undefined,
      progressPercent: job.progressPercent,
      totalCostCents: Math.round(Number(job.totalCostUsd ?? 0) * 100),
      totalTokens: job.totalTokens ?? 0,
    };
  }

  /**
   * Enrich job with calculated progress fields
   */
  private enrichWithProgress(job: BatchJob): BatchJobWithProgress {
    let estimatedCompletion: Date | undefined;

    if (job.status === 'running' && job.startedAt && job.totalItems > 0) {
      const elapsed = Date.now() - job.startedAt.getTime();
      const processed = job.processedItems + job.failedItems;
      if (processed > 0) {
        const avgTimePerItem = elapsed / processed;
        const remaining = job.totalItems - processed;
        const remainingTime = remaining * avgTimePerItem;
        estimatedCompletion = new Date(Date.now() + remainingTime);
      }
    }

    return {
      ...job,
      skippedItems: 0, // Not stored in DB
      estimatedCompletion,
    };
  }
}
