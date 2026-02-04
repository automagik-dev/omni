# WISH: Media Processing - Batch Job System

**Status:** DRAFT
**Beads:** omni-ap0
**Priority:** P1
**Depends On:** media-processing-realtime

## Context

Omni v1 has a batch job system that allows users to reprocess historical messages. This includes:
- **Targeted Chat Sync**: Process ALL messages from a specific chat (no limits)
- **Time-based Batch**: Process messages from past N days with optional limits

**V1 Reference Files:**
- `/home/cezar/dev/omni/src/api/routes/batch_jobs.py` - API endpoints
- `/home/cezar/dev/omni/src/services/batch_job_service.py` - Job orchestration
- `/home/cezar/dev/omni/src/db/trace_models.py` - BatchJob table
- `/home/cezar/tmp/MEDIA_PROCESSING_SYSTEM_PRD.md` - Full PRD

## Problem Statement

V2 has no way to process historical media. Users cannot:
- Sync all media from an old chat
- Reprocess messages from the past N days
- Track batch job progress in real-time
- See cost projections before starting

## Scope

### IN SCOPE

1. **Database Schema**
   - `batch_jobs` table for job tracking
   - Progress metrics (total, processed, failed, skipped)
   - Cost aggregation

2. **Batch Job Types**
   - `targeted_chat_sync` - All messages from one chat
   - `time_based_batch` - Messages from past N days

3. **Job Management API**
   - Create job (with parameters)
   - Get job status (real-time progress)
   - Get job details (results breakdown)
   - Cancel job
   - List jobs (with filtering)

4. **Progress Tracking**
   - Real-time progress percentage
   - Current item being processed
   - Running cost total
   - Estimated completion time

5. **Job Configuration**
   - Content types filter (audio, image, video, document)
   - Days back (7, 14, 30, 60, 90, 180, 365)
   - Limit (50, 100, 250, 500, 1000, unlimited)
   - Instance filter (specific or all)
   - Force reprocess (override existing MediaContent)

### OUT OF SCOPE

- UI for batch jobs (handled in UI wish)
- Scheduled/recurring jobs
- Multi-tenant job isolation

## Technical Design

### Database Schema

```typescript
// packages/db/src/schema.ts additions

export const batchJobs = pgTable('batch_jobs', {
  id: text('id').primaryKey(), // UUID
  jobType: text('job_type').notNull(), // 'targeted_chat_sync' | 'time_based_batch'
  instanceId: text('instance_id').references(() => instances.id),

  // Request parameters
  requestParams: jsonb('request_params').$type<{
    contentTypes: ('audio' | 'image' | 'video' | 'document')[];
    chatId?: string; // For targeted sync
    daysBack?: number; // For time-based
    limit?: number; // 0 = unlimited
    language?: string;
    force?: boolean; // Reprocess existing
  }>(),

  // Progress
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  totalFound: integer('total_found'), // All matching before filtering
  totalItems: integer('total_items'), // Items to process (after limit)
  processedItems: integer('processed_items').default(0),
  failedItems: integer('failed_items').default(0),
  skippedItems: integer('skipped_items').default(0),
  currentItem: text('current_item'), // Real-time indicator
  progressPercent: numeric('progress_percent', { precision: 5, scale: 2 }),

  // Cost aggregation
  totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 8 }),
  totalTokens: integer('total_tokens'),

  // Results summary
  resultsSummary: jsonb('results_summary').$type<{
    audioProcessed: number;
    imagesProcessed: number;
    videosProcessed: number;
    documentsProcessed: number;
    downloadFailed: number;
    processingFailed: number;
  }>(),

  errorMessage: text('error_message'),

  // Timeline
  createdAt: timestamp('created_at').defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
});
```

### API Endpoints

```typescript
// POST /api/v1/batch-jobs
// Create a new batch job
{
  jobType: 'targeted_chat_sync' | 'time_based_batch',
  instanceId: string,
  chatId?: string, // Required for targeted_chat_sync
  contentTypes: ('audio' | 'image' | 'video' | 'document')[],
  daysBack?: number, // For time_based_batch
  limit?: number,
  force?: boolean,
}

// GET /api/v1/batch-jobs/:jobId/status
// Real-time progress (poll every 2s)
{
  jobId: string,
  status: 'processing',
  processedItems: 42,
  failedItems: 1,
  progressPercent: 42.0,
  currentItem: 'msg_987',
  totalCostUsd: 1.18,
  estimatedCompletion: '2026-02-04T10:12:30Z',
}

// GET /api/v1/batch-jobs/:jobId/details
// Full results after completion
{
  jobId: string,
  status: 'completed',
  processedItems: [...],
  failedItems: [...],
  resultsSummary: {...},
}

// POST /api/v1/batch-jobs/:jobId/cancel
// Cancel a running job

// GET /api/v1/batch-jobs
// List jobs with filtering
```

## Implementation Groups

### Group 1: Schema & Service
- [ ] Add `batch_jobs` table to DB schema
- [ ] Create `BatchJobService` class
- [ ] Implement job state machine

### Group 2: Job Execution
- [ ] Implement targeted chat sync logic
- [ ] Implement time-based batch logic
- [ ] Add progress tracking
- [ ] Add cost aggregation

### Group 3: API
- [ ] Create batch jobs router
- [ ] Implement all endpoints
- [ ] Add OpenAPI documentation

### Group 4: Testing
- [ ] Unit tests for BatchJobService
- [ ] Integration tests for job execution
- [ ] API endpoint tests

## Success Criteria

- [ ] Users can sync all media from a specific chat
- [ ] Users can batch process messages from past N days
- [ ] Progress is tracked in real-time
- [ ] Jobs can be cancelled mid-execution
- [ ] Cost tracking aggregates correctly
- [ ] Failed items don't block job completion

## Dependencies

- `media-processing-realtime` wish (processors, MediaContent table)
