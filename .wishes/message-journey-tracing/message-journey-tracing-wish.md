# WISH: Message Journey Tracing and Performance Optimization

> End-to-end observability and performance optimization for message processing pipeline

**Status:** DRAFT
**Created:** 2026-02-10
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
- No alerting when latencies exceed acceptable thresholds

**Opportunity:**
- Add comprehensive instrumentation to measure every stage
- Establish baseline metrics
- Identify and fix bottlenecks based on data
- Create ongoing observability for performance monitoring

---

## Assumptions, Decisions, and Risks

### Assumptions

**ASM-1**: Message volume justifies optimization effort
- We assume message volume is high enough that performance matters
- If processing <100 messages/day, optimization may be premature

**ASM-2**: Correlation IDs exist or can be added
- Events already have `metadata.correlationId`
- We can use this to track messages across the journey

**ASM-3**: Timing overhead is acceptable
- Recording timestamps and emitting checkpoint events adds ~1-5ms overhead
- This is acceptable trade-off for observability

**ASM-4**: 5-minute journey retention is sufficient
- In-memory tracking of journeys expires after 5 minutes
- Long-term metrics stored in database or exported to monitoring system

### Decisions

**DEC-1**: Three-phase approach
- Phase 1: Instrumentation and baseline measurement
- Phase 2: Performance optimization based on data
- Phase 3: Ongoing monitoring and alerting
- **Rationale**: Measure before optimizing to avoid premature optimization

**DEC-2**: Event-based checkpoint tracking
- Use existing NATS event bus for checkpoint notifications
- Publish `system.journey.checkpoint` events at each stage
- **Rationale**: Leverages existing infrastructure, enables real-time monitoring

**DEC-3**: In-memory journey tracking with DB export
- Track active journeys in-memory (MessageJourneyTracker)
- Export aggregated metrics to database for historical analysis
- **Rationale**: Fast real-time access, persistent history

**DEC-4**: Non-blocking instrumentation
- Checkpoint recording should never block message processing
- Use fire-and-forget pattern for checkpoint events
- **Rationale**: Observability shouldn't degrade performance

**DEC-5**: Start with key checkpoints only
- Focus on major stages first (plugin → NATS → DB → agent)
- Add finer-grained checkpoints later if needed
- **Rationale**: Avoid over-instrumentation, focus on high-impact metrics

### Risks

**RISK-1**: Overhead from instrumentation
- **Impact**: Each checkpoint adds ~1-5ms latency
- **Mitigation**: Use non-blocking async checkpoints, sample if needed
- **Acceptance**: Trade-off is worth the observability gain

**RISK-2**: Memory usage from journey tracking
- **Impact**: Storing all journeys in-memory could consume significant RAM under high load
- **Mitigation**: 5-minute TTL, configurable retention, sampling option
- **Fallback**: Export to external monitoring system (Prometheus/Grafana)

**RISK-3**: Optimization may require architectural changes
- **Impact**: Bottlenecks may require significant refactoring (e.g., identity matching)
- **Mitigation**: Phase 2 scoped separately after Phase 1 data collection
- **Acceptance**: Some bottlenecks may need separate wishes

**RISK-4**: Timestamp synchronization across services
- **Impact**: If API and channel plugins run on different machines, clock skew affects accuracy
- **Mitigation**: Use NTP, document timestamp sources, consider relative timings
- **Acceptance**: <100ms skew is acceptable for initial version

---

## Scope

### IN SCOPE

**Phase 1: Instrumentation and Baseline**
- ✅ Add timing metadata to event system
- ✅ Create MessageJourneyTracker service
- ✅ Instrument channel plugins (WhatsApp, Discord, Telegram)
- ✅ Instrument message persistence
- ✅ Instrument agent notification (if applicable)
- ✅ API endpoints for journey retrieval and metrics
- ✅ CLI command to view journey details
- ✅ Baseline measurement report

**Phase 2: Performance Optimization** (separate execution, depends on Phase 1 data)
- ✅ Identify top 3 bottlenecks from baseline data
- ✅ Optimize bottlenecks (specific tasks TBD based on data)
- ✅ Add database indexes if needed
- ✅ Add caching layer if needed
- ✅ Batch operations if needed
- ✅ Comparison report (before/after metrics)

**Phase 3: Ongoing Monitoring** (separate execution)
- ✅ Export metrics to monitoring system (optional: Prometheus/Grafana)
- ✅ Alerting rules for latency thresholds
- ✅ Dashboard for real-time monitoring

### OUT OF SCOPE

- ❌ Distributed tracing (OpenTelemetry) - May add later, but not in v1
- ❌ Agent-internal processing time breakdown - Agent is external, we only measure request/response
- ❌ Platform-side latency (WhatsApp servers) - Outside our control
- ❌ Historical replay of old messages - Only tracks new messages after implementation
- ❌ Per-user latency SLAs - Focus on system-wide metrics first
- ❌ Automatic optimization - Phase 2 is manual analysis and fixes

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] events, [x] types, [x] new tracing module | EventMetadata extended with timings |
| api | [x] routes, [x] services, [x] plugins | New /metrics routes, journey tracker |
| sdk | [x] regenerate | New API endpoints |
| cli | [x] commands | New `omni metrics journey` command |
| channel-sdk | [ ] interface | No breaking changes |
| channel-whatsapp | [x] plugin | Add checkpoint tracking |
| channel-discord | [x] plugin | Add checkpoint tracking |
| channel-telegram | [x] plugin | Add checkpoint tracking |
| db | [ ] schema | No schema changes in Phase 1 |

### System Checklist

- [x] **Events**: New `system.journey.checkpoint` event type
- [ ] **Database**: No schema changes in Phase 1 (metrics in-memory)
- [x] **SDK**: API changed (new /metrics endpoints) - run `bun generate:sdk`
- [x] **CLI**: New `omni metrics journey <id>` and `omni metrics summary` commands
- [x] **Tests**: core/tracing, api/metrics routes, channel plugin checkpoints

---

## Journey Stages (What We're Measuring)

### Inbound Flow (User → Agent)

```
T0: platformReceivedAt       - Message arrives at platform (WhatsApp/Discord)
T1: pluginReceivedAt         - Channel plugin receives message
T2: eventPublishedAt         - Event published to NATS
T3: eventConsumedAt          - Persistence consumer receives event
T4: dbStoredAt              - Message stored in database
T5: agentNotifiedAt         - Agent notified (webhook/polling/MCP)
T6: agentStartedAt          - Agent starts processing

Metrics:
  - Channel Processing Time    = T1 - T0
  - Event Publish Time         = T2 - T1
  - NATS Delivery Time         = T3 - T2
  - DB Write Time              = T4 - T3
  - Agent Notification Time    = T5 - T4
  - Agent Queue Time           = T6 - T5
  - TOTAL INBOUND LATENCY      = T6 - T0
```

### Agent Processing

```
T6: agentStartedAt          - Agent starts processing
T7: agentCompletedAt        - Agent completes response

Metrics:
  - Agent Processing Time      = T7 - T6
```

### Outbound Flow (Agent → User)

```
T7: agentCompletedAt        - Agent sends response
T8: apiReceivedAt           - API receives response
T9: outboundEventPublishedAt - message.sent published to NATS
T10: pluginSentAt           - Plugin sends to platform
T11: platformDeliveredAt    - Platform confirms delivery

Metrics:
  - API Request Time           = T8 - T7
  - Outbound Event Publish     = T9 - T8
  - NATS Delivery Time         = T10 - T9
  - Platform Send Time         = T11 - T10
  - TOTAL OUTBOUND LATENCY     = T11 - T7
```

### Round-Trip

```
Metrics:
  - TOTAL ROUND-TRIP TIME      = T11 - T0
```

---

## Execution Groups

### Group A: Core Instrumentation Infrastructure

**Goal:** Build the foundation for journey tracking

**Packages:** `core`, `api`

**Deliverables:**

1. **Extended EventMetadata with timings**
   - [ ] Add `timings` field to `EventMetadata` interface
   - [ ] Update event publishing to accept timing metadata
   - [ ] Add helper to append timing checkpoints

2. **MessageJourneyTracker service**
   - [ ] Create `packages/core/src/tracing/message-journey.ts`
   - [ ] Implement checkpoint recording
   - [ ] Implement journey retrieval
   - [ ] Implement latency calculation
   - [ ] Implement metrics aggregation (avg, p50, p95, p99)
   - [ ] Add 5-minute TTL cleanup
   - [ ] Publish `system.journey.checkpoint` events

3. **API endpoints**
   - [ ] `GET /api/v2/metrics/journey/:correlationId` - Get specific journey
   - [ ] `GET /api/v2/metrics/summary` - Get aggregated metrics
   - [ ] `GET /api/v2/metrics/stream` - SSE stream of checkpoint events
   - [ ] Add journeyTracker to app context

4. **Tests**
   - [ ] Unit tests for MessageJourneyTracker
   - [ ] API endpoint tests
   - [ ] Event publishing with timings tests

**Acceptance Criteria:**
- [ ] Can record checkpoints with correlation ID
- [ ] Can retrieve journey by correlation ID
- [ ] Can calculate latencies between checkpoints
- [ ] API returns journey data in JSON format
- [ ] Tests pass: `bun test packages/core/src/tracing`
- [ ] Tests pass: `bun test packages/api/src/routes/v2/metrics`

**Validation:**
```bash
make check
bun test packages/core/src/tracing
bun test packages/api/src/routes/v2/metrics
```

---

### Group B: Channel Plugin Instrumentation

**Goal:** Add checkpoint tracking to all channel plugins

**Packages:** `channel-whatsapp`, `channel-discord`, `channel-telegram`

**Deliverables:**

1. **WhatsApp Plugin**
   - [ ] Track T0 (platformReceivedAt) from message timestamp
   - [ ] Track T1 (pluginReceivedAt) in `handleMessageReceived`
   - [ ] Track T2 (eventPublishedAt) after `emitMessageReceived`
   - [ ] Pass timings in event metadata
   - [ ] Track T10 (pluginSentAt) in `sendMessage`
   - [ ] Track T11 (platformDeliveredAt) on delivery receipt

2. **Discord Plugin**
   - [ ] Track T0 (platformReceivedAt) from Discord timestamp
   - [ ] Track T1 (pluginReceivedAt) in message handler
   - [ ] Track T2 (eventPublishedAt) after event emit
   - [ ] Pass timings in event metadata
   - [ ] Track T10 (pluginSentAt) in send method
   - [ ] Track T11 (platformDeliveredAt) if available

3. **Telegram Plugin**
   - [ ] Track T0 (platformReceivedAt) from Telegram timestamp
   - [ ] Track T1 (pluginReceivedAt) in message handler
   - [ ] Track T2 (eventPublishedAt) after event emit
   - [ ] Pass timings in event metadata
   - [ ] Track T10 (pluginSentAt) in send method
   - [ ] Track T11 (platformDeliveredAt) if available

4. **Tests**
   - [ ] Verify timings are included in emitted events
   - [ ] Verify checkpoint events are published

**Acceptance Criteria:**
- [ ] All channel plugins emit events with timing metadata
- [ ] Checkpoint events published for T0, T1, T2, T10, T11
- [ ] No breaking changes to plugin interfaces
- [ ] Tests pass: `bun test packages/channel-*/`

**Validation:**
```bash
make check
bun test packages/channel-whatsapp
bun test packages/channel-discord
bun test packages/channel-telegram
```

---

### Group C: Persistence, API, and Reporting

**Goal:** Complete instrumentation and add CLI tools

**Packages:** `api`, `cli`, `sdk`

**Deliverables:**

1. **Message Persistence Instrumentation**
   - [ ] Track T3 (eventConsumedAt) in message.received subscriber
   - [ ] Track T4 (dbStoredAt) after message creation
   - [ ] Track T5 (agentNotifiedAt) when agent is notified
   - [ ] Record checkpoints via journeyTracker

2. **Outbound Message Instrumentation**
   - [ ] Track T8 (apiReceivedAt) in send message endpoint
   - [ ] Track T9 (outboundEventPublishedAt) after event publish
   - [ ] Pass correlation ID from agent request to outbound flow

3. **CLI Commands**
   - [ ] `omni metrics journey <correlationId>` - Display journey timeline
   - [ ] `omni metrics summary` - Display aggregated metrics
   - [ ] `omni metrics live` - Live stream of checkpoints
   - [ ] Format output with colors and timing bars

4. **SDK Regeneration**
   - [ ] Run `bun generate:sdk` to include new endpoints
   - [ ] Update SDK documentation

5. **Baseline Measurement Report**
   - [ ] Run system with real/simulated load
   - [ ] Collect journey data for 100+ messages
   - [ ] Generate report with:
     - [ ] Average latencies per stage
     - [ ] P50, P95, P99 latencies
     - [ ] Top 3 bottlenecks
     - [ ] Recommendations for Phase 2

6. **Documentation**
   - [ ] Add metrics documentation to docs/
   - [ ] Update CLAUDE.md with journey tracking usage
   - [ ] Document API endpoints

**Acceptance Criteria:**
- [ ] Can view journey details via CLI
- [ ] Can see aggregated metrics via CLI
- [ ] Baseline report identifies bottlenecks
- [ ] SDK includes new endpoints
- [ ] Documentation complete
- [ ] All tests pass: `make check`

**Validation:**
```bash
make check
bun generate:sdk
omni metrics journey <test-correlation-id>
omni metrics summary
```

---

## Success Metrics

### Phase 1 Success (This Wish)

- [ ] Can track complete journey for any message (T0 → T11)
- [ ] Can identify which stage is slowest
- [ ] Baseline report shows:
  - [ ] Average latency per stage
  - [ ] P95 latency per stage
  - [ ] Total round-trip time
  - [ ] Top 3 bottlenecks
- [ ] CLI tools work and display journey clearly
- [ ] Overhead from instrumentation <5ms per message

### Future Phase 2 Success (Separate Wish)

Based on Phase 1 data, optimize identified bottlenecks:
- [ ] Reduce top bottleneck latency by 50%+
- [ ] Increase message throughput by 2-5x
- [ ] Reduce P95 total latency below target threshold (TBD based on baseline)

---

## Example CLI Output

```
$ omni metrics journey msg_abc123

Message Journey: msg_abc123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Inbound Flow:
  ✓ Platform received      T0        0ms
  ✓ Plugin received        T1      +52ms  ████░░░░░░
  ✓ Event published        T2      +23ms  ██░░░░░░░░
  ✓ Event consumed         T3      +15ms  █░░░░░░░░░
  ✓ DB stored              T4     +127ms  ███████████░░░
  ✓ Agent notified         T5      +34ms  ███░░░░░░░
  ✓ Agent started          T6      +12ms  █░░░░░░░░░
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Inbound: 263ms

Agent Processing:
  ✓ Agent completed        T7    +1842ms  ████████████████████
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Agent Time: 1842ms

Outbound Flow:
  ✓ API received           T8      +18ms  █░░░░░░░░░
  ✓ Event published        T9      +15ms  █░░░░░░░░░
  ✓ Plugin sent            T10     +23ms  ██░░░░░░░░
  ✓ Platform delivered     T11     +94ms  █████░░░░░
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Outbound: 150ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 Total Round-Trip: 2255ms

⚠️  Bottleneck: DB Write (T4) took 127ms - 48% of inbound time
```

---

## Next Steps

1. **Review this wish** - Get stakeholder approval
2. **Create beads issue** - Track this wish in beads
3. **Execute /forge** - When ready to implement
4. **Phase 2 planning** - After baseline data collected, create optimization wish

---

## Open Questions

1. **Agent notification mechanism** - How do agents get notified currently?
   - Webhook? Polling? MCP? This affects where we track T5

2. **Target latency thresholds** - What's acceptable?
   - Total inbound: <500ms? <1s?
   - Total round-trip: <3s? <5s?
   - Agent processing: N/A (external, can't control)

3. **Message volume** - What's the current and target load?
   - Helps determine if optimization is needed
   - Helps set sampling rate if overhead becomes an issue

4. **Monitoring system preference** - For Phase 3
   - Self-hosted Prometheus/Grafana?
   - Cloud service (Datadog, New Relic)?
   - Just API + CLI?
