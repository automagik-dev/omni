---
title: "Actor Model — Design Wish"
created: 2026-02-23
updated: 2026-02-23
tags: [architecture, actors, agents, identity, conversation, design]
status: wish
---

# Actor Model — Design Wish

> A design document for the next evolution of Omni's data model.
> Status: **wish** — this is aspirational, not yet implemented.
>
> Related: [[identity-graph|Identity Graph]], [[event-system|Event System]], [[overview|Architecture Overview]]

---

## The Problem with Today's Model

The current model makes a hard distinction between **humans** (Persons) and **bots** (config fields on Instances). This creates real limitations:

- The Omni bot that replies has no identity — it's just `message.isFromMe = true`
- You cannot ask "show me all messages sent by the Claude agent across all chats"
- You cannot treat a Claude Code session, an Agno workflow, or an external API as a channel the same way you treat WhatsApp
- Agent config lives as loose `varchar` fields on `Instance`, not as a proper entity
- There is no concept of a channel-agnostic conversation — `Chat` IS the conversation, tied forever to one channel
- There is no visibility into what an agent is *doing* within a chat — no live state, no task history

As we expand toward A2A-compatible agents and multi-channel continuity, these limitations become structural.

---

## The Four Primitives

Everything in the system reduces to four concepts:

```
Actor        → WHO    — any entity that sends or receives messages
Channel      → HOW    — the transport and protocol used
Conversation → WHERE  — channel-agnostic shared context
Event        → WHAT   — the atomic unit of everything that happens
```

All features — routing, automations, persistence, agent memory, A2A compatibility — are built on top of these four.

---

## Horizon Map

This document covers changes across two horizons:

| Horizon | What | Why now |
|---|---|---|
| **Now** | `agents` table, `senderAgentId`, identity graph extension, OmniEvent fixes | Closes structural gaps, unblocks observability |
| **Next** | `conversations` table, agent state machine, agent tasks, new channels | Cross-channel continuity, live agent UI, A2A |

Horizon Now is a prerequisite for Horizon Next. Each step is independently deployable.

---

## Actor: Person and Agent (Parallel, Distinct)

The key insight: **humans and agents are both Actors** — things that send and receive messages. But they have meaningfully different semantics, so they stay as parallel entities rather than a single unified type.

### Person — unchanged, humans only

A Person is an entity *in the world* — external, discovered via incoming messages, not controlled by Omni.

```typescript
interface Person {
  id: string                 // stable UUID forever
  displayName?: string
  primaryPhone?: string      // E.164 — identity anchor for auto-linking
  primaryEmail?: string      // identity anchor for auto-linking
  avatarUrl?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
```

Nothing changes here. Persons are still discovered, linked, merged, and unlinkable via the existing identity graph.

### Agent — new, software actors only

An Agent is an entity *you deploy* — registered explicitly, configured, controlled. It is NOT discovered; it is declared.

```typescript
interface Agent {
  id: string
  name: string

  // What kind of agent
  provider: 'claude' | 'agno' | 'openai' | 'custom' | 'omni-internal'
  model?: string                // 'claude-opus-4-6', 'gpt-4o', etc.
  agentType: 'assistant' | 'workflow' | 'team' | 'tool'

  // What it can do (A2A-compatible capability descriptor)
  capabilities: string[]        // ['text', 'images', 'tools', 'streaming', ...]
  agentCard?: AgentCard         // Full A2A agent card JSON — see Horizon Next

  // Ownership and control
  ownerId?: string              // FK → persons.id — who controls this agent
  instanceId?: string           // FK → instances.id — nullable: agent can be multi-instance

  // For reading Claude's conversation state (Horizon Next)
  configPath?: string           // e.g. ~/.claude/projects/<hash>/ — JSONL stream location

  // Classification
  isInternal: boolean           // true = Omni-managed bot; false = external (Claude, Agno, etc.)
  isActive: boolean

  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
```

**Key semantic difference:**
- Person = *discovered* (you find out they exist via incoming messages)
- Agent = *registered* (you explicitly add it to the system)

---

## ─── HORIZON NOW ─────────────────────────────────────────

*Additive, non-breaking changes. Each step independently deployable.*

### 1. `agents` table

New table. No changes to anything existing. Purely additive.

**Migration:** Create table → create one Agent row per Instance that has `agentProviderId` set (backfill).

### 2. PlatformIdentity — extended to cover both Actors

The identity graph stays exactly the same. The only change: the FK becomes polymorphic — points to a Person OR an Agent.

```typescript
interface PlatformIdentity {
  // Actor reference — exactly one is non-null
  personId?: string             // FK → persons.id  (existing)
  agentId?: string              // FK → agents.id   ← ADD

  // Everything else unchanged
  channel: ChannelType
  instanceId?: string
  platformUserId: string
  linkedBy: 'auto' | 'manual' | 'phone_match' | 'config_path_match' | 'initial'
  confidence: number            // 0–100
  // ...
}
```

Same linking, merging, and confidence scoring logic — reused for agents via a new `AgentService`.

**Migration:** Add nullable `agentId` column to `platform_identities`.

### 3. Message — replace `isFromMe`

The boolean `isFromMe` is a hack. It means "the bot sent this" but carries no identity.

```typescript
interface Message {
  // Sender — exactly one of these is set:
  senderPersonId?: string             // FK → persons.id  (existing)
  senderAgentId?: string              // FK → agents.id   ← ADD

  // isFromMe becomes derived (keep column, mark deprecated):
  // isFromMe = senderAgentId IS NOT NULL AND agent.isInternal = true
}
```

**Migration:** Add `senderAgentId`. Backfill from `isFromMe = true` + Instance's agent. Deprecate `isFromMe` (keep for now, remove later).

### 4. OmniEvent — tighten loose fields

```typescript
interface OmniEvent {
  personId?: string             // FK → persons.id  (existing)
  agentId?: string              // FK → agents.id   ← ADD

  // chatId was varchar — fix to proper FK:
  chatId?: string               // FK → chats.id    ← FIX (was varchar)

  // conversation scoping (FK added now, table created in Horizon Next):
  conversationId?: string       // FK → conversations.id ← ADD (nullable until table exists)
}
```

**Migration:** Add `agentId` column. Migrate `chatId` from varchar to UUID FK (data already valid UUIDs — it's a type fix, not a data fix).

### 5. Instance — clean agent reference

```typescript
interface Instance {
  // Remove loose fields: agentProviderId varchar, agentId varchar, agentType varchar
  // Add proper FK:
  agentId?: string              // FK → agents.id   ← ADD
}
```

**Migration:** After backfilling Agent rows, point `instance.agentId` to the correct Agent. Remove loose varchar fields.

### 6. AgentRoute — proper FK

```typescript
interface AgentRoute {
  // Remove: agentId varchar, agentType varchar, agentProviderId UUID (loose)
  // Add:
  agentId: string               // FK → agents.id   ← proper FK
}
```

### New event types (Horizon Now)

```typescript
'agent.registered'      // new Agent created in system
'agent.connected'       // agent came online on a channel
'agent.disconnected'    // agent went offline
```

### What Horizon Now unlocks

```sql
-- All messages from a specific agent
SELECT * FROM messages WHERE senderAgentId = :agentId;

-- All agents a person controls
SELECT * FROM agents WHERE ownerId = :personId;

-- All channels an agent is reachable on
SELECT * FROM platform_identities WHERE agentId = :agentId;

-- All chats an agent is participating in
SELECT c.* FROM chats c
JOIN chat_participants cp ON cp.chatId = c.id
WHERE cp.agentId = :agentId;

-- Agent message volume this week
SELECT COUNT(*) FROM messages
WHERE senderAgentId = :agentId
  AND createdAt > NOW() - INTERVAL '7 days';
```

---

## ─── HORIZON NEXT ────────────────────────────────────────

*Built on top of Horizon Now. Enables cross-channel continuity, live agent UI, A2A.*

### Conversation — channel-agnostic layer

Today `Chat` IS the conversation, permanently bound to one channel. The fix: `Conversation` as the channel-agnostic container. `Chat` becomes a channel-specific thread *within* a Conversation.

```typescript
interface Conversation {
  id: string
  title?: string

  // LLM-generated summary for context recovery across sessions
  summary?: string

  // Persistent cross-channel memory / state
  // e.g. { currentTopic: 'vacation planning', lastAgentSessionId: '...' }
  state?: Record<string, unknown>

  createdAt: Date
  updatedAt: Date
}
```

`Chat` gains one FK:

```typescript
interface Chat {
  conversationId?: string       // FK → conversations.id  ← ADD
  // everything else unchanged
}
```

A Conversation groups multiple Chats across channels:

```
Conversation: "Vacation planning with Cezar"
  ├── Chat: WhatsApp DM (+5511999)
  ├── Chat: Slack thread (#general / thread-abc)
  └── Chat: Telegram DM (@cezar)
```

Agent memory and context live on `Conversation`. A session started on WhatsApp continues on Telegram with full history.

**Backfill:** Initially one Conversation per Chat. Merging happens manually or via future auto-detection.

### Agent State (ephemeral)

A live state machine per agent per chat. Lives in **NATS KV** — not PostgreSQL. No DB pressure for typing indicators.

```typescript
interface AgentChatState {
  agentId: string
  chatId: string
  conversationId: string

  status:
    | 'idle'
    | 'thinking'      // reasoning, processing input
    | 'typing'        // composing response text
    | 'sending'       // splitting + delivering message parts
    | 'running_task'  // tool call, sub-agent, external API
    | 'waiting'       // waiting for user input or external result
    | 'error'

  // Rich per-status metadata — open and expandable
  statusMeta?: {
    // thinking
    model?: string
    tokensIn?: number

    // typing
    partialText?: string
    wordCount?: number

    // sending
    partsTotal?: number
    partsSent?: number

    // running_task
    taskId?: string
    taskType?: string
    taskTitle?: string
    progress?: number      // 0–100

    // waiting
    waitingFor?: 'user_input' | 'tool_result' | 'external_api' | 'sub_agent'

    // error
    errorCode?: string
    errorMessage?: string
    recoverable?: boolean
  }

  updatedAt: Date
}
```

**State machine:**

```
idle → thinking → typing → sending → idle
            ↓
      running_task ──→ thinking  (loop until done)
            ↓
         waiting ──→ thinking    (when unblocked)
            ↓
          error ──→ idle         (if recovered)
```

Transitions are streamed to clients via SSE as `agent.state.changed` events.

### Agent Task (persistent)

Every piece of work the agent performs is a Task — auditable, queryable, nestable.

```typescript
interface AgentTask {
  id: string
  agentId: string               // FK → agents.id
  chatId: string                // FK → chats.id
  conversationId: string        // FK → conversations.id
  messageId?: string            // FK → messages.id — what triggered this task

  // Task identity
  type: string                  // 'web_search' | 'code_exec' | 'file_read' |
                                // 'api_call' | 'sub_agent' | 'media_process' | 'custom.*'
  title: string                 // human-readable: "Searching for flights to Tokyo"
  description?: string

  // State
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_input'
  progress: number              // 0–100
  priority: number

  // Fully open metadata — shape defined per task type, no migration needed for new types
  metadata: Record<string, unknown>
  // web_search:   { query, engine, resultsCount, urls[] }
  // code_exec:    { language, code, runtime, exitCode }
  // api_call:     { url, method, statusCode, durationMs }
  // sub_agent:    { agentId, agentName, prompt }
  // file_read:    { path, lines, sizeBytes }
  // media_proc:   { mediaId, processingType, model }

  // Output
  result?: Record<string, unknown>
  error?: string

  // Nesting — tasks can spawn subtasks
  parentTaskId?: string         // FK → agent_tasks.id
  subtaskCount: number
  completedSubtaskCount: number

  // Timing
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}
```

### How State and Tasks connect

```
message.received
       ↓
AgentChatState → 'thinking'                          (NATS KV, ephemeral)
       ↓
  agent decides to use a tool
       ↓
AgentTask created  { type: 'web_search', title: 'Searching for X' }   (PostgreSQL, persisted)
AgentChatState → 'running_task' { taskId, taskType, progress: 0 }
       ↓
  progress streams in
AgentTask.progress + AgentChatState.statusMeta.progress → 0 → 25 → 75 → 100
       ↓
AgentTask completed  { result: { urls: [...] } }
AgentChatState → 'typing'
       ↓
AgentChatState → 'sending' { partsTotal: 2, partsSent: 0 → 1 → 2 }
       ↓
AgentChatState → 'idle'
```

### New event types (Horizon Next)

```typescript
// Agent state
'agent.state.changed'         // every state transition — streamed via SSE

// Agent tasks
'agent.task.created'          // task started
'agent.task.updated'          // progress update
'agent.task.completed'        // task done, result attached
'agent.task.failed'           // task error
'agent.task.cancelled'        // task stopped

// Agent sessions (Claude JSONL)
'agent.session.started'       // Claude project session began
'agent.session.message'       // message in Claude session
'agent.session.ended'         // stream closed

// A2A
'agent.a2a.task_received'     // incoming A2A task from external agent
'agent.a2a.task_updated'      // A2A task state change
'agent.a2a.task_completed'    // A2A task done
```

### New channels (Horizon Next)

| Channel | Transport | What it reads |
|---|---|---|
| `claude` | JSONL file watcher | `~/.claude/projects/<hash>/*.jsonl` |
| `agno` | Agno event stream | Agno session events |
| `cli` | stdin/stdout | Direct CLI interaction |
| `a2a` | HTTP + JSON-RPC | A2A protocol task stream |

### A2A mapping

The model is A2A-compatible by design — no A2A-specific terminology forced into the core.

| A2A concept | Omni concept |
|---|---|
| `Task` | `AgentTask` |
| `TaskStatus.working` | `AgentChatState.status = 'running_task'` |
| `TaskStatus.input-required` | `AgentChatState.status = 'waiting'` |
| `Artifact` | `AgentTask.result` |
| Streaming updates | `agent.state.changed` via SSE |
| Agent Card | `Agent.agentCard JSONB` |

### What Horizon Next unlocks

```sql
-- Full task history for a conversation
SELECT type, title, status, metadata, completedAt - startedAt AS duration
FROM agent_tasks WHERE conversationId = :id ORDER BY createdAt;

-- Which task types fail most?
SELECT type, COUNT(*) FROM agent_tasks
WHERE status = 'failed' GROUP BY type ORDER BY 2 DESC;

-- Full cross-channel conversation timeline
SELECT * FROM omni_events
WHERE conversationId = :id ORDER BY receivedAt;

-- Cost tracking per conversation (when populated in metadata)
SELECT SUM((metadata->>'costUsd')::numeric) FROM agent_tasks
WHERE conversationId = :id AND status = 'completed';
```

**UI this enables:**
- Live "Agent is thinking..." / "Running web search... 60%" per chat
- Conversation sidebar: all tasks run, expandable with metadata
- Task tree: subtasks, sub-agent calls, full decision path
- Human-in-the-loop: `waiting_input` state + UI to inject response
- Full replay: every state transition is an event, reconstruct agent's decision path

**Expandable for free** (no migration — just put it in `metadata`):
- Cost per task → `metadata.costUsd`, `metadata.tokensUsed`
- Tool versioning → `metadata.toolVersion`, `metadata.toolProvider`
- Billing summaries → `SUM(metadata.costUsd)` per period
- Sub-agent graphs → linked via `parentTaskId`

---

## Full Target Relationship Map

```
AgentProvider (1) ──▶ (M) Agent
Agent         (1) ──▶ (M) Instance
Agent         (1) ──▶ (M) PlatformIdentity
Agent         (M) ◀── (1) Person              (via ownerId)
Agent         (1) ──▶ (M) ChatParticipant
Agent         (1) ──▶ (M) Message             (as senderAgentId)
Agent         (1) ──▶ (M) OmniEvent           (as agentId)
Agent         (1) ──▶ (M) AgentRoute
Agent         (1) ──▶ (M) AgentTask           [Horizon Next]

AgentTask     (1) ──▶ (M) AgentTask           (parentTaskId — subtasks) [Horizon Next]

Person        (1) ──▶ (M) PlatformIdentity
Person        (1) ──▶ (M) ChatParticipant
Person        (1) ──▶ (M) Message             (as senderPersonId)
Person        (1) ──▶ (M) OmniEvent           (as personId)
Person        (1) ──▶ (M) Agent               (as ownerId)

Conversation  (1) ──▶ (M) Chat                [Horizon Next]
Conversation  (1) ──▶ (M) OmniEvent           (as conversationId) [Horizon Next]
Conversation  (1) ──▶ (M) AgentTask           [Horizon Next]

Chat          (1) ──▶ (M) Message
Chat          (1) ──▶ (M) ChatParticipant
Chat          (M) ──▶ (1) Conversation        [Horizon Next]

OmniEvent     (1) ──▶ (M) MediaContent
OmniEvent     (1) ──▶ (M) EventPayload
```

---

## What Does NOT Change

| Entity | Status |
|---|---|
| `Person` schema | Unchanged |
| `PlatformIdentity` linking/merging/confidence logic | Unchanged — extended to agents |
| `Chat` (except `conversationId` FK) | Unchanged |
| `Message` (except `senderAgentId`) | Unchanged |
| `AgentProvider` | Unchanged |
| `AgentSession` | Unchanged (add `agentId` FK) |
| `AccessRule` | Unchanged |
| `Automation` / `AutomationLog` | Unchanged |
| `BatchJob` / `SyncJob` | Unchanged |
| All existing 65 event types | Unchanged |
| Zod schema-first pattern | Unchanged |
| All existing enums | Unchanged |

---

## Migration Order

### Horizon Now (do these first)

1. Create `agents` table
2. Backfill: one Agent per Instance with `agentProviderId` set
3. Add `agentId` to `platform_identities` (nullable)
4. Add `senderAgentId` to `messages`, backfill from `isFromMe` + Instance agent
5. Add `agentId` to `omni_events`, fix `chatId` varchar → UUID FK
6. Update `instances`: add `agentId` FK, remove loose varchar fields
7. Update `agent_routes`: replace varchar `agentId` with proper FK

### Horizon Next (after Now is stable)

8. Create `conversations` table
9. Add `conversationId` FK to `chats`, backfill one-to-one
10. Add `conversationId` FK to `omni_events`
11. Create `agent_tasks` table
12. Add NATS KV schema for `AgentChatState`
13. Add new channel types: `claude`, `agno`, `cli`, `a2a`
14. Add `agent.state.changed` SSE stream

---

## Annotation Target State

| Area | Current | Horizon Now | Horizon Next |
|---|---|---|---|
| Agent entity | None | `agents` table + Zod + OpenAPI | + `agentCard`, `configPath` |
| `isFromMe` | boolean | Deprecated (kept) | Removed |
| `OmniEvent.chatId` | varchar | UUID FK | — |
| `PlatformIdentity.channel` | varchar(50) | ChannelType enum | — |
| Agent state | None | None | NATS KV `AgentChatState` |
| Agent tasks | None | None | `agent_tasks` table |
| `Conversation` | None | None | `conversations` table |
| A2A compatibility | None | Agent entity exists | `agentCard` + `a2a` channel |
| Cross-channel memory | None | None | `Conversation.state` |
