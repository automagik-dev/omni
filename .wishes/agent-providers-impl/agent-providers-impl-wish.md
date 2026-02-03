# WISH: Agno Provider Integration (Omnichannel)

> Wire Agno agents/teams to incoming messages across ALL channels with split, delay, debounce, and reply filtering.

**Status:** DRAFT
**Created:** 2026-02-02
**Updated:** 2026-02-03
**Author:** WISH Agent
**Beads:** omni-r76

---

## Context

**Problem:** The agent provider infrastructure exists (DB schema, API, types) but nothing actually calls the agent when messages arrive. We can configure providers but they don't execute.

**Goal:** When a message arrives for an instance with Agno configured:
1. Check reply filter conditions (DM, mention, reply, name match)
2. Apply debounce (with typing-aware restart option)
3. Call Agno API (agent, team, or workflow)
4. Split response on `\n\n`, apply delays, send back

**Current State:**
- ✅ `agent_providers` table with schema, baseUrl, apiKey
- ✅ Instance references (`agentProviderId`, `agentId`, `agentType`)
- ✅ Split/delay/debounce config fields already in schema
- ❌ No Agno client
- ❌ No message→agent wiring
- ❌ No reply filter logic

**Test Environment:**
- Agno API: `http://localhost:8181`
- API Key: `namastex888`
- Initial test: Discord bot instance
- **OMNICHANNEL**: Implementation is channel-agnostic, works with ANY channel plugin

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **DEC-1** | Decision | Start with Agno only (defer OpenAI/Anthropic/Custom) |
| **DEC-2** | Decision | Support agents, teams, and workflows |
| **DEC-3** | Decision | Split on `\n\n` applies to both streaming and sync |
| **DEC-4** | Decision | Typing presence starts immediately on agent call |
| **DEC-5** | Decision | Reply filter is per-instance config |
| **ASM-1** | Assumption | Agno API available at configured baseUrl |
| **ASM-2** | Assumption | Session context managed by Agno (user_id = chatId) |
| **RISK-1** | Risk | Agno API may be slow/unavailable → timeout + error handling |

---

## Scope

### IN SCOPE

- **Agno Client** - Support agents, teams, workflows (sync + streaming)
- **Reply Filter** - Conditions for when agent should reply
- **Debounce** - With typing-aware restart (where channel supports it)
- **Response Split** - On `\n\n` with configurable delays
- **Typing Presence** - Start as soon as agent call begins
- **Message Wiring** - Hook into message-persistence flow
- **OMNICHANNEL** - Channel-agnostic via ChannelPlugin interface (Discord, WhatsApp, any future channel)

### OUT OF SCOPE

- OpenAI/Anthropic/Custom providers (future wish)
- Tool calling UI/confirmation
- Multi-modal beyond text (images later)
- Conversation memory beyond Agno's session
- Provider cost tracking
- Agent health dashboard

---

## Agno API Reference

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
POST /workflows/{workflow_id}/runs # Run workflow
```

**Request Body:**
```typescript
{
  message: string;        // Required
  stream?: boolean;       // Default: true
  session_id?: string;    // Session continuity
  user_id?: string;       // User identifier
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

### Reply Filter (NEW - needs schema update)

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

### Existing Config (already in schema)

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
// NEW: messageDebounceRestartOnTyping: boolean  // Restart timer if user is typing
```

---

## Execution Group A: Agno Client & Factory

**Goal:** Implement the Agno client with streaming and sync support.

**Deliverables:**
- [ ] `packages/core/src/providers/types.ts` - Provider types
- [ ] `packages/core/src/providers/agno-client.ts` - Agno implementation
- [ ] `packages/core/src/providers/factory.ts` - Client factory
- [ ] `packages/core/src/providers/index.ts` - Exports

**Types:**
```typescript
interface ProviderRequest {
  message: string;
  stream?: boolean;
  sessionId?: string;   // Typically chatId for continuity
  userId?: string;      // Typically personId or senderId
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
}

interface AgnoClient {
  listAgents(): Promise<AgnoAgent[]>;
  listTeams(): Promise<AgnoTeam[]>;
  listWorkflows(): Promise<AgnoWorkflow[]>;

  runAgent(agentId: string, request: ProviderRequest): Promise<ProviderResponse>;
  runTeam(teamId: string, request: ProviderRequest): Promise<ProviderResponse>;
  runWorkflow(workflowId: string, request: ProviderRequest): Promise<ProviderResponse>;

  streamAgent(agentId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;
  streamTeam(teamId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;
  streamWorkflow(workflowId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;
}
```

**Acceptance Criteria:**
- [ ] Can list agents, teams, workflows from Agno API
- [ ] Can run agent with sync response
- [ ] Can stream agent with SSE parsing
- [ ] Handles errors (401, 404, 500) gracefully
- [ ] Respects timeout config

**Validation:**
```bash
bun test packages/core/src/providers/__tests__/agno-client.test.ts
```

---

## Execution Group B: Message Wiring & Reply Filter

**Goal:** Wire messages to agent calls with filtering, debounce, and response handling.

**Deliverables:**
- [ ] `packages/api/src/services/agent-runner.ts` - Orchestration service
- [ ] `packages/api/src/plugins/agent-responder.ts` - Event handler plugin
- [ ] Schema update for `agentReplyFilter` and `messageDebounceRestartOnTyping`
- [ ] Reply filter logic implementation
- [ ] Debounce buffer with typing-aware restart
- [ ] Emit `presence.typing` event from WhatsApp's stubbed `handlePresenceUpdate` (already capturing, just need to emit)

**Flow:**
```
message.received event
    ↓
message-persistence (existing - persists message)
    ↓
agent-responder plugin (NEW)
    ├─ Get instance config
    ├─ Check agentProviderId is set
    ├─ Apply reply filter → skip if no match
    ├─ Start typing presence immediately
    ├─ Apply debounce (buffer messages, restart on typing if enabled)
    ├─ When debounce fires:
    │   ├─ Aggregate buffered messages
    │   ├─ Call Agno via agentRunner.run()
    │   ├─ Split response on \n\n
    │   ├─ Send each part with configured delay
    │   └─ Emit message.sent events
    └─ Stop typing presence
```

**Reply Filter Implementation:**
```typescript
function shouldAgentReply(instance: Instance, message: Message): boolean {
  const filter = instance.agentReplyFilter;

  // No filter = no agent response
  if (!filter || !instance.agentProviderId) return false;

  // All mode = always reply
  if (filter.mode === 'all') return true;

  // Filtered mode = check conditions (OR logic)
  const { conditions } = filter;

  if (conditions.onDm && message.isDirectMessage) return true;
  if (conditions.onMention && message.mentionsBot) return true;
  if (conditions.onReply && message.isReplyToBot) return true;
  if (conditions.onNameMatch && matchesNamePattern(message.text, conditions.namePatterns)) return true;

  return false;
}
```

**Acceptance Criteria:**
- [ ] Messages only trigger agent when reply filter passes
- [ ] Typing presence shows while agent is processing
- [ ] Debounce aggregates rapid messages with `\n---\n`
- [ ] Typing-aware debounce restarts timer on user typing (WhatsApp)
- [ ] `presence.typing` event emitted when user is composing
- [ ] Response split on `\n\n` works correctly
- [ ] Split delays follow mode config (disabled/fixed/randomized)
- [ ] First message sent immediately, subsequent with delay

**Validation:**
```bash
bun test packages/api/src/plugins/__tests__/agent-responder.test.ts
make typecheck
```

---

## Execution Group C: Omnichannel Integration & Testing

**Goal:** End-to-end validation across channels - test with Discord, ready for WhatsApp and any future channel.

**Deliverables:**
- [ ] Create Agno provider record via API
- [ ] Configure instance with provider (any channel)
- [ ] CLI commands for provider/agent management
- [ ] Integration test with live Agno API
- [ ] Verify channel-agnostic implementation

**CLI Commands:**
```bash
omni providers list
omni providers create --name agno-local --schema agno --base-url http://localhost:8181 --api-key xxx
omni providers agents <provider-id>    # List agents from provider
omni providers teams <provider-id>     # List teams
omni providers test <provider-id>      # Health check

omni instances update <id> --agent-provider <provider-id> --agent-id calculator-agent
```

**Test Scenarios:**

*Discord (initial test):*
1. Create Agno provider pointing to localhost:8181
2. Set Discord instance to use provider with calculator-agent
3. Configure reply filter: `onMention: true`
4. Send message mentioning bot: "@Omni what is 25 * 4?"
5. Expect: Typing indicator → "The result of 25 * 4 is **100**."

*WhatsApp (same code, different channel):*
1. Same provider, different instance
2. Configure reply filter: `onDm: true` (private chats)
3. Send message in DM
4. Expect: Typing indicator → response with split delays
5. Test typing-aware debounce restart

**Channel Capabilities Matrix:**
| Feature | Discord | WhatsApp | Status |
|---------|---------|----------|--------|
| Send typing presence | ✅ | ✅ | Both support composing/paused |
| Detect bot mention | ✅ | ⚠️ | WhatsApp needs name pattern match |
| Detect reply to bot | ✅ | ✅ | Both have reply context |
| Receive user typing | ❌ | ✅ | Baileys captures `presence.update`, handler stubbed (easy fix) |
| Edit message | ✅ | ✅ | Baileys supports via `edit` param (15min window) |

**Note:** WhatsApp uses Baileys directly. User typing events are already captured (`all-events.ts:51`), just need to emit event from stubbed `handlePresenceUpdate`.

**Acceptance Criteria:**
- [ ] Provider created and persisted
- [ ] Instance linked to provider (any channel type)
- [ ] Bot responds based on reply filter
- [ ] Typing indicator shows immediately
- [ ] Split messages have configurable delay
- [ ] Same code works for Discord AND WhatsApp
- [ ] Channel-specific features gracefully degrade

**Validation:**
```bash
# Test provider health
omni providers test <provider-id>

# Discord test
# Send @mention in Discord, observe response

# WhatsApp test (when ready)
# Send DM, observe typing + response
```

---

## Technical Notes

### Streaming Split Strategy

When streaming, accumulate text and split on `\n\n`:

```typescript
async function* streamWithSplit(
  stream: AsyncGenerator<StreamChunk>,
  splitOnDoubleNewline: boolean,
): AsyncGenerator<string> {
  let buffer = '';

  for await (const chunk of stream) {
    if (chunk.content) {
      buffer += chunk.content;

      if (splitOnDoubleNewline) {
        // Check for complete segments
        while (buffer.includes('\n\n')) {
          const [segment, rest] = buffer.split('\n\n', 2);
          yield segment.trim();
          buffer = rest || '';
        }
      }
    }

    if (chunk.isComplete && buffer.trim()) {
      yield buffer.trim();
    }
  }
}
```

### Debounce with Typing Awareness

```typescript
class MessageDebouncer {
  private buffers: Map<string, Message[]> = new Map();
  private timers: Map<string, Timer> = new Map();

  buffer(chatId: string, message: Message, config: DebounceConfig): void {
    // Add to buffer
    const buffer = this.buffers.get(chatId) || [];
    buffer.push(message);
    this.buffers.set(chatId, buffer);

    // Restart timer
    this.restartTimer(chatId, config);
  }

  onUserTyping(chatId: string, config: DebounceConfig): void {
    if (config.restartOnTyping && this.buffers.has(chatId)) {
      this.restartTimer(chatId, config);
    }
  }

  private restartTimer(chatId: string, config: DebounceConfig): void {
    // Cancel existing
    const existing = this.timers.get(chatId);
    if (existing) clearTimeout(existing);

    // Calculate delay
    const delay = this.calculateDelay(config);

    // Set new timer
    const timer = setTimeout(() => this.flush(chatId), delay);
    this.timers.set(chatId, timer);
  }
}
```

### Presence Updates (Omnichannel)

```typescript
async function handleAgentResponse(instance: Instance, chat: Chat, message: Message): Promise<void> {
  // Get channel plugin - works for ANY channel (Discord, WhatsApp, future channels)
  const channel = getChannelPlugin(instance.channelType);

  // Start typing immediately (channel handles capability check internally)
  await channel.sendPresence(instance.id, chat.externalId, 'composing');

  try {
    const response = await agentRunner.run(instance, message);

    // Split and send
    const parts = splitOnDoubleNewline(response.content);

    for (let i = 0; i < parts.length; i++) {
      // Send message via channel plugin abstraction
      await channel.sendText(instance.id, chat.externalId, parts[i]);

      // Delay between parts (except last)
      if (i < parts.length - 1) {
        const delay = calculateSplitDelay(instance);
        await sleep(delay);

        // Re-send typing for next message
        await channel.sendPresence(instance.id, chat.externalId, 'composing');
      }
    }
  } finally {
    // Clear typing
    await channel.sendPresence(instance.id, chat.externalId, 'paused');
  }
}
```

### Channel Plugin Interface (abstraction layer)

```typescript
// All agent response handling goes through this interface
// Implementation is channel-specific, but API is universal
interface ChannelPlugin {
  // Presence (typing indicator) - noop if channel doesn't support
  sendPresence(instanceId: string, chatId: string, state: 'composing' | 'paused'): Promise<void>;

  // Send text message
  sendText(instanceId: string, chatId: string, text: string): Promise<SendResult>;

  // Channel capabilities (for graceful degradation)
  capabilities: {
    supportsTypingPresence: boolean;
    supportsUserTypingEvents: boolean;  // For typing-aware debounce
    supportsMessageEdit: boolean;        // For streaming updates
  };
}
```

---

## Schema Changes Required

### Add to instances table:
```typescript
// Reply filter (JSONB)
agentReplyFilter: jsonb('agent_reply_filter').$type<AgentReplyFilter>(),

// Typing-aware debounce
messageDebounceRestartOnTyping: boolean('message_debounce_restart_on_typing')
  .notNull()
  .default(false),
```

### AgentReplyFilter type:
```typescript
interface AgentReplyFilter {
  mode: 'all' | 'filtered';
  conditions: {
    onDm: boolean;
    onMention: boolean;
    onReply: boolean;
    onNameMatch: boolean;
    namePatterns?: string[];
  };
}
```

---

## Dependencies

- Agno API running on localhost:8181
- Discord instance configured
- Existing provider infrastructure (DB, API, services)

## Enables

- **OMNICHANNEL AI agents** - Same code, any channel
- AI agent responses in Discord (test target)
- AI agent responses in WhatsApp (ready immediately)
- AI agent responses in ANY future channel (Telegram, Slack, etc.)
- Future: OpenAI/Anthropic/Custom providers (same wiring)
- Future: Tool calling, RAG, multi-agent
