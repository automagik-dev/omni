/**
 * Batch Jobs routes - manage batch media processing jobs
 *
 * POST /batch-jobs           - Create new batch job
 * GET  /batch-jobs           - List batch jobs
 * GET  /batch-jobs/:id       - Get job details
 * GET  /batch-jobs/:id/status - Get job progress (lightweight)
 * POST /batch-jobs/:id/cancel - Cancel running job
 * POST /batch-jobs/estimate  - Estimate cost before creating
 *
 * @see media-processing-batch wish
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const batchJobsRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// SCHEMAS
// ============================================================================

const jobTypeSchema = z.enum(['targeted_chat_sync', 'time_based_batch', 'media_redownload']);
const contentTypeSchema = z.enum(['audio', 'image', 'video', 'document']);
// Job statuses for reference - used in transform below
const _jobStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;

/**
 * Create batch job request schema
 */
const createBatchJobSchema = z.object({
  jobType: jobTypeSchema.describe('Type of batch job'),
  instanceId: z.string().uuid().describe('Instance ID to process media from'),
  chatId: z.string().optional().describe('Chat ID for targeted_chat_sync (required for that type)'),
  daysBack: z.number().int().positive().optional().describe('Days to look back for time_based_batch'),
  limit: z.number().int().positive().optional().describe('Max items to process'),
  contentTypes: z.array(contentTypeSchema).optional().describe('Content types to process (default: all)'),
  force: z.boolean().optional().default(false).describe('Re-process items that already have content'),
  delayMinMs: z.number().int().min(0).optional().describe('Minimum random delay between items in ms (default: 1000)'),
  delayMaxMs: z.number().int().min(0).optional().describe('Maximum random delay between items in ms (default: 3000)'),
});

/**
 * Estimate request schema
 */
const estimateSchema = z.object({
  jobType: jobTypeSchema,
  instanceId: z.string().uuid(),
  chatId: z.string().optional(),
  daysBack: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  contentTypes: z.array(contentTypeSchema).optional(),
});

/**
 * List query params schema
 */
const listQuerySchema = z.object({
  instanceId: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as ('pending' | 'running' | 'completed' | 'failed' | 'cancelled')[] | undefined),
  jobType: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as ('targeted_chat_sync' | 'time_based_batch' | 'media_redownload')[] | undefined),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /batch-jobs - Create new batch job
 *
 * Creates and starts a batch processing job for historical media.
 * The job runs in the background - poll /batch-jobs/:id/status for progress.
 */
batchJobsRoutes.post('/', zValidator('json', createBatchJobSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  // Validate required fields based on job type
  if (data.jobType === 'targeted_chat_sync' && !data.chatId) {
    return c.json({ error: 'chatId is required for targeted_chat_sync jobs' }, 400);
  }
  if (data.jobType === 'time_based_batch' && data.daysBack === undefined) {
    return c.json({ error: 'daysBack is required for time_based_batch jobs' }, 400);
  }
  if (data.jobType === 'media_redownload' && data.daysBack === undefined) {
    return c.json({ error: 'daysBack is required for media_redownload jobs' }, 400);
  }

  const job = await services.batchJobs.create({
    jobType: data.jobType,
    instanceId: data.instanceId,
    chatId: data.chatId,
    daysBack: data.daysBack,
    limit: data.limit,
    contentTypes: data.contentTypes,
    force: data.force,
    delayMinMs: data.delayMinMs,
    delayMaxMs: data.delayMaxMs,
  });

  return c.json({ data: job }, 201);
});

/**
 * GET /batch-jobs - List batch jobs
 *
 * Returns paginated list of batch jobs with optional filtering.
 */
batchJobsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { instanceId, status, jobType, limit, cursor } = c.req.valid('query');
  const services = c.get('services');

  const result = await services.batchJobs.list({
    instanceId,
    status,
    jobType,
    limit,
    cursor,
  });

  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * POST /batch-jobs/estimate - Estimate cost before creating
 *
 * Returns estimated item counts and costs without creating a job.
 * Use this to show users what will be processed before starting.
 */
batchJobsRoutes.post('/estimate', zValidator('json', estimateSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const estimate = await services.batchJobs.estimate({
    jobType: data.jobType,
    instanceId: data.instanceId,
    chatId: data.chatId,
    daysBack: data.daysBack,
    limit: data.limit,
    contentTypes: data.contentTypes,
  });

  return c.json({ data: estimate });
});

/**
 * GET /batch-jobs/:id - Get job details
 *
 * Returns full job record with all fields.
 */
batchJobsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const job = await services.batchJobs.getById(id);

  return c.json({ data: job });
});

/**
 * GET /batch-jobs/:id/status - Get job progress (lightweight)
 *
 * Returns progress snapshot optimized for polling.
 * Poll this endpoint every 2-3 seconds for real-time updates.
 */
batchJobsRoutes.get('/:id/status', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const status = await services.batchJobs.getStatus(id);

  return c.json({
    data: {
      id: status.id,
      status: status.status,
      totalItems: status.totalItems,
      processedItems: status.processedItems,
      failedItems: status.failedItems,
      skippedItems: status.skippedItems,
      progressPercent: status.progressPercent,
      currentItem: status.currentItem,
      totalCostUsd: status.totalCostUsd,
      totalTokens: status.totalTokens,
      estimatedCompletion: status.estimatedCompletion?.toISOString(),
      startedAt: status.startedAt?.toISOString(),
      completedAt: status.completedAt?.toISOString(),
    },
  });
});

/**
 * POST /batch-jobs/:id/cancel - Cancel running job
 *
 * Gracefully stops a running job. The job will complete the current item
 * before stopping. Returns 409 if job is already completed/cancelled/failed.
 */
batchJobsRoutes.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  try {
    const job = await services.batchJobs.cancel(id);
    return c.json({ data: job });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Cannot cancel job')) {
      return c.json({ error: message }, 409);
    }
    throw error;
  }
});

export { batchJobsRoutes };
