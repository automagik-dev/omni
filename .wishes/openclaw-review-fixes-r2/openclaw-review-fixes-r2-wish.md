# Wish: OpenClaw Provider — Review Round 2 Fixes

**Status:** APPROVED
**Slug:** `openclaw-review-fixes-r2`
**Created:** 2026-02-11
**Branch:** `feat/openclaw-provider`
**PR:** #22

---

## Summary

Apply all remaining review findings from Felipe, Codex (×3), Gemini, and our Opus tentacles before merging PR #22. Two critical fixes, five should-fixes, and three backlog items to file.

---

## Scope

### IN

- **A.** Race condition buffer: early `chat` events arrive before `registerAccumulation(runId)` — add `earlyEventBuffer` Map in client with TTL + replay on register
- **B.** `resetSession` interface: change from `(sessionKey: string, chatId?: string)` to context object `{ chatId, userId, sessionStrategy, instanceId }` so each provider computes its own key
- **C.** Empty `apiKey` guard: validate token before connecting, prevent infinite reconnect loop
- **D.** Wire Prometheus metrics helpers (`recordOpenClawTrigger`, `updateOpenClawWsState`, etc.) in provider and client
- **E.** `sessions.delete` param: verify gateway expects `{ sessionKey }` vs `{ key }`, fix if wrong
- **F.** `displayName` sanitization: strip `[]`, newlines, control chars before prefixing to message
- **G.** Cosmetic: `wsRequestId` log fix, `schemaConfig` duplicate variable, remove dead `origin` field

### OUT

- rawEvent cast refactor (requires BufferedMessage redesign — separate wish)
- Provider cache invalidation/TTL (systemic, all providers — separate wish)
- Test cache reset helper (no current contamination)

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D-1 | Buffer early events in client, not provider | Client owns the WS message dispatch; provider shouldn't know about timing |
| D-2 | resetSession receives context object | Felipe's suggestion — eliminates coupling between session-cleaner and provider key formats |
| D-3 | Sanitize displayName at provider level | It's the provider that builds the message; sanitize at the boundary |

---

## Success Criteria

- [ ] Race condition: events arriving before registerAccumulation are buffered and replayed (unit test)
- [ ] resetSession interface uses context object; session-cleaner passes context
- [ ] Empty apiKey throws at provider construction, not at WS connect time
- [ ] Metrics helpers called in provider trigger() and client state changes
- [ ] sessions.delete sends correct param name for gateway
- [ ] displayName stripped of `[]` and control chars before message prefix
- [ ] `origin` field removed from types + dispatcher
- [ ] `schemaConfig` declared once in createOpenClawProviderInstance
- [ ] `wsRequestId` log field has real WS frame id (or removed)
- [ ] `make typecheck` passes
- [ ] `make lint` passes (warnings OK)
- [ ] All existing tests pass (949+)

---

## Execution Plan

### Group A: Critical Fixes (~30 min)

**A1: Race condition buffer in client.ts**
- Add `earlyEventBuffer: Map<string, { events: ChatEvent[], expiresAt: number }>` in OpenClawClient
- In `handleMessage`, if no accumulation callback for runId → buffer event (TTL 5s, max 100 events)
- In `registerAccumulation`, replay buffered events for that runId, then delete buffer entry
- Periodic cleanup of expired buffers (on each handleMessage or in health ping)
- Add unit test: event arrives before register → replayed on register

**A2: resetSession context interface**
- Change `IAgentProvider.resetSession?()` signature to accept context object
- Update `OpenClawAgentProvider.resetSession()` to use `context.chatId` with `buildSessionKey`
- Update session-cleaner to pass `{ chatId, userId: from, sessionStrategy, instanceId }`
- Ensure Agno/Webhook providers aren't broken (they don't implement resetSession currently)

**Validation:** `make typecheck && bun test packages/core packages/api`

### Group B: Should-Fixes (~15 min)

**B1: Empty apiKey guard**
- In `createOpenClawProviderInstance`: throw if `provider.apiKey` is empty/null
- Or in `OpenClawClient` constructor: throw if `config.token` is empty

**B2: Wire Prometheus metrics**
- In `trigger()`: call `recordOpenClawTrigger()` on success/failure
- In `trigger()`: call `recordOpenClawTTFD()` on first delta
- In client `setState()`: call `updateOpenClawWsState()`
- In client reconnect: call `recordOpenClawReconnect()`
- In circuit breaker open/close: call `updateOpenClawCircuitBreaker()`

**B3: sessions.delete param name**
- Check gateway protocol for correct param name
- Fix `deleteSession()` in client.ts if needed

**B4: displayName sanitization**
- Strip `[`, `]`, newlines, control chars from displayName before prefix

**Validation:** `make typecheck && make lint`

### Group C: Cosmetics (~5 min)

**C1: Remove `origin` from types + dispatcher**
**C2: Hoist `schemaConfig` in createOpenClawProviderInstance**
**C3: Fix `wsRequestId` log or remove field**

**Validation:** `make typecheck`

---

## Backlog Items (file to beads)

1. **rawEvent cast refactor** — BufferedMessage should carry full OmniEvent, not just payload
2. **Provider cache invalidation** — module-level cache needs TTL or event-based invalidation
3. **Test cache reset helper** — export `_resetProviderCache()` for test isolation
