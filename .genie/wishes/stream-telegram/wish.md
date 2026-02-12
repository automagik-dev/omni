# Wish: Stream Telegram — Progressive Response Rendering + Dispatcher

**Status:** READY (stream-plumbing complete)
**Slug:** `stream-telegram`
**Created:** 2026-02-11
**Parent:** `reasoning-stream` (split 2/2)
**Depends on:** `stream-plumbing`

---

## Summary

With the plumbing in place (`StreamDelta` types, client agent event routing, provider `triggerStream()`), this wish implements the user-facing streaming experience: a `TelegramStreamSender` that uses `editMessageText` for progressive rendering with thinking in collapsible blockquotes, and the dispatcher orchestration that connects the provider's AsyncGenerator to the channel's StreamSender.

---

## Scope

### IN
- `TelegramStreamSender` implementing `StreamSender` interface
- Throttled `editMessageText` for progressive content rendering (900ms)
- `<blockquote expandable>` for thinking display (Telegram Bot API 7.10+)
- Tail window for responses > 4096 chars, clean multi-message on final
- `createStreamSender()` wired in Telegram plugin
- `canStreamResponse: true` in Telegram capabilities
- Streaming dispatch path in `agent-dispatcher.ts`
- Graceful fallback to accumulate-then-reply when streaming unavailable
- Per-chatId stream guard (no parallel streams to same chat)
- End-to-end integration test

### OUT
- Discord/WhatsApp streaming (future wish, same StreamSender pattern)
- Tool call rendering in stream (captured by plumbing, not displayed yet)
- Admin UI for reasoning display preferences
- Changes to OpenClaw gateway
- Modifying existing accumulate-then-reply path

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | 900ms edit throttle | Safe for Telegram rate limits, visually fluid |
| 2 | `<blockquote expandable>` for thinking | Native Telegram 7.10+ collapse, clean UX |
| 3 | Tail window + final replace for 4096 limit | Single message during stream, clean split on final |
| 4 | Per-chatId stream guard | Prevents interleaved edits from parallel messages |
| 5 | Fallback on any streaming error | Preserves reliability of accumulate path |
| 6 | `agentStreamMode` instance flag | Opt-in per instance, zero change for existing |
| 7 | HTML parse_mode for all edits | Required for `<blockquote expandable>` |
| 8 | Skip thinking display if < 2s | Avoid visual noise for fast responses |

---

## Success Criteria

- [ ] Telegram users see response appearing progressively (not single block after silence)
- [ ] Agent thinking appears in collapsible `<blockquote expandable>` during processing
- [ ] TTFD (time-to-first-delta) < 2s from user message to first visible update
- [ ] No Telegram 429 errors under normal operation (throttle working)
- [ ] Responses > 4096 chars stream with tail window, finalize as properly-split messages
- [ ] Instances without `agentStreamMode: true` behave exactly as before
- [ ] If `editMessageText` fails mid-stream, degrades to accumulate-then-reply
- [ ] Per-chatId guard: second message during stream falls back to accumulate
- [ ] All existing tests pass, no regressions
- [ ] `make check` passes (typecheck + lint + test)

---

## Execution Groups

### Group 1: TelegramStreamSender
**Priority:** P0

#### Task 1.1: TelegramStreamSender Implementation
**What:** Implement `StreamSender` for Telegram with throttled edits, blockquote thinking, tail window.
**Files:**
- `packages/channel-telegram/src/senders/stream.ts` — New file
- `packages/channel-telegram/src/senders/index.ts` — Export
- `packages/channel-telegram/src/plugin.ts` — Implement `createStreamSender()`, add `canStreamResponse: true`
- `packages/channel-telegram/src/capabilities.ts` — Add `canStreamResponse: true`

**Deliverables:**
```typescript
class TelegramStreamSender implements StreamSender {
  // State
  private messageId: number | null = null;
  private lastEditAt = 0;
  private phase: 'idle' | 'thinking' | 'content' | 'done' = 'idle';
  private thinkingText = '';
  private thinkingStartMs = 0;
  
  // Config
  private readonly THROTTLE_MS = 900;
  private readonly MAX_STREAM_CHARS = 3800;
  private readonly MAX_THINKING_CHARS = 600;
  
  async onThinkingDelta(delta): Promise<void>  // blockquote expandable, throttled
  async onContentDelta(delta): Promise<void>   // tail window, cursor █, throttled
  async onFinal(delta): Promise<void>          // clean replace, multi-chunk split
  async onError(delta): Promise<void>          // cleanup placeholder
  async abort(): Promise<void>                 // delete placeholder if exists
}
```

Key behaviors:
1. **Thinking:** `<blockquote expandable>🧠 Pensando...\n{last 400 chars}</blockquote>` via `editMessageText` (HTML), throttled 900ms
2. **Content:** Response text + `█` cursor. If >3800 chars, tail window with `⏳ ...` header
3. **Final:** Edit msg 1 to chunk 1 (with thinking blockquote if present), send remaining chunks via `sendTextMessage()`. Use existing `splitMessage()` util
4. **Error/abort:** Delete placeholder message if exists, log error
5. **Throttle:** Skip edit if <900ms since last. On 429: exponential backoff
6. **Short thinking:** If thinking phase < 2s, skip showing it (just go to content)

**Acceptance Criteria:**
- [ ] Implements `StreamSender` interface
- [ ] Thinking in `<blockquote expandable>` (HTML parse_mode)
- [ ] Content streams via `editMessageText` with `█` cursor
- [ ] 900ms throttle enforced
- [ ] Content > 3800 chars uses tail window
- [ ] Final: msg 1 edited to chunk 1, remaining chunks sent as new messages
- [ ] Thinking capped at 600 chars in final blockquote
- [ ] 429 handled with exponential backoff
- [ ] `abort()` deletes placeholder
- [ ] `canStreamResponse: true` in Telegram capabilities
- [ ] Unit test: mock bot API → verify edit sequence

**Validation:** `cd packages/channel-telegram && bun run tsc --noEmit && bun test`

---

### Group 2: Dispatcher Streaming Orchestration
**Priority:** P0 (depends on Group 1 + stream-plumbing)

#### Task 2.1: Streaming Dispatch Path
**What:** Add streaming dispatch in `agent-dispatcher.ts`. When streaming available, use `triggerStream()` + `StreamSender` instead of `trigger()` + `sendResponseParts()`.
**Files:**
- `packages/api/src/plugins/agent-dispatcher.ts`

**Deliverables:**
1. `dispatchViaStreamingProvider()` — new function alongside `dispatchViaProvider()`
2. Capability check: `instance.agentStreamMode && plugin.capabilities?.canStreamResponse && plugin.createStreamSender && provider.triggerStream`
3. Creates `StreamSender` → gets `AsyncGenerator` → iterates → dispatches
4. `try/finally`: generator.return() + sender.abort() on error
5. Fallback: streaming error → log + fall through to accumulate
6. Per-chatId guard: `Map<string, StreamSender>`, second message falls back

**Acceptance Criteria:**
- [ ] `agentStreamMode: true` + streaming capable → streaming path
- [ ] Missing flag or capability → accumulate path (zero change)
- [ ] Each phase dispatched to correct sender method
- [ ] Error mid-stream → cleanup + fallback
- [ ] Per-chatId guard prevents parallel streams
- [ ] Typing indicators preserved
- [ ] Trigger logging works (traceId, durationMs)
- [ ] Existing `dispatchViaProvider` and `dispatchViaLegacy` untouched
- [ ] All existing tests pass

**Validation:** `cd packages/api && bun test && bun run tsc --noEmit`

---

### Group 3: Integration Testing
**Priority:** P1

#### Task 3.1: End-to-End Streaming Test
**What:** Integration test verifying full pipeline with mocked WS and bot API.
**Files:**
- `packages/api/src/plugins/__tests__/agent-dispatcher-streaming.test.ts` — New file

**Deliverables:**
1. Test: agent events → StreamDelta → Telegram edits
2. Test: thinking → content transition with metadata
3. Test: content > 4096 → tail window → multi-message final
4. Test: agentStreamMode=false → accumulate fallback
5. Test: editMessageText failure → graceful fallback
6. Test: timeout mid-stream → error + cleanup

**Acceptance Criteria:**
- [ ] Full pipeline tested
- [ ] All transition paths covered
- [ ] Fallback paths tested
- [ ] `bun test` passes

**Validation:** `bun test packages/api/src/plugins/__tests__/agent-dispatcher-streaming.test.ts && make check`

---

## Dependency Graph

```
stream-plumbing (wish 1) ──→ Group 1 (TelegramStreamSender)
                              Group 2 (Dispatcher) depends on Group 1
                              Group 3 (Integration) depends on Groups 1+2
```

---

## Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | Telegram 429 rate limits on editMessageText | Stream freezes | 900ms throttle + exponential backoff + fallback |
| 2 | `<blockquote expandable>` needs Bot API 7.10+ | Old clients see broken formatting | Fallback to plain text |
| 3 | Streams > 120s timeout | Partial response | StreamSender.abort() preserves what was shown |
| 4 | Parallel streams to same chat | Interleaved edits | Per-chatId guard, fallback |
| 5 | Grammy `editMessageText` API differences | Runtime errors | Use raw API call if needed |
