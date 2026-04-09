# Fix Omni Bugs: API Key Scoping + Media Timeout

## Problem Statement

Two bugs that affect production multi-agent deployments:

### Bug 1: Scoped API key returns cross-instance chats (#244)
**Severity: HIGH — security gap**

API keys created with `instanceIds` restriction correctly filter `instances list` but the `chats list` endpoint returns chats from ALL instances. This breaks multi-agent isolation where each agent (Sofia, ClaudIA) should only see its own chats.

**Root cause:** `packages/api/src/routes/v2/chats.ts` line 159-163 — the `GET /chats` handler calls `services.chats.list(query)` without applying `filterByInstanceAccess()`. The helper exists in `auth.ts:169` but is simply not called.

**Evidence:**
```typescript
// chats.ts:159 — NO instance filtering
chatsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const services = c.get('services');
  const result = await services.chats.list(query);  // ← returns ALL chats
  return c.json({ items: result.items, ... });
});
```

Compare with `messages.ts:461` which correctly passes `instanceIds`:
```typescript
const queryWithAccess = apiKey?.instanceIds ? { ...query, instanceIds: apiKey.instanceIds } : query;
```

### Bug 2: Media processing timeout hardcoded to 60s (#243)
**Severity: MEDIUM — breaks batch media**

`waitForMediaProcessing()` in `agent-dispatcher.ts:572` has `const deadline = Date.now() + 60_000`. When users send 8+ photos, later messages time out because the media processor queues them sequentially (~7s each via Gemini Vision).

The instance already has `agentWaitForMedia` (boolean) and `ackTimeoutMs` (integer) in the DB schema, but there's no `mediaWaitTimeoutMs` field. The 60s is hardcoded.

## Proposed Solution

### Fix 1: Apply instance scoping to chats list
- In `chats.ts` GET `/`, get `apiKey` from context
- Either filter results with `filterByInstanceAccess()` or pass `instanceIds` to the query (like messages.ts does)
- Also check: any other list endpoints missing this filter? (persons, journeys, etc.)

### Fix 2: Make media timeout configurable
- Add `mediaWaitTimeoutMs` column to instances table (default 60000)
- Pass the timeout from instance settings into `waitForMediaProcessing()`
- Schema migration + update CLI `instances update` to expose the flag

## Key Files
- `packages/api/src/routes/v2/chats.ts` — missing filterByInstanceAccess
- `packages/api/src/middleware/auth.ts` — has filterByInstanceAccess helper
- `packages/api/src/plugins/agent-dispatcher.ts:572` — hardcoded 60_000
- `packages/db/src/schema.ts` — needs mediaWaitTimeoutMs column
- `packages/api/src/routes/v2/instances.ts` — expose new field in update

## Questions for Brainstorm
1. Should we filter chats at query level (pass instanceIds to SQL) or post-fetch (filterByInstanceAccess)? Query level is more efficient.
2. For #243, should the timeout scale automatically with queue depth, or just be a flat configurable value?
3. Are there other list endpoints missing instance scoping? Should we audit all of them?
4. What's a good default for mediaWaitTimeoutMs? 60s works for 1-3 images but fails for 8+. 120s? 180s?

## GitHub Issues
- https://github.com/automagik-dev/omni/issues/244
- https://github.com/automagik-dev/omni/issues/243
