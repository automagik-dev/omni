# Wish: Fix three quick wins — JID self-filter (#344), NATS retry (#345), health route (#335)

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `fix-quick-wins-344-345-335` |
| **Date** | 2026-04-05 |
| **Design** | N/A — all three have complete root cause + fix in their issue bodies |

## Summary

Three independent, low-risk fixes from the open backlog. #344 is P1 (silently drops owner phone messages), #345 is P2 (NATS subscription retry), #335 is P3 (health check 404). All surgical, all in different files, all independently revertable.

## Scope

### IN
- Remove the over-broad JID self-filter in agent-dispatcher that drops owner phone messages (#344)
- Add exponential backoff retry to NATS reply subscription (#345)
- Add root-level `/health` redirect so external health checkers work (#335)

### OUT
- No changes to the reaction echo fixes that work correctly (layer 1: `!isFromMe` in dual-emit, layer 2: `sentMessageIds` cache)
- No changes to NatsGenieProvider itself (retry is in the caller, not the provider)
- No changes to the full `/api/v2/health` response shape

## Decisions

| Decision | Rationale |
|----------|-----------|
| **Remove** the JID self-filter entirely rather than narrow it | The filter is dead code for its stated purpose: bot reaction dual-emits with `isFromMe=true` are already blocked at plugin level (L2833 `!isFromMe` check). The filter ONLY catches regular owner messages — which is pure harm. Removing it is cleaner than adding conditions to dead code. |
| Retry in the caller (`createNatsGenieProviderInstance`), not in the provider class | The provider is a general-purpose NATS client. Retry policy is a deployment concern that belongs in the wiring code, not the transport layer. |
| Root-level redirect to `/api/v2/health` rather than duplicating the handler | Single source of truth. The health handler stays in one place. External checkers hitting `GET /health` get a 307 redirect to `/api/v2/health`. |

## Success Criteria

- [ ] Owner phone messages (isFromMe + JID match) pass through agent dispatch and reach the agent
- [ ] Bot's own reaction echoes are still blocked (existing layer 1 + layer 2 still work)
- [ ] NATS reply subscription retries up to 10 times with exponential backoff on failure
- [ ] Successful retry logs at info level; permanent failure logs at error level
- [ ] `GET /health` returns 307 redirect to `/api/v2/health`
- [ ] `GET /api/v2/health` continues to work as before
- [ ] All three bugs have unit test coverage
- [ ] `bun run build` + `bunx biome check .` + `bun test` all clean
- [ ] PR opened targeting `dev`, linking to #344, #345, #335

## Execution Strategy

### Wave 1 (parallel — all three fixes are independent)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Remove JID self-filter (#344) |
| 2 | engineer | Add NATS subscription retry (#345) |
| 3 | engineer | Add root-level health redirect (#335) |

### Wave 2 (after Wave 1)

| Group | Agent | Description |
|-------|-------|-------------|
| review | reviewer | Validate all three fixes, run quality gates, open PR |

## Execution Groups

### Group 1: Remove JID self-filter (#344) — XS, ~15 min

**Goal:** Stop dropping owner phone messages while keeping reaction echo protection intact.

**Root Cause Analysis:**

The JID self-filter at `agent-dispatcher.ts` L3358-3376 was added as "layer 3" defense against reaction echo loops (#336). But tracing the actual code flow reveals it's dead code for that purpose:

1. Bot sends reaction → Baileys echoes via `messages.reaction` event
2. `handleReactionReceived()` (plugin.ts L2806) called with `isFromMe=true`
3. L2833: `!isFromMe` is `false` → **dual-emit to message.received SKIPPED**
4. The reaction never reaches `message.received` → never hits `shouldProcessMessage` in agent-dispatcher

The JID self-filter runs on `message.received` events. Bot reaction dual-emits with `isFromMe=true` never arrive there. The filter ONLY catches regular owner messages (sent from phone via multi-device sync), which have `isFromMe=true` in their rawPayload. These are legitimate messages that should be dispatched.

**Deliverables:**

1. Delete the JID self-filter block (L3358-3376) in `packages/api/src/plugins/agent-dispatcher.ts`
2. Replace with a comment explaining why layer 3 was removed and that layers 1+2 handle the reaction echo
3. Add unit test: mock a `message.received` event with `rawPayload.isFromMe=true` + matching owner JID → verify it passes through (not null)
4. Add unit test: verify bot reaction dual-emits still blocked at plugin level (existing tests should cover, verify they exist)

**Acceptance Criteria:**
- [ ] JID self-filter block (L3358-3376) removed from agent-dispatcher.ts
- [ ] Owner phone messages with `isFromMe=true` pass through dispatch
- [ ] Reaction echo protection still works (layer 1: `!isFromMe` in plugin, layer 2: sentMessageIds cache)
- [ ] New unit test proves owner messages are not dropped

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni
grep -n "JID-based self-filter\|extractPhoneFromJid(payload" packages/api/src/plugins/agent-dispatcher.ts
# Should return zero matches (filter removed)
bun test packages/api/src/__tests__/agent-dispatcher
bun test packages/channel-whatsapp
```

**depends-on:** none

---

### Group 2: NATS reply subscription retry (#345) — S, ~20 min

**Goal:** Prevent permanent reply loss when NATS is briefly unavailable at startup.

**Deliverables:**

1. In `createNatsGenieProviderInstance()` (agent-dispatcher.ts L2760-2769), replace the fire-and-forget `.catch()` with an exponential backoff retry wrapper
2. Retry up to 10 times, starting at 2s delay, doubling each time, capped at 60s
3. Log `warn` on each retry attempt, `error` on permanent failure after 10 attempts
4. Rename `_metadata` → `metadata` in the onReply callback, add `agent: metadata.agent` to the error log (bonus from PR review)
5. Add unit test: mock `startReplySubscription` to fail N times then succeed → verify retry count

**Solution sketch:**
```typescript
const startWithRetry = async (attempt = 1): Promise<void> => {
  try {
    await natsProvider.startReplySubscription();
    log.info('NATS reply subscription started', { instanceId: instance.id, attempt });
  } catch (err) {
    const delay = Math.min(2000 * 2 ** (attempt - 1), 60_000);
    log.warn('NATS reply subscription failed, retrying', {
      instanceId: instance.id,
      providerId: provider.id,
      attempt,
      nextRetryMs: delay,
      error: err instanceof Error ? err.message : String(err),
    });
    if (attempt < 10) {
      setTimeout(() => startWithRetry(attempt + 1), delay);
    } else {
      log.error('NATS reply subscription permanently failed', {
        instanceId: instance.id,
        providerId: provider.id,
      });
    }
  }
};
startWithRetry();
```

**Acceptance Criteria:**
- [ ] Retry logic with exponential backoff (2s → 4s → 8s → ... → 60s cap)
- [ ] Max 10 attempts before giving up
- [ ] `warn` log on retry, `error` on permanent failure, `info` on success
- [ ] Agent name included in onReply error log
- [ ] Unit test covers retry behavior

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni
grep -n "startWithRetry\|attempt < 10" packages/api/src/plugins/agent-dispatcher.ts
bun test packages/api/src/__tests__/agent-dispatcher-nats
```

**depends-on:** none

---

### Group 3: Root-level health redirect (#335) — XS, ~10 min

**Goal:** External health checkers hitting `GET /health` get a valid response.

**Deliverables:**

1. In `packages/api/src/app.ts`, add a root-level `GET /health` redirect before the `/api/v2` mount:
   ```typescript
   // Root-level health redirect for external checkers (k8s probes, genie providers)
   app.get('/health', (c) => c.redirect('/api/v2/health', 307));
   ```
2. Add unit test: `GET /health` returns 307 with `Location: /api/v2/health`
3. Verify `GET /api/v2/health` still works unchanged

**Acceptance Criteria:**
- [ ] `GET /health` returns 307 redirect to `/api/v2/health`
- [ ] `GET /api/v2/health` unchanged
- [ ] Unit test covers the redirect

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni
grep -n "app.get.*'/health'" packages/api/src/app.ts
bun test packages/api
```

**depends-on:** none

---

### Group 4: Validation + PR (reviewer)

**Goal:** Verify all fixes, run quality gates, ship.

**Deliverables:**

1. `bun run build` across all packages — zero errors
2. `bunx biome check .` — zero lint errors
3. `bun test` — no new failures
4. Commit each bug as its own conventional commit:
   - `fix(api): remove over-broad JID self-filter that drops owner phone messages (#344)`
   - `fix(api): add exponential retry for NATS reply subscription (#345)`
   - `fix(api): add root-level /health redirect for external checkers (#335)`
5. Push branch, open PR targeting `dev`
6. PR title: `fix: quick wins — JID self-filter, NATS retry, health redirect (#344 #345 #335)`

**depends-on:** Group 1, Group 2, Group 3

## QA Criteria

- [ ] Owner phone message with `isFromMe=true` reaches agent (mock or real test)
- [ ] Bot reaction echo does NOT reach agent (existing behavior preserved)
- [ ] NATS subscription recovery after transient failure (mock test)
- [ ] `GET /health` returns 307 → `/api/v2/health`
- [ ] `GET /api/v2/health` returns 200 with health JSON
- [ ] No regressions in existing test suite

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Removing JID self-filter re-enables some edge case reaction loop | Low | Layer 1 (`!isFromMe` in plugin) and layer 2 (`sentMessageIds` cache) handle ALL known reaction echo scenarios. Layer 3 was dead code. |
| Retry setTimeout leak on process shutdown | Low | 10 retries × 60s max = 10 min worst case. Provider dispose() handles NATS cleanup. |
| 307 redirect adds a roundtrip for health checks | Low | One extra hop. Could use 301 for caching, but 307 is safer for POST/PUT probes. |

## Files to Create/Modify

```
packages/api/src/plugins/agent-dispatcher.ts    — Remove JID self-filter, add retry
packages/api/src/app.ts                          — Add root-level /health redirect
packages/api/src/__tests__/                      — New/updated tests for all three fixes
```

## References

- #344: https://github.com/automagik-dev/omni/issues/344
- #345: https://github.com/automagik-dev/omni/issues/345
- #335: https://github.com/automagik-dev/omni/issues/335
