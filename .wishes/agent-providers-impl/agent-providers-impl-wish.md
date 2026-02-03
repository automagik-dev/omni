# WISH: AgnoOS Provider Integration (Omnichannel)

> Wire AgnoOS agents/teams to incoming messages across ALL channels with split, delay, debounce, reply filtering, session strategy, and sender name prefix.

**Status:** SHIPPED
**Created:** 2026-02-02
**Updated:** 2026-02-03
**Author:** WISH Agent
**Beads:** omni-r76

---

## Context

**Problem:** The agent provider infrastructure exists (DB schema, API, types) but nothing actually calls the agent when messages arrive. We can configure providers but they don't execute.

**Goal:** When a message arrives for an instance with AgnoOS configured:
1. Check reply filter conditions (DM, mention, reply, name match)
2. Apply debounce (with typing-aware restart option)
3. Call AgnoOS API (agent or team)
4. Split response on `\n\n`, apply delays, send back

**Implementation Summary:**
- [x] `agent_providers` table with schema, baseUrl, apiKey
- [x] Instance references (`agentProviderId`, `agentId`, `agentType`)
- [x] Split/delay/debounce config fields in schema
- [x] AgnoOS client with sync + streaming support
- [x] Message→agent wiring via agent-responder plugin
- [x] Reply filter logic
- [x] Session strategy configuration (per_user, per_chat, per_user_per_chat)
- [x] Sender name prefix toggle

**Provider Types:**
- `agnoos` - AgnoOS provider (implemented)
- `a2a` - A2A protocol provider (placeholder, future implementation)
- `openai`, `anthropic`, `custom` - Future providers

**Test Environment:**
- AgnoOS API: `http://localhost:8181`
- API Key: `namastex888`
- Initial test: Discord bot instance
- **OMNICHANNEL**: Implementation is channel-agnostic, works with ANY channel plugin

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **DEC-1** | Decision | Start with AgnoOS only (defer OpenAI/Anthropic/Custom/A2A) |
| **DEC-2** | Decision | Support agents and teams (workflows deferred) |
| **DEC-3** | Decision | Split on `\n\n` applies to both streaming and sync |
| **DEC-4** | Decision | Typing presence starts immediately on agent call |
| **DEC-5** | Decision | Reply filter is per-instance config |
| **DEC-6** | Decision | Session strategy is per-instance (per_user_per_chat default) |
| **DEC-7** | Decision | Sender name prefix enabled by default |
| **ASM-1** | Assumption | AgnoOS API available at configured baseUrl |
| **ASM-2** | Assumption | Session context managed by AgnoOS via computed sessionId |
| **RISK-1** | Risk | AgnoOS API may be slow/unavailable → timeout + error handling |

---

## Scope

### IN SCOPE (COMPLETED)

- **AgnoOS Client** - Support agents, teams (sync + streaming)
- **Reply Filter** - Conditions for when agent should reply
- **Debounce** - With typing-aware restart (where channel supports it)
- **Response Split** - On `\n\n` with configurable delays
- **Typing Presence** - Start as soon as agent call begins
- **Message Wiring** - Hook into message.received events
- **OMNICHANNEL** - Channel-agnostic via ChannelPlugin interface
- **Session Strategy** - Configurable memory scope (per_user, per_chat, per_user_per_chat)
- **Sender Name Prefix** - Format messages as `[Name]: message`

### OUT OF SCOPE

- OpenAI/Anthropic/Custom/A2A providers (future wish)
- Workflow type support (deferred)
- Tool calling UI/confirmation
- Multi-modal beyond text (images later)
- Provider cost tracking
- Agent health dashboard

---

## AgnoOS API Reference

### List Endpoints
```bash
GET /agents                        # List agents
GET /teams                         # List teams
GET /workflows                     # List workflows
```

### Run Endpoints (multipart/form-data)
```bash
POST /agents/{agent_id}/runs       # Run agent
POST /teams/{team_id}/runs         # Run team
```

**Request Body:**
```typescript
{
  message: string;        // Required
  stream?: boolean;       // Default: true
  session_id?: string;    // Computed based on strategy
  user_id?: string;       // User identifier (always sent)
  files?: File[];         // Optional attachments
}
```

**Response (sync, stream=false):**
```typescript
{
  run_id: string;
  agent_id: string;
  session_id: string;
  content: string;        // The response text
  status: 'COMPLETED' | 'FAILED';
  metrics: { input_tokens, output_tokens, duration };
}
```

**Response (streaming, stream=true):**
```
event: RunStarted
data: {"run_id": "...", "session_id": "..."}

event: RunResponse
data: {"event": "RunResponse", "content": "Hello", "content_type": "str"}

event: RunCompleted
data: {"run_id": "...", "content": "Full response here"}
```

---

## Instance Configuration

### Session Strategy (NEW)

```typescript
// How should session ID be computed for agent memory?
agentSessionStrategy: 'per_user' | 'per_chat' | 'per_user_per_chat';

// per_user: Session = userId (same session across all chats for this user)
// per_chat: Session = chatId (all users in chat share session - group memory)
// per_user_per_chat: Session = `${userId}:${chatId}` (most isolated, default)
```

**Use Cases:**
- `per_user` - User has persistent memory across all chats
- `per_chat` - Group chat has shared context (all members see same history)
- `per_user_per_chat` - Each user has separate context per chat (default)

### Sender Name Prefix (NEW)

```typescript
// Prefix messages with sender name for agent context?
agentPrefixSenderName: boolean;  // Default: true

// When enabled, messages sent to agent look like:
// "[Cezar]: What is 25 * 4?"
// Name comes from: 1) persons.displayName (DB) 2) payload.pushName (fallback)
```

### Reply Filter

```typescript
// When should agent reply to messages?
agentReplyFilter: {
  mode: 'all' | 'filtered';  // all = reply to everything, filtered = check conditions
  conditions: {
    onDm: boolean;           // Reply if message is a DM (not in group/channel)
    onMention: boolean;      // Reply if bot is @mentioned
    onReply: boolean;        // Reply if message is a reply to bot's message
    onNameMatch: boolean;    // Reply if bot name appears in text
    namePatterns?: string[]; // Custom patterns for name matching
  };
}
```

**Logic:** If mode='filtered', check conditions with OR (any match triggers reply).

### Existing Config

```typescript
// Split & Delay
enableAutoSplit: boolean;                    // Split on \n\n
messageSplitDelayMode: 'disabled' | 'fixed' | 'randomized';
messageSplitDelayFixedMs: number;
messageSplitDelayMinMs: number;              // Default: 300
messageSplitDelayMaxMs: number;              // Default: 1000

// Debounce
messageDebounceMode: 'disabled' | 'fixed' | 'randomized';
messageDebounceMinMs: number;
messageDebounceMaxMs: number;
messageDebounceRestartOnTyping: boolean;     // Restart timer if user is typing
```

---

## Execution Group A: AgnoOS Client & Factory

**Status:** COMPLETE

**Deliverables:**
- [x] `packages/core/src/providers/types.ts` - Provider types
- [x] `packages/core/src/providers/agno-client.ts` - AgnoOS implementation
- [x] `packages/core/src/providers/factory.ts` - Client factory (agnoos + a2a placeholder)
- [x] `packages/core/src/providers/index.ts` - Exports
- [x] `packages/core/src/providers/__tests__/agno-client.test.ts` - Tests (no mocks/any)

**Types Implemented:**
```typescript
interface ProviderRequest {
  message: string;
  stream?: boolean;
  sessionId?: string;   // Computed based on session strategy
  userId?: string;      // Always sent for context
  timeoutMs?: number;
  files?: { path: string; mimeType: string }[];
}

interface ProviderResponse {
  content: string;
  runId: string;
  sessionId: string;
  status: 'completed' | 'failed';
  metrics?: { inputTokens: number; outputTokens: number; durationMs: number };
}

interface StreamChunk {
  event: string;
  content?: string;
  isComplete: boolean;
  runId?: string;
  fullContent?: string;
}

interface IAgnoClient {
  listAgents(): Promise<AgnoAgent[]>;
  listTeams(): Promise<AgnoTeam[]>;
  listWorkflows(): Promise<AgnoWorkflow[]>;

  runAgent(agentId: string, request: ProviderRequest): Promise<ProviderResponse>;
  runTeam(teamId: string, request: ProviderRequest): Promise<ProviderResponse>;
  runWorkflow(workflowId: string, request: ProviderRequest): Promise<ProviderResponse>;

  streamAgent(agentId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;
  streamTeam(teamId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;
  streamWorkflow(workflowId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;

  checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
}
```

**Validation:** All tests pass.

---

## Execution Group B: Message Wiring & Reply Filter

**Status:** COMPLETE

**Deliverables:**
- [x] `packages/api/src/services/agent-runner.ts` - Orchestration service
- [x] `packages/api/src/plugins/agent-responder.ts` - Event handler plugin
- [x] Schema update for `agentReplyFilter` and `messageDebounceRestartOnTyping`
- [x] Schema update for `agentSessionStrategy` and `agentPrefixSenderName`
- [x] Reply filter logic implementation
- [x] Session ID computation based on strategy
- [x] Sender name prefix with DB lookup + payload fallback
- [x] Debounce buffer with typing-aware restart

**Flow:**
```
message.received event
    ↓
agent-responder plugin
    ├─ Get instance config
    ├─ Check agentProviderId is set
    ├─ Skip if from ourselves
    ├─ Apply reply filter → skip if no match
    ├─ Apply debounce (buffer messages, restart on typing if enabled)
    ├─ When debounce fires:
    │   ├─ Start typing presence immediately
    │   ├─ Get sender name (DB lookup, fallback to pushName)
    │   ├─ Aggregate buffered messages with [Name]: prefix
    │   ├─ Compute session ID based on strategy
    │   ├─ Call AgnoOS via agentRunner.run()
    │   ├─ Split response on \n\n
    │   ├─ Send each part with configured delay
    │   └─ Re-send typing between parts
    └─ Stop typing presence
```

**Session ID Computation:**
```typescript
function computeSessionId(
  strategy: AgentSessionStrategy,
  userId: string,
  chatId: string,
): string {
  switch (strategy) {
    case 'per_user':
      return userId;
    case 'per_chat':
      return chatId;
    case 'per_user_per_chat':
    default:
      return `${userId}:${chatId}`;
  }
}
```

**Sender Name Resolution:**
```typescript
async getSenderName(personId?: string, fallbackName?: string): Promise<string | undefined> {
  // 1. Try database lookup via personId
  if (personId) {
    const person = await db.query(persons.displayName).where(eq(persons.id, personId));
    if (person?.displayName) return person.displayName;
  }
  // 2. Fallback to payload name (pushName, displayName)
  return fallbackName || undefined;
}
```

**Validation:** All tests pass.

---

## Execution Group C: Omnichannel Integration & Testing

**Status:** COMPLETE

**Deliverables:**
- [x] Provider API routes (list, get, create, health check)
- [x] CLI commands for provider/agent management
- [x] Channel-agnostic implementation verified
- [x] Typecheck passes
- [x] All 743 tests pass

**CLI Commands:**
```bash
omni providers list
omni providers create --name agno-local --schema agnoos --base-url http://localhost:8181 --api-key xxx
omni providers agents <provider-id>    # List agents from provider
omni providers teams <provider-id>     # List teams
omni providers test <provider-id>      # Health check

omni instances update <id> --agent-provider <provider-id> --agent-id calculator-agent
```

**Channel Capabilities Matrix:**
| Feature | Discord | WhatsApp | Status |
|---------|---------|----------|--------|
| Send typing presence | [x] | [x] | Both support composing/paused |
| Detect bot mention | [x] | [x] | WhatsApp uses name pattern match |
| Detect reply to bot | [x] | [x] | Both have reply context |
| Receive user typing | [] | [x] | Baileys captures presence.update |
| Receive edited msgs | [x] | [x] | Baileys handles protoType === 14 |

**Validation:** All tests pass, typecheck passes.

---

## Schema Changes (IMPLEMENTED)

### instances table additions:
```typescript
// Session strategy
export const agentSessionStrategies = ['per_user', 'per_chat', 'per_user_per_chat'] as const;
export type AgentSessionStrategy = (typeof agentSessionStrategies)[number];

agentSessionStrategy: varchar('agent_session_strategy', { length: 20 })
  .notNull()
  .default('per_user_per_chat')
  .$type<AgentSessionStrategy>(),

// Sender name prefix
agentPrefixSenderName: boolean('agent_prefix_sender_name')
  .notNull()
  .default(true),

// Reply filter (JSONB)
agentReplyFilter: jsonb('agent_reply_filter').$type<AgentReplyFilter>(),

// Typing-aware debounce
messageDebounceRestartOnTyping: boolean('message_debounce_restart_on_typing')
  .notNull()
  .default(false),
```

### Provider schemas:
```typescript
export const providerSchemas = ['agnoos', 'a2a', 'openai', 'anthropic', 'custom'] as const;
export type ProviderSchema = (typeof providerSchemas)[number];
```

---

## Dependencies

- AgnoOS API running on localhost:8181
- Discord or WhatsApp instance configured
- Existing provider infrastructure (DB, API, services)

## Enables

- **OMNICHANNEL AI agents** - Same code, any channel
- AI agent responses in Discord (tested)
- AI agent responses in WhatsApp (ready immediately)
- AI agent responses in ANY future channel (Telegram, Slack, etc.)
- Configurable session memory scope
- User identification in agent context
- Future: A2A protocol providers
- Future: OpenAI/Anthropic/Custom providers (same wiring)
- Future: Tool calling, RAG, multi-agent

---

## Review Verdict

**Verdict:** SHIP
**Date:** 2026-02-03
**Reviewer:** REVIEW Agent

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| AgnoOS Client implemented | PASS | `packages/core/src/providers/agno-client.ts` - Full sync/streaming support |
| Provider factory with schema support | PASS | `packages/core/src/providers/factory.ts` - agnoos + a2a placeholder |
| Agent runner service | PASS | `packages/api/src/services/agent-runner.ts` - Orchestration with split/delay |
| Agent responder plugin | PASS | `packages/api/src/plugins/agent-responder.ts` - Event wiring |
| Session strategy config | PASS | `per_user`, `per_chat`, `per_user_per_chat` supported |
| Sender name prefix | PASS | DB lookup + pushName fallback implemented |
| Reply filter logic | PASS | `shouldAgentReply()` with onDm/onMention/onReply/onNameMatch |
| Debounce with typing-aware restart | PASS | `MessageDebouncer` class with `restartOnTyping` |
| Typecheck passes | PASS | All 8 packages pass typecheck |
| Lint passes | PASS | Biome checked 317 files, no issues |
| Tests pass | PASS | 743 tests pass (0 fail) |

### Assessment

**Security:** PASS
- API keys stored in DB, not hardcoded
- Timeout handling prevents hangs
- No injection vulnerabilities identified
- Error messages don't leak sensitive info

**Correctness:** PASS
- Session ID computation follows documented strategy
- Response splitting handles edge cases (empty parts filtered)
- Debounce timer correctly restarts on typing when enabled
- Reply filter uses OR logic as documented

**Quality:** PASS
- Clean separation: client → runner → responder
- Comprehensive JSDoc comments
- Typed errors with `ProviderError` class
- Client caching for performance
- Logging throughout for debugging

**Tests:** PASS
- AgnoOS client has 25 test cases covering:
  - List endpoints (agents, teams, workflows)
  - Run endpoints (sync mode)
  - Streaming with SSE parsing
  - Error handling (401, 404, 500, timeout)
  - Health check

### Findings

No CRITICAL or HIGH issues found.

**Minor observations (informational only):**
- File attachment support is stubbed (TODO comment) - acceptable, out of scope
- Workflow type not wired in agent-runner switch (deferred per wish)

### Recommendation

This wish is ready for production. All acceptance criteria pass, code quality is high, and test coverage is adequate. The implementation is channel-agnostic as designed, enabling future channels without modification.

**Already closed:** Beads issue `omni-r76` was closed on 2026-02-03
