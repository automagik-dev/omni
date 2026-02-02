# WISH: Agent Provider Implementation

> Implement the provider client layer to actually call LLMs when messages arrive.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-r76

---

## Context

The agent provider **structure** exists (DB schema, API routes, service layer) but the **execution** is missing. We can create/configure providers but nothing actually calls them when a message arrives.

**Current State:**
- ✅ `agent_providers` table with schema, baseUrl, apiKey, capabilities
- ✅ CRUD API at `/api/v2/providers`
- ✅ Instances can reference a provider via `agentProviderId`
- ❌ No provider clients (OpenAI, Anthropic, Agno, Custom)
- ❌ No message→provider wiring
- ❌ No streaming support implementation

**Goal:** When a message arrives for an instance with a configured provider, call the LLM and send the response back.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | We need test APIs for each provider type to validate behavior |
| **ASM-2** | Assumption | Streaming is important for UX |
| **DEC-1** | Decision | Follow patterns from `docs/architecture/provider-system.md` |
| **DEC-2** | Decision | Start with OpenAI client (most common), then others |
| **DEC-3** | Decision | Explore AG-UI / A2A protocols for future standardization |
| **REQ-1** | Requirement | **EXTERNAL DEV TASK:** Set up test APIs for validation |

---

## Scope

### IN SCOPE

- Provider client implementations (OpenAI, Anthropic, Agno, Custom)
- Provider client factory
- Message→Provider wiring in event handlers
- Streaming support
- Basic conversation context (recent messages)
- Protocol exploration (AG-UI, A2A)

### OUT OF SCOPE

- Full conversation memory / RAG
- Tool/function calling
- Multi-modal beyond images (audio, video transcription already exists)
- Provider cost tracking

---

## External Dev Task: Test APIs

**IMPORTANT:** Before we can validate our clients work correctly, we need simple test endpoints.

### Required Test Endpoints

| Schema | Endpoint Needed | Purpose |
|--------|-----------------|---------|
| OpenAI | Echo server at `/v1/chat/completions` | Returns "Echo: {user message}" |
| Anthropic | Echo server at `/v1/messages` | Returns "Echo: {user message}" |
| Agno | Echo agent at `/agents/{id}/runs` | Returns "Echo: {user message}" |

**Suggested Approach:**
1. Simple Bun/Hono server with 3 routes
2. Each route accepts the schema's format, returns echo response
3. Support both streaming and non-streaming
4. Deploy somewhere accessible (or run locally)

**Example Echo Server Spec:**

```typescript
// POST /v1/chat/completions (OpenAI format)
// Request: { model, messages: [{ role: "user", content: "Hello" }] }
// Response: { choices: [{ message: { role: "assistant", content: "Echo: Hello" }}]}

// POST /v1/messages (Anthropic format)
// Request: { model, messages: [{ role: "user", content: "Hello" }] }
// Response: { content: [{ type: "text", text: "Echo: Hello" }]}

// POST /agents/:id/runs (Agno format)
// Request: { message: "Hello", stream: false }
// Response: { content: "Echo: Hello", run_id: "..." }
```

**Streaming versions** should chunk the response character by character with 50ms delays.

---

## Execution Group A: Base Infrastructure

**Goal:** Create the provider client foundation.

**Deliverables:**
- [ ] `packages/core/src/providers/types.ts` - Shared types
- [ ] `packages/core/src/providers/base-client.ts` - Abstract base class
- [ ] `packages/core/src/providers/factory.ts` - Client factory
- [ ] `packages/core/src/providers/index.ts` - Exports

**Types:**

```typescript
interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: Array<{ url?: string; base64?: string; mimeType: string }>;
}

interface ProviderRequest {
  messages: ProviderMessage[];
  stream?: boolean;
  sessionId?: string;
  userId?: string;
}

interface ProviderResponse {
  content: string;
  usage?: { inputTokens: number; outputTokens: number };
  metadata?: Record<string, unknown>;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

abstract class BaseProviderClient {
  abstract send(request: ProviderRequest): Promise<ProviderResponse>;
  abstract sendStream(request: ProviderRequest): AsyncGenerator<StreamChunk>;
  abstract healthCheck(): Promise<boolean>;
}
```

---

## Execution Group B: Provider Clients

**Goal:** Implement clients for each schema type.

**Deliverables:**
- [ ] `packages/core/src/providers/openai-client.ts`
- [ ] `packages/core/src/providers/anthropic-client.ts`
- [ ] `packages/core/src/providers/agno-client.ts`
- [ ] `packages/core/src/providers/custom-client.ts`

**Acceptance Criteria:**
- [ ] OpenAI client sends/receives in OpenAI format
- [ ] Anthropic client sends/receives in Anthropic format
- [ ] Agno client sends/receives in Agno format (form-data or JSON)
- [ ] Custom client uses template-based request/response mapping
- [ ] All clients support streaming
- [ ] All clients handle errors gracefully

**Validation (with echo servers):**
```bash
# Unit tests against echo servers
bun test packages/core/src/providers/__tests__/
```

---

## Execution Group C: Message Wiring

**Goal:** Wire incoming messages to provider calls.

**Deliverables:**
- [ ] `packages/core/src/providers/service.ts` - Provider service
- [ ] Update message event handlers to call providers
- [ ] Implement response sending back to channel

**Flow:**

```
message.received event
    ↓
Check instance.agentProviderId
    ↓
If provider configured:
    - Build messages array (system prompt + recent context + new message)
    - Call provider.send() or provider.sendStream()
    - Send response back via channel plugin
    ↓
Emit agent.response event
```

**Acceptance Criteria:**
- [ ] Message to instance with provider triggers LLM call
- [ ] Response is sent back to the sender
- [ ] Streaming responses send incremental updates (or buffer then send)
- [ ] No provider = no action (passthrough)

---

## Execution Group D: Protocol Exploration

**Goal:** Research AG-UI and A2A protocols for potential future adoption.

**Deliverables:**
- [ ] `docs/research/agent-protocols.md` - Research document

### AG-UI Protocol

[AG-UI](https://docs.ag-ui.com) (Agent User Interaction Protocol) - Standard for AI agents to interact with UIs.

**Research Questions:**
- What does AG-UI define?
- How does it handle streaming?
- Is it relevant to Omni's use case (messaging, not UI)?
- Could we adapt it for message-based interactions?

### A2A Protocol

[A2A](https://github.com/google/A2A) (Agent-to-Agent) - Google's protocol for agent interoperability.

**Research Questions:**
- What does A2A define?
- How do agents discover and communicate?
- Is it overkill for our use case?
- Could providers implement A2A for standardization?

### Clarification: MCP vs Agent Protocols

**MCP is NOT for agent communication.** In Omni:
- MCP = wrapper around the CLI (for AI assistants like Claude Code to manage Omni)
- Future: "omni skill" following SKILLS.md guidelines, using the omni CLI

AG-UI and A2A are candidates for **message→agent** communication standardization.

**Output:** Document comparing AG-UI vs A2A with recommendation for Omni's agent protocol.

---

## Technical Notes

### Provider Resolution

```typescript
// In message handler
async function handleMessage(event: MessageReceivedEvent) {
  const instance = await getInstance(event.instanceId);

  // Get provider (from reference or inline config)
  const provider = instance.agentProviderId
    ? await getProvider(instance.agentProviderId)
    : instance.agentApiUrl
      ? buildInlineProvider(instance)
      : null;

  if (!provider) return; // No agent configured

  const client = factory.create(provider);
  const response = await client.send({
    messages: buildMessages(instance, event),
  });

  await sendMessage(instance.id, event.from, response.content);
}
```

### Conversation Context

Start simple - last N messages from the chat:

```typescript
function buildMessages(instance: Instance, event: MessageEvent): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  // System prompt from provider config
  const systemPrompt = instance.agentProvider?.schemaConfig?.systemPrompt;
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Recent messages (last 10) for context
  const recent = await getRecentMessages(event.chatId, 10);
  for (const msg of recent) {
    messages.push({
      role: msg.isFromMe ? 'assistant' : 'user',
      content: msg.textContent || '[media]',
    });
  }

  // Current message
  messages.push({
    role: 'user',
    content: event.content.text || '[media]',
    images: event.mediaUrl ? [{ url: event.mediaUrl, mimeType: event.mediaMimeType }] : undefined,
  });

  return messages;
}
```

### Streaming Strategy

For messaging platforms, we have two options:

1. **Buffer then send** - Wait for complete response, send as one message
2. **Typing indicator + send** - Show typing, then send complete response
3. **Edit message** (Discord only) - Send placeholder, edit with chunks

Start with option 2 (simplest).

---

## Dependencies

- Test APIs from external dev (Group A-C blocked until available)
- Existing provider CRUD API

## Depends On

- None (can start immediately for structure, blocked for validation)

## Enables

- Actual AI agent functionality
- Future: Tool calling, RAG, multi-agent
