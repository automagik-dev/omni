# WISH: pg-boss Job System

> Unified durable job layer for Omni v2 — scheduling, retries, rate limiting, and crash resilience using pg-boss on existing Postgres.

**Status:** DRAFT
**Created:** 2026-02-12
**Author:** WISH Agent
**Beads:** omni-bn7

---

## Context

Omni v2 has three inconsistent execution models:

1. **In-process** — Batch jobs run inside the API process (`this.executeJob().catch()`). API crash = job death.
2. **Deferred-to-plugin** — Sync jobs created in DB but no reliable executor picks them up.
3. **Event-reactive** — Automations fire immediately on events. No delayed, scheduled, or cancellable execution.

Additionally:
- Cron scheduler (`croner`) is in-memory — restarts lose all schedules.
- Agent calls have no rate limiting — cost overruns possible.
- Webhook delivery is fire-and-forget — no retry on failure.

### Validated

pg-boss v12.11.1 tested against Bun 1.3.3 + pgserve with **67/67 features passing** (see `scripts/test-pgboss.ts`). Zero new infrastructure required — uses existing PostgreSQL.

---

## Assumptions

- **ASM-1:** Workers run inside the API process (via `boss.work()`). No separate worker service for now.
- **ASM-2:** pg-boss schema lives in its own Postgres schema (`pgboss`) alongside the `public` schema.
- **ASM-3:** NATS remains the event notification layer. pg-boss handles durable job execution. No overlap.
- **ASM-4:** Existing `batch_jobs` and `sync_jobs` tables remain for backwards compatibility during migration. New jobs go through pg-boss only.

## Decisions

- **DEC-1:** New `@omni/jobs` package for all job infrastructure.
- **DEC-2:** pg-boss uses the same `DATABASE_URL` as Drizzle — no separate connection config.
- **DEC-3:** Workers start inside API process via `boss.work()` during API bootstrap.
- **DEC-4:** Job handlers publish events to NATS on completion/progress (bridging jobs → events).
- **DEC-5:** `schedule_action` is a new automation action type that creates pg-boss jobs.

## Risks

- **RISK-1:** pg-boss uses `pg` (node-postgres) driver, Omni uses `postgres` (postgres.js). Two connection pools to the same DB. **Mitigation:** pg-boss pool is small (max 5), pgserve handles it fine in dev. Monitor in production.
- **RISK-2:** API process handles both HTTP and job workers. Heavy jobs could starve HTTP. **Mitigation:** `groupConcurrency` limits per queue. Future: split to separate worker process.
- **RISK-3:** Breaking change to automation action types. **Mitigation:** `schedule_action` is additive — existing actions unchanged.

---

## Scope

### IN SCOPE

- `@omni/jobs` package with pg-boss setup, queue definitions, typed job handlers
- Queue definitions for: `send-message`, `media-reprocess`, `sync-history`, `agent-call`, `webhook-delivery`, `failed-jobs`
- Worker registration in API bootstrap
- Migrate batch jobs execution from in-process to pg-boss workers
- Migrate sync jobs to pg-boss with singleton/exclusive dedup
- Agent call rate limiting via throttled sends + group concurrency
- Webhook delivery with retry + backoff
- `schedule_action` automation action type (delayed, cron, cancellable)
- Persistent cron scheduling (replace in-memory `croner`)
- API endpoints for scheduled job management (list, cancel, reschedule)
- Dead letter queue for failed jobs with inspection API

### OUT OF SCOPE

- Separate worker process / PM2 service (future scaling)
- UI for job management (dashboard can come later)
- Multi-step workflow orchestration (Temporal territory)
- Migration of historical `batch_jobs`/`sync_jobs` data into pg-boss tables
- SDK regeneration (no public API surface change in v1)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| **jobs** (NEW) | New package | pg-boss setup, queues, handlers, types |
| **core** | [x] automations/types | New `schedule_action` action type |
| **core** | [x] automations/actions | New action executor |
| **core** | [x] scheduler | Deprecate `croner` scheduler, replace with pg-boss |
| **db** | [x] schema | No schema changes — pg-boss manages its own tables |
| **api** | [x] services | Refactor batch-jobs, sync-jobs to use @omni/jobs |
| **api** | [x] bootstrap | Register workers on startup |
| **api** | [x] routes | Scheduled jobs management endpoints |
| **api** | [x] services/automations | Wire `schedule_action` executor |

### System Checklist

- [x] **Events**: Jobs publish to existing NATS events (batch-job.*, sync.*, etc.)
- [ ] **Database**: pg-boss creates its own schema — no Drizzle migration needed
- [ ] **SDK**: Internal API only in v1 — no SDK regen
- [ ] **CLI**: Future — `omni jobs list`, `omni jobs cancel <id>`
- [ ] **Tests**: @omni/jobs unit tests, integration tests for each worker

---

## Execution Group A: Foundation — `@omni/jobs` Package

**Goal:** Create the `@omni/jobs` package with pg-boss setup, typed queue definitions, and worker infrastructure.

**Packages:** `packages/jobs` (new)

**Deliverables:**

- [ ] Package scaffold: `packages/jobs/package.json`, `tsconfig.json`, `src/index.ts`
- [ ] `src/client.ts` — pg-boss singleton (similar to `@omni/db` client pattern)
  - `createJobClient(databaseUrl)` / `getJobClient()`
  - Configurable schema name, pool size
  - Graceful shutdown on SIGTERM
- [ ] `src/queues.ts` — Queue definitions with typed configs
  ```typescript
  export const QUEUES = {
    SEND_MESSAGE: { name: 'send-message', options: { retryLimit: 3, retryBackoff: true } },
    MEDIA_REPROCESS: { name: 'media-reprocess', options: { retryLimit: 3, retryBackoff: true, deadLetter: 'failed-jobs' } },
    SYNC_HISTORY: { name: 'sync-history', options: { policy: 'exclusive', retryLimit: 2 } },
    AGENT_CALL: { name: 'agent-call', options: { retryLimit: 2, retryDelay: 5 } },
    WEBHOOK_DELIVERY: { name: 'webhook-delivery', options: { retryLimit: 5, retryDelay: 30, retryBackoff: true } },
    FAILED_JOBS: { name: 'failed-jobs', options: { policy: 'stately' } },
  } as const;
  ```
- [ ] `src/types.ts` — Typed job payloads per queue (Zod schemas)
  ```typescript
  export const SendMessageJobSchema = z.object({
    instanceId: z.string(),
    chatId: z.string(),
    content: z.string(),
    channelType: z.string(),
    scheduledBy: z.string().optional(),  // automation ID or user ID
  });
  ```
- [ ] `src/handlers/` — Handler stubs for each queue (wired in Group B)
- [ ] `src/setup.ts` — `ensureQueues()` function that creates all queues on startup
- [ ] `src/bridge.ts` — `publishJobEvent()` helper that publishes NATS events from job handlers
- [ ] Tests: queue creation, send/fetch/complete cycle, retry behavior

**Acceptance Criteria:**

- [ ] `bun test packages/jobs` passes
- [ ] `import { getJobClient, QUEUES } from '@omni/jobs'` works from other packages
- [ ] pg-boss schema created automatically on first start
- [ ] All queues created via `ensureQueues()` with correct options
- [ ] `make check` passes (typecheck + lint)

**Validation:**
```bash
make check
bun test packages/jobs
```

---

## Execution Group B: Wire Existing Systems

**Goal:** Migrate batch jobs, sync jobs, agent calls, and webhooks from in-process/ad-hoc execution to pg-boss workers. Replace `croner` with pg-boss cron.

**Packages:** `packages/api`, `packages/jobs`, `packages/core`

**Deliverables:**

### B1: Batch Jobs → pg-boss

- [ ] Worker handler: `packages/jobs/src/handlers/media-reprocess.ts`
  - Receives job with item list, processes sequentially
  - Publishes `batch-job.progress` events to NATS
  - Updates `batch_jobs` table for backwards compat
  - Respects cancellation via `job.signal` (AbortSignal)
- [ ] Refactor `packages/api/src/services/batch-jobs.ts`
  - `createJob()` → `boss.send('media-reprocess', payload)` instead of `this.executeJob()`
  - Remove in-process execution code
  - Keep progress polling endpoint (reads from `batch_jobs` table)
- [ ] Remove `resumeJobs()` on startup — pg-boss handles persistence

### B2: Sync Jobs → pg-boss

- [ ] Worker handler: `packages/jobs/src/handlers/sync-history.ts`
  - Exclusive queue — only one sync per instance at a time (`singletonKey: instanceId`)
  - Publishes `sync.progress` / `sync.completed` events
  - Updates `sync_jobs` table
- [ ] Refactor sync job creation to use `boss.send('sync-history', payload, { singletonKey: instanceId })`

### B3: Agent Calls → pg-boss (Rate Limited)

- [ ] Worker handler: `packages/jobs/src/handlers/agent-call.ts`
  - `groupConcurrency: 2` per instance — max 2 concurrent agent calls per channel
  - Throttled sends: `boss.sendThrottled()` to prevent burst
  - Publishes agent response events
- [ ] Refactor `agent-runner.ts` to enqueue instead of direct call (for automation-triggered agents)
  - Direct agent calls (user-initiated) remain synchronous
  - Automation `call_agent` action routes through pg-boss

### B4: Webhook Delivery → pg-boss

- [ ] Worker handler: `packages/jobs/src/handlers/webhook-delivery.ts`
  - Retry with exponential backoff (5 attempts, 30s base delay)
  - Dead letter after exhausting retries
- [ ] Refactor webhook action executor to enqueue delivery

### B5: Replace croner → pg-boss cron

- [ ] Migrate any existing `croner` schedules to `boss.schedule()`
- [ ] Deprecate `packages/core/src/scheduler/` (mark for removal)
- [ ] Cron schedules persist in DB — survive restarts

### B6: API Bootstrap Integration

- [ ] `packages/api/src/bootstrap.ts` (or equivalent):
  ```typescript
  const boss = await createJobClient(DATABASE_URL);
  await ensureQueues(boss);
  await registerWorkers(boss, { eventBus, db, sendMessage, callAgent });
  ```
- [ ] Graceful shutdown: `boss.stop()` on SIGTERM/SIGINT
- [ ] Dead letter consumer: log + store failed jobs for inspection

**Acceptance Criteria:**

- [ ] Batch job creation returns immediately (202 Accepted)
- [ ] Batch job survives API restart (kill API mid-job, restart, job resumes)
- [ ] Sync jobs can't duplicate per instance (exclusive queue)
- [ ] Agent calls throttled — max 2 concurrent per instance
- [ ] Webhook retries visible in dead letter queue after 5 failures
- [ ] Cron schedules persist after API restart
- [ ] `make check` passes
- [ ] Existing API endpoints unchanged (backwards compatible)

**Validation:**
```bash
make check
bun test packages/jobs
bun test packages/api
# Manual: kill API during batch job, restart, verify job completes
```

---

## Execution Group C: `schedule_action` — Time Dimension for Automations

**Goal:** Add `schedule_action` as a new automation action type, enabling delayed, scheduled, and cancellable actions.

**Packages:** `packages/core`, `packages/api`, `packages/jobs`

**Deliverables:**

### C1: Type Definitions

- [ ] Add to `packages/core/src/automations/types.ts`:
  ```typescript
  export interface ScheduleActionConfig {
    /** Delay in seconds from now */
    delay?: number;
    /** Exact datetime (ISO 8601 or template) */
    at?: string;
    /** Cron expression for recurring */
    cron?: string;
    /** Timezone for cron (default: UTC) */
    tz?: string;
    /** Dedup key (template) — prevents duplicate schedules */
    key?: string;
    /** Cancel if this event fires before execution */
    cancelOnEvent?: string;
    cancelConditions?: AutomationCondition[];
    /** Actions to execute when triggered */
    actions: AutomationAction[];
  }
  ```
- [ ] Add `'schedule_action'` to `ACTION_TYPES`
- [ ] Add to `AutomationAction` union type

### C2: Action Executor

- [ ] `packages/core/src/automations/actions.ts` — add `executeScheduleAction()`
  - Resolves templates in `at`, `key`, `delay`
  - Creates pg-boss job via `boss.send()` / `boss.sendAfter()` / `boss.schedule()`
  - Returns job ID for tracking
- [ ] Worker handler: `packages/jobs/src/handlers/scheduled-action.ts`
  - Receives nested actions + context
  - Executes actions using existing `executeActions()` pipeline
  - Publishes completion events

### C3: Cancel-on-Event Support

- [ ] When `cancelOnEvent` is set, register a NATS listener for that event type
- [ ] On matching event: `boss.cancel('scheduled-action', jobId)`
- [ ] Track active cancellable jobs: `{ jobId, eventType, conditions }` in memory or DB
- [ ] Clean up listeners when job completes or is cancelled

### C4: API Endpoints for Scheduled Jobs

- [ ] `GET /v2/scheduled-jobs` — List pending scheduled jobs (wraps `boss.findJobs()`)
- [ ] `GET /v2/scheduled-jobs/:id` — Get scheduled job details
- [ ] `DELETE /v2/scheduled-jobs/:id` — Cancel a scheduled job
- [ ] `GET /v2/schedules` — List active cron schedules (wraps `boss.getSchedules()`)
- [ ] `DELETE /v2/schedules/:name` — Remove a cron schedule

### C5: Scheduled Message Convenience

- [ ] `POST /v2/messages/schedule` — Schedule a message send
  ```typescript
  {
    instanceId: string,
    chatId: string,
    content: string,
    sendAt: string,      // ISO datetime
    key?: string,        // dedup key
  }
  ```
  - Creates a pg-boss job with `sendAfter`
  - Returns `{ jobId, scheduledFor }`
- [ ] `GET /v2/messages/scheduled` — List scheduled messages for an instance
- [ ] `DELETE /v2/messages/scheduled/:jobId` — Cancel a scheduled message

**Acceptance Criteria:**

- [ ] Automation with `schedule_action` creates delayed pg-boss job
- [ ] Delayed action fires at correct time (within 1-minute accuracy)
- [ ] Cron schedule persists and fires recurring jobs
- [ ] `cancelOnEvent` cancels scheduled job when matching event arrives
- [ ] Scheduled messages appear in list endpoint and can be cancelled
- [ ] Existing automation actions unaffected (backwards compatible)
- [ ] `make check` passes

**Validation:**
```bash
make check
bun test packages/core
bun test packages/api
bun test packages/jobs
# Manual: create scheduled message, verify it sends at correct time
# Manual: create follow-up automation, reply before timeout, verify cancellation
```

---

## Queue Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│                  API Process (Hono)                  │
│                                                     │
│  HTTP Handlers ──→ boss.send() ──→ pg-boss (PG)    │
│                                                     │
│  boss.work() workers:                               │
│    ├── send-message      (priority, retry)          │
│    ├── media-reprocess   (retry, DLQ, AbortSignal)  │
│    ├── sync-history      (exclusive per instance)   │
│    ├── agent-call        (throttled, grouped)       │
│    ├── webhook-delivery  (retry + backoff)          │
│    ├── scheduled-action  (delayed + cron)           │
│    └── failed-jobs       (stately, inspection)      │
│                                                     │
│  Each worker ──→ NATS events (progress/completion)  │
└─────────────────────────────────────────────────────┘
```

## Dependencies Between Groups

```
Group A (Foundation) ──→ Group B (Wire Existing)
                    └──→ Group C (schedule_action)

B and C are independent of each other, can be parallelized.
```

---

## Open Questions

1. **Agent call path**: Should ALL agent calls go through pg-boss, or only automation-triggered ones? (Current decision: only automation-triggered. User-initiated stays synchronous for UX.)
2. **Batch job granularity**: One pg-boss job per batch, or one per item? (Recommendation: per batch, with progress tracking inside the handler.)
3. **Cancel-on-event persistence**: Store active cancellation watchers in memory or DB? (Memory is simpler but lost on restart. DB is durable but adds queries.)
