# WISH: NATS Events

> Implement the EventBus with NATS JetStream for event-driven architecture.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-6p2

---

## Context

Events are the nervous system of Omni. Every action produces events, events trigger reactions. NATS JetStream provides persistent, exactly-once event delivery.

Reference: `docs/architecture/event-system.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | NATS server running via PM2 (from foundation) |
| **DEC-1** | Decision | 6 streams: MESSAGES, IDENTITY, MEDIA, AGENT, ACCESS, CHANNEL |
| **DEC-2** | Decision | Exactly-once delivery with explicit acks |
| **DEC-3** | Decision | Dead letter queue for failed events |
| **DEC-4** | Decision | 30-day retention for most streams |

---

## Scope

### IN SCOPE

- `packages/core/src/events/bus.ts` - Full EventBus implementation
- Stream configuration for all 6 streams
- Publish with auto-enrichment (id, timestamp, source)
- Subscribe with pattern matching
- Validated subscribe with Zod schemas
- Dead letter handling
- Event replay capability
- Payload storage (compressed)
- Metrics collection

### OUT OF SCOPE

- Grafana dashboards (future)
- Multi-region replication (future)

---

## Execution Group A: Core EventBus

**Goal:** Implement EventBus with NATS JetStream.

**Deliverables:**
- [ ] `packages/core/src/events/bus.ts` - Full implementation
- [ ] `packages/core/src/events/config.ts` - Stream configurations
- [ ] `packages/core/src/events/codec.ts` - JSON encoding/decoding
- [ ] Connection management with reconnect
- [ ] Stream auto-creation on startup

**Acceptance Criteria:**
- [ ] EventBus connects to NATS
- [ ] All 6 streams created automatically
- [ ] `publish()` returns EventMetadata with sequence number
- [ ] `subscribe()` receives events with proper typing
- [ ] Reconnects automatically on disconnect

**Validation:**
```bash
bun test packages/core/src/events
```

---

## Execution Group B: Subscribe & Handlers

**Goal:** Implement subscription patterns and handler utilities.

**Deliverables:**
- [ ] `packages/core/src/events/subscribe.ts` - Subscription helpers
- [ ] `packages/core/src/events/handlers.ts` - Handler base classes
- [ ] Pattern matching for subjects (e.g., `message.*`)
- [ ] Queue groups for load balancing
- [ ] Durable consumers for reliability
- [ ] Retry with exponential backoff

**Acceptance Criteria:**
- [ ] Can subscribe to specific event types
- [ ] Can subscribe to patterns (`message.*`)
- [ ] Queue groups distribute load across workers
- [ ] Durable consumers survive restarts
- [ ] Failed messages retry with backoff

**Validation:**
```bash
# Test with multiple subscribers
bun run packages/core/test/events-integration.ts
```

---

## Execution Group C: Dead Letter & Replay

**Goal:** Handle failures and enable replay.

**Deliverables:**
- [ ] `packages/core/src/events/dead-letter.ts` - Dead letter handling
- [ ] `packages/core/src/events/replay.ts` - Event replay
- [ ] `packages/core/src/events/payload-store.ts` - Compressed payload storage
- [ ] Database table for dead letter events
- [ ] Metrics for event processing

**Acceptance Criteria:**
- [ ] Failed events (after max retries) go to dead letter
- [ ] Dead letter events stored in database
- [ ] Can replay events from time range
- [ ] Can replay specific event by ID
- [ ] Payloads compressed with gzip

**Validation:**
```bash
bun test packages/core/src/events/dead-letter.test.ts
bun test packages/core/src/events/replay.test.ts
```

---

## Technical Notes

### Stream Configuration

```typescript
const STREAMS = [
  { name: 'MESSAGES', subjects: ['message.>'], retention: 30 },
  { name: 'IDENTITY', subjects: ['identity.>'], retention: 90 },
  { name: 'MEDIA', subjects: ['media.>'], retention: 7 },
  { name: 'AGENT', subjects: ['agent.>'], retention: 7 },
  { name: 'ACCESS', subjects: ['access.>'], retention: 30 },
  { name: 'CHANNEL', subjects: ['channel.>'], retention: 7 },
];
```

### Key Event Types

From `docs/architecture/event-system.md`:
- `message.received` - Inbound message
- `message.sending` - Outbound message queued
- `message.sent` - Message delivered
- `message.status` - Delivery status update
- `identity.resolved` - Person identified
- `media.received` - Media attachment
- `media.processed` - Transcription/description ready
- `channel.connected` - Instance connected
- `channel.disconnected` - Instance disconnected

---

## Dependencies

- `nats` npm package
- `@omni/db` for dead letter storage

---

## Depends On

- Foundation (NATS server running)

## Enables

- All event-driven features
- Real-time WebSocket streams
- Media processing pipeline
