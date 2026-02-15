# Wish: Streaming Reasoning Responses on Telegram

**Status:** DRAFT
**Slug:** `stream-telegram-reasoning`
**Created:** 2026-02-12
**Author:** Cezar (user story) + Omni (architecture)
**Origin:** User story at `/home/genie/workspace/cezao/user-stories/omni-telegram-reasoning-stream.md`
**Depends on:** `openclaw-provider-integration` (SHIPPED — PR #22)

---

## Summary

Replace the OpenClaw provider's accumulate-then-reply mode with progressive streaming via `editMessageText`, showing thinking in collapsible `<blockquote expandable>` and response text building live with a cursor. Users see the agent thinking and responding in real time instead of waiting 10-60s for a monolithic text block.

---

## Problem

Today's flow: `chat.send` → accumulate all deltas → `state: final` → send complete response. The user sees "typing..." for 10-60 seconds, then a wall of text. No feedback, no transparency, dead experience.

The OpenClaw gateway **already sends** thinking data in deltas (`ChatMessage.thinking`, `ContentBlock.type: 'thinking'`), but `extractText()` discards it. The infrastructure exists — it's just not wired.

---

## Decisions

- **DEC-1: AsyncGenerator over callbacks.** `IAgentProvider.triggerStream()` returns `AsyncGenerator<StreamDelta>`, not a callback-based `StreamingCallback`. This keeps the provider channel-agnostic — the dispatcher consumes the generator and routes deltas to channel-specific handlers. No tight coupling between `@omni/core` and `@omni/channel-telegram`.

- **DEC-2: UX — Blockquote expandable (Opção A).** Thinking renders in `<blockquote expandable>` (Telegram Bot API 7.10+). Separate messages (Opção B) cause notification spam. Spoilers (Opção C) hide context. No-thinking (Opção D) loses the key value. Expandable blockquote is the cleanest.

- **DEC-3: Skip short thinking.** If thinking phase < 2 seconds, don't show it — go straight to response streaming. Brief "🧠 Pensando..." that immediately collapses is visual noise.

- **DEC-4: Channel capabilities as first-class concept.** Not all channels support edit-based streaming. `BaseChannelPlugin` exposes a `capabilities` object so the dispatcher can check `streamingEdits` before choosing the streaming path. WhatsApp falls back to accumulate. Telegram and Discord get streaming.

- **DEC-5: Rate limit strategy.** Throttle `editMessageText` at ~900ms for DMs, ~3s for groups. Grammy handles 429 retries natively. Tail-window for thinking (last ~400 chars) to stay under Telegram's 4096 char limit.

- **DEC-6: Separate timeout/circuit-breaker for streaming path.** The accumulate path's TTFD, circuit breaker, and timeouts (fixed in PR #22) are for a different failure mode. Streaming needs its own: stalled-stream detection (no delta for N seconds), per-edit error tracking, graceful fallback to accumulate if edit-based rendering fails mid-flight.

- **DEC-7: Backward compatible — opt-in per instance.** `agentStreamMode` column already exists in DB schema (`boolean, default false`). Instances without it continue on accumulate. No breaking changes to `trigger()`.

- **DEC-8: HTML parse_mode for Telegram streaming.** All streamed edits use `parse_mode: 'HTML'` to support `<blockquote expandable>`, `<b>`, `<i>`, `<code>`. Markdown parse mode can't do expandable blockquotes.

---

## Assumptions

- **ASM-1:** ✅ VERIFIED — `ChatMessage.thinking` and `ContentBlock.type: 'thinking'` already in `types.ts` (lines 51-62)
- **ASM-2:** ✅ VERIFIED — `editTextMessage()` exists in `channel-telegram/src/senders/text.ts` (wraps `bot.api.editMessageText`)
- **ASM-3:** ✅ VERIFIED — `agentStreamMode` column exists in DB schema (`packages/db/src/schema.ts:454`)
- **ASM-4:** ✅ VERIFIED — `<blockquote expandable>` requires Bot API 7.10+ (Grammy supports it)
- **ASM-5:** OpenClaw gateway sends cumulative snapshots (not incremental diffs) in deltas — each delta contains the full content so far
- **ASM-6:** Telegram rate limits: ~30 msg/s for DMs, ~20 msg/min for groups; `editMessageText` on same message_id has implicit throttle

---

## Risks

- **RISK-1:** Telegram rate-limits `editMessageText` aggressively in groups. **Mitigation:** Adaptive throttle (900ms DM, 3s group), Grammy 429 retry, fallback to accumulate on repeated failures.
- **RISK-2:** Long responses exceed 4096 chars mid-stream. **Mitigation:** When approaching limit, finalize current message and start a new one for overflow. Split point at last complete paragraph/sentence.
- **RISK-3:** `<blockquote expandable>` not supported on old Telegram clients. **Mitigation:** Graceful degradation — old clients see regular blockquote. No functional breakage.
- **RISK-4:** Stalled stream (gateway sends deltas then stops without `final`). **Mitigation:** Idle timeout — if no delta for 30s after last one, treat accumulated content as final and send.

---

## Scope

### IN
1. `IAgentProvider.triggerStream?()` returning `AsyncGenerator<StreamDelta>` on the interface
2. `OpenClawAgentProvider.triggerStream()` implementation — yields thinking and content deltas from WS events
3. `extractThinking()` method alongside existing `extractText()`
4. `StreamDelta` type: `{ type: 'thinking' | 'content' | 'final' | 'error'; text: string; thinkingDurationMs?: number; metadata?: ... }`
5. `AgentTriggerResult.thinking` and `AgentTriggerResult.thinkingDurationMs` fields
6. Dispatcher streaming path: `dispatchViaStreamingProvider()` with channel capability check and per-chatId guard
7. `ChannelCapabilities` on `BaseChannelPlugin` (`streamingEdits`, `maxMessageLength`, `htmlFormatting`, `expandableBlockquote`)
8. `TelegramStreamSender` — progressive `editMessageText` with phases (thinking → transition → response → final)
9. Throttle logic: adaptive per chat type, tail-window for thinking, cursor `█` during response
10. Graceful fallback: if streaming fails mid-flight, send accumulated content as regular message
11. Wire `agentStreamMode` instance flag to dispatcher path selection
12. Tests for streaming provider, dispatcher routing, and TelegramStreamSender

### OUT
- WhatsApp streaming (no reliable `editMessage` — separate wish if Baileys adds support)
- Discord streaming (same pattern, separate wish — channel-specific sender needed)
- Tool call rendering during streaming (thinking + text only for now)
- Streaming for non-OpenClaw providers (Agno, webhook — they don't send thinking data)
- UI dashboard for streaming metrics (future — session-observatory wish)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| `core` | `providers/types.ts`, `providers/openclaw/provider.ts`, `providers/openclaw/types.ts` | New interface method, streaming impl, delta types |
| `api` | `plugins/agent-dispatcher.ts` | Streaming dispatch path, capability check |
| `channel-telegram` | New `senders/stream.ts`, update `plugin.ts` | TelegramStreamSender, capabilities |
| `channel-sdk` | `BaseChannelPlugin` | ChannelCapabilities type |
| `db` | — | No changes (`agentStreamMode` already exists) |

### System Checklist
- [ ] **Events:** No new event types (streaming is internal to provider→dispatcher→channel)
- [ ] **Database:** No schema changes
- [ ] **SDK:** No API surface changes
- [x] **CLI:** No changes needed (agentStreamMode settable via API)
- [ ] **Tests:** Provider streaming, dispatcher routing, TelegramStreamSender, fallback

---

## Execution Groups

### Group A: Core Stream Plumbing (can run in parallel with C)
**Goal:** `IAgentProvider.triggerStream` + OpenClaw streaming implementation
**Packages:** `core`
**Deliverables:**
- [ ] `StreamDelta` type in `providers/types.ts`
- [ ] `triggerStream?(): AsyncGenerator<StreamDelta>` on `IAgentProvider`
- [ ] `AgentTriggerResult` extended with `thinking?: string` and `thinkingDurationMs?: number`
- [ ] `OpenClawAgentProvider.triggerStream()` — register accumulation callback that yields deltas instead of collecting them
- [ ] `extractThinking()` method on provider
- [ ] Streaming-specific timeout: idle detection (no delta for 30s → yield final with accumulated)
- [ ] Unit tests for triggerStream (mock WS, verify delta sequence)
**Acceptance Criteria:**
- [ ] `triggerStream()` yields `thinking` deltas followed by `content` deltas followed by `final`
- [ ] Existing `trigger()` path untouched — all accumulate tests still pass
- [ ] `make typecheck && make lint` pass

### Group B: Dispatcher Streaming Orchestration (depends on A)
**Goal:** Route streaming deltas from provider to channel-specific handler
**Packages:** `api`
**Deliverables:**
- [ ] `dispatchViaStreamingProvider()` in agent-dispatcher
- [ ] Channel capability check: `plugin.capabilities?.streamingEdits === true`
- [ ] Per-chatId streaming guard (only one active stream per chat — queue or reject concurrent)
- [ ] Fallback: if `triggerStream` not available or channel doesn't support streaming → existing `trigger()` path
- [ ] Fallback: if streaming fails mid-flight → send accumulated content as regular message
- [ ] Integration with `agentStreamMode` instance flag
**Acceptance Criteria:**
- [ ] Streaming instance + Telegram → uses streaming path
- [ ] Non-streaming instance → uses accumulate path (unchanged)
- [ ] WhatsApp instance (no streaming edits) → falls back to accumulate
- [ ] `make typecheck && make lint` pass

### Group C: TelegramStreamSender (can run in parallel with A)
**Goal:** Progressive `editMessageText` rendering with thinking blockquote
**Packages:** `channel-telegram`, `channel-sdk`
**Deliverables:**
- [ ] `ChannelCapabilities` type on `BaseChannelPlugin` (streamingEdits, maxMessageLength, etc.)
- [ ] Telegram plugin exports `capabilities: { streamingEdits: true, maxMessageLength: 4096, htmlFormatting: true, expandableBlockquote: true }`
- [ ] `TelegramStreamSender` class with phases: idle → thinking → responding → done
- [ ] Thinking phase: `sendMessage` first, then `editMessageText` with `<blockquote expandable>` + tail-window (last 400 chars)
- [ ] Transition: collapse thinking, start response
- [ ] Response phase: progressive edit with cursor `█`, HTML parse_mode
- [ ] Final phase: clean message, no cursor, thinking in collapsed blockquote at top
- [ ] Adaptive throttle: 900ms DM, 3000ms group
- [ ] Message split at 4096 chars: finalize current, start new message for overflow
- [ ] Skip thinking display if thinking phase < 2s
- [ ] Graceful 429 handling: skip edit, continue accumulating, catch up on next tick
**Acceptance Criteria:**
- [ ] User sees thinking appear progressively in collapsible blockquote
- [ ] Response text builds live with cursor
- [ ] Final message is clean (no cursor, thinking collapsed)
- [ ] Rate limits respected (no 429 errors in normal operation)
- [ ] Messages > 4096 chars split correctly
- [ ] `make typecheck && make lint` pass

### Group D: Wiring + Tests (depends on A, B, C)
**Goal:** End-to-end wiring, instance config, integration tests
**Packages:** `api`, `core`
**Deliverables:**
- [ ] Integration test: mock OpenClaw WS → dispatcher → TelegramStreamSender → verify edit sequence
- [ ] Verify `agentStreamMode: false` instances are completely unaffected
- [ ] Verify accumulate path regression (all PR #22 tests still pass)
- [ ] Document enable flow: `UPDATE instances SET agent_stream_mode = true WHERE ...`
- [ ] Metrics: log TTFD, thinking duration, total stream duration, edit count per response
**Acceptance Criteria:**
- [ ] Full streaming flow works end-to-end in test
- [ ] Zero regressions on accumulate path
- [ ] `make check` passes (typecheck + lint + all tests)

---

## Notes

- This is the "real-time streaming" item that was explicitly OUT of scope in the `openclaw-provider-integration` wish (PR #22). Now it's in scope.
- The `agentStreamMode` DB column already exists — no migration needed.
- PR #23 (nightly/2026-02-12) may already contain implementation. Review against this wish for alignment.
- Future: Discord streaming sender would follow the same `ChannelCapabilities` + sender pattern. WhatsApp blocked on Baileys `editMessage` reliability.
- OpenClaw issue #1876 tracks a similar feature in the native OpenClaw Telegram plugin — we can reference their approach for edge cases.
