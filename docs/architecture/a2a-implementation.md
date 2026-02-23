---
title: "A2A + Agent Channel Implementation Plan"
created: 2026-02-23
updated: 2026-02-23
tags: [architecture, a2a, agents, channels, ag-ui, implementation]
status: planned
---

# A2A + Agent Channel Implementation Plan

> Implementation plan for A2A protocol support, internal agent-to-agent routing, and AG-UI provider.
> Status: **planned** — beads created, ready to implement.
>
> Related: [[actor-model|Actor Model Design Wish]], [[event-system|Event System]], [[provider-system|Provider System]]

---

## Context

Three capabilities being added:

1. **A2A Server** (`channel-a2a`) — Omni exposes itself as an A2A-compatible agent. External A2A agents send tasks in; Omni routes them through the normal dispatcher and streams responses back.
2. **A2A Client** (`a2a` provider) — Omni can call external A2A-compatible agents. New `ProviderSchema = 'a2a'` slots into the existing provider factory.
3. **Internal routing** (`channel-internal`) — Agents can route responses to other agents within Omni. No external protocol needed.
4. **AG-UI provider** — Implement the stubbed `ag-ui` provider (currently throws 501). Different from A2A: AG-UI is agent→UI streaming, A2A is agent→agent.

**Hard constraint:** All existing providers (agno, webhook, openclaw, claude-code) and channels (whatsapp, discord, slack, telegram) must keep working exactly as before. No changes to `IAgentProvider` interface.

---

## Protocol Reference

### A2A (Agent-to-Agent)

- **Transport:** JSON-RPC 2.0 over HTTPS
- **Discovery:** `GET /.well-known/agent.json` → Agent Card
- **Core methods:** `message/send` (sync), `message/stream` (SSE), `tasks/get`, `tasks/cancel`, `tasks/subscribe`
- **Task states:** `submitted → working → completed | failed | canceled | input-required`
- **Streaming:** SSE events: `taskStatusUpdateEvent`, `taskArtifactUpdateEvent`
- **Parts:** `{ kind: 'text', text }` | `{ kind: 'file', uri | data }` | `{ kind: 'data', mimeType, data }`
- **Session:** `contextId` groups related messages (maps to Omni `sessionId`)
- **Auth:** Bearer token / API key / OAuth2 (advertised in Agent Card)
- **SDKs:** `@a2a-js/sdk` (TypeScript), `a2a-sdk` (Python)

### AG-UI (Agent-User Interaction)

- **Transport:** HTTP POST → SSE response
- **Direction:** Agent → UI (one-way streaming, NOT agent-to-agent)
- **Request:** `{ runId, messages, tools?, context?, state? }`
- **Events (19 types):** `RUN_STARTED/FINISHED/ERROR`, `TEXT_MESSAGE_START/CONTENT/END`, `TOOL_CALL_START/ARGS/END/RESULT`, `STEP_STARTED/FINISHED`, `STATE_DELTA/SNAPSHOT`, `MESSAGES_SNAPSHOT`, `RAW`
- **Adopted by:** CopilotKit, LangGraph, Agno, PydanticAI, Vercel AI, Google ADK, AWS

---

## Bead Map

```
omni-1h2  Foundation (CHANNEL_TYPES, agentCard, event types)
    │
    ├── omni-fdz  channel-a2a (A2A server)     ┐
    ├── omni-9r6  a2a provider (A2A client)     ├── omni-1uw  Integration tests
    ├── omni-2ej  channel-internal              ┘
    └── omni-3g4  ag-ui provider ──────────────┘
```

`fdz`, `9r6`, `2ej`, `3g4` are independent — implement in parallel after `1h2`.

---

## Step 1 — Foundation (`omni-1h2`)

**Files touched:**

### `packages/core/src/types/channel.ts`
```typescript
export const CHANNEL_TYPES = [
  'whatsapp-baileys',
  'whatsapp-cloud',
  'discord',
  'slack',
  'telegram',
  'a2a',        // ← ADD: external A2A protocol
  'internal',   // ← ADD: virtual agent-to-agent routing
] as const;
```

### `packages/db/drizzle/0017_agent_card.sql`
```sql
ALTER TABLE agents ADD COLUMN agent_card jsonb;
```

### `packages/db/src/schema.ts` — agents table
```typescript
agentCard: jsonb('agent_card').$type<AgentCard>(),
```

### `packages/core/src/schemas/agent.ts` — AgentCard type
```typescript
export const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  protocolVersion: z.string().default('0.3.0'),
  url: z.string().url(),
  capabilities: z.object({
    streaming: z.boolean().default(true),
    pushNotifications: z.boolean().default(false),
  }).optional(),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).optional(),
    inputModes: z.array(z.string()).default(['text']),
    outputModes: z.array(z.string()).default(['text']),
  })),
  authentication: z.object({
    schemes: z.array(z.unknown()),
  }).optional(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
```

### `packages/core/src/events/types.ts` — new event types
```typescript
// A2A events
'agent.a2a.task_received'   // external A2A task arrived
'agent.a2a.task_updated'    // task state changed
'agent.a2a.task_completed'  // task done
'agent.a2a.task_failed'     // task error

// Internal routing events
'agent.internal.forwarded'  // message forwarded between agents
```

---

## Step 2 — A2A Channel Plugin (`omni-fdz`)

New package: `packages/channel-a2a/`

```
packages/channel-a2a/
├── src/
│   ├── index.ts           # Singleton export
│   ├── plugin.ts          # A2AChannelPlugin extends BaseChannelPlugin
│   ├── capabilities.ts    # A2A_CAPABILITIES
│   ├── routes/
│   │   ├── agent-card.ts  # GET /.well-known/agent.json
│   │   └── jsonrpc.ts     # POST /a2a/:instanceId — all methods
│   ├── handlers/
│   │   ├── message-send.ts    # message/send
│   │   ├── message-stream.ts  # message/stream (SSE)
│   │   ├── tasks-get.ts       # tasks/get
│   │   └── tasks-cancel.ts    # tasks/cancel
│   ├── mapper.ts          # A2A Task ↔ Omni event translation
│   ├── stream-registry.ts # NATS KV: pending SSE streams per task
│   └── auth.ts            # Bearer token validation
└── package.json
```

### Plugin lifecycle

```typescript
class A2AChannelPlugin extends BaseChannelPlugin {
  readonly id = 'a2a';

  // No external connection — endpoint is always live
  async connect(instanceId, config): Promise<void> {
    await this.instances.setConnected(instanceId);
    await this.emitInstanceConnected(instanceId);
  }

  async disconnect(instanceId): Promise<void> {
    await streamRegistry.cleanup(instanceId); // abort pending SSE streams
    await this.emitInstanceDisconnected(instanceId);
  }

  // Called by dispatcher to send agent response back to A2A caller
  async sendMessage(instanceId, message): Promise<SendResult> {
    const stream = await streamRegistry.get(instanceId, message.metadata.a2aTaskId);
    if (stream) {
      await stream.writeArtifact(message.content.text);
      if (message.metadata.isFinal) await stream.complete();
    }
    await this.emitMessageSent({ instanceId, ...message });
    return { success: true, timestamp: Date.now() };
  }
}
```

### Incoming task → `message.received`

```typescript
// In message-send.ts handler
async function handleMessageSend(instanceId, params) {
  const taskId = generateId();

  // Translate A2A message → Omni event
  await plugin.emitMessageReceived({
    instanceId,
    externalId: taskId,
    chatId: params.message.contextId ?? generateId(),
    from: 'external-agent',
    content: {
      type: 'text',
      text: extractText(params.message.parts),
    },
    metadata: {
      a2aTaskId: taskId,
      a2aContextId: params.message.contextId,
      a2aMessageId: params.message.messageId,
    },
  });

  // Return initial task object
  return { id: taskId, status: { state: 'submitted' }, ... };
}
```

### Agent Card endpoint

```typescript
// GET /.well-known/agent.json
// GET /a2a/:instanceId/.well-known/agent.json
async function serveAgentCard(instanceId) {
  const instance = await services.instances.getById(instanceId);
  const agent = instance.agentId
    ? await services.agents.getById(instance.agentId)
    : null;

  return {
    name: agent?.name ?? instance.name,
    description: agent?.agentCard?.description ?? '',
    version: '1.0.0',
    protocolVersion: '0.3.0',
    url: `${config.baseUrl}/a2a/${instanceId}`,
    capabilities: { streaming: true, pushNotifications: false },
    skills: agent?.agentCard?.skills ?? [{ id: 'default', name: 'Chat', description: '' }],
    authentication: {
      schemes: [{ type: 'apiKey', name: 'X-Api-Key', in: 'header' }],
    },
  };
}
```

### Route registration in API

```typescript
// packages/api/src/routes/v2/index.ts
import { a2aPlugin } from '@omni/channel-a2a';

app.get('/.well-known/agent.json', serveDefaultAgentCard);
app.get('/a2a/:instanceId/.well-known/agent.json', serveAgentCard);
app.post('/a2a/:instanceId', validateA2AAuth, handleJsonRpc);
```

---

## Step 3 — A2A Provider (`omni-9r6`)

### `packages/core/src/types/agent.ts`
```typescript
export const PROVIDER_SCHEMAS = [
  'agno', 'webhook', 'openclaw', 'ag-ui', 'claude-code',
  'a2a',  // ← ADD
] as const;
```

### `packages/core/src/providers/a2a-client.ts`

```typescript
class A2AClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  async sendMessage(params: A2ASendParams): Promise<A2ATask> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: generateId(),
        method: 'message/send',
        params,
      }),
    });
    const { result, error } = await res.json();
    if (error) throw new ProviderError(error.message, error.code);
    return result;
  }

  async *sendMessageStream(params: A2ASendParams): AsyncGenerator<A2AStreamEvent> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: generateId(),
        method: 'message/stream', params,
      }),
    });
    yield* parseSSEStream(res.body!);
  }

  async getTask(taskId: string): Promise<A2ATask> { ... }
  async cancelTask(taskId: string): Promise<void> { ... }
  async checkHealth(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/.well-known/agent.json`);
    return res.ok;
  }
}
```

### `packages/core/src/providers/a2a-provider.ts`

```typescript
class A2AAgentProvider implements IAgentProvider {
  readonly schema = 'a2a';

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const task = await this.client.sendMessage({
      message: {
        messageId: generateId(),
        role: 'user',
        parts: [{ kind: 'text', text: context.content.text ?? '' }],
      },
      contextId: context.sessionId,  // A2A contextId = Omni sessionId
    });

    // Poll until terminal state
    const completed = await this.waitForCompletion(task.id);
    const text = extractTextFromArtifacts(completed.artifacts);

    return {
      parts: splitParts(text),
      metadata: { runId: task.id, providerId: this.id, durationMs: 0 },
    };
  }

  async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
    for await (const event of this.client.sendMessageStream({
      message: { messageId: generateId(), role: 'user', parts: [{ kind: 'text', text: context.content.text ?? '' }] },
      contextId: context.sessionId,
    })) {
      if (event.taskArtifactUpdateEvent) {
        const text = event.taskArtifactUpdateEvent.artifact.parts
          .filter(p => p.kind === 'text').map(p => p.text).join('');
        if (text) yield { phase: 'content', content: text };
      }
      if (event.taskStatusUpdateEvent?.status.state === 'completed') {
        yield { phase: 'final', content: '' };
        return;
      }
      if (event.taskStatusUpdateEvent?.status.state === 'input-required') {
        // Maps to AgentChatState 'waiting' — dispatcher handles this
        yield { phase: 'error', error: 'input-required' };
        return;
      }
    }
  }
}
```

---

## Step 4 — Internal Channel (`omni-2ej`)

### New package: `packages/channel-internal/`

```typescript
class InternalChannelPlugin extends BaseChannelPlugin {
  readonly id = 'internal';

  async connect(instanceId, config): Promise<void> {
    await this.emitInstanceConnected(instanceId);
  }

  async sendMessage(instanceId, message): Promise<SendResult> {
    // Route agent response as a new inbound message to target instance
    const targetInstanceId = message.metadata?.chainToInstanceId;
    if (!targetInstanceId) return { success: false, error: 'No chain target', timestamp: Date.now() };

    await this.emitMessageReceived({
      instanceId: targetInstanceId,
      externalId: generateId(),
      chatId: message.to,
      from: instanceId,  // source instance as sender
      content: message.content,
      metadata: {
        hopDepth: (message.metadata?.hopDepth ?? 0) + 1,
        sourceInstanceId: instanceId,
        sourceAgentId: message.metadata?.senderAgentId,
        sourceConversationId: message.metadata?.conversationId,
        isInternalRoute: true,
      },
    });

    return { success: true, timestamp: Date.now() };
  }
}
```

### Dispatcher extension

```typescript
// packages/api/src/plugins/agent-dispatcher.ts
// After sendResponseParts() — add chain routing

async function maybeChainToNextAgent(
  instance: DispatchInstance,
  result: AgentTriggerResult,
  context: MessageContext,
): Promise<void> {
  const chainInstanceId = instance.chainToInstanceId;
  if (!chainInstanceId) return;

  // Loop protection
  const hopDepth = context.event.metadata?.hopDepth ?? 0;
  if (hopDepth >= 5) {
    logger.warn('Chain hop limit reached', { instanceId: instance.id, hopDepth });
    return;
  }

  const internalPlugin = channelRegistry.get('internal');
  if (!internalPlugin) return;

  await internalPlugin.sendMessage(instance.id, {
    to: context.chatId,
    content: { type: 'text', text: result.parts.join('\n\n') },
    metadata: {
      chainToInstanceId: chainInstanceId,
      hopDepth,
      senderAgentId: instance.agentId,
      conversationId: context.conversationId,
      chainMode: instance.chainMode ?? 'replace',
    },
  });
}
```

### New Instance fields
```typescript
// instances table (new migration)
chainToInstanceId: uuid('chain_to_instance_id').references(() => instances.id),
chainMode: varchar('chain_mode', { length: 20 }).default('replace'), // 'replace' | 'parallel'
```

---

## Step 5 — AG-UI Provider (`omni-3g4`)

### `packages/core/src/providers/ag-ui-provider.ts`

```typescript
class AGUiAgentProvider implements IAgentProvider {
  readonly schema = 'ag-ui';

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const res = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
      },
      body: JSON.stringify({
        runId: context.traceId,
        messages: [{ role: 'user', content: context.content.text, id: generateId() }],
      }),
    });

    let text = '';
    for await (const event of parseAGUiStream(res.body!)) {
      if (event.type === 'TEXT_MESSAGE_CONTENT') text += event.delta ?? '';
      if (event.type === 'TOOL_CALL_START') {
        // Emit as AgentTask
        await services.agentTasks.create({
          agentId: context.instanceAgentId,
          chatId: context.source.chatId,
          type: 'tool_call',
          title: event.toolCallName ?? 'Tool call',
          metadata: { toolName: event.toolCallName },
        });
      }
    }

    return { parts: [text], metadata: { runId: context.traceId, providerId: this.id, durationMs: 0 } };
  }

  async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
    const res = await fetch(this.config.baseUrl, { /* same */ });
    for await (const event of parseAGUiStream(res.body!)) {
      if (event.type === 'TEXT_MESSAGE_CONTENT' && event.delta) {
        yield { phase: 'content', content: event.delta };
      }
      if (event.type === 'RUN_FINISHED') {
        yield { phase: 'final', content: '' };
        return;
      }
      if (event.type === 'RUN_ERROR') {
        yield { phase: 'error', error: event.message ?? 'AG-UI run error' };
        return;
      }
    }
  }
}
```

### `packages/core/src/providers/ag-ui-client.ts`

```typescript
async function* parseAGUiStream(body: ReadableStream): AsyncGenerator<AGUiEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6)) as AGUiEvent;
        } catch {}
      }
    }
  }
}
```

---

## What Does NOT Change

| Component | Status |
|---|---|
| `IAgentProvider` interface | Unchanged |
| `AgentTrigger` / `AgentTriggerResult` | Unchanged |
| agno, webhook, openclaw, claude-code providers | Unchanged |
| WhatsApp, Discord, Slack, Telegram plugins | Unchanged |
| Agent dispatcher core flow | Unchanged (extension only — new hook after sendResponseParts) |
| All existing DB tables | Unchanged (only additive: agentCard column, chainToInstanceId on instances) |
| Existing routes / API | Unchanged (new routes added alongside) |

---

## Verification Checklist

Before marking any bead complete:

- [ ] `bun run build` passes with no new type errors
- [ ] Existing provider tests pass (agno, webhook, claude-code)
- [ ] Existing channel tests pass (whatsapp, discord)
- [ ] New feature has at least one integration test
- [ ] No changes to `IAgentProvider`, `AgentTrigger`, `AgentTriggerResult`
- [ ] `isFromMe` flag still set correctly (backward compat)
- [ ] Rate limiting and debounce still apply to all message paths including internal
