# Wish: Reasoning Stream — Real-Time Thinking + Response Streaming

**Status:** READY
**Slug:** `reasoning-stream`
**Created:** 2025-02-11
**Design:** `.genie/brainstorms/reasoning-stream/design.md`
**User Story:** `/home/genie/workspace/cezao/user-stories/omni-telegram-reasoning-stream.md`

---

## Summary

Omni's OpenClaw provider accumulates all response deltas and sends one big message at the end. Users wait 10-60s seeing "typing..." then get a wall of text. The OpenClaw gateway already broadcasts `agent` events (thinking, assistant, tool, lifecycle) over WebSocket — Omni just ignores them.

This wish adds an AsyncGenerator streaming path to the provider, a `StreamSender` interface to channel-sdk, and a Telegram implementation that uses `editMessageText` for progressive rendering with thinking in collapsible blockquotes.

---

## Scope

### IN
- Route `agent` WS events by runId in OpenClaw client (alongside existing `chat` routing)
- Register `tool-events` capability in WS connect handshake
- `StreamDelta` discriminated union type in `@omni/core`
- `AgentEventPayload` type in `@omni/core`
- `triggerStream()` AsyncGenerator method on `OpenClawAgentProvider`
- `StreamSender` interface + `canStreamResponse` capability in `@omni/channel-sdk`
- `createStreamSender()` optional method on `ChannelPlugin`
- `TelegramStreamSender` with throttled edits, tail window, expandable blockquote thinking
- Streaming dispatch path in `agent-dispatcher.ts`
- Graceful fallback to accumulate-then-reply when streaming unavailable

### OUT
- Discord/WhatsApp streaming (future wish, same pattern)
- Tool call rendering in stream (data captured but not displayed)
- Admin UI for reasoning display preferences
- Changes to the OpenClaw gateway itself
- Modifying the existing `trigger()` or `chat` event accumulation path
- Per-user thinking display preferences

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Discriminated union `StreamDelta` with 4 phases | Type narrowing per phase, cumulative snapshots match gateway |
| 2 | Factory `createStreamSender()` with per-phase methods | Matches union variants, sender owns state, dispatcher controls flow |
| 3 | Tail window + final replace for 4096 limit | Single message during stream, clean multi-message on final |
| 4 | Consume `agent` events (not `chat`) for streaming | Agent events carry thinking + assistant + tool + lifecycle |
| 5 | AsyncGenerator on provider | Pull-based, natural backpressure, clean cancellation |
| 6 | `caps: ['tool-events']` in WS connect | Enables future tool rendering, one-line change |
| 7 | 900ms edit throttle | Safe for Telegram rate limits, visually fluid |
| 8 | `<blockquote expandable>` for thinking | Native Telegram 7.10+ collapse, clean UX |

---

## Success Criteria

- [ ] Telegram users see response appearing progressively (not single block after silence)
- [ ] Agent thinking appears in collapsible `<blockquote expandable>` during processing
- [ ] TTFD (time-to-first-delta) < 2s from user message to first visible update
- [ ] No Telegram 429 errors under normal operation (throttle working)
- [ ] Responses > 4096 chars stream with tail window, finalize as properly-split messages
- [ ] Instances without `agentStreamMode: true` behave exactly as before
- [ ] If `editMessageText` fails mid-stream, degrades to accumulate-then-reply
- [ ] All existing tests pass, no regressions
- [ ] `make check` passes (typecheck + lint + test)

---

## Execution Groups

### Group 1: Types & Client Plumbing
**Priority:** P0 (foundation — everything depends on this)
**Parallel:** No (must complete before Groups 2-3)

#### Task 1.1: StreamDelta + AgentEventPayload Types
**What:** Add shared types to `@omni/core`.
**Files:**
- `packages/core/src/providers/types.ts` — Add `StreamDelta` type
- `packages/core/src/providers/openclaw/types.ts` — Add `AgentEventPayload`, `AgentEventStream` types
- `packages/core/src/providers/index.ts` — Export new types

**Deliverables:**
```typescript
// StreamDelta — discriminated union, cumulative snapshots
export type StreamDelta =
  | { phase: 'thinking'; thinking: string; thinkingElapsedMs: number }
  | { phase: 'content'; content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'final';   content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'error';   error: string };

// AgentEventPayload — mirrors OpenClaw gateway's agent event shape
export type AgentEventStream = 'lifecycle' | 'tool' | 'assistant' | 'thinking' | 'error';
export interface AgentEventPayload {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
}
```

**Acceptance Criteria:**
- [ ] `StreamDelta` type exported from `@omni/core`
- [ ] `AgentEventPayload` and `AgentEventStream` types exported from `@omni/core`
- [ ] TypeScript narrowing works: `if (delta.phase === 'thinking') { delta.thinking }` compiles
- [ ] No changes to existing types

**Validation:**
```bash
cd packages/core && bun run tsc --noEmit
# Verify exports:
bun -e "import { StreamDelta, AgentEventPayload } from './packages/core/src/providers/types'; console.log('ok')" 2>/dev/null || echo "Check export path"
```

---

#### Task 1.2: Client — Route Agent Events by runId
**What:** Extend `OpenClawClient.handleEventFrame()` to route `agent` events to runId-based callbacks (alongside existing `chat` routing). Add `tool-events` capability to connect handshake.
**Files:**
- `packages/core/src/providers/openclaw/client.ts`

**Deliverables:**
1. New `routeAgentEvent()` method that extracts `runId` from agent event payload and dispatches to registered callback
2. New `registerAgentAccumulation(runId, callback)` / `unregisterAgentAccumulation(runId)` methods (separate map from chat accumulation, since both fire for same runId)
3. `handleEventFrame()` updated: `if (event.event === 'agent' && event.payload) { this.routeAgentEvent(...) }`
4. `sendConnect()` updated: `caps: ['tool-events']` (was `caps: []`)

**Acceptance Criteria:**
- [ ] `agent` events with matching runId are dispatched to registered callbacks
- [ ] `chat` event routing unchanged (existing accumulation still works)
- [ ] `tool-events` capability registered in connect handshake
- [ ] Agent accumulation callbacks have same 50-limit backpressure as chat callbacks
- [ ] Cleanup: `unregisterAgentAccumulation` removes callback
- [ ] Existing tests pass

**Validation:**
```bash
cd packages/core && bun test
make typecheck
```

---

### Group 2: StreamSender Interface (channel-sdk)
**Priority:** P0 (needed by Group 3 and Group 4)
**Parallel:** Yes — can run alongside Group 1

#### Task 2.1: StreamSender Interface + Capability
**What:** Add `StreamSender` interface and `canStreamResponse` capability to `@omni/channel-sdk`. Add optional `createStreamSender()` to `ChannelPlugin`.
**Files:**
- `packages/channel-sdk/src/types/streaming.ts` — New file: `StreamSender` interface
- `packages/channel-sdk/src/types/capabilities.ts` — Add `canStreamResponse?: boolean`
- `packages/channel-sdk/src/types/plugin.ts` — Add `createStreamSender?()` method
- `packages/channel-sdk/src/types/index.ts` — Export new types
- `packages/channel-sdk/src/index.ts` — Re-export

**Deliverables:**
```typescript
// streaming.ts
import type { StreamDelta } from '@omni/core';

export interface StreamSender {
  onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }): Promise<void>;
  onContentDelta(delta: StreamDelta & { phase: 'content' }): Promise<void>;
  onFinal(delta: StreamDelta & { phase: 'final' }): Promise<void>;
  onError(delta: StreamDelta & { phase: 'error' }): Promise<void>;
  abort(): Promise<void>;
}

// Added to ChannelPlugin:
createStreamSender?(
  instanceId: string,
  chatId: string,
  replyToMessageId?: string,
): StreamSender;

// Added to ChannelCapabilities:
canStreamResponse?: boolean;
```

**Acceptance Criteria:**
- [ ] `StreamSender` interface exported from `@omni/channel-sdk`
- [ ] `canStreamResponse` added to `ChannelCapabilities` (optional, default undefined/false)
- [ ] `createStreamSender` added as optional method on `ChannelPlugin`
- [ ] `DEFAULT_CAPABILITIES` unchanged (canStreamResponse not set = falsy)
- [ ] Existing channel implementations unaffected (method is optional)
- [ ] All channel-sdk tests pass

**Validation:**
```bash
cd packages/channel-sdk && bun run tsc --noEmit
bun test
```

---

### Group 3: Provider — triggerStream() AsyncGenerator
**Priority:** P0
**Parallel:** No — depends on Group 1 (types + client routing)

#### Task 3.1: OpenClaw Provider triggerStream()
**What:** Add `triggerStream()` method to `OpenClawAgentProvider` that returns `AsyncGenerator<StreamDelta>`. Consumes `agent` events via client's new agent accumulation callbacks. Maps event streams to `StreamDelta` phases.
**Files:**
- `packages/core/src/providers/openclaw/provider.ts`
- `packages/core/src/providers/types.ts` — Add `triggerStream` to `IAgentProvider` interface (optional)

**Deliverables:**
1. `triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta>` on `OpenClawAgentProvider`
2. Maps:
   - `agent` + `stream: "thinking"` → `yield { phase: 'thinking', thinking: data.text, thinkingElapsedMs }`
   - `agent` + `stream: "assistant"` → `yield { phase: 'content', content: data.text, thinking?, thinkingDurationMs? }`
   - `agent` + `stream: "lifecycle"` + `phase: "end"` → `yield { phase: 'final', content, thinking?, thinkingDurationMs? }`
   - `agent` + `stream: "lifecycle"` + `phase: "error"` → `yield { phase: 'error', error }`
3. Tracks thinking state internally (accumulated thinking text, start time)
4. Respects circuit breaker (same as `trigger()`)
5. Respects `agentTimeoutMs` (timeout → yield error + return)
6. Cleanup in `finally` block: unregister agent accumulation callback
7. Optional `triggerStream?` added to `IAgentProvider` interface

**Acceptance Criteria:**
- [ ] `triggerStream()` yields `StreamDelta` objects as agent events arrive
- [ ] Thinking → content transition preserves thinking text and duration
- [ ] Circuit breaker respected (yields error delta when open)
- [ ] Timeout produces error delta (not throw)
- [ ] Generator cleanup unregisters callbacks on normal completion, error, and `return()`
- [ ] Existing `trigger()` method completely unchanged
- [ ] `IAgentProvider` interface updated with optional `triggerStream`
- [ ] Unit test: mock agent events → verify yielded StreamDelta sequence

**Validation:**
```bash
cd packages/core && bun test
make typecheck
# Manual: verify generator yields correct phases with mock events
bun test --grep "triggerStream"
```

---

### Group 4: Telegram StreamSender + Dispatcher Integration
**Priority:** P0
**Parallel:** No — depends on Groups 1, 2, 3

#### Task 4.1: TelegramStreamSender
**What:** Implement `StreamSender` for Telegram using throttled `editMessageText`, expandable blockquote for thinking, tail window for 4096 limit, and clean multi-message final.
**Files:**
- `packages/channel-telegram/src/senders/stream.ts` — New file
- `packages/channel-telegram/src/senders/index.ts` — Export
- `packages/channel-telegram/src/plugin.ts` — Implement `createStreamSender()`
- `packages/channel-telegram/src/index.ts` — Update exports if needed

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
  
  // Methods
  async onThinkingDelta(delta): Promise<void>  // blockquote expandable, throttled
  async onContentDelta(delta): Promise<void>   // tail window, cursor █, throttled
  async onFinal(delta): Promise<void>          // clean replace, multi-chunk split
  async onError(delta): Promise<void>          // cleanup placeholder
  async abort(): Promise<void>                 // delete placeholder if exists
}
```

Key behaviors:
1. **Thinking phase:** `<blockquote expandable>🧠 Pensando...\n{last 400 chars}</blockquote>` via `editMessageText`, throttled 900ms
2. **Content phase:** Response text + `█` cursor. If >3800 chars, tail window with `⏳ Resposta longa...` header
3. **Final:** Edit msg 1 to chunk 1 (with thinking blockquote if present), send remaining chunks via `sendTextMessage()`. Uses existing `splitMessage()` util
4. **Error/abort:** Delete placeholder message if it exists, log error
5. **Throttle:** Skip edit if <900ms since last edit. On Telegram 429: exponential backoff
6. **HTML parse_mode:** All edits use `parse_mode: 'HTML'` for blockquote support

**Acceptance Criteria:**
- [ ] `TelegramStreamSender` implements `StreamSender` interface
- [ ] Thinking displayed in `<blockquote expandable>` (HTML parse_mode)
- [ ] Content streams via `editMessageText` with `█` cursor
- [ ] Edits throttled at 900ms minimum interval
- [ ] Content > 3800 chars uses tail window (last ~3600 chars shown)
- [ ] Final: msg 1 edited to chunk 1, remaining chunks sent as new messages
- [ ] Final: thinking collapsed in expandable blockquote (capped at 600 chars)
- [ ] Telegram 429 caught and handled (exponential backoff, not crash)
- [ ] `abort()` deletes placeholder message
- [ ] `createStreamSender()` wired in Telegram plugin with `canStreamResponse: true`
- [ ] Unit test: mock bot API → verify edit sequence and throttling

**Validation:**
```bash
cd packages/channel-telegram && bun run tsc --noEmit
bun test
```

---

#### Task 4.2: Dispatcher Streaming Orchestration
**What:** Add streaming dispatch path in `agent-dispatcher.ts`. When `agentStreamMode` is true and channel supports streaming, use `triggerStream()` + `StreamSender` pipeline instead of `trigger()` + `sendResponseParts()`.
**Files:**
- `packages/api/src/plugins/agent-dispatcher.ts`

**Deliverables:**
1. New `dispatchViaStreamingProvider()` function (alongside existing `dispatchViaProvider()`)
2. Capability check: `instance.agentStreamMode && plugin.capabilities?.canStreamResponse && plugin.createStreamSender`
3. Creates `StreamSender` via `plugin.createStreamSender(instanceId, chatId, replyTo)`
4. Gets `AsyncGenerator` via `provider.triggerStream(trigger)`
5. Iterates generator, dispatches each delta to appropriate sender method
6. `try/finally` cleanup: generator.return() + sender.abort() on error
7. Fallback: if streaming path throws, log error and fall through to existing `dispatchViaProvider()`
8. Guard: one active stream per chatId (Map<string, StreamSender>). Second message to same chat during stream falls back to accumulate

**Acceptance Criteria:**
- [ ] `agentStreamMode: true` + `canStreamResponse` → streaming path used
- [ ] `agentStreamMode: false` or missing → existing accumulate path (zero behavior change)
- [ ] Generator iteration correctly dispatches each phase to sender
- [ ] Errors mid-stream: generator cleaned up, sender aborted, fallback to accumulate
- [ ] Per-chatId stream guard prevents parallel streams
- [ ] Typing indicator sent before stream starts (existing behavior preserved)
- [ ] Typing indicator paused after stream completes
- [ ] Trigger logging works for streaming path (traceId, durationMs, providerId)
- [ ] Existing `dispatchViaProvider` and `dispatchViaLegacy` completely unchanged
- [ ] All existing agent-dispatcher tests pass

**Validation:**
```bash
cd packages/api && bun test
bun test --grep "agent-dispatcher"
make check
```

---

### Group 5: Integration Testing
**Priority:** P1
**Parallel:** No — depends on all previous groups

#### Task 5.1: End-to-End Streaming Test
**What:** Integration test that verifies the full pipeline: mock OpenClaw WS → provider triggerStream → dispatcher → Telegram StreamSender → verify edit sequence.
**Files:**
- `packages/api/src/plugins/__tests__/agent-dispatcher-streaming.test.ts` — New file

**Deliverables:**
1. Test: agent events flow → StreamDelta sequence → Telegram edits
2. Test: thinking → content transition preserves thinking metadata
3. Test: content > 4096 chars → tail window during stream → multi-message on final
4. Test: agentStreamMode=false → falls back to accumulate (no streaming)
5. Test: editMessageText failure → graceful fallback
6. Test: timeout mid-stream → error delta → cleanup

**Acceptance Criteria:**
- [ ] Full pipeline tested with mocked WS events and mocked Telegram bot
- [ ] Thinking → content → final transition tested
- [ ] 4096 char limit handling tested (tail window + final split)
- [ ] Fallback paths tested (agentStreamMode off, edit failure, timeout)
- [ ] All tests pass with `bun test`

**Validation:**
```bash
bun test packages/api/src/plugins/__tests__/agent-dispatcher-streaming.test.ts
make check
```

---

## Dependency Graph

```
Group 1 (Types + Client)  ──→  Group 3 (Provider) ──→  Group 4 (Telegram + Dispatcher) ──→  Group 5 (Integration)
                                      ↑
Group 2 (channel-sdk)  ──────────────┘ (also needed by Group 4)
```

Groups 1 and 2 can execute in parallel.
Groups 3 and 4 are sequential.
Group 5 validates everything.

---

## Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | Telegram 429 rate limits on editMessageText | Stream freezes | 900ms throttle + exponential backoff + fallback to accumulate |
| 2 | `<blockquote expandable>` needs Bot API 7.10+ | Old clients see broken formatting | Fallback to italic text |
| 3 | Streams >120s timeout | Partial response | StreamSender.abort() preserves what was shown |
| 4 | Parallel streams to same chat | Interleaved edits | Per-chatId guard, second message falls back |
| 5 | Agent event seq gaps | Phase confusion | Cumulative snapshots are self-healing, log gaps |
| 6 | Listener leak on error paths | Memory growth | finally-block cleanup + timeout auto-cleanup |

---

## Next Step

Run `/plan-review` to validate, then `/make` to begin execution.
