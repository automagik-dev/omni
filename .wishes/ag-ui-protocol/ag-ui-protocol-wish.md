# WISH: AG-UI Protocol Support

> Add AG-UI as a provider type so Omni can consume any AG-UI-compliant agent backend, capture structured agent events into the event system, and let each instance configure how AG-UI events render per channel.

**Status:** DRAFT
**Created:** 2026-02-05
**Author:** WISH Agent
**Beads:** omni-s8k
**Priority:** P1

---

## Context

### The Problem

Omni's agent integration is built around Agno's API (`IAgnoClient`). Only Agno truly works today. Adding new agent frameworks (LangGraph, PydanticAI, CrewAI, etc.) means writing custom provider clients for each. The current streaming model (`StreamChunk`) only captures text deltas - we lose all the rich structured data agents produce (tool calls, steps, reasoning, errors).

### The Solution: AG-UI Protocol

AG-UI (Agent-User Interaction Protocol) standardizes how AI agents stream responses. Instead of every framework having its own format, they all speak AG-UI: HTTP POST in, SSE events out.

**Benchmark proof (21 configs, 9 frameworks, 3 models):**
- 179/189 tests passed (95%)
- Fastest: LlamaIndex + Claude at 1429ms median
- Tool calling works across all frameworks
- Sub-second TTFB for most combinations

**What Omni gets:**
- **One client** that works with LangGraph, PydanticAI, Agno, LlamaIndex, Vercel AI, CrewAI, AG2, Google ADK
- **Structured agent events** (tool calls, steps, errors) flowing into NATS for observability
- **Per-instance rendering config** - WhatsApp gets split messages, Discord gets embeds, each instance controls what to show
- **Framework/model swapping** via config - no code changes

### Protocol Overview

- **Transport:** HTTP POST + Server-Sent Events (SSE) response
- **Client sends:** `RunAgentInput` (threadId, runId, messages, tools, state, context)
- **Server streams:** 19 typed events across 6 categories

| Category | Events |
|----------|--------|
| **Lifecycle** | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED` |
| **Text** | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` |
| **Tool Calls** | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT` |
| **State** | `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT` |
| **Activity** | `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` |
| **Special** | `RAW`, `CUSTOM` |

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | AG-UI protocol is stable enough for production (v0.0.4x, 178K+ weekly npm downloads) |
| **ASM-2** | Assumption | `@ag-ui/core` types work with Bun runtime |
| **DEC-1** | Decision | Implement AG-UI SSE client natively using Bun's `fetch` + `ReadableStream` (not `@ag-ui/client` which pulls in RxJS) |
| **DEC-2** | Decision | Use `@ag-ui/core` for type definitions only |
| **DEC-3** | Decision | AG-UI is a **new provider type** alongside Agno - existing providers continue unchanged |
| **DEC-4** | Decision | AG-UI events are captured as Omni NATS events (`agent.*` namespace) and stored in `omniEventRecords` |
| **DEC-5** | Decision | Per-instance `agentEventRendering` config controls what/how AG-UI events are shown per channel |
| **DEC-6** | Decision | Omni is a **client only** - no AG-UI server endpoint (Omni already has its own API/SDK/WebSocket for frontends) |
| **RISK-1** | Risk | `@ag-ui/core` may have Node.js deps; **mitigation:** vendor types if needed |
| **RISK-2** | Risk | SSE parsing edge cases; **mitigation:** benchmark suite validates 9 frameworks |
| **RISK-3** | Risk | Breaking changes in AG-UI v0.x; **mitigation:** abstract behind Omni's provider interface |

---

## Scope

### IN SCOPE

#### 1. AG-UI Provider Client
- New `ag-ui` provider schema in DB
- Native SSE client (Bun `fetch` + `ReadableStream`)
- `RunAgentInput` construction from Omni's message context
- Full event stream parsing (all 19 event types)
- Backward-compatible adapter so `AgentRunnerService` works with AG-UI providers
- Provider configuration: endpoint URL, auth headers, forwarded props, timeout
- Sync `run()` mode (collect stream → return complete response)
- Streaming `stream()` mode (yield `AgUIStreamEvent` objects)

#### 2. Agent Event System (NATS Integration)

Every agent event carries **full context** for identification and correlation.

**Shared base payload (all agent events inherit this):**

```typescript
interface AgentEventBase {
  /** AG-UI run ID - correlates ALL events in a single agent run */
  runId: string;
  /** Computed session ID (per_user, per_chat, per_user_per_chat) */
  sessionId: string;
  /** Omni chat ID where this run was triggered */
  chatId: string;
  /** Provider ID from DB (which AG-UI endpoint) */
  providerId: string;
  /** Agent ID configured on the instance */
  agentId: string;
}
```

**EventMetadata (standard Omni fields, set on every agent event):**

```typescript
metadata: {
  correlationId: string;       // Unique per event (auto-generated)
  instanceId: string;          // Which instance triggered this
  channelType: ChannelType;    // whatsapp-baileys, discord, etc.
  personId?: string;           // Person who sent the triggering message
  platformIdentityId?: string; // Platform-specific sender ID
  traceId: string;             // Carried from the original message.received event
  source: 'agent-responder';   // Always agent-responder
}
```

**This enables queries like:**
- All events for a run: `payload.runId = 'xxx'`
- All agent activity for a chat: `payload.chatId = 'xxx'`
- All agent activity for a session: `payload.sessionId = 'xxx'`
- All agent activity for an instance: `metadata.instanceId = 'xxx'`
- All agent activity for a person: `metadata.personId = 'xxx'`
- Trace message → agent run → tool calls: `metadata.traceId` (shared with triggering `message.received`)

**Event types and their specific payloads:**

| Omni Event | Triggered By | Extra Payload (beyond base) |
|------------|-------------|---------|
| `agent.run.started` | `RUN_STARTED` | `agentEndpoint` |
| `agent.run.completed` | `RUN_FINISHED` | `metrics: { ttfbMs, durationMs, toolCallCount, stepCount, textLength }` |
| `agent.run.error` | `RUN_ERROR` | `error: string`, `errorCode?: string` |
| `agent.tool.called` | `TOOL_CALL_START` + `ARGS` + `END` | `toolCallId`, `toolName`, `toolArgs?: string` |
| `agent.tool.result` | `TOOL_CALL_RESULT` | `toolCallId`, `toolName`, `resultContent: string` |
| `agent.step.started` | `STEP_STARTED` | `stepName: string` |
| `agent.step.completed` | `STEP_FINISHED` | `stepName: string` |

**Correlation flow (end-to-end tracing):**

```
message.received (traceId: "abc")     ← user sends "what's the weather?"
  ↓ agent-responder picks it up
agent.run.started (traceId: "abc", runId: "run-1", sessionId: "user:chat", chatId: "chat-1")
agent.tool.called (traceId: "abc", runId: "run-1", toolName: "get_weather")
agent.tool.result (traceId: "abc", runId: "run-1", toolName: "get_weather", result: "72°F")
agent.run.completed (traceId: "abc", runId: "run-1", metrics: { ttfbMs: 120, durationMs: 1450, ... })
  ↓ agent-responder sends response
message.sent (traceId: "abc")         ← "It's 72°F in San Francisco"
```

The `traceId` threads through the entire flow: original message → agent run → tool calls → response sent. The `runId` groups all events within a single agent invocation. The `sessionId` tracks conversation continuity across multiple runs.

These flow through NATS → stored in `omniEventRecords` → available via WebSocket + API.

#### 3. Per-Instance Event Rendering Config
Configurable per instance how AG-UI events translate to channel messages:

```typescript
interface AgentEventRendering {
  // How text is delivered
  streamMode: 'buffer_split' | 'disabled';
  //   buffer_split = collect full text, split on \n\n, send with delays (WhatsApp, Telegram)
  //   disabled = don't send text at all (edge case)

  // Typing indicators during streaming
  sendTypingOnStream: boolean; // default: true

  // Tool call visibility
  showToolCalls: boolean; // default: false
  toolCallTemplate?: string; // e.g. "🔍 {toolName}..." - sent as status message

  // Step visibility
  showSteps: boolean; // default: false
  stepTemplate?: string; // e.g. "📋 {stepName}"

  // Custom event handlers (future: trigger NATS events, webhooks, etc.)
  // eventTriggers?: AgentEventTrigger[];
}
```

Stored as JSONB on the `instances` table. Sensible defaults per channel type:

| Channel | Default streamMode | sendTyping | showToolCalls | showSteps |
|---------|-------------------|------------|---------------|-----------|
| WhatsApp | `buffer_split` | true | false | false |
| Discord | `buffer_split` | true | false | false |
| Telegram | `buffer_split` | true | false | false |
| All | `buffer_split` | true | false | false |

Users can override per instance to enable tool call messages, step tracking, etc.

#### 4. SDK Impact
- New `ag-ui` provider type in SDK's provider CRUD
- Agent events (`agent.*`) exposed via existing WebSocket endpoints
- Instance config gains `agentEventRendering` field
- SDK regeneration after API changes

### OUT OF SCOPE

- AG-UI server endpoint (Omni is a client, not a server)
- Protocol Buffers binary transport (SSE only)
- AG-UI state management (`STATE_SNAPSHOT`, `STATE_DELTA`) - phase 2
- CopilotKit/React frontend integration - separate wish
- Replacing existing Agno provider (continues working)
- AG-UI middleware system
- Multi-agent sub-runs (`parentRunId`) - phase 2
- `progressive_edit` stream mode (editing messages in place for Discord) - phase 2
- Reasoning event rendering - phase 2 (AG-UI reasoning events are still in draft)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] types, [x] providers, [x] events | AG-UI client, event types, agent event payloads |
| api | [x] services, [x] plugins | Agent runner update, responder event rendering |
| db | [x] schema | Provider schema enum, instance rendering config |
| sdk | [x] regenerate | New provider type, agent events |
| cli | [ ] | No changes needed |
| channel-sdk | [ ] | No interface changes |

### System Checklist

- [x] **Events**: New `agent.*` core events (7 types)
- [x] **Database**: `ag-ui` provider schema, `agentEventRendering` JSONB column
- [x] **SDK**: Regenerate after API changes
- [x] **Tests**: AG-UI client unit tests, event emission tests, integration with mock server

---

## Technical Design

### Architecture

```
  Channels              ┌──────────────────────────┐         Agent Backends
 ┌──────────┐          │      Omni Platform        │
 │ WhatsApp │──┐       │                          │     ┌──────────────────┐
 │ Discord  │──┤  NATS  │  ┌────────────────────┐  │     │ LangGraph        │
 │ Telegram │──┼───────▶│  │  Agent Responder   │  │     │ POST /agui       │
 │ Slack    │──┤       │  │                    │──AG-UI──▶ SSE stream back  │
 │ Voice    │──┘       │  │  ┌──────────────┐  │  │     └──────────────────┘
 └──────────┘          │  │  │ AG-UI Client │  │  │     ┌──────────────────┐
                        │  │  │ (Bun native) │──┼──AG-UI──▶ PydanticAI      │
                        │  │  └──────────────┘  │  │     └──────────────────┘
                        │  │         │          │  │     ┌──────────────────┐
                        │  │    AG-UI events     │──AG-UI──▶ Agno / CrewAI   │
                        │  │         │          │  │     └──────────────────┘
                        │  └─────────┼──────────┘  │
                        │            ▼             │
                        │  ┌────────────────────┐  │
                        │  │  NATS Event Bus    │  │
                        │  │  agent.run.started │  │
                        │  │  agent.tool.called │  │
                        │  │  agent.run.completed│ │
                        │  └────────┬───────────┘  │
                        │           ▼              │
                        │  ┌────────────────────┐  │
                        │  │ omniEventRecords   │  │
                        │  │ (persisted)        │  │
                        │  └────────────────────┘  │
                        │           ▼              │
                        │  ┌────────────────────┐  │
                        │  │ WebSocket / API    │  │  ──▶ SDK consumers, UI
                        │  └────────────────────┘  │
                        └──────────────────────────┘
```

### AG-UI Client (`packages/core/src/providers/ag-ui-client.ts`)

Native Bun SSE implementation:

```typescript
export class AgUIClient {
  constructor(private config: AgUIProviderConfig) {}

  /** Stream AG-UI events from endpoint */
  async *stream(input: RunAgentInput): AsyncGenerator<AgUIStreamEvent> {
    const response = await fetch(this.config.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...this.config.authHeaders,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
    });

    if (!response.ok) {
      throw new ProviderError(`AG-UI endpoint returned ${response.status}`, 'SERVER_ERROR', response.status);
    }

    yield* parseSSEStream(response.body!, mapToAgUIStreamEvent);
  }

  /** Sync run: collect full stream into a single response */
  async run(input: RunAgentInput): Promise<ProviderResponse> {
    let fullContent = '';
    let runId = '';
    let sessionId = input.threadId;

    for await (const event of this.stream(input)) {
      if (event.type === 'TEXT_MESSAGE_CONTENT' && event.content) {
        fullContent += event.content;
      }
      if (event.runId) runId = event.runId;
    }

    return { content: fullContent, runId, sessionId, status: 'completed' };
  }
}
```

### Agent Runner Integration

The `AgentRunnerService` gains a new `streamAgUI()` method that yields rich `AgUIStreamEvent` objects. The agent responder uses this when the provider is `ag-ui`, and uses the instance's `agentEventRendering` config to decide what to send to the channel:

```typescript
// In agent-responder.ts - processAgentResponse enhanced for AG-UI
async function processAgentResponseAgUI(
  agentRunner: AgentRunnerService,
  eventBus: EventBus,
  instance: Instance,
  messages: BufferedMessage[],
): Promise<void> {
  const rendering = instance.agentEventRendering ?? DEFAULT_RENDERING;
  let textBuffer = '';

  for await (const event of agentRunner.streamAgUI(context)) {
    // 1. Always emit to NATS (observability)
    await emitAgentEvent(eventBus, instance.id, event);

    // 2. Render to channel based on config
    switch (event.type) {
      case 'TEXT_MESSAGE_START':
        if (rendering.sendTypingOnStream) {
          await sendTypingPresence(channel, instanceId, chatId, 'composing');
        }
        break;

      case 'TEXT_MESSAGE_CONTENT':
        textBuffer += event.content;
        break;

      case 'TEXT_MESSAGE_END':
        // Buffer collected → split and send
        const parts = splitResponse(textBuffer, instance.enableAutoSplit ?? true);
        await sendResponseParts(channel, instanceId, chatId, parts, getSplitDelayConfig(instance));
        textBuffer = '';
        break;

      case 'TOOL_CALL_START':
        if (rendering.showToolCalls && rendering.toolCallTemplate) {
          const msg = rendering.toolCallTemplate.replace('{toolName}', event.toolCall!.name);
          await sendTextMessage(channel, instanceId, chatId, msg);
        }
        break;

      case 'STEP_STARTED':
        if (rendering.showSteps && rendering.stepTemplate) {
          const msg = rendering.stepTemplate.replace('{stepName}', event.step!.name);
          await sendTextMessage(channel, instanceId, chatId, msg);
        }
        break;

      case 'RUN_ERROR':
        await handleAgentError(event.error, channel, instanceId, chatId);
        break;
    }
  }
}
```

### Database Changes

```sql
-- Add ag-ui to provider schema enum
ALTER TYPE provider_schema ADD VALUE 'ag-ui';

-- Add rendering config to instances
ALTER TABLE instances ADD COLUMN agent_event_rendering JSONB DEFAULT NULL;
```

### New Core Events

Added to `CORE_EVENT_TYPES` and `EventPayloadMap`:

```typescript
// In packages/core/src/events/types.ts
'agent.run.started',
'agent.run.completed',
'agent.run.error',
'agent.tool.called',
'agent.tool.result',
'agent.step.started',
'agent.step.completed',
```

### Channel Event Mapping (Default)

```
AG-UI Event              → Omni Event (always)          → Channel (if configured)
─────────────────────────┬─────────────────────────────┬────────────────────────
RUN_STARTED              │ agent.run.started            │ (nothing)
TEXT_MESSAGE_START        │ (no event)                   │ sendTyping() if enabled
TEXT_MESSAGE_CONTENT      │ (buffer internally)          │ (buffering...)
TEXT_MESSAGE_END          │ (no event)                   │ sendMessage(split parts)
TOOL_CALL_START+ARGS+END │ agent.tool.called            │ status msg if showToolCalls
TOOL_CALL_RESULT         │ agent.tool.result            │ (nothing by default)
STEP_STARTED             │ agent.step.started           │ status msg if showSteps
STEP_FINISHED            │ agent.step.completed         │ (nothing)
RUN_FINISHED             │ agent.run.completed (metrics)│ (nothing)
RUN_ERROR                │ agent.run.error              │ error message
```

**Key insight:** Events ALWAYS flow to NATS regardless of rendering config. The rendering config only controls what the channel user sees.

---

## Benchmark Reference

Full results: `/home/cezar/dev/agui-benchmark/ag-ui-benchmark-results-20260205-221930.txt`

| Rank | Agent | Framework | Model | Median |
|------|-------|-----------|-------|--------|
| 1 | llamaindex-anthropic | LlamaIndex | Claude | 1429ms |
| 2 | vercel-anthropic | Vercel AI | Claude | 1456ms |
| 3 | pydantic-anthropic | PydanticAI | Claude | 1584ms |
| 4 | vercel-gemini | Vercel AI | Gemini | 1614ms |
| 5 | pydantic-gemini | PydanticAI | Gemini | 1641ms |

---

## Pre-Work: Capture Reference SSE Streams

**Goal:** Capture raw SSE output from multiple AG-UI frameworks to use as test fixtures and parser validation.

**Deliverables:**
- [ ] Run stream capture script against benchmark agents (simple, tool_time, tool_calc prompts)
- [ ] Save raw SSE per framework: `pydantic`, `langgraph`, `agno`, `vercel-ai`, `llamaindex` (at minimum)
- [ ] Store captures in `packages/core/src/providers/__fixtures__/ag-ui/` for unit tests
- [ ] Document any SSE format differences between frameworks

**Why:** Without real SSE captures, we're guessing at wire format. Different frameworks may format events differently (field ordering, optional fields, whitespace, etc.)

---

## Execution Group A: AG-UI Provider Client + Event Types

**Goal:** Omni can connect to any AG-UI endpoint and the event system captures agent activity.

**Packages:** core, db

**Deliverables:**
- [ ] Add `@ag-ui/core` dependency (types only)
- [ ] Implement SSE stream parser (`parseSSEStream`)
- [ ] Implement `AgUIClient` with `stream()` and `run()` methods
- [ ] Implement `IAgnoClient`-compatible adapter for backward compat with `AgentRunnerService`
- [ ] Add `ag-ui` to provider schema enum in DB
- [ ] Add AG-UI provider config fields to DB (endpoint URL stored in `baseUrl`, auth via `apiKey`)
- [ ] Define `AgentEventBase` shared payload interface with full context (runId, sessionId, chatId, providerId, agentId)
- [ ] Define 7 `agent.*` core event types with typed payloads extending `AgentEventBase`
- [ ] Ensure `traceId` propagation from triggering `message.received` through all agent events
- [ ] Add `agentEventRendering` JSONB column to instances table
- [ ] Unit tests: SSE parser, AG-UI client, event type definitions

**Acceptance Criteria:**
- [ ] `AgUIClient.stream()` correctly parses all 19 AG-UI event types from SSE
- [ ] `AgUIClient.run()` collects stream into a `ProviderResponse`
- [ ] Provider can be created via API with schema `ag-ui`
- [ ] `agent.*` event types are registered and have typed payloads
- [ ] `make check` passes

**Validation:**
```bash
make check
bun test packages/core/src/providers/__tests__/ag-ui-client.test.ts
bun test packages/core/src/events/__tests__/agent-events.test.ts
```

---

## Execution Group B: Agent Responder + Channel Rendering

**Goal:** Agent responder uses AG-UI streaming, emits agent events to NATS, and renders to channels based on per-instance config.

**Packages:** api, core

**Deliverables:**
- [ ] Add `streamAgUI()` to `AgentRunnerService` that yields `AgUIStreamEvent` objects
- [ ] Update agent responder to detect AG-UI providers and use `streamAgUI()`
- [ ] Emit `agent.*` events to NATS with full context (traceId from original message, sessionId, chatId, providerId)
- [ ] Propagate `traceId` from `message.received` through agent run to `message.sent`
- [ ] Implement rendering config lookup with channel-type defaults
- [ ] Typing indicators on `TEXT_MESSAGE_START` (when `sendTypingOnStream: true`)
- [ ] Tool call status messages (when `showToolCalls: true` + template)
- [ ] Step status messages (when `showSteps: true` + template)
- [ ] Metrics collection: TTFB, total duration, tool call count, emitted via `agent.run.completed`
- [ ] Existing Agno providers continue working unchanged (no regression)
- [ ] Integration tests with mock AG-UI SSE server

**Acceptance Criteria:**
- [ ] Message from WhatsApp → AG-UI agent → split response back to WhatsApp
- [ ] `agent.run.started` and `agent.run.completed` events appear in NATS with full context
- [ ] All agent events share same `runId` for correlation and same `traceId` as triggering message
- [ ] `agent.tool.called` events emitted when agent uses tools (with toolName, toolArgs)
- [ ] Events queryable by runId, sessionId, chatId, instanceId, personId
- [ ] Instance with `showToolCalls: true` sends tool status messages
- [ ] Instance with `showToolCalls: false` (default) sends nothing for tool calls
- [ ] Agno-backed instances work exactly as before
- [ ] `make check` passes

**Validation:**
```bash
make check
bun test packages/api/src/__tests__/agent-agui.test.ts
```

---

## Execution Group C: SDK + API Exposure

**Goal:** Agent events and AG-UI config are accessible via API/SDK/WebSocket.

**Packages:** api, sdk

**Deliverables:**
- [ ] Agent events (`agent.*`) flow through existing WebSocket endpoint (`/ws/events`)
- [ ] Agent events queryable via existing events API (`GET /events?type=agent.*`)
- [ ] Instance CRUD supports `agentEventRendering` field
- [ ] Provider CRUD supports `ag-ui` schema with proper validation
- [ ] Regenerate SDK (`make sdk-generate`)
- [ ] Update OpenAPI spec with new types

**Acceptance Criteria:**
- [ ] SDK can create/update AG-UI providers
- [ ] SDK can read/update instance `agentEventRendering` config
- [ ] WebSocket clients receive `agent.*` events in real-time
- [ ] `make check` && `make sdk-generate` pass

**Validation:**
```bash
make check
make sdk-generate
```

---

## Success Criteria

- [ ] Can configure an AG-UI provider pointing to any AG-UI endpoint
- [ ] Messages from any channel are routed to AG-UI agent and response comes back
- [ ] Agent activity is captured as structured events in NATS/omniEventRecords
- [ ] Per-instance rendering config controls what channel users see (tool calls, steps, etc.)
- [ ] Existing Agno provider continues working unchanged
- [ ] All quality gates pass (`make check`)

---

## Dependencies

- `@ag-ui/core` npm package (type definitions)
- Existing provider system (`packages/core/src/providers/`)
- Agent runner service (`packages/api/src/services/agent-runner.ts`)
- Agent responder plugin (`packages/api/src/plugins/agent-responder.ts`)
- Event system (`packages/core/src/events/`)

## Enables

- Framework-agnostic agent integration (LangGraph, PydanticAI, Agno, CrewAI, etc.)
- Model-agnostic routing (Claude, GPT, Gemini via config)
- Structured agent observability (tool calls, steps, metrics in event store)
- Per-instance control over what users see
- A/B testing between agent frameworks
- Cost/latency-based agent routing
- Future: event triggers (tool call → webhook, step → notification)
- Future: progressive message editing (Discord)
- Future: reasoning visibility
