# WISH: Message Journey Tracing

> End-to-end latency instrumentation for the message processing pipeline

**Status:** REVIEW
**Created:** 2026-02-10
**Updated:** 2026-02-12
**Author:** WISH Agent
**Beads:** omni-eef

---

## The Problem

**Current State:**
- Messages flow through multiple stages: Channel Plugin → NATS → Persistence → Database → Agent → Response
- No visibility into latency at each stage
- No baseline performance metrics
- Unknown bottlenecks causing potential slowness
- Cannot measure end-to-end latency from user message to agent response and back

**Pain Points:**
- When users report "slow responses", we can't pinpoint where the delay is
- No way to measure if optimizations actually improved performance
- Cannot identify which stage is the bottleneck (DB writes? Identity lookups? NATS delivery?)

**Opportunity:**
- Add comprehensive instrumentation to measure every stage
- Establish baseline metrics
- Identify bottlenecks based on data (measure first, optimize later)

---

## Assumptions, Decisions, and Risks

### Assumptions

**ASM-1**: Message volume justifies optimization effort
- We assume message volume is high enough that performance matters
- If processing <100 messages/day, optimization may be premature

**ASM-2**: Correlation IDs exist and flow through the pipeline
- Events already have `metadata.correlationId` (confirmed in codebase)
- We can use this to track messages across the journey

**ASM-3**: Timing overhead is acceptable
- Recording `Date.now()` at each stage adds <1ms overhead
- In-process recording (no NATS overhead for checkpoints)

**ASM-4**: Single-process architecture (for now)
- API + persistence consumers run in the same process
- In-memory journey tracker can see all checkpoints directly
- If we split into microservices later, we'll need distributed tracing

### Decisions

**DEC-1**: Measure before optimizing (three-phase approach)
- This wish = Phase 1: Instrumentation and baseline measurement
- Phase 2 (optimization) and Phase 3 (monitoring/alerting) are separate wishes
- **Rationale**: Avoid premature optimization

**DEC-2**: In-process checkpoint recording (NOT NATS events)
- Record checkpoints via direct function calls to `JourneyTracker` singleton
- Do NOT publish `system.journey.checkpoint` events to NATS (would double traffic)
- Publish a single `system.journey.complete` summary event when round-trip finishes
- **Rationale**: 11 checkpoint events per message would flood NATS at scale

**DEC-3**: In-memory journey tracking with configurable TTL
- Track active journeys in `Map<correlationId, Journey>` in-memory
- Default TTL: 30 minutes (configurable via `JOURNEY_TTL_MS` env var)
- No DB persistence in Phase 1
- **Rationale**: Fast, zero-infrastructure, sufficient for debugging

**DEC-4**: Non-blocking instrumentation
- Checkpoint recording is synchronous `Date.now()` — no async overhead
- Journey tracker runs cleanup on a timer, never blocks message processing
- **Rationale**: Observability must not degrade performance

**DEC-5**: Configurable sampling rate
- `JOURNEY_SAMPLE_RATE` env var (default: `1.0` = 100%)
- At scale, reduce to 0.1 (10%) or 0.01 (1%) to limit memory
- Sampling decision made at T1 (plugin received) and propagated in metadata
- **Rationale**: At high volume, tracking every message is expensive

**DEC-6**: Agent notification = OpenClaw trigger_logs
- T5 (agentNotifiedAt) = when a trigger_log record is created for this message
- T6 (agentStartedAt) = not trackable (agent is external black box)
- T7 (agentCompletedAt) = when the agent's response arrives via API /messages/send
- **Rationale**: OpenClaw provider integration uses trigger_logs; this is the existing agent notification path

**DEC-7**: EventMetadata extension is strictly optional
- Add `timings?: Record<string, number>` to `EventMetadata`
- All existing consumers ignore unknown fields — no breaking change
- **Rationale**: Backward compatibility with all existing event consumers

**DEC-8**: Journey routes under `/api/v2/journeys/` (not `/metrics/`)
- `/api/v2/metrics` already serves Prometheus data — avoid collision
- Journey endpoints: `/api/v2/journeys/:correlationId`, `/api/v2/journeys/summary`
- **Rationale**: Clean URL separation

### Risks

**RISK-1**: Memory usage from journey tracking
- **Impact**: At 1000 messages/min with 30-min TTL = ~30K journeys in memory (~30MB)
- **Mitigation**: Configurable TTL, sampling rate, max entries cap (LRU eviction at 50K)
- **Fallback**: Reduce TTL or sampling rate

**RISK-2**: Optimization may require architectural changes
- **Impact**: Bottlenecks may require significant refactoring (e.g., identity matching)
- **Mitigation**: Phase 2 scoped as separate wish after data collection
- **Acceptance**: Some bottlenecks may need separate wishes

**RISK-3**: Platform timestamp accuracy varies
- **Impact**: T0 (platformReceivedAt) comes from external platforms with different precision
  - WhatsApp: `messageTimestamp` in protobuf (seconds since epoch — must × 1000)
  - Discord: `message.createdTimestamp` (milliseconds)
  - Telegram: `message.date` (seconds since epoch — must × 1000)
- **Mitigation**: Normalize all platform timestamps to Unix ms in the plugin layer
- **Acceptance**: T0 accuracy is ±1 second for WhatsApp/Telegram (second-level precision)

**RISK-4**: Clock skew across services
- **Impact**: If services run on different machines, timestamps may drift
- **Mitigation**: Single-process architecture (ASM-4) eliminates this for now
- **Acceptance**: Re-evaluate if architecture splits

---

## Scope

### IN SCOPE (Phase 1 only)

- Add optional `timings` field to `EventMetadata`
- Create `JourneyTracker` service (in-memory, singleton)
- Instrument channel plugins (WhatsApp, Discord, Telegram) with T0, T1, T2
- Instrument persistence consumer with T3, T4
- Instrument agent notification with T5 (via trigger_logs)
- Instrument outbound message flow with T7, T8, T9
- Instrument channel plugins outbound with T10, T11
- API endpoints for journey retrieval and aggregated metrics
- CLI commands for journey inspection
- Baseline measurement report (100+ messages)

### OUT OF SCOPE

- Phase 2: Performance optimization based on data (separate wish)
- Phase 3: Ongoing monitoring, alerting, dashboards (separate wish)
- Distributed tracing / OpenTelemetry integration
- Agent-internal processing time breakdown (agent is external)
- Platform-side latency (outside our control)
- Historical replay of old messages (only new messages after implementation)
- Per-user latency SLAs
- SSE/WebSocket live streaming of checkpoints (Phase 3)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] events (EventMetadata), [x] new tracing module | Strictly optional `timings` field |
| api | [x] routes, [x] services, [x] plugins | New /journeys routes, tracker in context |
| sdk | [x] regenerate | New API endpoints |
| cli | [x] commands | New `omni journey` commands |
| channel-sdk | [x] BaseChannelPlugin | Helper methods for timing capture |
| channel-whatsapp | [x] handlers | Add checkpoint tracking |
| channel-discord | [x] handlers | Add checkpoint tracking |
| channel-telegram | [x] handlers | Add checkpoint tracking |
| db | [ ] schema | No schema changes in Phase 1 |

### System Checklist

- [x] **Events**: Optional `timings` added to EventMetadata, new `system.journey.complete` summary event
- [ ] **Database**: No schema changes (in-memory tracking)
- [x] **SDK**: API changed (new /journeys endpoints) — run `bun generate:sdk`
- [x] **CLI**: New `omni journey show <id>` and `omni journey summary` commands
- [x] **Tests**: core/tracing, api/journeys routes, channel plugin checkpoint tests

---

## Journey Stages (What We're Measuring)

### Inbound Flow (User → Agent)

```
T0: platformReceivedAt       - Message arrives at platform (WhatsApp/Discord/Telegram)
T1: pluginReceivedAt         - Channel plugin receives message
T2: eventPublishedAt         - Event published to NATS
T3: eventConsumedAt          - Persistence consumer receives event
T4: dbStoredAt               - Message stored in database
T5: agentNotifiedAt          - Agent trigger_log created

Metrics:
  - Channel Processing Time    = T1 - T0
  - Event Publish Time         = T2 - T1
  - NATS Delivery Time         = T3 - T2
  - DB Write Time              = T4 - T3
  - Agent Notification Time    = T5 - T4
  - TOTAL INBOUND LATENCY      = T5 - T0
```

### Agent Processing (external black box)

```
T5: agentNotifiedAt          - Trigger created
T7: agentCompletedAt         - Agent response arrives at API (/messages/send)

Metrics:
  - Agent Round-Trip Time      = T7 - T5  (includes agent thinking + network)
```

Note: T6 (agentStartedAt) is not trackable — the agent is an external system.
We measure T5→T7 as a single "agent processing" block.

### Outbound Flow (Agent → User)

```
T7: agentCompletedAt          - Agent response hits API
T8: apiProcessedAt            - API processes send request
T9: outboundEventPublishedAt  - message.sent published to NATS
T10: pluginSentAt             - Plugin sends to platform
T11: platformDeliveredAt      - Platform confirms delivery (if available)

Metrics:
  - API Processing Time        = T8 - T7
  - Outbound Event Publish     = T9 - T8
  - NATS Delivery Time         = T10 - T9
  - Platform Send Time         = T11 - T10
  - TOTAL OUTBOUND LATENCY     = T11 - T7
```

### Round-Trip

```
Metrics:
  - TOTAL ROUND-TRIP TIME      = T11 - T0
  - OMNI PROCESSING TIME       = (T5 - T0) + (T11 - T7)  (excludes agent)
```

### Platform Timestamp Normalization

| Platform | Raw Field | Precision | Normalization |
|----------|-----------|-----------|---------------|
| WhatsApp | `messageTimestamp` (protobuf) | Seconds | `× 1000` |
| Discord | `message.createdTimestamp` | Milliseconds | None |
| Telegram | `message.date` | Seconds | `× 1000` |

---

## Execution Groups

### Group A: Core Instrumentation Infrastructure

**Goal:** Build the journey tracker foundation and API endpoints

**Packages:** `core`, `api`

**Deliverables:**

1. **Extend EventMetadata with optional timings**
   - [ ] Add `timings?: Record<string, number>` to `EventMetadata` interface
   - [ ] Add helper: `withTiming(metadata, checkpoint, timestamp?)` → returns metadata with timing added
   - [ ] Ensure existing consumers are unaffected (field is optional)

2. **JourneyTracker service**
   - [ ] Create `packages/core/src/tracing/journey-tracker.ts`
   - [ ] `recordCheckpoint(correlationId, checkpoint, timestamp?)` — in-process, sync
   - [ ] `getJourney(correlationId)` → journey with all checkpoints + calculated latencies
   - [ ] `getSummary(options?)` → aggregated metrics (avg, p50, p95, p99 per stage)
   - [ ] Configurable TTL (default 30 min, env `JOURNEY_TTL_MS`)
   - [ ] Configurable sampling rate (env `JOURNEY_SAMPLE_RATE`, default 1.0)
   - [ ] Max entries cap with LRU eviction (default 50K)
   - [ ] Periodic cleanup of expired entries (every 60s)
   - [ ] Publish `system.journey.complete` event when T11 recorded (or T5 if no outbound)

3. **API endpoints**
   - [ ] `GET /api/v2/journeys/:correlationId` — specific journey timeline
   - [ ] `GET /api/v2/journeys/summary` — aggregated metrics with optional filters
   - [ ] Register journeyTracker in app context

4. **Tests**
   - [ ] Unit tests for JourneyTracker (checkpoint recording, TTL, LRU, sampling)
   - [ ] Unit tests for latency calculations
   - [ ] API endpoint tests for /journeys routes

**Acceptance Criteria:**
- [ ] Can record checkpoints with correlation ID (sync, <1ms)
- [ ] Can retrieve journey by correlation ID with latencies
- [ ] Can get aggregated metrics (avg, p50, p95, p99)
- [ ] Sampling rate works (at 0.5, ~half of journeys tracked)
- [ ] TTL cleanup evicts expired entries
- [ ] API returns journey data in JSON format
- [ ] Tests pass: `bun test packages/core/src/tracing`

**Validation:**
```bash
make check
bun test packages/core/src/tracing
bun test packages/api/src/routes/v2/journeys
```

---

### Group B: Channel Plugin Instrumentation

**Goal:** Add timing checkpoints to all channel plugins (inbound + outbound)

**Packages:** `channel-sdk`, `channel-whatsapp`, `channel-discord`, `channel-telegram`

**Deliverables:**

1. **BaseChannelPlugin timing helpers**
   - [ ] Add `captureT0(platformTimestamp)` — normalize platform timestamp to Unix ms
   - [ ] Add `captureCheckpoint(metadata, name)` — appends `Date.now()` to timings
   - [ ] Document normalization rules per platform

2. **WhatsApp Plugin**
   - [ ] T0: Extract `messageTimestamp × 1000` from protobuf
   - [ ] T1: `Date.now()` at start of `handleMessageReceived`
   - [ ] T2: `Date.now()` after `emitMessageReceived` returns
   - [ ] Pass timings in event metadata
   - [ ] T10: `Date.now()` in `sendMessage` before platform call
   - [ ] T11: `Date.now()` after platform send succeeds

3. **Discord Plugin**
   - [ ] T0: `message.createdTimestamp` (already ms)
   - [ ] T1: `Date.now()` at start of message handler
   - [ ] T2: `Date.now()` after event emit
   - [ ] Pass timings in event metadata
   - [ ] T10: `Date.now()` in send method before API call
   - [ ] T11: `Date.now()` after Discord API responds

4. **Telegram Plugin**
   - [ ] T0: `message.date × 1000`
   - [ ] T1: `Date.now()` at start of message handler
   - [ ] T2: `Date.now()` after event emit
   - [ ] Pass timings in event metadata
   - [ ] T10: `Date.now()` in send method before API call
   - [ ] T11: `Date.now()` after Telegram API responds

5. **Tests**
   - [ ] Verify timings are present in emitted event metadata
   - [ ] Verify T0 normalization (seconds → ms conversion)

**Acceptance Criteria:**
- [ ] All channel plugins emit events with `metadata.timings` containing T0, T1, T2
- [ ] Outbound paths record T10, T11
- [ ] Platform timestamps correctly normalized to Unix ms
- [ ] No breaking changes to plugin interfaces (timings is optional)
- [ ] Tests pass: `bun test packages/channel-*/`

**Validation:**
```bash
make check
bun test packages/channel-whatsapp
bun test packages/channel-discord
bun test packages/channel-telegram
```

---

### Group C: Persistence Instrumentation + CLI + Baseline

**Goal:** Complete the instrumentation chain and provide tooling to inspect journeys

**Packages:** `api`, `cli`, `sdk`

**Deliverables:**

1. **Message Persistence Instrumentation**
   - [ ] T3: `Date.now()` at start of `message.received` subscriber handler
   - [ ] T4: `Date.now()` after `services.messages.findOrCreate` completes
   - [ ] Record T3, T4 checkpoints to journeyTracker using correlationId from event metadata

2. **Agent Notification Instrumentation**
   - [ ] T5: `Date.now()` when trigger_log is created for this message
   - [ ] Record T5 checkpoint to journeyTracker

3. **Outbound Message Instrumentation**
   - [ ] T7: `Date.now()` when `/api/v2/messages/send` request arrives (link via chat context)
   - [ ] T8: `Date.now()` after API processes the send request
   - [ ] T9: `Date.now()` after `message.sent` event published to NATS
   - [ ] Record T7, T8, T9 checkpoints to journeyTracker

4. **CLI Commands**
   - [ ] `omni journey show <correlationId>` — display journey timeline with timing bars
   - [ ] `omni journey summary [--since <duration>]` — display aggregated metrics
   - [ ] Format: colored output with stage bars (see Example CLI Output below)

5. **SDK Regeneration**
   - [ ] Run `bun generate:sdk` to include new /journeys endpoints

6. **Baseline Measurement Report**
   - [ ] Script: `scripts/perf/journey-baseline.ts`
   - [ ] Collect journey data for 100+ real messages
   - [ ] Generate report: average latencies per stage, p50/p95/p99, top 3 bottlenecks
   - [ ] Save to `docs/performance/journey-baseline.md`

**Acceptance Criteria:**
- [ ] Complete inbound chain tracked: T0→T1→T2→T3→T4→T5
- [ ] Complete outbound chain tracked: T7→T8→T9→T10→T11
- [ ] CLI displays journey timeline clearly
- [ ] CLI displays aggregated summary
- [ ] SDK regenerated with new endpoints
- [ ] Baseline report exists with real data
- [ ] All tests pass: `make check`

**Validation:**
```bash
make check
bun generate:sdk
omni journey show <test-correlation-id>
omni journey summary
```

---

## Target Latency Thresholds

Initial targets (to be refined after baseline):

| Metric | Acceptable | Warning | Critical |
|--------|------------|---------|----------|
| Total inbound (T0→T5) | <500ms | <1s | >2s |
| DB write (T3→T4) | <50ms | <200ms | >500ms |
| NATS delivery (T2→T3) | <10ms | <50ms | >100ms |
| Omni processing (excl. agent) | <1s | <2s | >5s |
| Total round-trip (T0→T11) | <5s | <10s | >30s |

Agent processing time (T5→T7) is excluded — it's an external black box.

---

## Success Criteria

- [ ] Can track complete journey for any sampled message (T0 → T11)
- [ ] Can identify which stage is slowest via CLI
- [ ] Baseline report shows avg, p50, p95, p99 per stage
- [ ] Baseline report identifies top 3 bottlenecks
- [ ] Overhead from instrumentation <1ms per checkpoint (sync `Date.now()`)
- [ ] Memory footprint <50MB at 50K tracked journeys

---

## Example CLI Output

```
$ omni journey show evt_abc123

Message Journey: evt_abc123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Inbound Flow:
  ✓ Platform received      T0        0ms
  ✓ Plugin received        T1      +52ms  ████░░░░░░
  ✓ Event published        T2      +23ms  ██░░░░░░░░
  ✓ Event consumed         T3      +15ms  █░░░░░░░░░
  ✓ DB stored              T4     +127ms  ███████████░░░
  ✓ Agent notified         T5      +34ms  ███░░░░░░░
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Inbound: 251ms

Agent Processing:
  ✓ Agent completed        T7    +1842ms  ████████████████████
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Agent Time: 1842ms (T5→T7, external)

Outbound Flow:
  ✓ API processed          T8      +18ms  █░░░░░░░░░
  ✓ Event published        T9      +15ms  █░░░░░░░░░
  ✓ Plugin sent            T10     +23ms  ██░░░░░░░░
  ✓ Platform delivered     T11     +94ms  █████░░░░░
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Outbound: 150ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Round-Trip: 2243ms
  Omni Processing:  401ms (excl. agent)

  Bottleneck: DB Write (T3→T4) took 127ms — 51% of Omni time
```

---

## Technical Notes

### JourneyTracker Interface

```typescript
interface JourneyCheckpoint {
  name: string;       // e.g., 'platformReceivedAt', 'pluginReceivedAt'
  stage: string;      // e.g., 'T0', 'T1', 'T2'
  timestamp: number;  // Unix ms
}

interface Journey {
  correlationId: string;
  checkpoints: JourneyCheckpoint[];
  startedAt: number;
  completedAt?: number;
  latencies: Record<string, number>;  // e.g., 'channelProcessing': 52
}

interface JourneyTracker {
  recordCheckpoint(correlationId: string, stage: string, name: string, timestamp?: number): void;
  getJourney(correlationId: string): Journey | null;
  getSummary(options?: { since?: number }): JourneySummary;
  isTracking(correlationId: string): boolean;  // check sampling
  shouldSample(): boolean;  // based on JOURNEY_SAMPLE_RATE
}
```

### EventMetadata Extension

```typescript
// packages/core/src/events/types.ts
export interface EventMetadata {
  correlationId: string;
  instanceId?: string;
  channelType?: ChannelType;
  personId?: string;
  platformIdentityId?: string;
  traceId?: string;
  source?: string;
  streamSequence?: number;
  timings?: Record<string, number>;  // NEW — checkpoint name → Unix ms
}
```

### Sampling Flow

```
Channel plugin receives message
  → journeyTracker.shouldSample() → random < JOURNEY_SAMPLE_RATE?
    → YES: add metadata.timings = { platformReceivedAt: T0, pluginReceivedAt: T1 }
    → NO: skip timings entirely (metadata.timings remains undefined)

Downstream consumers:
  → if (event.metadata.timings) { journeyTracker.recordCheckpoint(...) }
  → if no timings, skip tracking (zero overhead for unsampled messages)
```

---

## Dependencies

- OpenClaw provider integration (for T5 agent notification tracking via trigger_logs)

## Enables (Future Wishes)

- Phase 2: Performance optimization based on baseline data
- Phase 3: Real-time monitoring, alerting, dashboards
- Distributed tracing (OpenTelemetry) integration
