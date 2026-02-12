# Wish: Stream Plumbing — Agent Event Routing + AsyncGenerator Provider

**Status:** COMPLETE
**Slug:** `stream-plumbing`
**Created:** 2026-02-11
**Parent:** `reasoning-stream` (split 1/2)
**Depends on:** Nothing
**Blocks:** `stream-telegram`

---

## Summary

Omni's OpenClaw provider accumulates all response deltas into one batch and sends a single message at the end. The OpenClaw gateway already broadcasts real-time `agent` events (thinking, assistant, tool, lifecycle) over WebSocket — Omni just ignores them.

This wish adds the plumbing: types, client-side agent event routing, and an AsyncGenerator `triggerStream()` method on the provider that yields `StreamDelta` objects as the agent works.

---

## Scope

### IN
- `StreamDelta` discriminated union type (4 phases: thinking/content/final/error)
- `AgentEventPayload` + `AgentEventStream` types matching OpenClaw gateway protocol
- Route `agent` WS events by runId in OpenClaw client (alongside existing `chat` routing)
- Register `tool-events` capability in WS connect handshake
- `triggerStream()` AsyncGenerator method on `OpenClawAgentProvider`
- `StreamSender` interface + `canStreamResponse` capability in `@omni/channel-sdk`
- Optional `createStreamSender()` method on `ChannelPlugin`
- Optional `triggerStream?()` on `IAgentProvider` interface
- Unit tests for client routing and provider generator

### OUT
- Telegram `StreamSender` implementation (→ `stream-telegram`)
- Dispatcher streaming orchestration (→ `stream-telegram`)
- Discord/WhatsApp streaming
- Changes to the OpenClaw gateway itself
- Modifying existing `trigger()` or `chat` event accumulation path

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Discriminated union `StreamDelta` with 4 phases | Type narrowing per phase, cumulative snapshots match gateway |
| 2 | Factory `createStreamSender()` with per-phase methods | Matches union variants, sender owns state, dispatcher controls flow |
| 3 | Consume `agent` events (not `chat`) for streaming | Agent events carry thinking + assistant + tool + lifecycle |
| 4 | AsyncGenerator on provider | Pull-based, natural backpressure, clean cancellation |
| 5 | `caps: ['tool-events']` in WS connect | Enables tool rendering, one-line change |
| 6 | Separate agent accumulation map from chat map | Both fire for same runId, must coexist |

---

## Key Technical Context

### OpenClaw Gateway WebSocket Event Map

| WS Event | Stream | Data | Broadcast? |
|----------|--------|------|-----------|
| `agent` | `thinking` | `{text, delta}` | ✅ All operators |
| `agent` | `assistant` | `{text, delta}` | ✅ All operators |
| `agent` | `tool` | `{phase, name, ...}` | ⚠️ Only `tool-events` cap connections |
| `agent` | `lifecycle` | `{phase: "start"/"end"/"error"}` | ✅ All operators |
| `chat` | — | `{state: "delta"/"final", message}` | ✅ All operators |

Source: `/home/genie/research/openclaw/src/gateway/server-chat.ts`, `/home/genie/research/openclaw/src/infra/agent-events.ts`, `/home/genie/research/openclaw/src/agents/pi-embedded-subscribe.ts:544`

### Current Omni Client Limitation

`handleEventFrame()` in `client.ts` only routes `chat` events to runId callbacks. `agent` events go to generic listeners only — nobody consumes them for accumulation.

---

## Success Criteria

- [ ] `StreamDelta` type exported from `@omni/core`, TypeScript narrowing works
- [ ] `AgentEventPayload` type matches OpenClaw gateway's actual event shape
- [ ] Client routes `agent` events to runId-based callbacks (separate from `chat` routing)
- [ ] Client connects with `caps: ['tool-events']`
- [ ] `triggerStream()` yields thinking → content → final StreamDelta sequence
- [ ] Thinking → content transition preserves accumulated thinking text + duration
- [ ] Circuit breaker respected (yields error delta when open)
- [ ] Timeout produces error delta (not throw)
- [ ] Generator cleanup unregisters callbacks on normal completion, error, and `return()`
- [ ] Existing `trigger()` method and `chat` accumulation completely unchanged
- [ ] `StreamSender` interface exported from `@omni/channel-sdk`
- [ ] `canStreamResponse` capability added to `ChannelCapabilities`
- [ ] All existing tests pass, no regressions
- [ ] `bun run tsc --noEmit` passes in all affected packages

---

## Execution Groups

### Group 1: Types + Client Plumbing
**Priority:** P0

#### Task 1.1: StreamDelta + AgentEventPayload Types
**What:** Add shared types to `@omni/core`.
**Files:**
- `packages/core/src/providers/types.ts` — Add `StreamDelta` type + optional `triggerStream` on `IAgentProvider`
- `packages/core/src/providers/openclaw/types.ts` — Add `AgentEventPayload`, `AgentEventStream`
- `packages/core/src/providers/index.ts` — Export new types

**Deliverables:**
```typescript
export type StreamDelta =
  | { phase: 'thinking'; thinking: string; thinkingElapsedMs: number }
  | { phase: 'content'; content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'final';   content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'error';   error: string };

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
- [ ] Types exported from `@omni/core`
- [ ] TypeScript narrowing: `if (delta.phase === 'thinking') { delta.thinking }` compiles
- [ ] No changes to existing types

**Validation:** `cd packages/core && bun run tsc --noEmit`

---

#### Task 1.2: Client — Route Agent Events by runId
**What:** Extend `OpenClawClient.handleEventFrame()` to route `agent` events to runId-based callbacks. Add `tool-events` capability.
**Files:**
- `packages/core/src/providers/openclaw/client.ts`

**Deliverables:**
1. `routeAgentEvent(payload)` — extracts `runId`, dispatches to callback
2. `registerAgentAccumulation(runId, callback)` / `unregisterAgentAccumulation(runId)` — separate map from chat
3. `handleEventFrame()`: `if (event.event === 'agent') { this.routeAgentEvent(...) }`
4. `sendConnect()`: `caps: ['tool-events']`

**Acceptance Criteria:**
- [ ] `agent` events with matching runId dispatched to registered callbacks
- [ ] `chat` event routing unchanged
- [ ] `tool-events` cap in connect handshake
- [ ] 50-limit backpressure on agent accumulation map
- [ ] Cleanup: `unregisterAgentAccumulation` removes callback
- [ ] Existing tests pass

**Validation:** `cd packages/core && bun test && bun run tsc --noEmit`

---

### Group 2: StreamSender Interface
**Priority:** P0 (parallel with Group 1)

#### Task 2.1: StreamSender Interface + Capability
**What:** Add `StreamSender` interface and `canStreamResponse` to `@omni/channel-sdk`.
**Files:**
- `packages/channel-sdk/src/types/streaming.ts` — New file
- `packages/channel-sdk/src/types/capabilities.ts` — Add `canStreamResponse`
- `packages/channel-sdk/src/types/plugin.ts` — Add optional `createStreamSender()`
- `packages/channel-sdk/src/types/index.ts` + `packages/channel-sdk/src/index.ts` — Exports

**Deliverables:**
```typescript
export interface StreamSender {
  onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }): Promise<void>;
  onContentDelta(delta: StreamDelta & { phase: 'content' }): Promise<void>;
  onFinal(delta: StreamDelta & { phase: 'final' }): Promise<void>;
  onError(delta: StreamDelta & { phase: 'error' }): Promise<void>;
  abort(): Promise<void>;
}
```

**Acceptance Criteria:**
- [ ] `StreamSender` exported from `@omni/channel-sdk`
- [ ] `canStreamResponse` on `ChannelCapabilities` (optional, default falsy)
- [ ] `createStreamSender` optional on `ChannelPlugin`
- [ ] Existing channel implementations unaffected
- [ ] All channel-sdk tests pass

**Validation:** `cd packages/channel-sdk && bun run tsc --noEmit && bun test`

---

### Group 3: Provider triggerStream()
**Priority:** P0 (depends on Group 1)

#### Task 3.1: OpenClaw Provider triggerStream()
**What:** AsyncGenerator method that consumes `agent` events and yields `StreamDelta`.
**Files:**
- `packages/core/src/providers/openclaw/provider.ts`

**Deliverables:**
1. `async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta>`
2. Maps agent event streams → StreamDelta phases
3. Tracks thinking state (text, start time, duration)
4. Respects circuit breaker + `agentTimeoutMs`
5. Cleanup in `finally` block
6. Unit test with mocked agent events

**Acceptance Criteria:**
- [ ] Yields correct StreamDelta sequence from agent events
- [ ] Thinking → content transition preserves metadata
- [ ] Circuit breaker → error delta
- [ ] Timeout → error delta
- [ ] Generator cleanup on completion, error, `return()`
- [ ] Existing `trigger()` untouched
- [ ] Unit test passes

**Validation:** `cd packages/core && bun test --grep "triggerStream" && bun run tsc --noEmit`

---

## Dependency Graph

```
Group 1 (Types + Client) ──→ Group 3 (Provider triggerStream)
Group 2 (channel-sdk)    ──→ (used by stream-telegram wish)
```

Groups 1 and 2 can execute in parallel.
Group 3 depends on Group 1.

---

## Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | Agent event seq gaps | Phase confusion | Cumulative snapshots are self-healing, log gaps |
| 2 | Listener leak on error paths | Memory growth | finally-block cleanup + timeout auto-cleanup |
| 3 | `tool-events` cap changes gateway behavior | Unexpected events | Tools captured but not displayed (phase 1) |
| 4 | Parallel triggers same runId | Callback collision | One agent accumulation per runId (Map enforced) |
