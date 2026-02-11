# Wish: OpenClaw Provider Integration

**Status:** SHIPPED (Review 2026-02-10 — SHIP verdict, trigger_logs INSERT deferred to follow-up)
**Beads:** omni-6vk
**Slug:** `openclaw-provider-integration`
**Created:** 2026-02-10
**Council:** R1: 1/9/0 → R2: 0/10/0 → R3: 10 APPROVE Phase 1 (Phase 2 split to `session-observatory`) + Sofia PM APPROVE

---

## Summary

Build a new `openclaw` provider schema for Omni that connects to OpenClaw Gateway via WebSocket, enabling any Omni channel instance (Telegram, WhatsApp, Discord, etc.) to route messages to an OpenClaw agent with full session continuity. This replaces the need for `anthropic`/`openai` schemas — OpenClaw is a session-based agent runtime, not a stateless LLM API.

> Phase 2 (Session Observatory — heartbeat/task review, RLHF, metrics, dashboard) has been split into a separate wish: `.wishes/session-observatory/session-observatory-wish.md`

---

## Scope

### IN
- New `openclaw` schema in ProviderSchemaEnum
- `OpenClawClient` — server-side WebSocket client adapted from genie-os reference (`src/lib/openclaw/client.ts`)
- `OpenClawAgentProvider` implementing `IAgentProvider` interface (including new lifecycle methods)
- Wire into `resolveProvider()` in agent-dispatcher (NOT into legacy `createProviderClient()` factory)
- Session key mapping: Omni instance+chat → OpenClaw `agent:<agentId>:<hashedSessionId>` (HMAC'd, non-enumerable)
- Agent selection via `instance.agentId` (existing DB field) — multi-agent ready from day one
- Accumulate-then-reply mode (collect streamed deltas correlated by `runId`, return complete response)
- Two-phase timeout: send-ack (~10s) + response-accumulation (from `agentTimeout`, default 120s)
- Sender name prefixing: `[Felipe]: message` format using existing `agentPrefixSenderName` flag
- Media passthrough: leverage Omni's existing `agentWaitForMedia` + media-processor pipeline
- Trash emoji session reset via new `IAgentProvider.resetSession()` optional method
- CLI support: `omni providers create --schema openclaw`
- Observability: Prometheus metrics, trigger_logs integration, structured logging with traceId+sessionKey
- End-to-end test: Sofia's Telegram → Omni → OpenClaw agent → response

### OUT
- Real-time streaming to channel (future — additive, no breaking changes)
- Tool call rendering in channel messages
- Thinking block exposure to end users
- OpenClaw agent lifecycle management from Omni (create/delete agents)
- Implementing `anthropic`/`openai`/`a2a` schemas (separate wish)
- Changes to OpenClaw Gateway protocol
- Guardrail/middleware pipeline (doable via automations `call_agent` chaining)
- Proactive outbound from OpenClaw → Omni (works via `omni send` API already)
- Encryption of `api_key` column at rest (systemic issue, separate wish)

---

## Decisions

- **DEC-1:** New `openclaw` schema — OpenClaw is not a stateless LLM API; it has sessions, tools, streaming, memory. A dedicated schema properly models the protocol.
- **DEC-2:** WebSocket (not HTTP) — OpenClaw Gateway's primary interface is WS with connect challenge + auth handshake. HTTP endpoints lack streaming and session management.
- **DEC-3:** One WS client per provider, multiplexed — `OpenClawClient` is keyed by `provider.id` (shared across instances). `OpenClawAgentProvider` instances (keyed by `provider.id:instance.id`) are lightweight wrappers holding a ref to the shared client + instance-specific config (`agentId`, `agentTimeout`). 50 instances on 1 provider = 50 cheap provider objects + 1 WS connection.
- **DEC-4:** Session key format: `agent:<agentId>:omni-<chatId>` for MVP. Simple, readable, debuggable. HMAC-SHA256 deferred to follow-up if security review demands it (Sofia + Simplifier consensus: overengineering for MVP).
- **DEC-5:** Accumulate-then-reply — collect delta events correlated by `runId` (not just sessionKey) until `final` state. Event routing via `Map<runId, AccumulationCallback>` for O(1) lookup (not O(N) listener iteration). Track `lastDeltaReceivedAt` to distinguish "never responded" from "stalled mid-stream". Max 50 concurrent in-flight accumulations per client; beyond that, reject with backpressure error. Supports concurrent messages on same session without interleaving. Streaming can be layered later.
- **DEC-6:** Provider DB record: `schema: 'openclaw'`, `baseUrl: 'ws://host:port'`, `apiKey: '<gateway-token>'`, `schemaConfig: { defaultAgentId: 'sofia' }`. Token from DB only, never hardcoded.
- **DEC-7:** Adapt genie-os client for server-side — strip browser APIs (`navigator.*`), use `crypto.randomUUID()`, set `platform: 'omni'`, `mode: 'omni-dispatch'`, `client.id: 'omni-v2'`.
- **DEC-8:** Minimum scopes — request only what chat dispatch needs (`chat.send`, event subscription). Do NOT copy `operator.admin` from reference implementation.
- **DEC-9:** `IAgentProvider` interface extension — add optional `dispose?(): Promise<void>` and `resetSession?(sessionId: string): Promise<void>` methods for lifecycle management. Provider must also set `schema: 'openclaw'` and `mode: 'round-trip'` to satisfy existing required interface fields.
- **DEC-10:** Skip legacy factory — OpenClaw goes through `resolveProvider()` → `IAgentProvider` path only. Add throw-with-hint in `createProviderClient()` like webhook does. Do NOT implement `IAgnoClient` for OpenClaw.
- **DEC-11:** Circuit breaker — after 3 consecutive connection failures within 60s, short-circuit `trigger()` for 30s cooldown. Prevents OpenClaw outage from starving entire dispatcher concurrency pool. Counts only `trigger()`-initiated failures, NOT health ping failures.
- **DEC-12:** Schema source of truth — `PROVIDER_SCHEMAS` in `types/agent.ts` is the canonical list. `ProviderSchemaEnum` in `common.ts` is derived from it: `z.enum(PROVIDER_SCHEMAS)`. CLI's `VALID_SCHEMAS` imports from `@omni/core`. One source, zero drift.
- **DEC-13:** `DispatcherCleanup` becomes `() => Promise<void>` — cleanup must `await` provider `dispose()` calls. Use `Promise.allSettled()` to ensure one failing provider doesn't block others. Shutdown path in `index.ts` must `await globalDispatcherCleanup()`. Each `dispose()` has 3s internal timeout to prevent shutdown hangs.
- **DEC-14:** Lazy connect with background warm-up — WS connection starts on first `resolveProvider()` call but does not block the return. `trigger()` waits for connection readiness within the send-ack timeout (10s). Startup succeeds even if OpenClaw is unreachable.
- **DEC-15:** Log redaction — gateway token MUST NOT appear in any log output. Connect frames logged with `auth: { token: '[REDACTED]' }`. No raw WebSocket frame logging in production.
- **DEC-16:** Session-cleaner wiring — session-cleaner resolves providers via the dispatcher's `resolveProvider()` function (exported from agent-dispatcher module), reusing cached `IAgentProvider` instances. Does not create its own client.
- **DEC-17:** Media arrives as text — OpenClaw provider receives media content pre-processed by `prepareAgentContent()` (audio→transcription, image→description) embedded in `AgentTrigger.content.text`, not as raw file attachments.

---

## Success Criteria

### Implementation Priority (Sofia's guidance)

**47 acceptance criteria is a lot.** When implementing, prioritize in this order:
1. **Core Pipeline** (6 criteria) — the pipe works end-to-end
2. **Sofia's User Requirements** (7 criteria) — first user validation
3. **Operational + Observability** (remaining) — nice-to-have for MVP, mandatory for merge

---

### Core Pipeline
- [ ] `omni providers create --schema openclaw --base-url ws://127.0.0.1:18789 --api-key <token> --default-agent-id sofia` creates provider successfully
- [ ] `omni providers test <id>` connects to OpenClaw gateway via WS and reports healthy
- [ ] Sofia's `sofia-telegram` instance with `agentProviderId` routes incoming Telegram messages to her OpenClaw agent
- [ ] Agent responds with full text, delivered back to Telegram user
- [ ] WebSocket reconnects automatically on disconnect with exponential backoff
- [ ] `make check` passes (typecheck + lint + tests)

### Sofia's User Requirements (First User Validation)
- [ ] **Session per person**: same user gets same conversation context across messages
- [ ] **Sender name visible**: Messages arrive at OpenClaw prefixed `[Felipe]: text` when `agentPrefixSenderName` is true
- [ ] **Media works end-to-end**: Audio → transcription → OpenClaw; Image → description → OpenClaw
- [ ] **Trash emoji reset**: User sends trash emoji → OpenClaw session cleared via `resetSession()`
- [ ] **Multi-agent ready**: Different instances can use different `agentId` values on the same provider
- [ ] **Latency acceptable**: Message → response roundtrip < 30s for typical text replies
- [ ] **Omni overhead < 500ms**: Time from Telegram message received to OpenClaw `chat.send` dispatched, and from final delta received to Telegram response sent, each < 500ms (Sofia's observation — the 30s budget is for OpenClaw processing, not Omni plumbing)

### Operational Requirements (Council-mandated)
- [ ] **WS client shared per provider**: 10 instances on same provider = 1 WS connection
- [ ] **Graceful shutdown**: `DispatcherCleanup` (now async) calls `dispose()` on all cached providers via `Promise.allSettled()`; each dispose has 3s internal timeout
- [ ] **Circuit breaker**: 3 consecutive trigger failures → 30s cooldown, user gets degradation message. Circuit breaker state observable via Prometheus gauge + WARN/INFO on state transitions
- [ ] **ws:// warning**: Log WARN when connecting over unencrypted WS to non-localhost
- [ ] **Session keys non-enumerable**: Simple `agent:<agentId>:omni-<chatId>` format for MVP. HMAC deferred to follow-up.
- [ ] **Reconnect log escalation**: WARN→INFO→DEBUG, periodic WARN every 10th attempt, `reconnectAttempt` count in log context
- [ ] **Max message length**: 100KB cap before dispatch to OpenClaw (reject with error, log context)
- [ ] **Lazy connection**: WS connects on first `resolveProvider()`, does not block startup
- [ ] **Log redaction**: Gateway token never appears in logs, connect frame auth redacted
- [ ] **agentId validation**: Must match `/^[a-zA-Z0-9_-]+$/` before session key construction
- [ ] **Provider deactivation guard**: `resolveProvider()` checks `provider.isActive` and tears down clientPool entry when inactive

### Observability Requirements (Council-mandated)
- [ ] **Correlation Rosetta Stone**: Log `{traceId, wsRequestId, runId, sessionKey, agentId, instanceId}` at trigger entry
- [ ] **Prometheus metrics** (concrete definitions):
  - `omni_openclaw_ws_state` gauge `{provider_id}` — 0=disconnected, 1=connecting, 2=connected
  - `omni_openclaw_trigger_duration_seconds` histogram `{provider_id, status}` — buckets: `[1, 5, 10, 30, 60, 120, 180]`
  - `omni_openclaw_trigger_errors_total` counter `{provider_id, error_type}` — TIMEOUT, WS_ERROR, CIRCUIT_OPEN, ACCUMULATION_CAP
  - `omni_openclaw_reconnects_total` counter `{provider_id}`
  - `omni_openclaw_time_to_first_delta_seconds` histogram `{provider_id}` — buckets: `[0.5, 1, 2, 5, 10, 30]`
  - `omni_openclaw_circuit_breaker_state` gauge `{provider_id}` — 0=closed, 1=open
  - Helper functions: `recordOpenClawTrigger()`, `recordOpenClawTTFD()` consistent with existing patterns in metrics module
- [ ] **trigger_logs write logic** (NEW — no existing write code): Implement generic trigger_logs INSERT in dispatcher for ALL providers, populating `traceId, instanceId, providerId, eventType, triggerType, channelType, chatId, senderId, firedAt, respondedAt, responded, durationMs, error, metadata`
- [ ] **time-to-first-delta**: Elapsed from `chat.send` frame dispatch to first `ChatEvent` with `state: 'delta'` and matching `runId`. Emitted as histogram AND logged at DEBUG with `{traceId, runId, ttfdMs}`
- [ ] **Two-phase timeout**: send-ack timeout (10s) + accumulation timeout (from `agentTimeout`)
- [ ] **Dead-response detection**: `chat.send` acknowledged but no matching events → log warning with `{traceId, runId, sessionKey, agentId, ackReceivedAt}`
- [ ] **`lastDeltaReceivedAt` tracking**: Distinguish "never responded" from "stalled mid-stream" in timeout logs — include `deltasReceived`, `lastDeltaReceivedAt`, `accumulatedBytes` in timeout warning
- [ ] **sessionKey in all log lines** from OpenClawClient and OpenClawAgentProvider
- [ ] **User-facing timeout message**: "The assistant is taking longer than expected. Please try again in a moment."

---

## Assumptions

- **ASM-1:** OpenClaw Gateway is reachable from Omni API server via WebSocket (same host or network)
- **ASM-2:** Gateway auth token grants sufficient permissions for `chat.send` and event subscription
- **ASM-3:** `chat.send` with `sessionKey` auto-creates sessions in OpenClaw (NEEDS VERIFICATION before forge)
- **ASM-4:** The existing `IAgentProvider` interface (with optional `dispose`/`resetSession`) is sufficient
- **ASM-5:** `ChatEvent` frames include `runId` for correlation with `chat.send` responses (NEEDS VERIFICATION)

## Risks

- **RISK-1:** WebSocket connection stability — Mitigation: exponential backoff with jitter, circuit breaker, health ping (30s interval)
- **RISK-2:** Agent timeout (tool use, thinking) — Mitigation: two-phase timeout, user-facing degradation message
- **RISK-3:** Session key collision — Mitigation: HMAC'd keys with instance-specific secret component
- **RISK-4:** Rate limits via shared OpenClaw — Mitigation: existing dispatcher rate limiter + OpenClaw queuing
- **RISK-5:** Plaintext WebSocket — Mitigation: warn on `ws://` for non-localhost, document `wss://` for production
- **RISK-6:** Overprivileged gateway token — Mitigation: minimum scopes, token from DB only, audit logging
- **RISK-7:** Dispatcher concurrency starvation — Mitigation: circuit breaker prevents 5/5 slots consumed by dead provider

---

## Execution Groups

### Group 0: Protocol Verification Spike (BLOCKER B-2)

**Goal:** Verify critical assumptions about OpenClaw Gateway protocol before building. 30-minute spike.

**Deliverables:**
- Connect to OpenClaw gateway via WS, complete handshake
- Verify ASM-3: `chat.send` with a new `sessionKey` auto-creates the session (no explicit session creation needed)
- Verify ASM-5: `ChatEvent` frames include `runId` that correlates with `chat.send` response
- Verify session key format works: `agent:sofia:omni-test-session`
- Document actual protocol behavior in `docs/research/openclaw-protocol-verification.md`

**Acceptance Criteria:**
- [ ] ASM-3 confirmed or refuted (with evidence)
- [ ] ASM-5 confirmed or refuted (with evidence)
- [ ] Session key format documented
- [ ] If either assumption is wrong, document the alternative approach

**Validation:** `cat docs/research/openclaw-protocol-verification.md` (must exist with findings)

---

### Group A: OpenClaw Client + Provider (merged per Simplifier)

**Goal:** Build the WebSocket client and `IAgentProvider` implementation as a single unit.

**Packages:** core

**Deliverables:**
- `packages/core/src/providers/openclaw/client.ts` — Server-side WS client: connect challenge, auth handshake (minimum scopes), request/response correlation, event streaming, auto-reconnect with backoff, health ping (30s), log escalation
- `packages/core/src/providers/openclaw/types.ts` — Protocol types: `ReqFrame`, `ResFrame`, `EventFrame`, `ConnectParams`, `HelloPayload`, `ChatSendParams`, `ChatSendResult`, `ChatEvent`, `ChatEventState`, `ChatMessage`, `ContentBlock`, `ConnectionState` (skip unused: `Agent`, `Model`, `Session`, `ChatHistoryParams`)
- `packages/core/src/providers/openclaw/provider.ts` — `OpenClawAgentProvider implements IAgentProvider`:
  - `trigger()`: send `chat.send`, accumulate deltas by `runId`, return `AgentTriggerResult`
  - `dispose()`: close WS cleanly, reject pending, cancel reconnect
  - `resetSession()`: clear OpenClaw session
  - `checkHealth()`: WS connection state
  - Session key mapping: `agent:<agentId>:omni-<chatId>` (simple for MVP)
  - Two-phase timeout (send-ack + accumulation)
  - Circuit breaker (3 failures → 30s cooldown)
  - 1MB accumulation cap
  - Max 100KB message length validation
  - Sender name prefix support
  - ws:// warning for non-localhost
- `packages/core/src/providers/openclaw/index.ts` — Barrel exports
- One test file covering both client and provider

**Acceptance Criteria:**
- [ ] Client connects to OpenClaw gateway and completes auth handshake with minimum scopes
- [ ] `request()` sends frames and resolves responses via correlation ID
- [ ] Event routing: O(1) `runId`-based lookup via `Map<runId, AccumulationCallback>`, not O(N) listener iteration
- [ ] Event listener receives `chat.event` frames; accumulation correlates by `runId`
- [ ] Auto-reconnect: 800ms → 15s max, log escalation (WARN→INFO→DEBUG→periodic WARN), `reconnectAttempt` in log context
- [ ] Health ping: 30s interval, 5s pong timeout, reconnect on stale. Health ping failures NOT counted by circuit breaker
- [ ] `dispose()` closes WS, flushes pending with error, cancels reconnect timer. Internal 3s timeout. Logs `{providerId, activeConnections, pendingRequests}`
- [ ] `resetSession(sessionKey)` clears OpenClaw session state
- [ ] `trigger()` returns accumulated response with `{durationMs, runId, providerId, lastDeltaReceivedAt}`
- [ ] Session keys use simple `agent:<agentId>:omni-<chatId>` format. `agentId` validated against `/^[a-zA-Z0-9_-]+$/`
- [ ] Two-phase timeout: send-ack (10s) + accumulation (configurable, default 120s)
- [ ] Circuit breaker: 3 consecutive trigger failures → 30s short-circuit. Logs WARN on open, INFO on close
- [ ] 1MB accumulation cap per-runId, 100KB message length cap. Max 50 concurrent in-flight accumulations per client
- [ ] Logs `{traceId, wsRequestId, runId, sessionKey, agentId}` at every significant lifecycle point
- [ ] Gateway token NEVER in logs — connect frame logged with `auth: { token: '[REDACTED]' }`
- [ ] ws:// warning for non-localhost URLs
- [ ] `lastDeltaReceivedAt` tracked in accumulator for partial-response diagnostics
- [ ] Scopes test: `expect(connectParams.scopes).not.toContain('operator.admin')`

**Validation:** `bun test packages/core/src/providers/openclaw/`

**Files:**
```
packages/core/src/providers/openclaw/client.ts      (NEW)
packages/core/src/providers/openclaw/types.ts       (NEW)
packages/core/src/providers/openclaw/provider.ts    (NEW)
packages/core/src/providers/openclaw/index.ts       (NEW)
packages/core/src/providers/openclaw/__tests__/openclaw.test.ts  (NEW)
```

---

### Group B: Schema Registration, Interface Extension & Dispatcher Wiring (includes BLOCKER B-1)

**Goal:** Extend `IAgentProvider` with lifecycle methods, reconcile schema sources of truth, wire OpenClaw into the dispatcher with proper cleanup. **CRITICAL: Refactor `processAgentResponse` to use `IAgentProvider.trigger()` first, fallback to `agentRunner.run()` for legacy schemas.** Without this, text messages bypass the entire provider path — only reactions use `resolveProvider()` today.

**Packages:** core, api

**Deliverables:**
- **🔴 BLOCKER B-1:** Refactor `processAgentResponse()` in agent-dispatcher.ts to try `IAgentProvider.trigger()` first, then fallback to `agentRunner.run()` for instances without a resolved provider (pattern: same as `processReactionTrigger` already does at lines 925-977)
- Reconcile `ProviderSchemaEnum` (Zod) and `PROVIDER_SCHEMAS` (TypeScript const) — derive Zod enum from const: `z.enum(PROVIDER_SCHEMAS)`. Add `'openclaw'` and `'webhook'` to both
- Add optional `dispose?()` and `resetSession?()` to `IAgentProvider` interface
- Add `'openclaw'` to schema enum/const
- Add `OpenClawConfig` interface to `types/agent.ts`
- Add throw-with-hint `case 'openclaw':` in `createProviderClient()` factory (like webhook)
- Update `isProviderSchemaSupported()` and `getSupportedProviderSchemas()`
- Add `case 'openclaw':` to `resolveProvider()` in agent-dispatcher
- Implement WS client pool: `Map<providerId, OpenClawClient>` separate from `providerCache`
- Change `DispatcherCleanup` type to `() => Promise<void>`. Update `index.ts` shutdown to `await globalDispatcherCleanup()`. Use `Promise.allSettled()` for dispose calls
- Export `resolveProvider()` from agent-dispatcher for session-cleaner reuse
- Update session-cleaner: use `provider.resetSession?.()` via exported `resolveProvider()`, not hardcoded schema check, not creating its own client
- Export from `packages/core/src/providers/index.ts`
- Add Prometheus metrics registration with concrete definitions (see Observability Requirements)
- Add metric helper functions: `recordOpenClawTrigger()`, `recordOpenClawTTFD()` consistent with existing `recordEventProcessed` etc.
- Implement generic trigger_logs INSERT in dispatcher (all providers, not OpenClaw-specific) — this is NEW write logic, the table exists but has never been populated

**Acceptance Criteria:**
- [ ] **🔴 BLOCKER B-1:** `processAgentResponse()` tries `IAgentProvider.trigger()` first, falls back to `agentRunner.run()` for legacy
- [ ] `ProviderSchemaEnum` derived from `PROVIDER_SCHEMAS`: `z.enum(PROVIDER_SCHEMAS)` — single source
- [ ] `IAgentProvider` has optional `dispose?()` and `resetSession?()` — backwards compatible
- [ ] `resolveProvider()` creates `OpenClawAgentProvider` for openclaw schema
- [ ] Client pool: multiple instances on same provider share one `OpenClawClient`
- [ ] `DispatcherCleanup` is `() => Promise<void>`, uses `Promise.allSettled()`, shutdown path awaits it
- [ ] Session-cleaner uses exported `resolveProvider()` + `provider.resetSession?.()` — no schema-specific branching, no own client creation
- [ ] trigger_logs generic INSERT wired for all providers (not just OpenClaw)
- [ ] Prometheus metrics registered with correct names, labels, and bucket ranges per spec
- [ ] Metric helpers `recordOpenClawTrigger()` and `recordOpenClawTTFD()` follow existing patterns
- [ ] `make typecheck && make lint` pass
- [ ] Existing agnoos + webhook providers unaffected (backwards compatible)

**Validation:** `make check`

**Files:**
```
packages/core/src/types/agent.ts                    (MODIFY — schema enum, OpenClawConfig)
packages/core/src/schemas/common.ts                 (MODIFY — derive ProviderSchemaEnum from PROVIDER_SCHEMAS)
packages/core/src/providers/types.ts                (MODIFY — dispose, resetSession on IAgentProvider)
packages/core/src/providers/factory.ts              (MODIFY — throw-with-hint, supported schemas)
packages/core/src/providers/index.ts                (MODIFY — exports)
packages/core/src/metrics/index.ts                  (MODIFY — OpenClaw metrics with concrete definitions + helpers)
packages/api/src/plugins/agent-dispatcher.ts        (MODIFY — processAgentResponse refactor, resolveProvider export, clientPool, async cleanup)
packages/api/src/plugins/session-cleaner.ts         (MODIFY — generic resetSession via resolveProvider)
packages/api/src/services/agent-runner.ts           (MODIFY — isProviderSchemaSupported)
packages/api/src/index.ts                           (MODIFY — await async DispatcherCleanup)
```

---

### Group C: CLI + End-to-End Integration

**Goal:** CLI commands for creating/testing OpenClaw providers, end-to-end validation with Sofia's Telegram instance.

**Packages:** cli

**Deliverables:**
- Fix CLI `VALID_SCHEMAS` — import from `@omni/core` or sync with `PROVIDER_SCHEMAS`
- Add `--default-agent-id` flag to `providers create` (or generic `--schema-config`)
- Add WS health check in `providers test` for openclaw schema (connect + auth handshake)
- URL scheme validation: reject non-ws/wss URLs for openclaw schema
- Contextual error messages for 5 WS failure modes:
  - Wrong URL scheme → "OpenClaw requires ws:// or wss://"
  - Connection refused → "Cannot connect to gateway. Is it running?"
  - Auth failed → "Gateway rejected the API key. Verify token."
  - Agent not found → "Agent '<id>' not found. Available: ..."
  - Timeout → "Connection timed out after 30s"
- Guided next steps after provider creation: print the `instances update` command
- End-to-end test: create provider, test connectivity, configure instance, send message, verify response

**Acceptance Criteria:**
- [ ] `omni providers create --schema openclaw --base-url ws://... --api-key <token> --default-agent-id sofia` succeeds
- [ ] `omni providers test <id>` performs WS handshake and reports healthy/unhealthy with latency
- [ ] URL scheme validation rejects `http://` with helpful error
- [ ] CLI `VALID_SCHEMAS` derived from or synced with `@omni/core`
- [ ] After creation, CLI prints next steps: "Assign to instance with: omni instances update ..."
- [ ] `omni instances update <id> --agent-provider-id <pid> --agent-id sofia` configures routing
- [ ] Send Telegram message → receive agent response
- [ ] Session persists across multiple messages (same user, same conversation context)
- [ ] `make typecheck && make lint` pass

**Validation:**
```bash
make cli-build
omni providers create --name sofia-openclaw --schema openclaw --base-url ws://127.0.0.1:18789 --api-key <token> --default-agent-id sofia
omni providers test <provider-id>
omni instances update <sofia-instance-id> --agent-provider-id <provider-id> --agent-id sofia
# Send Telegram message, verify response
make check
```

**Files:**
```
packages/cli/src/commands/providers.ts              (MODIFY — VALID_SCHEMAS, --default-agent-id, WS test, error messages)
```

---

## Council Review Results

### Round 3: 10 APPROVE Phase 1

All 10 council members approve Phase 1 after R2 modifications + Sofia's 3 observations. Key affirmations:
- Deployer: "Zero deployment friction. Clean rollback. Ship it."
- Sentinel: "DEC-4 session key simplification acceptable for MVP."
- Operator: "Phase 1 touches zero database tables."

**New R3 findings incorporated:**
- 4th schema source of truth: `providerSchemas` const at schema.ts line 225 — added to DEC-12 scope
- chatId safety validation: colons/slashes could break session key format — added `agentId` regex + chatId sanitization
- Phase 2 unanimously split to separate wish

### Previous Rounds: 0 APPROVE / 10 MODIFY → Revised

All council findings have been incorporated. Additionally, Sofia (PM/first user) flagged 3 gaps the council missed:

| Sofia's Gap | Resolution |
|-------------|------------|
| Proactive outbound (digests, alerts, 1:1) | OUT of scope — already works via `omni send` API. No provider change needed. |
| Media end-to-end verification | Added explicit test: audio→transcription→OpenClaw + image→description→OpenClaw in Group C validation |
| Session key format undefined | DEC-4 simplified to `agent:<agentId>:omni-<chatId>` for MVP per Sofia + Simplifier consensus. HMAC deferred. |

All council findings have been incorporated into this revision:

| Finding | Source | Resolution |
|---------|--------|------------|
| **ROUND 2 BLOCKERS** | | |
| `processAgentResponse` bypasses IAgentProvider | Questioner R2, Architect R2 | BLOCKER B-1 in Group B |
| Protocol assumptions unverified (ASM-3, ASM-5) | Questioner R2, Architect R2 | Group 0: Protocol Verification Spike |
| **ROUND 2 MUST-FIX** | | |
| `DispatcherCleanup` sync→async | Benchmarker R2, Deployer R2, Tracer R2, Operator R2 | DEC-13: `Promise<void>` + `allSettled` + 3s timeout |
| Schema source of truth unspecified | Architect R2, Deployer R2, Ergonomist R2 | DEC-12: derive Zod from PROVIDER_SCHEMAS |
| Session-cleaner provider resolution | Benchmarker R2, Ergonomist R2, Operator R2 | DEC-16: exported `resolveProvider()` |
| trigger_logs phantom table | Tracer R2, Measurer R2 | Group B: generic INSERT, not "populate" |
| Prometheus metrics undefined | Measurer R2 | Observability: concrete metric table |
| time-to-first-delta undefined | Measurer R2 | Observability: precise definition |
| HMAC instanceSecret underspecified | Sentinel R2 | DEC-4: `instanceSalt` via `crypto.randomBytes(32)` |
| Log redaction for gateway tokens | Sentinel R2 | DEC-15: `[REDACTED]` in connect frame |
| Connection strategy (lazy vs eager) | Operator R2 | DEC-14: lazy with background warm-up |
| **ROUND 2 ADDITIVE** | | |
| O(1) runId event routing | Benchmarker R2 | DEC-5: `Map<runId, callback>` |
| `lastDeltaReceivedAt` in accumulator | Tracer R2 | Group A criteria + observability |
| Backpressure: max 50 concurrent accumulations | Benchmarker R2 | DEC-5 + Group A criteria |
| Circuit breaker state gauge | Tracer R2, Measurer R2 | Prometheus metrics table |
| Health ping vs circuit breaker interaction | Benchmarker R2 | DEC-11: trigger failures only |
| `agentId` input validation | Sentinel R2 | DEC-4: regex validation |
| `Promise.allSettled()` for dispose | Sentinel R2 | DEC-13 |
| `dispose()` internal timeout | Operator R2 | DEC-13: 3s timeout |
| Provider deactivation guard | Operator R2 | Operational requirements |
| Metric helper functions | Measurer R2 | Group B deliverable |
| `reconnectAttempt` in log context | Tracer R2 | Group A criteria |
| Provider instance is lightweight wrapper | Architect R2 | DEC-3 clarification |
| Media arrives as text | Architect R2 | DEC-17 |
| Scopes test assertion | Sentinel R2 | Group A criteria |
| **ROUND 1 (previously incorporated)** | | |
| Merge Groups A+B | Simplifier | Done — 3 groups |
| Skip legacy factory | Questioner, Simplifier | DEC-10: throw-with-hint only |
| `dispose()` + `resetSession()` on IAgentProvider | Architect, Questioner, Operator | DEC-9: optional methods |
| WS client pool separate from provider cache | Architect, Benchmarker, Operator | DEC-3: client keyed by providerId |
| Reconcile schema sources of truth | Architect, Ergonomist | DEC-12 |
| `runId` event correlation | Questioner, Benchmarker | DEC-5: correlate by runId |
| HMAC session keys | Sentinel | DEC-4: non-enumerable |
| Minimum scopes | Sentinel | DEC-8: chat-only, not admin |
| ws:// warning | Sentinel | RISK-5 + Group A criteria |
| Circuit breaker | Operator | DEC-11 + Group A criteria |
| Graceful shutdown wiring | Operator, Architect | DEC-13 |
| Reconnect log escalation | Operator | Group A criteria |
| Two-phase timeout | Tracer | Group A criteria |
| Correlation Rosetta Stone log | Tracer | Observability requirements |
| Prometheus metrics | Measurer | Group B deliverable |
| trigger_logs integration | Measurer | Observability requirements |
| Time-to-first-delta | Measurer | Observability requirements |
| Dead-response detection | Tracer | Observability requirements |
| CLI schema sync | Ergonomist | Group C deliverable |
| `--default-agent-id` flag | Ergonomist | Group C deliverable |
| Error messages for WS failures | Ergonomist | Group C deliverable |
| Max message length | Sentinel | Group A criteria (100KB) |
| 1MB accumulation cap | Benchmarker | Group A criteria |
| Health ping | Benchmarker, Operator | Group A criteria (30s) |
| User-facing timeout message | Measurer, Operator | Observability requirements |

### Sofia PM Review: APPROVE (with 3 observations → incorporated)

| # | Observation | Resolution |
|---|-------------|------------|
| 1 | HMAC session keys = overengineering for MVP | DEC-4 simplified to `agent:<agentId>:omni-<chatId>`. HMAC deferred. |
| 2 | 47 acceptance criteria is too many for implementor | Added "Implementation Priority" section: Core Pipeline → Sofia's Requirements → Operational/Observability |
| 3 | Missing Omni overhead latency criteria | Added: "Omni overhead < 500ms" (Telegram→dispatch and delta→response, each < 500ms) |

### Deferred (tracked as follow-ups, not blocking)
- Encrypt `api_key` column at rest (systemic, all providers)
- `tokenRotatedAt` tracking on provider records
- Rotate hardcoded genie-os token (separate repo)
- Cache invalidation when provider config changes via API (+ `rotateProvider()` for token rotation)
- `omni instances sessions` CLI command for session debugging
- Per-provider concurrency limit (if shared `concurrency: 5` becomes a bottleneck with slow agents)
- i18n for user-facing session reset messages (currently hardcoded Portuguese)
- `runId` indexed column on trigger_logs table (currently in metadata JSONB)

---

## Phase 2: Split to Separate Wish

> Phase 2 (Session Observatory — heartbeat/task review, RLHF, metrics, dashboard, user management) was unanimously recommended for split by Council R3 (10/10).
>
> See: `.wishes/session-observatory/session-observatory-wish.md` (DRAFT, 16 must-fix items from council)

---

## Files to Create/Modify

```
# New files (6)
packages/core/src/providers/openclaw/client.ts
packages/core/src/providers/openclaw/types.ts
packages/core/src/providers/openclaw/provider.ts
packages/core/src/providers/openclaw/index.ts
packages/core/src/providers/openclaw/__tests__/openclaw.test.ts
docs/research/openclaw-protocol-verification.md     (Group 0 output)

# Modified files (11)
packages/core/src/types/agent.ts                    (PROVIDER_SCHEMAS, OpenClawConfig)
packages/core/src/schemas/common.ts                 (derive ProviderSchemaEnum from PROVIDER_SCHEMAS)
packages/core/src/providers/types.ts                (IAgentProvider: dispose, resetSession)
packages/core/src/providers/factory.ts              (throw-with-hint, supported schemas)
packages/core/src/providers/index.ts                (exports)
packages/core/src/metrics/index.ts                  (OpenClaw Prometheus metrics + helpers)
packages/api/src/plugins/agent-dispatcher.ts        (processAgentResponse refactor, resolveProvider export, clientPool, async cleanup, trigger_logs)
packages/api/src/plugins/session-cleaner.ts         (generic resetSession via resolveProvider)
packages/api/src/services/agent-runner.ts           (isProviderSchemaSupported)
packages/api/src/index.ts                           (await async DispatcherCleanup)
packages/cli/src/commands/providers.ts              (VALID_SCHEMAS from @omni/core, flags, WS test, errors)
```

---

## Review Verdict

**Verdict:** SHIP
**Date:** 2026-02-10
**Branch:** `feat/openclaw-provider` (3 commits, 22 files, +2638/-113)
**Evidence:** `make check` — 949 pass, 33 skip, 0 fail, 14/14 typecheck

### Acceptance Criteria

| Category | Criteria | PASS | FAIL | E2E-ONLY |
|----------|----------|------|------|----------|
| Core Pipeline (6) | Provider create, test, routing, response, reconnect, make check | 4 | 0 | 2 |
| Sofia's Requirements (7) | Session, sender name, media, trash reset, multi-agent, latency | 5 | 0 | 2 |
| Operational (12) | WS sharing, shutdown, circuit breaker, ws:// warn, session keys, reconnect, caps, lazy, redaction, agentId validation, deactivation guard | 12 | 0 | 0 |
| Observability (16) | Correlation, Prometheus metrics, TTFD, two-phase timeout, dead-response, lastDelta, sessionKey logs, user-facing timeout | 15 | 1 | 0 |
| **Total** | | **36** | **1** | **4** |

### Gap: trigger_logs INSERT (MEDIUM — non-blocking)

The `trigger_logs` table exists in the DB schema but the generic INSERT write logic for ALL providers was not implemented. This is an observability feature, not core pipeline. The table has never been populated by any provider — adding OpenClaw-specific writes would be inconsistent.

**Resolution:** Deferred to follow-up task. Should be implemented as a cross-provider observability enhancement (all providers, not just OpenClaw).

### E2E Items (4 — require live OpenClaw gateway)

These criteria cannot be validated without a running OpenClaw gateway:
- Sofia's instance routes incoming Telegram → OpenClaw → response
- Agent responds with full text delivered back to user
- Latency < 30s for typical replies
- Session persists across multiple messages

**Resolution:** Validate during first deployment with Sofia's Telegram instance.

### Security Verification

| Check | Status | Evidence |
|-------|--------|---------|
| Token never in logs | ✅ PASS | `auth: { token: '[REDACTED]' }` in client.ts:340 |
| Minimum scopes only | ✅ PASS | Test asserts `not.toContain('operator.admin')` |
| ws:// warning | ✅ PASS | Warns on non-localhost unencrypted WS |
| No `any` types | ✅ PASS | TypeScript strict, typecheck passes |
| No secrets in code | ✅ PASS | Token from DB only (provider.apiKey) |

### Quality Advisory (non-blocking)

| Severity | Finding | Recommendation |
|----------|---------|----------------|
| MEDIUM | Stale WS connection if provider config changes | Add config hash to cache key (follow-up) |
| LOW | agent-dispatcher.ts >1700 lines | Extract ProviderFactory to @omni/core (follow-up) |
| WARNING | 8 biome warnings (complexity, non-null assertions) | Address in polish pass |

### Recommendation

**SHIP.** Core pipeline is complete and well-tested. The 1 gap (trigger_logs) is observability, not functionality, and should be implemented as a cross-provider feature. 4 E2E criteria require live gateway validation during deployment.
