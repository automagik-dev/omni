# WISH: Message Resilience - Zero Data Loss on Downtime

> Fix critical message loss during API/NATS/VM downtime with durable consumers, sequence tracking, and startup gap detection.

**Status:** DRAFT
**Created:** 2026-02-09
**Author:** WISH Agent
**Beads:** omni-2q2
**Priority:** P0 - Critical Data Loss

---

## Problem Statement

Messages sent to instances while the API server, NATS, or the entire VM is offline are **silently lost** when the system restarts.

### Root Cause

All 7 durable consumers in `packages/api/src/plugins/` use `startFrom: 'last'`, which maps to NATS `DeliverPolicy.Last`. This means:

- **On first startup**: Consumer skips to the most recent message, ignoring all prior history
- **On restart after downtime**: Consumer jumps to the latest message, **skipping everything published while offline**
- **VM-down scenario**: When both NATS and API restart, the consumer starts from whatever is "last" in the rebuilt stream

### Affected Consumers

| Consumer | File | Impact |
|----------|------|--------|
| `message-persistence-received` | message-persistence.ts:368 | **DATA LOSS** - Incoming messages |
| `message-persistence-sent` | message-persistence.ts:434 | **DATA LOSS** - Sent message records |
| `message-persistence-delivered` | message-persistence.ts:483 | Status updates lost |
| `message-persistence-read` | message-persistence.ts:531 | Read receipts lost |
| `media-processor` | media-processor.ts:317 | Media not processed |
| `agent-responder` | agent-responder.ts:619 | Agent replies lost |
| `agent-responder-typing` | agent-responder.ts:651 | OK (ephemeral) |
| `event-persistence` | event-persistence.ts | Event audit trail gaps |

### Loss Scenarios

1. **API restart** (deploy, crash, OOM): ~15-60 seconds of messages lost
2. **API extended downtime** (dependency failure): minutes to hours of messages lost
3. **VM restart** (reboot, migration): everything between shutdown and reconnect lost
4. **NATS restart without persistent storage**: entire stream history lost (mitigated by file storage)

### Existing Safeguards

- NATS streams use **file storage** with **30-day retention** (MESSAGE stream)
- Messages use **explicit ack** policy (only ack'd after successful DB write)
- Messages have `findOrCreate` with **unique constraint** on `(chatId, externalId)` = built-in dedup
- Replay infrastructure exists in `packages/core/src/events/replay.ts` (types + helpers, not wired up)
- Publish returns `{ sequence, stream }` (sequence available but never stored)

---

## Decisions

- **DEC-1**: Change all critical consumers from `startFrom: 'last'` to `startFrom: 'first'`
  - NATS durable consumers are smart: on subsequent startups, they resume from last ack regardless of deliver_policy
  - `DeliverPolicy.All` only applies to **first-ever creation** of the consumer
  - Combined with existing `findOrCreate` dedup, replaying already-processed messages is harmless (idempotent)
- **DEC-2**: Add a `consumer_offsets` table to track last-processed NATS sequence per consumer
  - Provides audit trail and gap detection
  - Enables startup health check: "consumer X is at seq 5000, stream has 5500 = 500 unprocessed"
- **DEC-3**: Add startup gap detection that logs warnings when gaps are found
  - First phase: log + metrics only (no automatic replay)
  - Prevents silent data loss going unnoticed
- **DEC-4**: Keep `sync-worker` at `startFrom: 'new'` (sync jobs are ephemeral triggers)
- **DEC-5**: Keep `agent-responder-typing` at `startFrom: 'last'` (ephemeral presence data)

## Assumptions

- **ASM-1**: NATS file storage survives VM restarts (standard JetStream behavior)
- **ASM-2**: The `findOrCreate` pattern with unique constraints makes all message persistence idempotent
- **ASM-3**: Processing old messages on first startup is acceptable (better than losing them)
- **ASM-4**: WhatsApp/Discord channels will reconnect and re-publish missed messages after VM restart (channel-specific reconnect logic already exists)

## Risks

- **RISK-1**: First startup after migration processes ALL 30 days of stream history
  - **Mitigation**: `findOrCreate` dedup means no duplicate DB records; add a log line counting processed/skipped
  - **Mitigation**: Could use `startFrom: new Date(Date.now() - 24h)` as a bounded first-run alternative
- **RISK-2**: High throughput burst on startup as backlog is processed
  - **Mitigation**: Existing `concurrency: 10` limit on consumers; add configurable backpressure
- **RISK-3**: Consumer name change would reset consumer state
  - **Mitigation**: We are NOT changing consumer names, only the deliver_policy

---

## Scope

### IN SCOPE

1. Fix `startFrom` on all critical consumers (`'last'` -> `'first'`)
2. Add `consumer_offsets` DB table for sequence tracking
3. Update subscription handler to record sequence after each ack
4. Add startup gap detection (log warnings)
5. Add health endpoint for consumer lag monitoring
6. Tests for all changes

### OUT OF SCOPE

- Automatic replay mechanism (future work, infra exists in `replay.ts`)
- Channel-side message buffering (channels already reconnect and re-fetch)
- NATS cluster/HA configuration (ops concern)
- Dead letter queue processing UI
- Consumer lag alerting (monitoring tool concern)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] events/bus interface | Add sequence to handler context |
| db | [x] schema, [x] migrations | New `consumer_offsets` table |
| api | [x] plugins, [x] services, [x] routes | Fix consumers, add tracking, health endpoint |
| sdk | [x] regenerate | Health endpoint added |

### System Checklist

- [ ] **Events**: No new event types (uses existing sequence from PublishResult)
- [x] **Database**: New `consumer_offsets` table via `make db-push`
- [x] **SDK**: Regenerate after health endpoint added
- [ ] **CLI**: No changes needed
- [x] **Tests**: Core consumer tests, API integration tests

---

## Execution Group A: Fix Consumer Delivery Policy

**Goal:** Eliminate message loss on restart by changing all consumers to replay from first/last-ack position.

**Packages:** api

**Deliverables:**

- [ ] Change `startFrom: 'last'` -> `startFrom: 'first'` in:
  - `message-persistence.ts` (4 consumers: received, sent, delivered, read)
  - `media-processor.ts` (1 consumer: media-processor)
  - `agent-responder.ts` (1 consumer: agent-responder, keep typing at 'last')
  - `event-persistence.ts` (1 consumer: event-persistence)
- [ ] Add startup log line per consumer: "Consumer X resuming, deliver_policy=All"
- [ ] Add idempotency confirmation log: count of processed vs skipped on backlog drain

**Acceptance Criteria:**

- [ ] All critical consumers use `startFrom: 'first'`
- [ ] `sync-worker` remains `startFrom: 'new'`
- [ ] `agent-responder-typing` remains `startFrom: 'last'`
- [ ] `make check` passes
- [ ] Manual test: stop API, send messages, restart API -> messages appear in DB

**Validation:**

```bash
make check
bun test packages/api
grep "startFrom" packages/api/src/plugins/*.ts  # Verify no 'last' on critical consumers
```

---

## Execution Group B: Sequence Tracking & Gap Detection

**Goal:** Track NATS sequence numbers in DB and detect processing gaps on startup.

**Packages:** db, core, api

**Deliverables:**

- [ ] Add `consumer_offsets` table to DB schema:
  ```sql
  consumer_offsets (
    consumer_name  VARCHAR(100) PRIMARY KEY,
    stream_name    VARCHAR(50) NOT NULL,
    last_sequence  BIGINT NOT NULL DEFAULT 0,
    last_event_id  UUID,
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
  )
  ```
- [ ] Add `ConsumerOffsetService` in api/services with:
  - `getOffset(consumerName)` - get last processed sequence
  - `updateOffset(consumerName, stream, sequence, eventId)` - update after successful processing
- [ ] Update `createSubscription()` in core to expose NATS sequence number (`msg.info.streamSequence`) to handlers via event metadata or callback
- [ ] Update all consumer handlers in message-persistence to call `updateOffset()` after successful processing
- [ ] Add startup gap detection:
  - On consumer init, query stream info for total messages
  - Compare with last stored offset
  - Log warning if gap > 0: "Consumer X has {gap} unprocessed messages (last: {offset}, stream: {total})"
- [ ] Add `/health/consumers` endpoint returning per-consumer lag info

**Acceptance Criteria:**

- [ ] `consumer_offsets` table created via `make db-push`
- [ ] Sequences recorded after each successful message processing
- [ ] Startup logs show gap detection results
- [ ] `/health/consumers` returns lag for each consumer
- [ ] `make check` passes

**Validation:**

```bash
make db-push
make check
bun test packages/api
bun test packages/core
make sdk-generate
# Manual: curl localhost:4000/health/consumers -> shows consumer lag info
```

---

## Testing Strategy

### Unit Tests

- [ ] Consumer config tests: verify `startFrom: 'first'` for critical consumers
- [ ] ConsumerOffsetService: CRUD operations on offsets table
- [ ] Gap detection logic: mock stream info vs stored offset

### Integration Tests

- [ ] **The critical test**: Stop API -> publish N messages to NATS -> restart API -> verify all N messages in DB
- [ ] Idempotency: process same message twice -> no duplicate DB records
- [ ] Offset tracking: process messages -> verify offset updated
- [ ] Health endpoint: returns accurate consumer lag

### Manual Verification

```bash
# 1. Start system normally
make dev

# 2. Send test messages
make cli ARGS="send --instance wa-test --to 5511999990001 --text 'test 1'"
make cli ARGS="send --instance wa-test --to 5511999990001 --text 'test 2'"

# 3. Stop API (keep NATS running)
make restart-api  # or kill the API process

# 4. Send more messages while API is down (via NATS directly or channel)

# 5. Start API
make dev-api

# 6. Verify messages appear in DB
make cli ARGS="messages list --chat-id <chat>"

# 7. Check consumer health
curl http://localhost:4000/health/consumers
```

---

## Notes

- The fix in Group A is a one-line change per consumer but has massive impact
- Group B adds observability so we can prove messages are never lost
- The existing `findOrCreate` + unique constraint is our safety net for idempotency
- NATS durable consumers handle the hard part: resuming from last ack on reconnect
- The real danger was `DeliverPolicy.Last` on **first creation** of a consumer (fresh deploy or consumer name change)
