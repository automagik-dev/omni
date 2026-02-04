# WISH: Media Processing - Batch Job System

> Reprocess historical media with progress tracking, cancellation, and resumability

**Status:** APPROVED
**Created:** 2026-02-04
**Author:** WISH Agent
**Beads:** omni-ap0
**Priority:** P1
**Depends On:** ✅ media-processing-realtime (SHIPPED)

---

## Problem Statement

Users have historical chats with unprocessed media (audio, images, videos, documents). V2 currently only processes media in real-time when messages arrive. There's no way to:

- Process all media from an old chat retroactively
- Batch process messages from the past N days
- Track progress of long-running processing jobs
- Cancel a job mid-execution
- Resume a job after API restart

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| **DEC-1** | Hybrid execution model | DB-backed jobs with in-process worker. Events for notifications. Balances simplicity with resumability. |
| **DEC-2** | Match V1 feature set | Targeted chat sync + time-based batch + cost projections |
| **DEC-3** | Resumability required | On restart, query `status=processing` jobs and continue from `processedItems` |
| **DEC-4** | Cancellation via DB flag | Worker checks `status` between items, stops if `cancelled` |
| **DEC-5** | Reuse real-time processor logic | Same `MediaProcessingService`, same `persistProcessingResult` pattern |

## Assumptions

| ID | Assumption | Impact if Wrong |
|----|------------|-----------------|
| **ASM-1** | Single API process handles jobs | If multi-instance, need job locking (add later) |
| **ASM-2** | Jobs complete in reasonable time | If hours+, may need external worker |
| **ASM-3** | Media files are accessible locally | If S3-only, need download step |

## Risks

| ID | Risk | Mitigation |
|----|------|------------|
| **RISK-1** | Long job blocks API resources | Process with delays between items, yield to event loop |
| **RISK-2** | Restart loses in-flight item | Track `currentItem`, skip already-processed on resume |
| **RISK-3** | Cost overrun | Show projection before starting, allow cancel anytime |

---

## Scope

### IN SCOPE

1. **BatchJobService** - Orchestrates job lifecycle
2. **Job Types**
   - `targeted_chat_sync` - All media from one chat (no limit)
   - `time_based_batch` - Media from past N days (with optional limit)
3. **API Endpoints**
   - `POST /api/v1/batch-jobs` - Create job
   - `GET /api/v1/batch-jobs/:id` - Get job details
   - `GET /api/v1/batch-jobs/:id/status` - Real-time progress (poll every 2s)
   - `POST /api/v1/batch-jobs/:id/cancel` - Cancel running job
   - `GET /api/v1/batch-jobs` - List jobs with filtering
   - `POST /api/v1/batch-jobs/:id/estimate` - Cost projection before starting
4. **Progress Tracking**
   - `totalItems`, `processedItems`, `failedItems`, `skippedItems`
   - `currentItem` (message ID being processed)
   - `progressPercent` (0-100)
   - `totalCostUsd`, `totalTokens`
5. **Cancellation** - Set status to `cancelled`, worker stops gracefully
6. **Resumability** - On startup, resume `processing` jobs from checkpoint
7. **CLI Commands** - `omni batch create`, `omni batch status`, `omni batch cancel`, `omni batch list`

### OUT OF SCOPE

- UI for batch jobs (separate wish)
- Scheduled/recurring jobs
- Multi-tenant job isolation
- External worker process (future enhancement)
- Job priority/queuing (FIFO for now)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| api | [x] routes, [x] services | New BatchJobService + routes |
| db | [ ] schema | Already has `batch_jobs` table |
| core | [x] events | New batch job events |
| sdk | [x] regenerate | New API endpoints |
| cli | [x] commands | `batch` command group |
| media-processing | [ ] no changes | Reuse existing service |

### System Checklist

- [x] **Database**: `batch_jobs` table exists, may need minor adjustments
- [x] **Events**: Add `batch-job.created`, `batch-job.progress`, `batch-job.completed`, `batch-job.cancelled`
- [x] **SDK**: Regenerate after API routes added
- [x] **CLI**: Add `batch` command group
- [x] **Tests**: Service + API + CLI tests

---

## Technical Design

### Job State Machine

```
pending → processing → completed
              ↓
         cancelled
              ↓
           failed
```

### Resumability Flow

```
On API Startup:
1. Query: SELECT * FROM batch_jobs WHERE status = 'processing'
2. For each job:
   a. Load requestParams
   b. Query items already in media_content with this batchJobId
   c. Resume processing remaining items
```

### Cancellation Flow

```
1. API receives cancel request
2. UPDATE batch_jobs SET status = 'cancelled' WHERE id = ?
3. Worker (in processing loop):
   - Before each item: check status
   - If cancelled: break loop, set completedAt
```

### Cost Estimation

```typescript
// Before starting, calculate estimate
const items = await queryEligibleItems(params);
const estimate = {
  totalItems: items.length,
  audioCount: items.filter(i => i.type === 'audio').length,
  imageCount: items.filter(i => i.type === 'image').length,
  // ... costs based on provider rates
  estimatedCostUsd: calculateCost(items),
  estimatedTimeMinutes: items.length * AVG_PROCESSING_TIME_MS / 60000,
};
```

### API Response Examples

```typescript
// POST /api/v1/batch-jobs
{
  jobType: 'targeted_chat_sync',
  instanceId: 'uuid',
  chatId: 'chat-external-id',
  contentTypes: ['audio', 'image'],
  force: false, // Skip items already processed
}

// GET /api/v1/batch-jobs/:id/status
{
  id: 'uuid',
  status: 'processing',
  totalItems: 150,
  processedItems: 42,
  failedItems: 1,
  skippedItems: 5,
  progressPercent: 28,
  currentItem: 'msg-uuid-xyz',
  totalCostUsd: 1.18,
  estimatedCompletion: '2026-02-04T10:12:30Z',
}
```

---

## Execution Groups

### Group A: Service & Core

**Goal:** Implement BatchJobService with full lifecycle management

**Packages:** `api`, `core`

**Deliverables:**
- [ ] `BatchJobService` class with:
  - `createJob(params)` - Validate, insert job, start processing
  - `getJob(id)` - Full job details
  - `getJobStatus(id)` - Progress snapshot
  - `cancelJob(id)` - Set cancelled status
  - `listJobs(filters)` - Paginated list
  - `estimateCost(params)` - Pre-start projection
- [ ] `executeJob(job)` - Main processing loop
  - Query eligible messages
  - Process each with MediaProcessingService
  - Update progress after each item
  - Check for cancellation between items
  - Handle errors gracefully (continue on failure)
- [ ] `resumeJobs()` - Called on startup, resumes processing jobs
- [ ] Events: `batch-job.created`, `batch-job.progress`, `batch-job.completed`, `batch-job.cancelled`, `batch-job.failed`

**Acceptance Criteria:**
- [ ] Jobs persist across API restart
- [ ] Cancelled jobs stop within 1 item
- [ ] Failed items don't block job completion
- [ ] Progress updates in real-time

**Validation:**
- `make check`
- `bun test packages/api`

---

### Group B: API Routes

**Goal:** Expose batch job management via REST API

**Packages:** `api`, `sdk`

**Deliverables:**
- [ ] `POST /api/v1/batch-jobs` - Create job
- [ ] `GET /api/v1/batch-jobs/:id` - Full details
- [ ] `GET /api/v1/batch-jobs/:id/status` - Progress (lightweight)
- [ ] `POST /api/v1/batch-jobs/:id/cancel` - Cancel
- [ ] `GET /api/v1/batch-jobs` - List with filters (`instanceId`, `status`, `jobType`)
- [ ] `POST /api/v1/batch-jobs/estimate` - Cost projection
- [ ] OpenAPI documentation for all endpoints
- [ ] Request validation with Zod schemas

**Acceptance Criteria:**
- [ ] All endpoints return appropriate status codes
- [ ] Invalid requests return 400 with clear error messages
- [ ] Non-existent jobs return 404
- [ ] Cancel on completed job returns 409

**Validation:**
- `make check`
- `make sdk-generate`
- Manual API testing with curl

---

### Group C: CLI Commands

**Goal:** CLI interface for batch job management

**Packages:** `cli`

**Deliverables:**
- [ ] `omni batch create` - Interactive job creation
  - Select instance
  - Select job type (targeted/time-based)
  - Select content types
  - For targeted: select chat
  - For time-based: select days back, limit
  - Show cost estimate, confirm before starting
- [ ] `omni batch status <id>` - Show progress
- [ ] `omni batch list` - List jobs with filtering
- [ ] `omni batch cancel <id>` - Cancel running job
- [ ] `omni batch watch <id>` - Live progress updates (poll + display)

**Acceptance Criteria:**
- [ ] Commands work without interactive prompts (flags for automation)
- [ ] Output is LLM-friendly (structured, parseable)
- [ ] Progress display updates in place (no scroll spam)

**Validation:**
- `make check`
- Manual CLI testing

---

## Success Criteria

- [ ] Users can sync all media from a specific chat
- [ ] Users can batch process messages from past N days
- [ ] Progress is tracked in real-time (poll-based)
- [ ] Jobs can be cancelled mid-execution (stops within 1 item)
- [ ] Jobs resume from checkpoint after API restart
- [ ] Cost tracking aggregates correctly
- [ ] Failed items logged but don't block completion
- [ ] CLI provides full batch management capability

---

## V1 Reference

For implementation details, refer to:
- `/home/cezar/dev/omni/src/api/routes/batch_jobs.py` - API patterns
- `/home/cezar/dev/omni/src/services/batch_job_service.py` - Service logic
- `/home/cezar/dev/omni/src/db/trace_models.py` - Schema reference

---

## Next Steps

1. Run `/forge` to execute this wish
2. Group A should complete before B (service needed for routes)
3. Group C can run in parallel with B after A completes
