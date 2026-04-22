# Design: Fix API Key Chat Scoping + Event-Driven Media Pipeline

| Field | Value |
|-------|-------|
| **Slug** | `fix-omni-bugs-243-244` |
| **Date** | 2026-03-24 |
| **WRS** | 100/100 |

## Problem
Two production bugs: (1) scoped API keys leak cross-instance chat data, and (2) the media processing pipeline uses DB polling with a hardcoded timeout instead of the NATS event system — dropping media results on batch messages.

## Scope
### IN
- #244: Apply instance scoping to `GET /chats` list endpoint
- #243: Replace DB-polling `waitForMediaProcessing()` with event-driven await on `media.processed`
- Ensure media-processor publishes events on BOTH success AND failure paths
- Tests for both fixes

### OUT
- No new DB migration (no `mediaWaitTimeoutMs` column — the timeout is deleted, not configured)
- Route-level config overrides (separate wish)
- Changes to media-processing service itself (Gemini/Whisper)

## Fix 1: Chat List Instance Scoping (#244)

### Root Cause
`chats.ts:159` — `GET /chats` calls `services.chats.list(query)` without passing API key instance restrictions. Every other list endpoint applies scoping.

### Fix
1. Add `instanceIds?: string[]` to `ListChatsOptions` interface in `services/chats.ts`
2. Add `if (instanceIds?.length) conditions.push(inArray(chats.instanceId, instanceIds))` in `buildListConditions()`
3. In `routes/v2/chats.ts` GET `/`, extract `apiKey` from context and pass `instanceIds`:
```typescript
const apiKey = c.get('apiKey');
const queryWithAccess = apiKey?.instanceIds
  ? { ...query, instanceIds: apiKey.instanceIds }
  : query;
const result = await services.chats.list(queryWithAccess);
```

### Files
- `packages/api/src/services/chats.ts` — add `instanceIds` to interface + condition
- `packages/api/src/routes/v2/chats.ts` — pass instanceIds from apiKey context

## Fix 2: Event-Driven Media Pipeline (#243)

### Root Cause — Architectural
The dispatcher and media-processor are two independent NATS subscribers of `message.received`. They coordinate through **DB column polling** instead of using the event system:

```
CURRENT (broken):
  message.received ──┬── media-processor → process → write DB column → publish media.processed (NOBODY LISTENS)
                     └── agent-dispatcher → debounce → poll DB column 120× → timeout → "[unavailable]"
```

This is fundamentally wrong. We have NATS JetStream with durable consumers, dead letter queues, at-least-once delivery, and auto-retry — and we're polling a database 120 times instead.

### Fix — Event-Driven Completion

```
NEW (correct):
  message.received ──┬── media-processor → process → write DB → publish media.processed ─┐
                     │                                    (OR on failure: media.failed) ─┐│
                     └── agent-dispatcher → debounce ──────────────────────────────────────┤
                                                                                          │
  media.processed ────── agent-dispatcher (durable subscriber) ← resolves pending await ──┘
  media.failed    ────── agent-dispatcher (durable subscriber) ← resolves as error ───────┘
```

### Implementation

#### A. Media Processor — publish on ALL paths

Currently the media-processor only publishes `media.processed` on success (line 367). On failure (line 338), it writes a DB error marker but publishes nothing. Fix:

```typescript
// On failure path (line 338-353), ADD event publication:
if (!result.success) {
  // ... existing error marker write ...

  // NEW: publish failure event so dispatcher doesn't wait forever
  await ctx.eventBus.publish('media.processed', {
    eventId: eventId ?? media.messageId,
    mediaId: media.messageId,
    processingType: result.processingType ?? inferProcessingType(content.type),
    content: '',  // empty = failed
    error: result.errorMessage ?? 'unknown',
  });
  return;
}
```

> Decision: Use `media.processed` with empty content + error field, not a new `media.failed` event type. Keeps the contract simple — one event type, dispatcher checks for content.

Also: the outer try/catch (line 437-449) currently swallows errors silently. Add a `media.processed` publish there too for truly unexpected crashes.

#### B. Agent Dispatcher — subscribe to `media.processed`, delete polling

1. **New: Media completion registry** — in-memory Map that tracks pending and completed media:

```typescript
// Pending media awaits, keyed by DB message UUID
const mediaCompletions = new Map<string, {
  resolve: (result: { content: string; error?: string }) => void;
  reject: (error: Error) => void;
}>();

// Cache of already-completed results (event arrived before dispatcher needed it)
const mediaResultCache = new Map<string, { content: string; error?: string }>();
```

2. **New: Subscribe to `media.processed`** with durable consumer:

```typescript
await eventBus.subscribe(
  'media.processed',
  async (event) => {
    const payload = event.payload as MediaProcessedPayload;
    const { mediaId, content, error } = payload;

    // If dispatcher is already waiting → resolve the promise
    const pending = mediaCompletions.get(mediaId);
    if (pending) {
      pending.resolve({ content, error });
      mediaCompletions.delete(mediaId);
      return;
    }

    // If dispatcher hasn't asked yet → cache the result (TTL 5min)
    mediaResultCache.set(mediaId, { content, error });
    setTimeout(() => mediaResultCache.delete(mediaId), 300_000);
  },
  {
    durable: 'agent-dispatcher-media',
    queue: 'agent-dispatcher-media',
    startFrom: 'new',
  },
);
```

3. **Replace `waitForMediaProcessing()`** — delete the 30-line polling loop, replace with:

```typescript
async function awaitMediaProcessing(
  services: Services,
  instanceId: string,
  chatId: string,
  externalId: string,
  contentType: string,
): Promise<{ content: string | null; localPath: string | null }> {
  const column = getProcessedColumn(contentType);
  if (!column) return MEDIA_WAIT_NULL;

  const chat = await services.chats.findByExternalIdSmart(instanceId, chatId);
  if (!chat) return MEDIA_WAIT_NULL;

  const msg = await services.messages.getByExternalId(chat.id, externalId);
  if (!msg) return MEDIA_WAIT_NULL;

  // 1. Check if result already in DB (processing finished before debounce fired)
  const existing = checkProcessedColumn(msg, column);
  if (existing !== 'pending') {
    return existing === 'error' ? MEDIA_WAIT_NULL : existing;
  }

  // 2. Check event cache (event arrived before we asked)
  const cached = mediaResultCache.get(msg.id);
  if (cached) {
    mediaResultCache.delete(msg.id);
    if (!cached.content || cached.error) return MEDIA_WAIT_NULL;
    const localPath = msg.mediaLocalPath ? resolve(join(MEDIA_BASE_PATH, msg.mediaLocalPath)) : null;
    return { content: cached.content, localPath };
  }

  // 3. Await the event (NATS guarantees delivery)
  const result = await new Promise<{ content: string; error?: string }>((resolve, reject) => {
    mediaCompletions.set(msg.id, { resolve, reject });
  });

  if (!result.content || result.error) return MEDIA_WAIT_NULL;

  // Re-read message for localPath (media storage may have updated it)
  const updated = await services.messages.getByExternalId(chat.id, externalId);
  const localPath = updated?.mediaLocalPath ? resolve(join(MEDIA_BASE_PATH, updated.mediaLocalPath)) : null;
  return { content: result.content, localPath };
}
```

**Zero polling. Zero timeouts. NATS guarantees delivery.**

### Delivery Guarantees

| Scenario | What Happens |
|----------|-------------|
| Processing succeeds | `media.processed` published → dispatcher resolves promise |
| Processing fails (API error) | `media.processed` with empty content published → dispatcher gets null |
| Processor crashes mid-processing | NATS redelivers `message.received` (maxRetries: 2) → processor retries |
| All retries exhausted | Dead letter queue → auto-retry 1h/6h/24h → manual intervention |
| Dispatcher restarts | Durable consumer replays unacked `media.processed` events |
| Event arrives before dispatcher needs it | Cached in `mediaResultCache` (5min TTL) |
| Event arrives after dispatcher asks | Resolves pending promise in `mediaCompletions` |
| NATS itself goes down | JetStream persistence on disk → events replayed on reconnect |

**Nothing is lost.** Every media message produces exactly one `media.processed` event (success or failure). The dispatcher has a durable consumer that will receive it — if not now, then on retry, or on restart, or from the dead letter queue.

### What Gets Deleted
- `waitForMediaProcessing()` — 30 lines of DB polling loop
- `sleep(500)` import usage in media wait
- The hardcoded `60_000` deadline
- 120 DB queries per media message

### What Gets Added
- `media.processed` event publication on failure path (~5 lines)
- `media.processed` durable subscription in dispatcher (~20 lines)
- `awaitMediaProcessing()` — event-driven replacement (~25 lines)
- `mediaCompletions` Map + `mediaResultCache` Map (~10 lines)

**Net delta: approximately zero lines.** We're replacing polling with events.

### MediaProcessedPayload Extension

The existing `MediaProcessedPayload` needs an optional `error` field:

```typescript
export interface MediaProcessedPayload {
  eventId: string;
  mediaId: string;
  processingType: 'transcription' | 'description' | 'extraction';
  content: string;
  model?: string;
  provider?: string;
  tokensUsed?: number;
  error?: string;  // NEW: set when processing failed
}
```

## Decisions
| Decision | Rationale |
|----------|-----------|
| Event-driven, not configurable timeout | Timeouts are duct tape. NATS gives us guaranteed delivery. Use it. |
| No new DB migration | The `mediaWaitTimeoutMs` column is unnecessary — there's no timeout to configure. |
| Single `media.processed` event for success+failure | Simpler than two event types. Empty content + error field = failure. |
| Cache + Promise Map pattern | Handles both race conditions: event-before-ask and ask-before-event. Standard pattern. |
| Durable consumer for media events | Survives dispatcher restarts. JetStream replays missed events. |
| Query-level filtering for chats (#244) | More efficient than post-fetch. Matches messages.ts pattern. |

## Risks & Assumptions
| Risk | Severity | Mitigation |
|------|----------|------------|
| Promise leak if event never arrives (catastrophic NATS failure) | Low | Add periodic cleanup: promises older than 10min get rejected with error. This is a circuit breaker, not a timeout. Log as `media_promise_leaked` for alerting. |
| mediaResultCache grows unbounded | Low | 5min TTL with `setTimeout` cleanup. Also periodic sweep. |
| Existing `MediaProcessedPayload` type change | Low | Adding optional `error` field is backward compatible. |

## Execution Groups

### Group 1: Chat scoping fix (#244)
**Files:**
- `packages/api/src/services/chats.ts` — add `instanceIds` to ListChatsOptions + buildListConditions
- `packages/api/src/routes/v2/chats.ts` — extract apiKey, pass instanceIds
- Test: verify scoped key only sees its instance's chats

### Group 2: Event-driven media pipeline (#243)
**Files:**
- `packages/core/src/events/types.ts` — add `error?` to MediaProcessedPayload
- `packages/api/src/plugins/media-processor.ts` — publish event on failure path + catch block
- `packages/api/src/plugins/agent-dispatcher.ts` — subscribe to `media.processed`, replace polling with event-await

### Group 3: Tests
- Unit test: `awaitMediaProcessing()` resolves on event, returns null on error event
- Unit test: cache hit when event arrives before ask
- Integration test: scoped API key chat filtering

## Success Criteria
- [ ] `GET /chats` with scoped API key only returns chats from allowed instances
- [ ] `waitForMediaProcessing()` polling loop is deleted — zero DB polling for media
- [ ] Dispatcher subscribes to `media.processed` with durable consumer
- [ ] Media processor publishes `media.processed` on BOTH success and failure
- [ ] 8 photos sent in batch → all 8 described, zero `[media processing unavailable]`
- [ ] Existing tests pass
- [ ] Close GitHub issues #243 and #244
