# Wish: Fix API Key Chat Scoping + Event-Driven Media Pipeline

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `fix-omni-bugs-243-244` |
| **Date** | 2026-03-24 |
| **Design** | [DESIGN.md](../../brainstorms/fix-omni-bugs-243-244/DESIGN.md) |

## Summary
Two production bugs: (1) scoped API keys leak cross-instance chat data because `GET /chats` doesn't filter by `instanceIds` (#244), and (2) the media processing pipeline uses DB polling with a hardcoded 60s timeout instead of listening to the `media.processed` NATS event that the media-processor already publishes (#243). Fix 1 is a 4-line security patch. Fix 2 replaces 120 DB queries per media message with zero-poll event-driven await.

## Scope
### IN
- #244: Add `instanceIds` filtering to `GET /chats` list endpoint (query-level, like messages.ts)
- #243: Replace `waitForMediaProcessing()` DB polling with event-driven await on `media.processed`
- Add `error?` field to `MediaProcessedPayload` type
- Media-processor publishes `media.processed` on failure path (currently only publishes on success)
- Media-processor publishes `media.processed` in outer catch block (unexpected crashes)
- Dispatcher subscribes to `media.processed` with durable JetStream consumer
- Promise Map + result cache pattern for race condition handling
- Periodic cleanup of leaked promises (10min circuit breaker)
- Tests for both fixes

### OUT
- No new DB migration — there is no timeout to configure, the timeout is deleted
- Route-level config overrides (separate wish: `route-config-overrides`)
- Changes to media-processing service itself (Gemini/Whisper processors)
- Other list endpoint audits (confirmed: only chats is missing scoping)

## Decisions
| Decision | Rationale |
|----------|-----------|
| Event-driven, not configurable timeout | Timeouts are duct tape. NATS JetStream gives guaranteed delivery with durable consumers, dead letter queue, auto-retry. Use the infrastructure we already have. |
| No new DB migration | The `mediaWaitTimeoutMs` column is unnecessary — there's no timeout to configure. |
| Single `media.processed` event for success+failure | Simpler than two event types. Empty content + error field = failure. Dispatcher checks content. |
| Cache + Promise Map pattern | Handles both race conditions: event-before-ask (cache hit) and ask-before-event (promise resolves). Standard Node.js pattern. |
| Query-level filtering for chats (#244) | Filters in SQL WHERE clause, not post-fetch. More efficient. Follows messages.ts:461 pattern exactly. |

## Success Criteria
- [ ] `GET /chats` with scoped API key only returns chats from allowed instances
- [ ] `GET /chats` with unscoped API key returns all chats (no regression)
- [ ] `waitForMediaProcessing()` polling loop is deleted — zero DB polling for media wait
- [ ] Dispatcher subscribes to `media.processed` with durable consumer `agent-dispatcher-media`
- [ ] Media processor publishes `media.processed` on success path (already does)
- [ ] Media processor publishes `media.processed` on failure path (new)
- [ ] Media processor publishes `media.processed` in outer catch block (new)
- [ ] Promise cleanup rejects promises older than 10min (circuit breaker)
- [ ] Existing tests pass: `bun test` in packages/api
- [ ] Close GitHub issues #243 and #244

## Execution Strategy

### Wave 1 (parallel)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Chat scoping fix — add instanceIds filter to chats list |
| 2 | engineer | Event-driven media pipeline — replace polling with NATS await |

### Wave 2 (after Wave 1)
| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Tests for both fixes |

## Execution Groups

### Group 1: chat-scoping-fix
**Goal:** Fix scoped API key leaking cross-instance chats.
**Deliverables:**
1. Add `instanceIds?: string[]` to `ListChatsOptions` interface in `packages/api/src/services/chats.ts`
2. Add `if (instanceIds?.length) conditions.push(inArray(chats.instanceId, instanceIds))` to `buildListConditions()` (after the existing `instanceId` singular check at line 116)
3. In `packages/api/src/routes/v2/chats.ts` GET `/` handler (line 159), extract `apiKey` from context and pass `instanceIds`:
```typescript
const apiKey = c.get('apiKey');
const queryWithAccess = apiKey?.instanceIds
  ? { ...query, instanceIds: apiKey.instanceIds }
  : query;
const result = await services.chats.list(queryWithAccess);
```
4. Import `filterByInstanceAccess` is NOT needed — we're filtering at query level

**Acceptance Criteria:**
- [ ] Scoped API key with instanceIds returns only chats from those instances
- [ ] Unscoped API key returns all chats (no regression)
- [ ] TypeScript compiles clean: `bunx tsc --noEmit`

**Validation:**
```bash
cd /home/genie/.genie/worktrees/omni/omni-day && bunx tsc --noEmit
```

**depends-on:** none

---

### Group 2: event-driven-media
**Goal:** Replace DB-polling media wait with event-driven NATS subscription.
**Deliverables:**
1. **`packages/core/src/events/types.ts`** — Add optional `error?: string` field to `MediaProcessedPayload` interface
2. **`packages/api/src/plugins/media-processor.ts`** — Publish `media.processed` on failure path (line 338-353, after error marker write). Also publish in the outer catch block (line 437-449) for unexpected crashes. Payload: `{ eventId, mediaId, processingType, content: '', error: errorMessage }`
3. **`packages/api/src/plugins/agent-dispatcher.ts`** — Major changes:
   - Add `mediaCompletions` Map (pending promises keyed by message UUID)
   - Add `mediaResultCache` Map (completed results cache with 5min TTL)
   - Add periodic cleanup interval: reject promises older than 10min, log as `media_promise_leaked`
   - Subscribe to `media.processed` with durable consumer `agent-dispatcher-media`, queue `agent-dispatcher-media`, startFrom `new`
   - Replace `waitForMediaProcessing()` function with `awaitMediaProcessing()`:
     1. Check DB first (result may already be written)
     2. Check cache (event may have arrived before dispatcher asked)
     3. Await promise (event will arrive via NATS)
   - Update `collectProcessedMedia()` to call `awaitMediaProcessing()` instead of `waitForMediaProcessing()`
   - Delete the old `waitForMediaProcessing()` function entirely

**Acceptance Criteria:**
- [ ] `waitForMediaProcessing` function no longer exists (search: `grep -r waitForMediaProcessing packages/api/`)
- [ ] `media.processed` subscription exists with durable consumer
- [ ] Media processor publishes event on ALL code paths (success, failure, crash)
- [ ] No `60_000` deadline or `sleep(500)` polling in the media wait path
- [ ] TypeScript compiles clean: `bunx tsc --noEmit`

**Validation:**
```bash
cd /home/genie/.genie/worktrees/omni/omni-day && bunx tsc --noEmit && ! grep -r "waitForMediaProcessing" packages/api/src/
```

**depends-on:** none

---

### Group 3: tests
**Goal:** Add tests for both fixes.
**Deliverables:**
1. Test chat scoping: verify `services.chats.list({ instanceIds: ['id-1'] })` only returns chats from that instance
2. Test `awaitMediaProcessing()`: mock event arrival → promise resolves with content
3. Test cache hit: set cache entry → `awaitMediaProcessing()` returns cached result without waiting
4. Test error event: `media.processed` with empty content + error → returns null
5. Test promise cleanup: promise older than cleanup interval → rejected

**Acceptance Criteria:**
- [ ] All new tests pass
- [ ] Existing tests still pass: `bun test` in packages/api

**Validation:**
```bash
cd /home/genie/.genie/worktrees/omni/omni-day/packages/api && bun test
```

**depends-on:** Group 1, Group 2

---

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Promise leak if `media.processed` event never arrives | Low | 10min circuit breaker rejects stale promises. Logged as `media_promise_leaked` for monitoring. |
| mediaResultCache grows unbounded | Low | 5min TTL per entry via `setTimeout`. Plus periodic sweep on cleanup interval. |
| Adding `error?` to `MediaProcessedPayload` breaks consumers | Low | Optional field — fully backward compatible. |
| Durable consumer creates new JetStream consumer | Low | New consumer `agent-dispatcher-media` on MEDIA stream. No conflict with existing consumers. |

## Files to Create/Modify

```
packages/api/src/services/chats.ts                    # Add instanceIds to ListChatsOptions + buildListConditions
packages/api/src/routes/v2/chats.ts                   # Pass apiKey.instanceIds to chats.list()
packages/core/src/events/types.ts                     # Add error? to MediaProcessedPayload
packages/api/src/plugins/media-processor.ts           # Publish media.processed on failure + catch paths
packages/api/src/plugins/agent-dispatcher.ts          # Subscribe media.processed, replace polling with event-await
packages/api/src/plugins/__tests__/media-await.test.ts     # New: event-driven media tests
packages/api/src/__tests__/chat-scoping.test.ts            # New: chat instance scoping tests
```
