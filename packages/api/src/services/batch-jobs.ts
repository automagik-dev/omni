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

import { join } from 'node:path';
import { downloadMediaToBuffer } from '@omni/channel-whatsapp';
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
  type MediaProcessingService,
  type ProcessingResult,
  createMediaProcessingService,
} from '@omni/media-processing';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { MediaStorageService } from './media-storage';

const log = createLogger('services:batch-jobs');

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
  totalCostCents: number;
  totalTokens: number;
  errors: Array<{ itemId: string; error: string }>;
}

/**
 * Item for media re-download from raw event payloads
 */
interface RedownloadItem {
  message: Message;
  rawPayload: Record<string, unknown>;
  eventInstanceId: string;
}

/**
 * Batch Job Service
 */
export class BatchJobService {
  private mediaService: MediaProcessingService;
  private mediaStorage: MediaStorageService;
  /** Track active job executions for cancellation */
  private activeJobs = new Map<string, { cancelled: boolean }>();
  /** Average processing time per item in ms (for estimation) */
  private static readonly AVG_PROCESSING_TIME_MS = 3000;
  /** Average re-download time per item in ms */
  private static readonly AVG_REDOWNLOAD_TIME_MS = 1500;
  /** Delay between items to avoid blocking event loop */
  private static readonly INTER_ITEM_DELAY_MS = 100;
  /** Progress update interval (items) */
  private static readonly PROGRESS_UPDATE_INTERVAL = 5;

  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {
    this.mediaService = createMediaProcessingService();
    this.mediaStorage = new MediaStorageService(db);
  }

  /**
   * Create and start a batch job
   */
  async create(options: CreateBatchJobOptions): Promise<BatchJob> {
    const { jobType, instanceId, chatId, daysBack, limit, contentTypes, force = false } = options;

    // Validate based on job type
    if (jobType === 'targeted_chat_sync' && !chatId) {
      throw new Error('chatId is required for targeted_chat_sync jobs');
    }
    if (jobType === 'time_based_batch' && daysBack === undefined) {
      throw new Error('daysBack is required for time_based_batch jobs');
    }
    if (jobType === 'media_redownload' && daysBack === undefined) {
      throw new Error('daysBack is required for media_redownload jobs');
    }

    const requestParams = {
      chatId,
      daysBack,
      limit,
      contentTypes: contentTypes ?? ['audio', 'image', 'video', 'document'],
      force,
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
      totalCostUsd: 0,
      totalTokens: 0,
      errors: [],
    };

    const [created] = await this.db.insert(batchJobs).values(jobData).returning();

    if (!created) {
      throw new Error('Failed to create batch job');
    }

    log.info('Batch job created', { jobId: created.id, jobType, instanceId });

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

    // Start execution in background (non-blocking)
    this.executeJob(created.id).catch((error) => {
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
    // media_redownload: zero cost, just download from CDN
    if (options.jobType === 'media_redownload') {
      const redownloadItems = await this.queryRedownloadItems(options);
      const counts = this.countByMimeType(redownloadItems.map((i) => i.message.mediaMimeType));
      const estimatedDurationMinutes = Math.ceil(
        (redownloadItems.length * BatchJobService.AVG_REDOWNLOAD_TIME_MS) / 60000,
      );

      return {
        totalItems: redownloadItems.length,
        ...counts,
        estimatedCostCents: 0,
        estimatedCostUsd: 0,
        estimatedDurationMinutes,
      };
    }

    const items = await this.queryEligibleItems(options);
    const counts = this.countByMimeType(items.map((i) => i.mediaMimeType));

    // Rough cost estimates (in cents)
    // Audio: ~$0.04/hour = ~0.1 cents per 10-second clip
    // Image: ~$0.01 per image (Gemini vision tokens)
    // Video: ~$0.02 per video (Gemini)
    // Document: ~$0.00 (local processing)
    const estimatedCostCents =
      counts.audioCount * 10 + counts.imageCount * 1 + counts.videoCount * 2 + counts.documentCount * 0;

    const estimatedDurationMinutes = Math.ceil((items.length * BatchJobService.AVG_PROCESSING_TIME_MS) / 60000);

    return {
      totalItems: items.length,
      ...counts,
      estimatedCostCents,
      estimatedCostUsd: estimatedCostCents / 100,
      estimatedDurationMinutes,
    };
  }

  /**
   * Resume jobs that were running when the API restarted
   */
  async resumeJobs(): Promise<void> {
    const runningJobs = await this.db.select().from(batchJobs).where(eq(batchJobs.status, 'running'));

    if (runningJobs.length === 0) {
      log.debug('No jobs to resume');
      return;
    }

    log.info('Resuming batch jobs', { count: runningJobs.length });

    for (const job of runningJobs) {
      this.executeJob(job.id).catch((error) => {
        log.error('Failed to resume job', { jobId: job.id, error: String(error) });
      });
    }
  }

  /**
   * Execute a batch job (main processing loop)
   */
  private async executeJob(jobId: string): Promise<void> {
    const job = await this.getById(jobId);
    const instanceId = this.requireInstanceId(job);
    const params = (job.requestParams ?? {}) as Partial<CreateBatchJobOptions>;

    // Register job as active
    this.activeJobs.set(jobId, { cancelled: false });

    try {
      const { eligibleItems, redownloadItems, totalItems, skippedItems } = await this.prepareJobExecution(
        job,
        instanceId,
        params,
      );

      await this.markJobRunning(jobId, instanceId, job.jobType as BatchJobType, totalItems);

      const state = this.initializeJobState(job);
      const startTime = Date.now();

      await this.processAllItems(jobId, instanceId, eligibleItems, totalItems, skippedItems, state, redownloadItems);

      await this.finalizeJob(
        jobId,
        instanceId,
        job.jobType as BatchJobType,
        totalItems,
        skippedItems,
        state,
        startTime,
      );
    } catch (error) {
      await this.handleJobError(jobId, instanceId, error);
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Prepare job execution - query and filter items
   */
  private async prepareJobExecution(
    job: BatchJob,
    instanceId: string,
    params: Partial<CreateBatchJobOptions>,
  ): Promise<{
    eligibleItems: Message[];
    redownloadItems?: RedownloadItem[];
    totalItems: number;
    skippedItems: number;
  }> {
    const jobType = job.jobType as BatchJobType;

    // media_redownload: query from omni_events, filter by missing local path
    if (jobType === 'media_redownload') {
      const redownloadItems = await this.queryRedownloadItems({
        jobType,
        instanceId,
        daysBack: params.daysBack,
        limit: params.limit,
        contentTypes: params.contentTypes as ProcessableContentType[],
      });
      // Extra safety: only items still missing local path
      const filtered = redownloadItems.filter((item) => !item.message.mediaLocalPath);
      return { eligibleItems: [], redownloadItems: filtered, totalItems: filtered.length, skippedItems: 0 };
    }

    const items = await this.queryEligibleItems({
      jobType,
      instanceId,
      chatId: params.chatId,
      daysBack: params.daysBack,
      limit: params.limit,
      contentTypes: params.contentTypes as ProcessableContentType[],
    });

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
  ): Promise<void> {
    await this.db
      .update(batchJobs)
      .set({ status: 'running', startedAt: new Date(), totalItems })
      .where(eq(batchJobs.id, jobId));

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
      totalCostCents: job.totalCostUsd ?? 0,
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
    redownloadItems?: RedownloadItem[],
  ): Promise<void> {
    // media_redownload path: process from raw event payloads
    if (redownloadItems && redownloadItems.length > 0) {
      for (let i = 0; i < redownloadItems.length; i++) {
        if (await this.isJobCancelled(jobId)) break;

        const item = redownloadItems[i];
        if (!item) continue;

        await this.db.update(batchJobs).set({ currentItem: item.message.id }).where(eq(batchJobs.id, jobId));
        await this.processRedownloadItem(item, jobId, state);
        await this.updateProgressIfNeeded(
          jobId,
          instanceId,
          i,
          redownloadItems.length,
          totalItems,
          skippedItems,
          item.message.id,
          state,
        );
        await new Promise((resolve) => setTimeout(resolve, BatchJobService.INTER_ITEM_DELAY_MS));
      }
      return;
    }

    for (let i = 0; i < eligibleItems.length; i++) {
      if (await this.isJobCancelled(jobId)) break;

      const item = eligibleItems[i];
      if (!item) continue;

      await this.db.update(batchJobs).set({ currentItem: item.id }).where(eq(batchJobs.id, jobId));
      await this.processSingleItem(instanceId, item, jobId, state);
      await this.updateProgressIfNeeded(
        jobId,
        instanceId,
        i,
        eligibleItems.length,
        totalItems,
        skippedItems,
        item.id,
        state,
      );
      await new Promise((resolve) => setTimeout(resolve, BatchJobService.INTER_ITEM_DELAY_MS));
    }
  }

  /**
   * Check if job was cancelled (via memory flag or DB)
   */
  private async isJobCancelled(jobId: string): Promise<boolean> {
    const activeJob = this.activeJobs.get(jobId);
    if (activeJob?.cancelled) {
      log.info('Job cancelled by user', { jobId });
      return true;
    }

    const [current] = await this.db
      .select({ status: batchJobs.status })
      .from(batchJobs)
      .where(eq(batchJobs.id, jobId))
      .limit(1);
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
  ): Promise<void> {
    try {
      const result = await this.processItem(instanceId, item, jobId);
      if (result.success) {
        state.processedItems++;
        state.totalCostCents += result.costCents;
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
  ): Promise<void> {
    const isProgressInterval = (index + 1) % BatchJobService.PROGRESS_UPDATE_INTERVAL === 0;
    const isLastItem = index === total - 1;
    if (!isProgressInterval && !isLastItem) return;

    const progressPercent =
      totalItems > 0 ? Math.round(((state.processedItems + state.failedItems) / totalItems) * 100) : 0;

    await this.db
      .update(batchJobs)
      .set({
        processedItems: state.processedItems,
        failedItems: state.failedItems,
        progressPercent,
        totalCostUsd: state.totalCostCents,
        totalTokens: state.totalTokens,
        errors: state.errors,
      })
      .where(eq(batchJobs.id, jobId));

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
            totalCostCents: state.totalCostCents,
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
  ): Promise<void> {
    const [finalStatus] = await this.db
      .select({ status: batchJobs.status })
      .from(batchJobs)
      .where(eq(batchJobs.id, jobId))
      .limit(1);
    if (finalStatus?.status === 'cancelled') return;

    const durationMs = Date.now() - startTime;

    await this.db
      .update(batchJobs)
      .set({
        status: 'completed',
        completedAt: new Date(),
        processedItems: state.processedItems,
        failedItems: state.failedItems,
        progressPercent: 100,
        totalCostUsd: state.totalCostCents,
        totalTokens: state.totalTokens,
        errors: state.errors,
        currentItem: null,
      })
      .where(eq(batchJobs.id, jobId));

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
            totalCostCents: state.totalCostCents,
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
  private async handleJobError(jobId: string, instanceId: string, error: unknown): Promise<void> {
    log.error('Job execution failed', { jobId, error: String(error) });

    await this.db
      .update(batchJobs)
      .set({ status: 'failed', completedAt: new Date(), errorMessage: String(error) })
      .where(eq(batchJobs.id, jobId));

    if (this.eventBus) {
      await this.eventBus.publish('batch-job.failed', { jobId, instanceId, error: String(error) }, { instanceId });
    }
  }

  /**
   * Process a single media item
   */
  private async processItem(instanceId: string, message: Message, batchJobId: string): Promise<ProcessingResult> {
    const mimeType = message.mediaMimeType;
    if (!mimeType || !this.mediaService.canProcess(mimeType)) {
      return this.failedResult(`MIME type not processable: ${mimeType}`);
    }

    const filePath = await this.resolveFilePath(instanceId, message, mimeType);
    if (!filePath) {
      return this.failedResult('No media file path available');
    }

    const fullPath = join(this.mediaStorage.getBasePath(), filePath);
    const result = await this.mediaService.process(fullPath, mimeType, {
      language: 'pt',
      caption: message.textContent ?? undefined,
    });

    if (result.success && result.content) {
      await this.persistProcessingResult(message.id, result, batchJobId);
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
   * Resolve file path - download from URL if needed
   */
  private async resolveFilePath(instanceId: string, message: Message, mimeType: string): Promise<string | null> {
    if (message.mediaLocalPath) {
      return message.mediaLocalPath;
    }

    if (!message.mediaUrl) {
      return null;
    }

    try {
      const result = await this.mediaStorage.storeFromUrl(
        instanceId,
        message.id,
        message.mediaUrl,
        mimeType,
        message.platformTimestamp ?? undefined,
      );
      await this.mediaStorage.updateMessageLocalPath(message.id, result.localPath);
      return result.localPath;
    } catch {
      return null;
    }
  }

  /**
   * Persist processing result to DB (called only when result.success && result.content is truthy)
   */
  private async persistProcessingResult(
    messageId: string,
    result: ProcessingResult,
    batchJobId: string,
  ): Promise<void> {
    // Content is guaranteed by caller check: `if (result.success && result.content)`
    const content = result.content ?? '';

    await this.db.insert(mediaContent).values({
      mediaId: messageId,
      processingType: result.processingType,
      content,
      model: result.model,
      provider: result.provider,
      language: result.language,
      duration: result.duration,
      tokensUsed: result.inputTokens ? result.inputTokens + (result.outputTokens ?? 0) : undefined,
      costUsd: result.costCents,
      processingTimeMs: result.processingTimeMs,
      batchJobId,
    });

    const updateData = this.getMessageUpdateForType(result.processingType, content);
    if (updateData) {
      await this.db.update(messages).set(updateData).where(eq(messages.id, messageId));
    }
  }

  /**
   * Query messages with raw event payloads for re-downloading media from WhatsApp CDN.
   * Uses DISTINCT ON to get one event per message (most recent).
   */
  private async queryRedownloadItems(options: {
    jobType: BatchJobType;
    instanceId: string;
    daysBack?: number;
    limit?: number;
    contentTypes?: ProcessableContentType[];
  }): Promise<RedownloadItem[]> {
    const { instanceId, daysBack, limit, contentTypes } = options;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (daysBack ?? 30));

    // Raw SQL for DISTINCT ON joined query
    const query = sql`
      SELECT DISTINCT ON (m.id)
        m.id as message_id,
        m.chat_id,
        m.external_id as message_external_id,
        m.has_media,
        m.media_mime_type,
        m.media_local_path,
        m.media_url,
        m.text_content,
        m.platform_timestamp,
        m.transcription,
        m.image_description,
        m.video_description,
        m.document_extraction,
        m.created_at as message_created_at,
        e.raw_payload,
        e.instance_id as event_instance_id
      FROM messages m
      INNER JOIN omni_events e ON e.external_id = m.external_id
      INNER JOIN chats c ON c.id = m.chat_id
      WHERE m.has_media = true
        AND m.media_local_path IS NULL
        AND e.event_type = 'message.received'
        AND e.raw_payload IS NOT NULL
        AND c.instance_id = ${instanceId}
        AND m.created_at >= ${cutoffDate}
      ORDER BY m.id, e.created_at DESC
    `;

    const result = await this.db.execute(query);
    const rows = result as unknown as Array<Record<string, unknown>>;

    // Map raw rows to RedownloadItem
    const items: RedownloadItem[] = [];
    for (const row of rows) {
      const message: Message = {
        id: row.message_id as string,
        chatId: row.chat_id as string,
        externalId: row.message_external_id as string,
        hasMedia: row.has_media as boolean,
        mediaMimeType: row.media_mime_type as string | null,
        mediaLocalPath: row.media_local_path as string | null,
        mediaUrl: row.media_url as string | null,
        textContent: row.text_content as string | null,
        platformTimestamp: row.platform_timestamp as Date | null,
        transcription: row.transcription as string | null,
        imageDescription: row.image_description as string | null,
        videoDescription: row.video_description as string | null,
        documentExtraction: row.document_extraction as string | null,
        createdAt: row.message_created_at as Date,
      } as Message;

      items.push({
        message,
        rawPayload: row.raw_payload as Record<string, unknown>,
        eventInstanceId: row.event_instance_id as string,
      });
    }

    // Filter by content types
    const allowedTypes = new Set(contentTypes ?? PROCESSABLE_CONTENT_TYPES);
    const filtered = items.filter((item) => {
      const type = this.getContentTypeFromMime(item.message.mediaMimeType);
      return type && allowedTypes.has(type);
    });

    return limit ? filtered.slice(0, limit) : filtered;
  }

  /**
   * Process a single re-download item: reconstruct WAMessage, download from CDN, store locally
   */
  private async processRedownloadItem(item: RedownloadItem, jobId: string, state: JobProcessingState): Promise<void> {
    try {
      const payload = item.rawPayload;

      // Reconstruct WAMessage-compatible object from raw payload
      const waMessage = {
        key: payload.key,
        message: payload.message,
        messageTimestamp: payload.messageTimestamp,
      } as Parameters<typeof downloadMediaToBuffer>[0];

      const result = await downloadMediaToBuffer(waMessage);
      if (!result) {
        state.failedItems++;
        state.errors.push({ itemId: item.message.id, error: 'downloadMediaToBuffer returned null' });
        return;
      }

      const stored = await this.mediaStorage.storeFromBuffer(
        item.eventInstanceId,
        item.message.id,
        result.buffer,
        result.mimeType,
        item.message.platformTimestamp ?? undefined,
      );

      await this.mediaStorage.updateMessageLocalPath(item.message.id, stored.localPath);
      state.processedItems++;
      // Zero cost, zero tokens for re-download
    } catch (error) {
      state.failedItems++;
      const errorMsg = String(error);
      // 404/410 = expired CDN link
      const isExpired = errorMsg.includes('404') || errorMsg.includes('410') || errorMsg.includes('Gone');
      state.errors.push({
        itemId: item.message.id,
        error: isExpired ? 'Media expired on CDN' : errorMsg,
      });
      log.warn('Redownload failed', { jobId, messageId: item.message.id, error: errorMsg });
    }
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
    const chatConditions = [eq(chats.instanceId, instanceId)];

    if (jobType === 'targeted_chat_sync' && chatId) {
      chatConditions.push(eq(chats.externalId, chatId));
    }

    if (jobType === 'time_based_batch' && daysBack !== undefined) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      conditions.push(gte(messages.createdAt, cutoffDate));
    }

    // Query with join
    let query = this.db
      .select({ message: messages })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(...conditions, ...chatConditions))
      .orderBy(desc(messages.createdAt))
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
   * Count items by content type from MIME types
   */
  private countByMimeType(mimeTypes: (string | null)[]): {
    audioCount: number;
    imageCount: number;
    videoCount: number;
    documentCount: number;
  } {
    const counts = { audioCount: 0, imageCount: 0, videoCount: 0, documentCount: 0 };
    for (const mime of mimeTypes) {
      const type = this.getContentTypeFromMime(mime);
      if (type === 'audio') counts.audioCount++;
      else if (type === 'image') counts.imageCount++;
      else if (type === 'video') counts.videoCount++;
      else if (type === 'document') counts.documentCount++;
    }
    return counts;
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
      totalCostCents: job.totalCostUsd ?? 0,
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
