# WISH: Events Ops

> Operational tooling for the event system: dead letter handling, replay, payload storage, and metrics.

**Status:** READY
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-gwb

---

## Context

Once the core EventBus is running (`nats-events` wish), we need operational tooling to handle failures, debug issues, and monitor system health. This wish covers the "day 2" operations capabilities.

**Existing from nats-events:**
- `SystemEventSchemas.deadLetter` - schema for dead letter events (`system.dead_letter`)
- `SystemEventSchemas.replayStarted` - schema for replay start events
- `SystemEventSchemas.replayCompleted` - schema for replay completion events
- `SystemEventSchemas.healthDegraded` - schema for health alerts
- SYSTEM stream configured for `system.>` events

Reference: `docs/architecture/event-system.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | `nats-events` wish completed (EventBus working) |
| **DEC-1** | Decision | Dead letter events stored in PostgreSQL (not just NATS) |
| **DEC-2** | Decision | Payloads compressed with gzip before storage |
| **DEC-3** | Decision | 14-day retention for payloads, 30-day for dead letters |
| **DEC-4** | Decision | Metrics exposed via `/metrics` endpoint (Prometheus format) |
| **DEC-5** | Decision | Auto-retry dead letters: 1h → 6h → 24h, then manual intervention |
| **DEC-6** | Decision | Payload storage configurable per event type (not per instance) |
| **DEC-7** | Decision | Soft-delete for payloads (audit trail preserved, marked deleted) |
| **DEC-8** | Decision | Full application metrics (events + NATS + DB pool + system) |
| **DEC-9** | Decision | In-process scheduler for cleanup (CLI command added later) |

---

## Scope

### IN SCOPE

- Dead letter queue handling (failed events after max retries)
- Dead letter database table and storage
- Dead letter retry mechanism
- Event replay by time range
- Event replay by specific ID
- Payload storage with compression
- Payload retrieval and decompression
- Basic event metrics (counts, latencies)
- Cleanup jobs for retention

### OUT OF SCOPE

- Grafana dashboards (separate ops task)
- Alerting rules (separate ops task)
- Multi-region replication
- Real-time metrics streaming

---

## Execution Group A: Dead Letter Queue

**Goal:** Capture and store failed events for debugging and auto/manual retry.

**Deliverables:**
- [ ] `packages/core/src/events/dead-letter.ts` - Dead letter handler + auto-retry
- [ ] `packages/db/src/schema/dead-letter.ts` - Database table
- [ ] Integration with NatsEventBus (after max retries → dead letter)
- [ ] Auto-retry scheduler (1h → 6h → 24h backoff)
- [ ] API endpoints for listing and managing dead letters

**Database Schema:**
```typescript
export const deadLetterEvents = pgTable('dead_letter_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  payload: jsonb('payload').notNull(),
  error: text('error').notNull(),
  stack: text('stack'),

  // Retry tracking
  autoRetryCount: integer('auto_retry_count').notNull().default(0),
  manualRetryCount: integer('manual_retry_count').notNull().default(0),
  nextAutoRetryAt: timestamp('next_auto_retry_at'),  // null = no more auto-retries

  // Status tracking
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  // Status: 'pending' | 'retrying' | 'resolved' | 'abandoned'

  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastRetryAt: timestamp('last_retry_at'),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: varchar('resolved_by', { length: 100 }),  // manual resolution note
});
```

**Auto-Retry Schedule:**
| Attempt | Delay | nextAutoRetryAt |
|---------|-------|-----------------|
| 1 | 1 hour | createdAt + 1h |
| 2 | 6 hours | lastRetryAt + 6h |
| 3 | 24 hours | lastRetryAt + 24h |
| 4+ | Manual only | null |

**API Endpoints:**
- `GET /api/v2/dead-letters` - List with filters (status, eventType, dateRange)
- `GET /api/v2/dead-letters/:id` - Get single dead letter with payload
- `POST /api/v2/dead-letters/:id/retry` - Manual retry
- `POST /api/v2/dead-letters/:id/resolve` - Mark as resolved (with note)
- `POST /api/v2/dead-letters/:id/abandon` - Give up on auto-retry

**Acceptance Criteria:**
- [ ] Events exceeding max retries go to dead letter table
- [ ] Dead letters include full event payload and error details
- [ ] Auto-retry runs in-process on schedule (1h, 6h, 24h)
- [ ] After 3 auto-retries, requires manual intervention
- [ ] Can manually retry at any time
- [ ] Can mark as resolved with a note
- [ ] Can abandon to stop auto-retries
- [ ] Publishes `system.dead_letter` event on creation
- [ ] List endpoint supports filtering by status, type, date range

**Validation:**
```bash
bun test packages/core/src/events/__tests__/dead-letter.test.ts
```

---

## Execution Group B: Payload Storage

**Goal:** Store event payloads for debugging and compliance with configurable retention.

**Deliverables:**
- [ ] `packages/core/src/events/payload-store.ts` - Payload storage service
- [ ] `packages/db/src/schema/event-payloads.ts` - Database table
- [ ] `packages/db/src/schema/payload-config.ts` - Per-type configuration
- [ ] Compression with gzip
- [ ] Soft-delete with audit trail
- [ ] Configurable storage per event type

**Database Schema:**
```typescript
// Payload storage configuration per event type
export const payloadStorageConfig = pgTable('payload_storage_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 100 }).notNull().unique(),
  // '*' = default for all types

  storeWebhookRaw: boolean('store_webhook_raw').notNull().default(true),
  storeAgentRequest: boolean('store_agent_request').notNull().default(true),
  storeAgentResponse: boolean('store_agent_response').notNull().default(true),
  storeChannelSend: boolean('store_channel_send').notNull().default(true),
  storeError: boolean('store_error').notNull().default(true),

  retentionDays: integer('retention_days').notNull().default(14),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Actual payload storage
export const eventPayloads = pgTable('event_payloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  stage: varchar('stage', { length: 50 }).notNull(),
  // Stages: 'webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error'

  payloadCompressed: text('payload_compressed').notNull(),
  payloadSizeOriginal: integer('payload_size_original'),
  payloadSizeCompressed: integer('payload_size_compressed'),

  // Metadata
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  containsMedia: boolean('contains_media').notNull().default(false),
  containsBase64: boolean('contains_base64').notNull().default(false),

  // Soft-delete for audit trail
  deletedAt: timestamp('deleted_at'),
  deletedBy: varchar('deleted_by', { length: 100 }),
  deleteReason: varchar('delete_reason', { length: 255 }),
});
```

**API Endpoints:**
- `GET /api/v2/events/:eventId/payloads` - List payloads for event
- `GET /api/v2/events/:eventId/payloads/:stage` - Get specific stage
- `DELETE /api/v2/events/:eventId/payloads` - Soft-delete (requires reason)
- `GET /api/v2/payload-config` - List storage configs
- `PUT /api/v2/payload-config/:eventType` - Update config for type

**Acceptance Criteria:**
- [ ] Can store payload at any stage (respecting config)
- [ ] Storage decision based on event type config (with `*` default)
- [ ] Payloads compressed with gzip (typically 5-10x reduction)
- [ ] Can retrieve and decompress payload by eventId + stage
- [ ] Soft-delete preserves record but clears payload data
- [ ] Soft-delete requires reason (audit trail)
- [ ] Content flags (media, base64) set automatically
- [ ] Config API allows per-type customization

**Validation:**
```bash
bun test packages/core/src/events/__tests__/payload-store.test.ts
```

---

## Execution Group C: Replay, Metrics & Cleanup

**Goal:** Enable event replay, full application observability, and automated cleanup.

**Deliverables:**
- [ ] `packages/core/src/events/replay.ts` - Event replay service
- [ ] `packages/core/src/metrics/` - Full application metrics
- [ ] `packages/core/src/scheduler/` - In-process job scheduler
- [ ] `packages/api/src/routes/v2/metrics.ts` - Prometheus endpoint
- [ ] Cleanup jobs for retention enforcement

**Replay Interface:**
```typescript
interface ReplayOptions {
  stream: string;
  startTime: Date;
  endTime?: Date;
  eventTypes?: string[];  // Filter by type
  filter?: (event: OmniEvent) => boolean;
  handler: (event: OmniEvent) => Promise<void>;
  dryRun?: boolean;  // Log but don't execute
  rateLimit?: number;  // events/sec limit
}

interface ReplayResult {
  id: string;  // Replay job ID
  processed: number;
  skipped: number;
  errors: number;
  duration: number;
  status: 'running' | 'completed' | 'failed';
}
```

**Full Application Metrics:**
```typescript
// Event metrics
omni_events_total{type, status}              // Counter
omni_events_processing_seconds{type}         // Histogram (p50, p95, p99)
omni_events_agent_latency_seconds{type}      // Histogram
omni_dead_letters_total{type, status}        // Counter
omni_dead_letters_pending                    // Gauge

// NATS metrics
omni_nats_connected                          // Gauge (0/1)
omni_nats_messages_published_total{stream}   // Counter
omni_nats_messages_consumed_total{stream}    // Counter
omni_nats_consumer_lag{stream, consumer}     // Gauge

// Database metrics
omni_db_pool_connections{state}              // Gauge (idle, active, waiting)
omni_db_query_duration_seconds{operation}    // Histogram

// System metrics
omni_process_memory_bytes{type}              // Gauge (heap, rss, external)
omni_process_cpu_seconds_total               // Counter
omni_process_uptime_seconds                  // Gauge
```

**API Endpoints:**
- `GET /metrics` - Prometheus format (all metrics)
- `POST /api/v2/replay` - Start replay job
- `GET /api/v2/replay/:id` - Get replay status
- `POST /api/v2/replay/:id/cancel` - Cancel running replay

**In-Process Scheduler:**
```typescript
// Cleanup jobs run automatically
const scheduler = createScheduler({
  jobs: [
    {
      name: 'cleanup-payloads',
      schedule: '0 3 * * *',  // Daily at 3 AM
      handler: cleanupExpiredPayloads,
    },
    {
      name: 'cleanup-dead-letters',
      schedule: '0 3 * * *',  // Daily at 3 AM
      handler: cleanupExpiredDeadLetters,
    },
    {
      name: 'dead-letter-auto-retry',
      schedule: '*/15 * * * *',  // Every 15 minutes
      handler: processDeadLetterRetries,
    },
  ],
});
```

**Acceptance Criteria:**
- [ ] Can replay events from time range with rate limiting
- [ ] Can replay specific event by ID
- [ ] Replay marks events with `replayOf` metadata
- [ ] Dry-run mode for testing replay queries
- [ ] Publishes `system.replay.started` and `system.replay.completed`
- [ ] `/metrics` endpoint returns Prometheus format
- [ ] Event metrics: counts by type/status, latency percentiles
- [ ] NATS metrics: connection status, message counts, consumer lag
- [ ] DB metrics: pool status, query latencies
- [ ] System metrics: memory, CPU, uptime
- [ ] In-process scheduler runs cleanup jobs
- [ ] Cleanup respects per-type retention from config
- [ ] Dead letter auto-retry runs every 15 minutes

**Validation:**
```bash
bun test packages/core/src/events/__tests__/replay.test.ts
bun test packages/core/src/metrics/__tests__/
bun test packages/core/src/scheduler/__tests__/
```

---

## Technical Notes

### Compression Strategy

```typescript
import { gzipSync, gunzipSync } from 'node:zlib';

// Store
const compressed = gzipSync(JSON.stringify(payload));
const base64 = compressed.toString('base64');

// Retrieve
const buffer = Buffer.from(base64, 'base64');
const payload = JSON.parse(gunzipSync(buffer).toString('utf8'));
```

### Retention Policy

| Data Type | Retention | Cleanup Schedule |
|-----------|-----------|------------------|
| Event payloads | Configurable (default 14 days) | Daily at 3 AM |
| Dead letter events | 30 days | Daily at 3 AM |
| NATS streams | Varies by stream | Managed by NATS |

### Scheduler Library

Use `croner` (lightweight cron scheduler for Bun/Node):
```typescript
import { Cron } from 'croner';

// Example
const job = new Cron('0 3 * * *', async () => {
  await cleanupExpiredPayloads();
});
```

### Metrics Library

Use `prom-client` for Prometheus metrics:
```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const registry = new Registry();
const eventsTotal = new Counter({
  name: 'omni_events_total',
  help: 'Total events processed',
  labelNames: ['type', 'status'],
  registers: [registry],
});
```

---

## Dependencies

**NPM:**
- `zlib` (built-in Node module)
- `croner` - Lightweight cron scheduler
- `prom-client` - Prometheus metrics client

**Internal:**
- `@omni/core` - EventBus, event types
- `@omni/db` - Database connection

---

## Migration Notes

### Existing `omniEvents` Table

The `omniEvents` table already has payload columns (`rawPayload`, `agentRequest`, `agentResponse`). These are:
- **Inline storage** - payloads stored directly in the event row
- **Uncompressed** - JSONB format, no compression
- **Always stored** - no configuration

The new `eventPayloads` table is:
- **Separate storage** - payloads in dedicated table with FK to eventId
- **Compressed** - gzip + base64 for storage efficiency
- **Configurable** - per-type rules for what to store
- **Soft-deletable** - audit trail support

**Strategy:** Keep `omniEvents` payload columns for backwards compatibility. New payload storage goes to `eventPayloads` table. Migration of existing data is OUT OF SCOPE.

---

## Depends On

- `nats-events` wish (core EventBus implementation) ✅ SHIPPED

## Enables

- Production debugging
- Compliance/audit trail
- System health monitoring
- Incident recovery (replay)
- `events-ext` wish (webhooks, automations)
