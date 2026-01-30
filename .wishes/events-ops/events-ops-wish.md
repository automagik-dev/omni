# WISH: Events Ops

> Operational tooling for the event system: dead letter handling, replay, payload storage, and metrics.

**Status:** DRAFT
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

**Goal:** Capture and store failed events for debugging and retry.

**Deliverables:**
- [ ] `packages/core/src/events/dead-letter.ts` - Dead letter handler
- [ ] `packages/core/src/db/schema/dead-letter.ts` - Database table
- [ ] Integration with NatsEventBus (after max retries → dead letter)
- [ ] Retry mechanism for dead letter events
- [ ] CLI/API for listing and managing dead letters

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
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  retriedAt: timestamp('retried_at'),
  resolvedAt: timestamp('resolved_at'),
});
```

**Acceptance Criteria:**
- [ ] Events exceeding max retries go to dead letter table
- [ ] Dead letters include full event payload and error details
- [ ] Can list dead letters by event type, time range
- [ ] Can retry a specific dead letter event
- [ ] Can mark dead letter as resolved (manual resolution)
- [ ] Uses `SystemEventSchemas.deadLetter` from `@omni/core/events/nats` for `system.dead_letter` events

**Validation:**
```bash
bun test packages/core/src/events/dead-letter.test.ts
```

---

## Execution Group B: Payload Storage

**Goal:** Store event payloads for debugging and compliance.

**Deliverables:**
- [ ] `packages/core/src/events/payload-store.ts` - Payload storage
- [ ] `packages/core/src/db/schema/event-payloads.ts` - Database table
- [ ] Compression with gzip
- [ ] Retrieval with decompression
- [ ] Content flags for filtering (containsMedia, containsBase64)

**Database Schema:**
```typescript
export const eventPayloads = pgTable('event_payloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  stage: varchar('stage', { length: 50 }).notNull(),
  // Stages: 'webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error'

  payloadCompressed: text('payload_compressed').notNull(),
  payloadSizeOriginal: integer('payload_size_original'),
  payloadSizeCompressed: integer('payload_size_compressed'),

  timestamp: timestamp('timestamp').notNull().defaultNow(),
  containsMedia: boolean('contains_media').notNull().default(false),
  containsBase64: boolean('contains_base64').notNull().default(false),
});
```

**Acceptance Criteria:**
- [ ] Can store payload at any stage
- [ ] Payloads compressed with gzip (typically 5-10x reduction)
- [ ] Can retrieve and decompress payload by eventId
- [ ] Can filter by stage without decompressing
- [ ] Content flags set automatically on storage

**Validation:**
```bash
bun test packages/core/src/events/payload-store.test.ts
```

---

## Execution Group C: Replay & Metrics

**Goal:** Enable event replay and basic observability.

**Deliverables:**
- [ ] `packages/core/src/events/replay.ts` - Event replay
- [ ] `packages/core/src/events/metrics.ts` - Event metrics
- [ ] Replay by time range
- [ ] Replay by specific event ID
- [ ] Metrics: event counts, processing latencies
- [ ] Cleanup job for retention policy

**Replay Interface:**
```typescript
interface ReplayOptions {
  stream: string;
  startTime: Date;
  endTime?: Date;
  filter?: (event: OmniEvent) => boolean;
  handler: (event: OmniEvent) => Promise<void>;
  dryRun?: boolean;  // Log but don't execute
}

interface ReplayResult {
  processed: number;
  skipped: number;
  errors: number;
  duration: number;
}
```

**Acceptance Criteria:**
- [ ] Can replay events from time range
- [ ] Can replay specific event by ID
- [ ] Replay marks events with `replayOf` field
- [ ] Dry-run mode for testing replay queries
- [ ] Metrics track: events/sec, p50/p95/p99 latency
- [ ] Cleanup removes payloads older than 14 days
- [ ] Cleanup removes dead letters older than 30 days

**Validation:**
```bash
bun test packages/core/src/events/replay.test.ts
bun test packages/core/src/events/metrics.test.ts
```

---

## Technical Notes

### Compression Strategy

```typescript
import { gzipSync, gunzipSync } from 'zlib';

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
| Event payloads | 14 days | Daily at 3 AM |
| Dead letter events | 30 days | Daily at 3 AM |
| NATS streams | Varies by stream | Managed by NATS |

---

## Dependencies

**NPM:**
- `zlib` (built-in)

**Internal:**
- `@omni/core` - EventBus, event types
- `@omni/db` - Database connection

---

## Depends On

- `nats-events` wish (core EventBus implementation)

## Enables

- Production debugging
- Compliance/audit trail
- System health monitoring
- Incident recovery (replay)
