# Wish: Standardize sendTyping Across All Channels

**Status:** DRAFT
**Slug:** standardize-sendtyping
**Date:** 2026-03-11
**Issue:** #86

---

## Summary

Discord and Telegram typing indicators expire after 5-10 seconds, causing them to vanish mid-LLM-response while users wait 30+ seconds. The API sends `duration=30000` but only WhatsApp honors it. Fix Discord/Telegram with per-channel auto-refresh, delete 161 lines of dead code in WhatsApp's `typing.ts`, and document Slack's thread-only behavior.

## Scope

### IN
- Auto-refresh typing in Discord's `sendTyping` (refresh every 8s while duration > 0)
- Auto-refresh typing in Telegram's `sendTyping` (refresh every 4s while duration > 0)
- Cleanup on `duration=0` (stop refresh, clear indicator)
- Defensive cleanup: auto-clear intervals after max 60s failsafe timeout
- Cleanup on plugin disconnect/destroy (clear all active typing intervals)
- Delete WhatsApp's unused `packages/channel-whatsapp/src/typing.ts` (161 lines dead code)
- Remove unused exports of typing utilities from WhatsApp package index
- Document Slack's `canSendTyping: false` and thread-only limitation
- Unit tests for Discord/Telegram auto-refresh behavior
- `make check` passes

### OUT
- Changing the `sendTyping` interface signature (future issue — start/stop semantics)
- Shared TypingManager abstraction in channel-sdk (council rejected unanimously)
- Modifying WhatsApp's plugin `sendTyping` implementation (already works correctly)
- Modifying A2A's `sendTyping` (stream-close repurposing is separate concern)
- Modifying Slack's typing implementation (thread-only by platform constraint)
- Rate limit middleware or request deduping (unnecessary at current scale)
- Changes to API callers (`agent-dispatcher.ts`, `agent-responder.ts`)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where auto-refresh lives | Per-channel (inside each plugin) | Council unanimous: channels have different refresh rates, platform-specific cleanup, no shared abstraction needed |
| Resurrect TypingManager? | No | Was deleted as unused (issue #84). A 2-channel problem doesn't justify a shared abstraction |
| Discord refresh interval | 8 seconds | Discord typing lasts ~10s, 8s refresh ensures overlap without hitting rate limits (5 req/5s per channel) |
| Telegram refresh interval | 4 seconds | Telegram typing lasts ~5s, 4s refresh ensures continuous indicator |
| Failsafe timeout | 60 seconds | Prevents leaked intervals if `duration=0` (stop) is never called |
| WhatsApp typing.ts | Delete entirely | Plugin inlines 4 lines; the 161-line module with TypingIndicator class, sendRecording, etc. is unused |
| Interface changes | Deferred | Council split 3/5 on start/stop semantics — valid but separate PR to avoid scope creep |

## Success Criteria

- [ ] Discord typing indicator persists for full duration of LLM response (30s+)
- [ ] Telegram typing indicator persists for full duration of LLM response (30s+)
- [ ] Calling `sendTyping(id, chatId, 0)` on Discord/Telegram clears the refresh interval
- [ ] No leaked intervals: after plugin disconnect, no intervals remain active
- [ ] Failsafe: intervals auto-clear after 60s even without explicit stop
- [ ] WhatsApp's `packages/channel-whatsapp/src/typing.ts` is deleted
- [ ] WhatsApp `sendTyping` still works (plugin.ts inline implementation unchanged)
- [ ] Slack behavior documented (canSendTyping: false, thread-only)
- [ ] Unit tests cover: start refresh, stop refresh, failsafe timeout, cleanup on disconnect
- [ ] `make check` passes (lint, types, tests)

## Assumptions & Risks

| Risk | Mitigation |
|------|-----------|
| Discord rate limits at high concurrency (5 req/5s per channel) | 8s refresh interval stays well under limit; at 50 concurrent chats = 6.25 req/8s per channel = safe |
| Telegram global rate limit (30 req/s) | 4s refresh at 100 concurrent chats = 25 req/s = within limit |
| Leaked intervals if cleanup logic has bugs | Failsafe timeout (60s) catches all leaks; tests verify cleanup |
| WhatsApp typing.ts deletion breaks something | Grep confirms no imports of deleted functions; tests verify |
| Future interface change (start/stop) requires rework | Per-channel refresh logic is <20 lines each — easy to migrate |

---

## Execution Groups

### Group 1: Delete WhatsApp Dead Code

**Goal:** Remove 161 lines of unused typing utilities from the WhatsApp channel package.

**Deliverables:**
- [ ] Delete `packages/channel-whatsapp/src/typing.ts` entirely
- [ ] Remove any exports of typing utilities from `packages/channel-whatsapp/src/index.ts`
- [ ] Remove `packages/channel-whatsapp/src/__tests__/typing.test.ts` if it only tests the deleted module
- [ ] Verify `packages/channel-whatsapp/src/plugin.ts` `sendTyping` method still works (it inlines its own logic, doesn't import from typing.ts)

**Acceptance:**
- No imports of deleted typing.ts remain in the codebase
- WhatsApp plugin's sendTyping (inline in plugin.ts) is untouched
- `bun test` in channel-whatsapp passes

**Validation:**
```bash
rg "from.*['\"].*typing" packages/channel-whatsapp/src/ && echo "FAIL: still imported" || echo "OK: no imports"
cd packages/channel-whatsapp && bun test
```

---

### Group 2: Discord Auto-Refresh Typing

**Goal:** Make Discord typing indicator persist for the full requested duration by auto-refreshing every 8 seconds.

**Deliverables:**
- [ ] Modify `packages/channel-discord/src/plugin.ts` `sendTyping` method:
  - Accept `duration` parameter (currently ignored)
  - If `duration > 0`: send initial typing, then `setInterval` every 8000ms to re-send
  - If `duration === 0`: clear any active interval for that chatId
  - Track active intervals in a `Map<string, ReturnType<typeof setInterval>>` keyed by `${instanceId}:${chatId}`
  - Add failsafe `setTimeout` at 60s to auto-clear interval
  - Clear interval on errors (catch and clear if channel.sendTyping() fails)
- [ ] Add cleanup in plugin disconnect/destroy: clear all active typing intervals
- [ ] Unit test `packages/channel-discord/src/__tests__/typing-refresh.test.ts`:
  - Test: calling sendTyping with duration > 0 starts an interval
  - Test: calling sendTyping with duration === 0 clears the interval
  - Test: interval auto-clears after 60s failsafe
  - Test: plugin disconnect clears all intervals

**Acceptance:**
- Discord typing refreshes every 8s for up to 60s
- `duration=0` stops the refresh
- No intervals leak after disconnect
- Tests pass

**Validation:**
```bash
cd packages/channel-discord && bun test src/__tests__/typing-refresh.test.ts
```

---

### Group 3: Telegram Auto-Refresh Typing

**Goal:** Make Telegram typing indicator persist for the full requested duration by auto-refreshing every 4 seconds.

**Deliverables:**
- [ ] Modify `packages/channel-telegram/src/plugin.ts` `sendTyping` method:
  - Accept `duration` parameter (currently ignored)
  - If `duration > 0`: send initial typing, then `setInterval` every 4000ms to re-send
  - If `duration === 0`: clear any active interval for that chatId
  - Track active intervals in a `Map<string, ReturnType<typeof setInterval>>` keyed by `${instanceId}:${chatId}`
  - Add failsafe `setTimeout` at 60s to auto-clear interval
  - Clear interval on errors (catch and clear if sendChatAction fails)
- [ ] Add cleanup in plugin disconnect/destroy: clear all active typing intervals
- [ ] Unit test `packages/channel-telegram/src/__tests__/typing-refresh.test.ts`:
  - Test: calling sendTyping with duration > 0 starts an interval
  - Test: calling sendTyping with duration === 0 clears the interval
  - Test: interval auto-clears after 60s failsafe
  - Test: plugin disconnect clears all intervals

**Acceptance:**
- Telegram typing refreshes every 4s for up to 60s
- `duration=0` stops the refresh
- No intervals leak after disconnect
- Tests pass

**Validation:**
```bash
cd packages/channel-telegram && bun test src/__tests__/typing-refresh.test.ts
```

---

### Group 4: Documentation & Final Verification

**Goal:** Document Slack's no-op behavior and verify everything works end-to-end.

**Depends on:** Groups 1, 2, 3

**Deliverables:**
- [ ] Add inline comment in Slack plugin's `sendTyping` documenting thread-only limitation and `canSendTyping: false`
- [ ] Add inline comment in Slack's capabilities explaining why canSendTyping is false
- [ ] Run full `make check` to verify lint, types, and all tests pass
- [ ] Verify no regressions in existing typing tests across all channels

**Acceptance:**
- Slack behavior is documented in code comments
- `make check` passes with zero errors
- No test regressions

**Validation:**
```bash
make check
```

---

## Dependencies

```
Group 1 (WhatsApp cleanup) ← independent
Group 2 (Discord refresh) ← independent
Group 3 (Telegram refresh) ← independent
Group 4 (docs & verification) ← depends on Groups 1, 2, 3
```

**Execution order:**
- **Parallel wave 1:** Groups 1 + 2 + 3 (all independent)
- **Sequential:** Group 4 (after all others complete)

---

## Future Work (out of scope, separate issues)

- **Interface redesign:** Replace `sendTyping(id, chatId, duration?)` with `startTyping(id, chatId)` / `stopTyping(id, chatId)` — council members (Architect, Ergonomist) strongly recommend this as a follow-up
- **A2A separation:** Give A2A its own `closeStream()` method instead of repurposing `sendTyping(id, chatId, 0)`
- **Rate limit protection:** Add per-channel request deduping if scale requires it
