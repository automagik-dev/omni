# Design: Reasoning Stream — Real-Time Thinking + Response Streaming via Telegram

**Status:** VALIDATED
**Slug:** `reasoning-stream`
**Date:** 2025-02-11
**Authors:** Cezão (research + user story), Omni (architecture)

---

## Problem

Omni's OpenClaw provider operates in accumulate-then-reply mode: it collects ALL deltas until `state: final`, then sends the entire response as a single message. Users see "typing..." for 10-60 seconds, then a wall of text. No feedback on what the agent is doing. The OpenClaw gateway already broadcasts `agent` events with thinking, assistant text, tool calls, and lifecycle phases over WebSocket — but Omni only consumes `chat` events and discards everything else.

---

## Solution

Add an AsyncGenerator-based streaming path (`triggerStream()`) to the OpenClaw provider that consumes `agent` WebSocket events (`stream: "thinking"`, `"assistant"`, `"tool"`, `"lifecycle"`) and yields typed `StreamDelta` discriminated unions. The agent-dispatcher checks `instance.agentStreamMode` + channel capabilities, then pipes deltas into a channel-specific `StreamSender` (new optional interface on `ChannelPlugin`). Telegram's `StreamSender` implementation uses throttled `editMessageText` with a sliding tail window to handle the 4096 char limit, collapsible `<blockquote expandable>` for thinking, and clean multi-message split on final.

---

## Scope

### IN

- **Phase 1 — Client:** Route `agent` events by runId in `OpenClawClient`. Register `tool-events` capability in WS connect handshake. Add `AgentEventPayload` type to Omni's OpenClaw types.
- **Phase 2 — Provider:** New `triggerStream()` method on `OpenClawAgentProvider` returning `AsyncGenerator<StreamDelta>`. Maps `agent` event streams to `StreamDelta` phases. Existing `trigger()` stays untouched.
- **Phase 3 — Dispatcher + Telegram:** `StreamSender` interface in `channel-sdk`. `createStreamSender()` optional method on `ChannelPlugin`. Telegram implementation with throttled edits, tail window, expandable blockquote thinking, clean final replace. Dispatcher orchestration: capability check → create sender → iterate generator → pipe deltas.
- **StreamDelta type** in `@omni/core` (shared)
- **StreamSender interface** in `@omni/channel-sdk` (shared)
- **`canStreamResponse` capability** in channel-sdk capabilities
- **Telegram `TelegramStreamSender`** in `@omni/channel-telegram`
- **Fallback:** instances without `agentStreamMode` or channels without `canEditMessage` use existing accumulate-then-reply path unchanged

### OUT

- Discord streaming (future — same pattern, different sender)
- WhatsApp streaming (WhatsApp Cloud API doesn't support message editing)
- Reasoning display configuration UI (admin dashboard controls)
- Custom thinking display preferences per user
- Tool call streaming display (tool events captured but not rendered in Phase 1 — data collection only)
- Changes to the OpenClaw gateway itself
- Modifying the existing `trigger()` method or `chat` event accumulation path

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Discriminated union for `StreamDelta`** — 4 phases: `thinking`, `content`, `final`, `error` with phase-specific fields | TypeScript narrowing gives type safety per phase. Cumulative snapshots (matching gateway behavior) eliminate append-vs-replace ambiguity. |
| 2 | **Factory pattern `createStreamSender()`** returning stateful `StreamSender` with per-phase methods | Per-method callbacks match the discriminated union. Sender owns lifecycle state (messageId, throttle timer, phase). Dispatcher stays in control of the iteration. |
| 3 | **Tail window + final replace** for 4096 char limit | Single message during stream (no visual chaos). Sliding window shows latest ~3800 chars. On final: edit msg 1 to chunk 1, send remaining as new messages via existing `splitMessage()`. Natural transition. |
| 4 | **Consume `agent` events, not `chat` events** for streaming | `agent` events carry thinking (`stream: "thinking"`), granular assistant text (`stream: "assistant"`), tool calls (`stream: "tool"`), and lifecycle (`stream: "lifecycle"`). `chat` events only have cumulative text snapshots without thinking. Using `agent` events gives us everything. |
| 5 | **AsyncGenerator on provider** (option B from prior analysis) | Pull-based: dispatcher controls iteration pace. Natural backpressure. Clean cancellation via `generator.return()`. Composable with `for await...of`. |
| 6 | **`caps: ['tool-events']` in WS connect** | Gateway only sends `stream: "tool"` events to connections with this capability. One-line change, enables future tool-call rendering. |
| 7 | **Throttle edits at 900ms** | Telegram rate limits: ~30 req/s for DMs but `editMessageText` on same message has implicit throttle. 900ms is safe margin, visually fluid. Configurable per-sender. |
| 8 | **Expandable blockquote for thinking** (`<blockquote expandable>`) | Telegram Bot API 7.10+ feature. Thinking collapses by default, tap to expand. Keeps response clean while preserving reasoning access. Cap thinking at 600 chars in blockquote. |

---

## Architecture Detail

### StreamDelta Type (`@omni/core`)

```typescript
export type StreamDelta =
  | { phase: 'thinking'; thinking: string; thinkingElapsedMs: number }
  | { phase: 'content'; content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'final';   content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'error';   error: string };
```

All text fields are **cumulative** (full text so far, not incremental diffs). This matches how the OpenClaw gateway sends assistant text and how Omni's existing accumulation works.

### AgentEventPayload Type (`@omni/core`)

```typescript
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

### StreamSender Interface (`@omni/channel-sdk`)

```typescript
export interface StreamSender {
  onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }): Promise<void>;
  onContentDelta(delta: StreamDelta & { phase: 'content' }): Promise<void>;
  onFinal(delta: StreamDelta & { phase: 'final' }): Promise<void>;
  onError(delta: StreamDelta & { phase: 'error' }): Promise<void>;
  abort(): Promise<void>;
}
```

Added to `ChannelPlugin`:
```typescript
createStreamSender?(
  instanceId: string,
  chatId: string,
  replyToMessageId?: string,
): StreamSender;
```

Added to `ChannelCapabilities`:
```typescript
canStreamResponse?: boolean;  // signals channel supports createStreamSender
```

### Event Flow

```
OpenClaw Gateway WS
    │
    ├── event: "agent", stream: "thinking"  ──→ routeAgentEvent(runId) ──→ yield {phase:'thinking'}
    ├── event: "agent", stream: "assistant" ──→ routeAgentEvent(runId) ──→ yield {phase:'content'}
    ├── event: "agent", stream: "tool"      ──→ routeAgentEvent(runId) ──→ (logged, not yielded in v1)
    ├── event: "agent", stream: "lifecycle"
    │   ├── phase: "end"   ──→ yield {phase:'final'}
    │   └── phase: "error" ──→ yield {phase:'error'}
    │
    └── event: "chat", state: "final"       ──→ existing accumulation path (unchanged)
```

### Dispatcher Flow

```
agent-dispatcher.ts:
  1. Resolve provider
  2. Check: instance.agentStreamMode && plugin.capabilities.canStreamResponse
  3. IF streaming:
       sender = plugin.createStreamSender(instanceId, chatId, replyTo)
       generator = provider.triggerStream(trigger)
       for await (delta of generator):
         switch (delta.phase):
           'thinking' → sender.onThinkingDelta(delta)
           'content'  → sender.onContentDelta(delta)
           'final'    → sender.onFinal(delta)
           'error'    → sender.onError(delta)
  4. ELSE: existing trigger() + sendResponseParts() path
```

### Telegram StreamSender — 4096 Handling

```
Content ≤ 3800 chars:
  ┌─────────────────────────────┐
  │ Response text here...█      │  ← single message, editMessageText
  └─────────────────────────────┘

Content > 3800 chars (tail window):
  ┌─────────────────────────────┐
  │ ⏳ Resposta longa            │
  │ ━━━━━━━━━━━━━━━             │
  │ ...últimos ~3600 chars...█  │  ← single message, sliding window
  └─────────────────────────────┘

On final (multi-chunk):
  ┌─────────────────────────────┐
  │ <blockquote expandable>     │
  │ 🧠 Pensou por 4.2s          │  ← edit msg 1 to chunk 1 (+ thinking)
  │ </blockquote>               │
  │ Response chunk 1...         │
  └─────────────────────────────┘
  ┌─────────────────────────────┐
  │ Response chunk 2...         │  ← new message(s) via sendTextMessage
  └─────────────────────────────┘
```

Thinking during stream:
```
  ┌─────────────────────────────┐
  │ <blockquote expandable>     │
  │ 🧠 Pensando...              │
  │ Last ~400 chars of          │  ← editMessageText, throttled 900ms
  │ thinking text...            │
  │ </blockquote>               │
  └─────────────────────────────┘
```

---

## Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | **Telegram rate limiting on editMessageText** — aggressive edits could trigger 429 | Stream freezes, error responses | 900ms throttle with exponential backoff on 429. On persistent 429: fall back to accumulate-then-reply for remainder of response. |
| 2 | **`<blockquote expandable>` requires Bot API 7.10+** — older Telegram clients may not render | Broken formatting on old clients | Feature-detect via bot API version. Fallback: plain italic text for thinking. |
| 3 | **Long-running streams (>120s) could timeout** — existing agentTimeoutMs applies | Generator aborted mid-stream | StreamSender.abort() cleans up. Partial response preserved via existing editMessageText (user sees what streamed so far). |
| 4 | **Race condition: two messages trigger two parallel streams for same chat** | Interleaved edits on same message | Guard: one active StreamSender per chatId. If stream already active, queue second message or fall back to accumulate. |
| 5 | **`agent` event ordering not guaranteed** — seq gaps possible | Thinking/content phases could interleave oddly | Use seq numbers for ordering. `server-chat.ts` already emits seq gap warnings. If gap detected, log but continue (cumulative snapshots are self-healing). |
| 6 | **Memory: agent event listener registration leak** | Unbounded listeners if cleanup fails | Cleanup in finally block of generator. Max accumulation cap (existing 50 limit). Timeout-based auto-cleanup. |

---

## Success Definition

- **Streaming works:** Telegram users see response appearing progressively via `editMessageText`, not as a single block after silence
- **Thinking visible:** Agent reasoning appears in collapsible `<blockquote expandable>` during processing, collapses on final
- **TTFD < 2s:** Time from user message to first visible delta (thinking or content) under 2 seconds
- **Throttle correct:** No Telegram 429 errors under normal operation
- **4096 handled:** Responses >4096 chars stream with tail window, finalize as properly-split multi-message
- **Backward compatible:** Instances without `agentStreamMode: true` behave exactly as before
- **Fallback graceful:** If editMessageText fails mid-stream, response degrades to accumulate-then-reply (not lost)
- **Zero gateway changes:** All changes are Omni-side only

---

## Files Changed (Estimated)

| Package | File | Change |
|---------|------|--------|
| `@omni/core` | `src/providers/openclaw/types.ts` | Add `AgentEventPayload`, `AgentEventStream` types |
| `@omni/core` | `src/providers/types.ts` | Add `StreamDelta` type |
| `@omni/core` | `src/providers/openclaw/client.ts` | Route `agent` events by runId, add `tool-events` cap |
| `@omni/core` | `src/providers/openclaw/provider.ts` | Add `triggerStream()` AsyncGenerator method |
| `@omni/channel-sdk` | `src/types/streaming.ts` | New: `StreamSender` interface |
| `@omni/channel-sdk` | `src/types/capabilities.ts` | Add `canStreamResponse` capability |
| `@omni/channel-sdk` | `src/types/plugin.ts` | Add `createStreamSender?()` to `ChannelPlugin` |
| `@omni/channel-telegram` | `src/senders/stream.ts` | New: `TelegramStreamSender` class |
| `@omni/channel-telegram` | `src/plugin.ts` | Implement `createStreamSender()` |
| `@omni/api` | `src/plugins/agent-dispatcher.ts` | Streaming dispatch path alongside existing accumulate path |

---

## Next Step

Run `/wish` to convert this design into an executable plan with task groups and acceptance criteria.
