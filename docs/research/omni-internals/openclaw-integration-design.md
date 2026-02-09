---
title: "OpenClaw ↔ Omni Integration Design"
created: 2026-02-09
updated: 2026-02-09
status: research-complete
type: architecture-research
tags:
  - openclaw
  - integration
  - architecture
  - channels
  - messaging
author: coral-research-agent
---

# OpenClaw ↔ Omni Integration Design

> How Omni becomes OpenClaw's messaging backbone — a comprehensive integration plan based on deep architectural analysis of both systems.

## Executive Summary

OpenClaw is a personal AI assistant platform with a rich plugin system for messaging channels (Telegram, Discord, WhatsApp, Slack, Signal, iMessage, etc.) and AI agent orchestration. Omni is an event-driven omnichannel messaging platform with identity resolution, media processing, and multi-provider agent routing. The integration opportunity is to make Omni the **unified messaging and identity layer** that OpenClaw consumes, rather than each system independently implementing channel connectors.

**Recommended approach: Omni as an OpenClaw Extension Plugin** — the cleanest integration path that leverages OpenClaw's mature plugin SDK while giving Omni control over the messaging substrate.

---

## Part 1: OpenClaw Architecture Deep Dive

### 1.1 System Overview

OpenClaw is a **desktop-first personal AI assistant** with these core components:

| Component | Description |
|-----------|-------------|
| **Gateway** | WebSocket server (port 18789) managing channels, nodes, sessions, hooks |
| **Agent (Pi)** | LLM-powered agent with tools, sessions, memory, streaming |
| **Channels** | Messaging connectors (Telegram, Discord, WhatsApp, etc.) |
| **Nodes** | Paired devices (phones, other machines) for camera/screen/location |
| **Extensions** | Plugin system for adding channels, tools, hooks, providers |
| **CLI** | `openclaw` command for configuration, management, and interaction |

**Key architectural insight**: OpenClaw runs as a **single-user system** (one gateway per person), not a multi-tenant server. The gateway runs locally or on a VPS, serving one human's AI assistant.

### 1.2 Plugin System Architecture

OpenClaw's extension system is the primary integration surface. Extensions live in `extensions/` as workspace packages.

#### Plugin Manifest (`openclaw.plugin.json`)

```json
{
  "id": "whatsapp",
  "channels": ["whatsapp"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

#### Plugin Entry Point Pattern

Every extension follows this pattern:

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

const plugin = {
  id: "my-extension",
  name: "My Extension",
  description: "...",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // Set runtime for internal use
    setMyRuntime(api.runtime);
    // Register capabilities
    api.registerChannel({ plugin: myChannelPlugin });
    api.registerTool(myTool);
    api.registerHook("message.received", handler);
    api.registerGatewayMethod("my.method", handler);
    api.registerHttpRoute({ path: "/my-webhook", handler });
    api.registerService(myService);
    api.registerCommand(myCommand);
  },
};
export default plugin;
```

#### Plugin API Surface (`OpenClawPluginApi`)

| Method | Purpose |
|--------|---------|
| `registerChannel(registration)` | Add a messaging channel |
| `registerTool(tool, opts)` | Add an agent tool |
| `registerHook(events, handler, opts)` | Add event hooks |
| `registerGatewayMethod(method, handler)` | Add WebSocket RPC methods |
| `registerHttpHandler(handler)` | Add HTTP handlers to the gateway server |
| `registerHttpRoute({ path, handler })` | Add specific HTTP routes |
| `registerProvider(provider)` | Add an AI model provider |
| `registerCli(registrar, opts)` | Add CLI subcommands |
| `registerService(service)` | Add background services |
| `registerCommand(command)` | Add slash/chat commands |
| `on(hookName, handler, opts)` | Typed hook registration |

#### Plugin Runtime (`PluginRuntime`)

The runtime object injected into plugins provides access to core behavior without direct imports:

- `channel.text` — text chunking, control command detection
- `channel.reply` — buffered reply dispatch with typing indicators
- `channel.routing` — agent route resolution (session keys)
- `channel.pairing` — DM pairing approval workflow
- `channel.media` — media download/save
- `channel.mentions` — mention pattern matching
- `channel.groups` — group policy resolution
- `channel.debounce` — inbound message debouncing
- `channel.commands` — command authorization
- `logging` — structured logging
- `state` — state directory resolution

### 1.3 Channel Plugin Interface (`ChannelPlugin`)

This is the heart of the integration. A `ChannelPlugin` implements:

```typescript
interface ChannelPlugin {
  id: ChannelId;
  meta: ChannelMeta;         // Label, docs, blurb, system image
  capabilities: ChannelCapabilities;  // Chat types, polls, reactions, media, etc.
  
  // Account management
  config: ChannelConfigAdapter;      // Account CRUD, enable/disable
  security: ChannelSecurityAdapter;  // DM policy, pairing, allowlists
  setup: ChannelSetupAdapter;       // Account creation/configuration
  
  // Messaging
  outbound: ChannelOutboundAdapter;  // Send text, media, polls
  messaging: ChannelMessagingAdapter; // Target normalization
  
  // Features
  groups: ChannelGroupAdapter;       // Group mention policy
  mentions: ChannelMentionAdapter;   // @mention stripping
  threading: ChannelThreadingAdapter; // Thread/reply context
  commands: ChannelCommandAdapter;   // Slash commands
  actions: ChannelMessageActionAdapter; // Reactions, polls
  
  // Lifecycle
  gateway: ChannelGatewayAdapter;    // Start/stop/login/logout accounts
  heartbeat: ChannelHeartbeatAdapter; // Health checks
  status: ChannelStatusAdapter;      // Status reporting
  auth: ChannelAuthAdapter;         // Login flow
  directory: ChannelDirectoryAdapter; // Contact/group directory
  
  // Agent
  agentTools: () => AgentTool[];     // Channel-specific tools
  agentPrompt: ChannelAgentPromptAdapter; // System prompt additions
}
```

### 1.4 Channel Dock (Lightweight Metadata)

The "dock" system provides lightweight channel behavior without loading heavy implementations:

```typescript
interface ChannelDock {
  id: ChannelId;
  capabilities: ChannelCapabilities;
  commands?: ChannelCommandAdapter;
  outbound?: { textChunkLimit?: number };
  streaming?: { blockStreamingCoalesceDefaults?: { minChars, idleMs } };
  elevated?: ChannelElevatedAdapter;
  config?: { resolveAllowFrom, formatAllowFrom };
  groups?: ChannelGroupAdapter;
  mentions?: ChannelMentionAdapter;
  threading?: ChannelThreadingAdapter;
  agentPrompt?: ChannelAgentPromptAdapter;
}
```

### 1.5 Message Flow (Inbound)

Tracing an inbound message through OpenClaw (e.g., Telegram):

```
1. Telegram sends webhook/update to the channel monitor
   └─► Channel-specific listener (e.g., Bot API long polling)

2. Channel normalizes the message into OpenClaw's internal context format:
   - From (sender ID), To (bot ID), Body (text)
   - ChatType (direct/group/channel/thread)
   - MessageThreadId, ReplyToId
   - SenderId, SenderName
   - Media attachments

3. Security check:
   - DM policy: open / pairing / allowlist
   - Group policy: open / allowlist / mention-gated
   - If blocked → pairing flow or silent reject

4. Route resolution (resolveAgentRoute):
   - Matches bindings: peer → guild → team → account → channel → default
   - Determines agentId and sessionKey
   - Session key format: agent:<agentId>:main or agent:<agentId>:<channel>:<peer>

5. Agent invocation:
   - Loads session history (compaction-managed)
   - Enriches with channel context, media transcriptions
   - Calls LLM provider (Claude, GPT, etc.)
   - Streams response back via the channel

6. Reply dispatch:
   - Buffered block streaming (coalesced chunks)
   - Text chunking (per-channel limits: WA=4000, Discord=2000, etc.)
   - Typing indicators
   - Media attachment forwarding
```

### 1.6 Message Flow (Outbound)

```
1. Agent generates response (text/media/tools)

2. Reply dispatcher:
   - Splits text into chunks per channel limits
   - Adds typing indicators between chunks
   - Resolves media URLs for download/forwarding

3. Channel outbound adapter:
   - resolveTarget() → normalize recipient ID
   - sendText() / sendMedia() / sendPoll()
   - Returns { channel, messageId, ... }

4. Status tracking:
   - Runtime status updated (lastMessageAt, lastEventAt)
   - Heartbeat checks enabled
```

### 1.7 Plugin Discovery

Plugins are discovered from multiple locations:

1. **Config paths** (`extraPaths` in config)
2. **Workspace extensions** (`.openclaw/extensions/` in workspace)
3. **Global extensions** (`~/.openclaw/extensions/`)
4. **Bundled plugins** (shipped with OpenClaw)

Discovery reads `package.json` for `openclaw.extensions` field or falls back to `index.ts`/`index.js`.

### 1.8 Configuration System

OpenClaw uses a JSON config at `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "whatsapp": {
      "accounts": {
        "default": {
          "name": "My WhatsApp",
          "enabled": true,
          "authDir": "~/.openclaw/web-auth/default",
          "allowFrom": ["+1234567890"],
          "dmPolicy": "pairing"
        }
      }
    },
    "telegram": { ... },
    "discord": { ... }
  },
  "agents": {
    "default": { ... },
    "list": [{ "id": "main", ... }]
  },
  "gateway": { "mode": "local", "port": 18789 },
  "session": { "dmScope": "main" },
  "routing": { "bindings": [...] }
}
```

---

## Part 2: Omni v2 Architecture Summary

### 2.1 Core Design

Omni v2 is an **event-driven, multi-tenant** messaging platform:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Event Bus** | NATS JetStream | All state changes as events, persistence, replay |
| **API** | Hono + tRPC | HTTP API with OpenAPI docs |
| **Database** | PostgreSQL + Drizzle | Events, identity, access rules |
| **Channel Manager** | Plugin registry | Channel plugin lifecycle |
| **Identity Graph** | Custom service | Unified cross-channel person identity |
| **Media Pipeline** | Parallel workers | Transcription (Whisper), description (Gemini), extraction |
| **Agent Router** | Provider abstraction | OpenAI / Anthropic / Agno / Custom agent providers |

### 2.2 Omni's Strengths (vs OpenClaw)

| Capability | Omni | OpenClaw |
|-----------|------|----------|
| **Multi-tenant** | ✅ Multiple instances, shared infra | ❌ Single-user per gateway |
| **Identity graph** | ✅ Cross-channel person resolution | ❌ Per-channel identity only |
| **Event sourcing** | ✅ Full event bus (NATS), replay, audit | ❌ Session logs, no event bus |
| **Media pipeline** | ✅ Dedicated workers, parallel processing | ✅ Built-in transcription/description |
| **Agent routing** | ✅ Multi-provider, per-instance config | ✅ Multi-model, per-session routing |
| **API surface** | ✅ Full REST + tRPC + WebSocket + MCP | ⚠️ WebSocket RPC + CLI (no REST API) |
| **Channel maturity** | ⚠️ WhatsApp Baileys primary | ✅ 7+ channels, mature extensions |

### 2.3 Omni's Event Types

```
MESSAGES stream:  message.received, message.sending, message.sent, message.status
IDENTITY stream:  identity.resolved, identity.merged, identity.updated
MEDIA stream:     media.received, media.processing, media.processed, media.failed
AGENT stream:     agent.request, agent.response, agent.error
ACCESS stream:    access.checked, access.rule_changed
CHANNEL stream:   channel.connected, channel.disconnected, channel.qr_code
```

---

## Part 3: Integration Design

### 3.1 Integration Options Analysis

#### Option A: Omni as OpenClaw Extension Plugin ⭐ RECOMMENDED

**Approach**: Build an OpenClaw extension that registers Omni as a channel provider. OpenClaw sends/receives messages through Omni's API. Omni handles all channel connections; OpenClaw handles AI agent logic.

```
┌─────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                   │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │   Agent Pi  │  │   Hooks     │  │   Tools      │ │
│  │   (LLM)     │  │   System    │  │   System     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘ │
│         │                │                │          │
│         └────────────────┼────────────────┘          │
│                          │                            │
│  ┌───────────────────────┴───────────────────────┐   │
│  │        extensions/omni (Channel Plugin)        │   │
│  │                                                │   │
│  │  register(api) {                               │   │
│  │    api.registerChannel({ plugin: omniChannel })│   │
│  │    api.registerHttpRoute("/omni/webhook")      │   │
│  │    api.registerTool(omniSearchTool)            │   │
│  │  }                                             │   │
│  └───────────────────────┬───────────────────────┘   │
│                          │ HTTP/WebSocket              │
└──────────────────────────┼────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│                     Omni v2 API                       │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ WhatsApp │  │ Discord  │  │  Slack   │   ...      │
│  │ Baileys  │  │   Bot    │  │  Socket  │            │
│  └──────────┘  └──────────┘  └──────────┘            │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │  Event Bus (NATS) → Identity → Media Pipeline │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

**Pros:**
- Cleanest integration — uses OpenClaw's native plugin API
- Omni handles all channel complexity, connection management, identity
- OpenClaw handles agent logic, tools, memory, sessions
- Each system does what it's best at
- OpenClaw gets all Omni channels "for free" (WhatsApp, Discord, Slack, etc.)
- Omni's identity graph gives OpenClaw cross-channel person awareness

**Cons:**
- Requires building a non-trivial OpenClaw extension
- Latency: OpenClaw → HTTP → Omni → Channel (extra hop)
- Two systems to maintain and deploy

#### Option B: OpenClaw Routes Messages to Omni for Delivery

**Approach**: OpenClaw handles inbound (native channels) but delegates outbound delivery to Omni.

**Verdict**: Partial integration, doesn't leverage Omni's full value. ❌

#### Option C: Omni Exposes Webhooks That OpenClaw Consumes

**Approach**: Omni receives messages and forwards them to OpenClaw via webhooks.

**Verdict**: Works but creates a fragile webhook chain. Better as a component of Option A. ⚠️

#### Option D: Full Replacement (Omni replaces OpenClaw channels)

**Approach**: Omni completely replaces OpenClaw's channel system.

**Verdict**: Too invasive, OpenClaw's channel system is deeply integrated. ❌

### 3.2 Detailed Design: Option A (Omni Extension)

#### 3.2.1 Extension Structure

```
extensions/omni/
├── openclaw.plugin.json
├── package.json
├── index.ts                    # Entry point
├── src/
│   ├── channel.ts              # ChannelPlugin implementation
│   ├── runtime.ts              # Runtime storage
│   ├── omni-client.ts          # Omni API client
│   ├── webhook-handler.ts      # Inbound webhook from Omni
│   ├── config-schema.ts        # Zod schema for plugin config
│   ├── accounts.ts             # Account management
│   ├── identity-tool.ts        # Agent tool: search people
│   ├── send-adapter.ts         # Outbound message delivery
│   └── types.ts
└── README.md
```

#### 3.2.2 Plugin Manifest

```json
{
  "id": "omni",
  "channels": ["omni-whatsapp", "omni-discord", "omni-slack"],
  "configSchema": {
    "type": "object",
    "properties": {
      "apiUrl": { "type": "string", "description": "Omni API base URL" },
      "apiKey": { "type": "string", "description": "Omni API key" },
      "webhookSecret": { "type": "string", "description": "Webhook signing secret" }
    },
    "required": ["apiUrl", "apiKey"]
  }
}
```

#### 3.2.3 Registration Flow

```typescript
// extensions/omni/index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { omniChannelPlugin } from "./src/channel.js";
import { setOmniRuntime } from "./src/runtime.js";
import { omniIdentityTool, omniTimelineTool } from "./src/identity-tool.js";
import { createWebhookHandler } from "./src/webhook-handler.js";

const plugin = {
  id: "omni",
  name: "Omni Messaging",
  description: "Omni v2 omnichannel messaging backbone",
  configSchema: { /* ... */ },
  
  register(api: OpenClawPluginApi) {
    setOmniRuntime(api.runtime);
    const config = api.pluginConfig as OmniPluginConfig;
    
    // Register Omni as a channel (one per Omni instance/channel)
    api.registerChannel({ plugin: omniChannelPlugin });
    
    // Register webhook endpoint for inbound messages from Omni
    api.registerHttpRoute({
      path: "/omni/webhook",
      handler: createWebhookHandler(config),
    });
    
    // Register identity search tool for the agent
    api.registerTool(omniIdentityTool(config), {
      name: "omni_search_person",
    });
    
    // Register timeline tool
    api.registerTool(omniTimelineTool(config), {
      name: "omni_person_timeline",
    });
    
    // Register gateway methods for status/management
    api.registerGatewayMethod("omni.status", async (params) => {
      return await getOmniClient(config).getHealth();
    });
    
    api.registerGatewayMethod("omni.instances", async (params) => {
      return await getOmniClient(config).listInstances();
    });
  },
};
export default plugin;
```

#### 3.2.4 Channel Plugin Implementation

The `ChannelPlugin` for Omni acts as a bridge, translating OpenClaw's channel interface into Omni API calls:

```typescript
// extensions/omni/src/channel.ts
export const omniChannelPlugin: ChannelPlugin = {
  id: "omni",
  meta: {
    label: "Omni",
    selectionLabel: "Omni (Multi-Channel)",
    detailLabel: "Omni v2",
    docsPath: "/channels/omni",
    docsLabel: "omni",
    blurb: "route messages through Omni v2 for unified identity and multi-channel support.",
    systemImage: "globe",
  },
  
  capabilities: {
    chatTypes: ["direct", "group"],
    polls: true,
    reactions: true,
    media: true,
  },

  // Config: maps Omni instances to OpenClaw accounts
  config: {
    listAccountIds: (cfg) => listOmniAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveOmniAccount(cfg, accountId),
    isEnabled: (account) => account.enabled,
    isConfigured: async (account) => {
      const client = getOmniClient();
      const instance = await client.getInstance(account.instanceId);
      return instance?.status === "active";
    },
  },

  // Outbound: send via Omni API
  outbound: {
    deliveryMode: "gateway",
    textChunkLimit: 4000,
    
    sendText: async ({ to, text, accountId }) => {
      const client = getOmniClient();
      const result = await client.sendMessage({
        instanceId: resolveInstanceId(accountId),
        to,
        content: { type: "text", text },
      });
      return { channel: "omni", messageId: result.messageId };
    },
    
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const client = getOmniClient();
      const result = await client.sendMessage({
        instanceId: resolveInstanceId(accountId),
        to,
        content: { type: "media", text, mediaUrl },
      });
      return { channel: "omni", messageId: result.messageId };
    },
    
    resolveTarget: ({ to, allowFrom, mode }) => {
      // Omni handles target normalization
      return { ok: true, to };
    },
  },

  // Gateway: lifecycle through Omni API
  gateway: {
    startAccount: async (ctx) => {
      const client = getOmniClient();
      // Register webhook with Omni for this instance
      await client.registerWebhook({
        instanceId: ctx.account.instanceId,
        url: `${ctx.gatewayUrl}/plugin/omni/webhook`,
        secret: ctx.webhookSecret,
        events: ["message.received", "message.status"],
      });
      ctx.log?.info(`[omni:${ctx.accountId}] registered webhook`);
    },
  },

  // Status: proxy from Omni
  status: {
    buildChannelSummary: async ({ account }) => {
      const client = getOmniClient();
      const instance = await client.getInstance(account.instanceId);
      return {
        configured: true,
        running: instance?.status === "active",
        connected: instance?.status === "active",
      };
    },
  },
};
```

#### 3.2.5 Webhook Handler (Inbound Messages)

When Omni receives a message, it forwards it to OpenClaw via webhook:

```typescript
// extensions/omni/src/webhook-handler.ts
export function createWebhookHandler(config: OmniPluginConfig) {
  return async (req: Request): Promise<Response> => {
    // Verify webhook signature
    const signature = req.headers.get("x-omni-signature");
    if (!verifySignature(signature, await req.text(), config.webhookSecret)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const event = await req.json();
    
    switch (event.type) {
      case "message.received": {
        const { payload } = event;
        // Inject into OpenClaw's message processing pipeline
        // This is where OpenClaw's agent picks up the message
        await injectInboundMessage({
          channel: "omni",
          accountId: payload.instanceId,
          from: payload.sender.platformUserId,
          to: payload.instanceId,
          body: payload.content.text,
          chatType: payload.conversationId?.includes("@g.") ? "group" : "direct",
          senderId: payload.sender.platformUserId,
          senderName: payload.sender.platformUsername,
          messageId: payload.externalMessageId,
          // Pass Omni's enrichments
          transcription: payload.content.transcription,
          imageDescription: payload.content.imageDescription,
          // Pass identity info
          personId: payload.personId,
          personName: payload.personName,
          mediaUrls: payload.content.media?.map(m => m.url),
        });
        break;
      }
      
      case "message.status": {
        // Handle delivery receipts
        break;
      }
    }
    
    return new Response("OK", { status: 200 });
  };
}
```

#### 3.2.6 Omni API Client

```typescript
// extensions/omni/src/omni-client.ts
export class OmniClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request(path: string, opts?: RequestInit) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...opts?.headers,
      },
    });
    if (!res.ok) throw new Error(`Omni API error: ${res.status}`);
    return res.json();
  }

  // Health
  async getHealth() { return this.request("/api/v2/health"); }

  // Instances
  async listInstances() { return this.request("/api/v2/instances"); }
  async getInstance(id: string) { return this.request(`/api/v2/instances/${id}`); }

  // Messages
  async sendMessage(params: SendMessageParams) {
    return this.request("/api/v2/messages", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  // Identity
  async searchPersons(query: string) {
    return this.request(`/api/v2/persons/search`, {
      method: "POST",
      body: JSON.stringify({ query }),
    });
  }

  async getPersonTimeline(personId: string, opts?: TimelineOpts) {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.channels) params.set("channels", opts.channels.join(","));
    return this.request(`/api/v2/persons/${personId}/timeline?${params}`);
  }

  async getPersonPresence(personId: string) {
    return this.request(`/api/v2/persons/${personId}/presence`);
  }

  // Webhooks
  async registerWebhook(params: WebhookRegistration) {
    return this.request("/api/v2/webhooks", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }
}
```

#### 3.2.7 Agent Tools (Identity-Powered)

The integration unlocks powerful agent tools that leverage Omni's identity graph:

```typescript
// extensions/omni/src/identity-tool.ts
export function omniIdentityTool(config: OmniPluginConfig) {
  return {
    name: "omni_search_person",
    description: "Search for a person across all messaging channels. Returns unified identity with presence on WhatsApp, Discord, Slack, etc.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, phone, or email to search" },
      },
      required: ["query"],
    },
    execute: async (params: { query: string }) => {
      const client = new OmniClient(config.apiUrl, config.apiKey);
      const results = await client.searchPersons(params.query);
      return JSON.stringify(results, null, 2);
    },
  };
}

export function omniTimelineTool(config: OmniPluginConfig) {
  return {
    name: "omni_person_timeline",
    description: "Get a person's message timeline across all channels. Shows unified conversation history from WhatsApp, Discord, Slack, etc.",
    inputSchema: {
      type: "object",
      properties: {
        personId: { type: "string", description: "Person UUID from identity graph" },
        channels: { 
          type: "array", 
          items: { type: "string" },
          description: "Filter by channels (whatsapp, discord, slack)" 
        },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: ["personId"],
    },
    execute: async (params) => {
      const client = new OmniClient(config.apiUrl, config.apiKey);
      const timeline = await client.getPersonTimeline(params.personId, {
        channels: params.channels,
        limit: params.limit,
      });
      return JSON.stringify(timeline, null, 2);
    },
  };
}
```

### 3.3 OpenClaw Configuration

Users would configure the Omni extension in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "omni": {
      "enabled": true,
      "apiUrl": "https://omni.example.com",
      "apiKey": "omni_sk_...",
      "webhookSecret": "whsec_..."
    }
  },
  "channels": {
    "omni": {
      "accounts": {
        "wa-personal": {
          "name": "WhatsApp Personal",
          "instanceId": "cdbb6ca3",
          "enabled": true,
          "allowFrom": ["+1234567890"]
        },
        "discord-server": {
          "name": "Discord Bot",
          "instanceId": "abc12345",
          "enabled": true
        }
      }
    }
  },
  "routing": {
    "bindings": [
      {
        "match": { "channel": "omni", "accountId": "wa-personal" },
        "agentId": "personal-assistant"
      },
      {
        "match": { "channel": "omni", "accountId": "discord-server" },
        "agentId": "community-bot"
      }
    ]
  }
}
```

---

## Part 4: Data Flow Diagrams

### 4.1 Inbound Message Flow (User → Agent)

```
User sends WhatsApp message
       │
       ▼
┌─────────────────────┐
│    Omni v2 API      │
│  ┌───────────────┐  │
│  │  WhatsApp     │  │
│  │  Baileys      │──┼──► message.received event
│  └───────────────┘  │          │
│                     │          ▼
│  ┌───────────────┐  │  ┌──────────────┐
│  │  Identity     │◄─┼──│ Identity     │
│  │  Graph        │  │  │ Resolution   │
│  └───────────────┘  │  └──────────────┘
│                     │          │
│  ┌───────────────┐  │          ▼
│  │  Media        │◄─┼──│ Media Pipeline│
│  │  Pipeline     │  │  │ (transcribe) │
│  └───────────────┘  │  └──────────────┘
│                     │          │
│  ┌───────────────┐  │          ▼
│  │  Webhook      │──┼──► POST /plugin/omni/webhook
│  │  Dispatch     │  │   (enriched message + person info)
│  └───────────────┘  │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│   OpenClaw Gateway  │
│  ┌───────────────┐  │
│  │  Omni Plugin  │──┼──► Injects into OpenClaw pipeline
│  │  (webhook)    │  │          │
│  └───────────────┘  │          ▼
│                     │  ┌──────────────┐
│  ┌───────────────┐  │  │  Security    │
│  │  Agent Route  │◄─┼──│  (allowlist) │
│  │  Resolution   │  │  └──────────────┘
│  └───────────────┘  │          │
│         │           │          ▼
│         ▼           │  ┌──────────────┐
│  ┌───────────────┐  │  │  Agent Pi    │
│  │  LLM Call     │──┼──│  (Claude)    │
│  │  (streaming)  │  │  └──────────────┘
│  └───────────────┘  │
│         │           │
│         ▼           │
│  ┌───────────────┐  │
│  │  Reply via    │──┼──► Omni API: POST /messages
│  │  Omni Plugin  │  │
│  └───────────────┘  │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│    Omni v2 API      │
│  ┌───────────────┐  │
│  │  WhatsApp     │──┼──► Delivers to user
│  │  Baileys      │  │
│  └───────────────┘  │
│                     │
│  message.sent event │
└─────────────────────┘
```

### 4.2 Cross-Channel Identity Lookup

```
Agent receives: "What did Mom say on WhatsApp yesterday?"
       │
       ▼
OpenClaw Agent uses omni_search_person tool
       │  query: "Mom"
       ▼
Omni API: POST /persons/search { query: "Mom" }
       │
       ▼
Returns: {
  person: {
    id: "uuid-mom",
    displayName: "Mom",
    identities: [
      { channel: "whatsapp", platformUserId: "+15551234" },
      { channel: "discord", platformUserId: "123456789" },
    ]
  }
}
       │
       ▼
Agent uses omni_person_timeline tool
       │  personId: "uuid-mom", channels: ["whatsapp"]
       ▼
Omni API: GET /persons/uuid-mom/timeline?channels=whatsapp
       │
       ▼
Returns recent WhatsApp messages from Mom
       │
       ▼
Agent responds with contextual answer
```

---

## Part 5: Implementation Plan

### Phase 1: Foundation (Week 1-2)

1. **Omni API hardening**
   - Ensure webhook registration endpoint exists
   - Ensure message send endpoint is stable
   - Add webhook dispatch for `message.received` events
   - Add person search and timeline API endpoints

2. **OpenClaw extension scaffold**
   - Create `extensions/omni/` directory structure
   - Implement `openclaw.plugin.json`
   - Implement basic `register()` with channel registration
   - Implement `OmniClient` for API communication

### Phase 2: Core Integration (Week 3-4)

3. **Inbound flow**
   - Implement webhook handler in OpenClaw extension
   - Map Omni message format → OpenClaw internal context
   - Wire into OpenClaw's security/routing pipeline
   - Test: Omni receives WhatsApp → OpenClaw agent responds

4. **Outbound flow**
   - Implement `sendText()` and `sendMedia()` via Omni API
   - Implement target resolution
   - Text chunking (delegate to Omni or handle locally)
   - Test: OpenClaw agent sends → Omni delivers to WhatsApp

### Phase 3: Identity & Tools (Week 5-6)

5. **Identity tools**
   - `omni_search_person` tool
   - `omni_person_timeline` tool
   - `omni_person_presence` tool
   - Test: Agent can look up cross-channel person info

6. **Account management**
   - Map Omni instances to OpenClaw accounts
   - Status reporting via Omni API
   - Instance health monitoring
   - `openclaw channels status` integration

### Phase 4: Polish (Week 7-8)

7. **Advanced features**
   - Reactions via Omni actions API
   - Media pipeline integration (use Omni's transcriptions)
   - Group support with mention gating
   - Streaming response optimization

8. **Documentation & testing**
   - Channel setup guide in OpenClaw docs
   - Configuration reference
   - End-to-end test suite
   - Performance benchmarks

---

## Part 6: Key Decisions & Trade-offs

### 6.1 Single "omni" Channel vs Per-Channel Registration

**Decision**: Register as a single `omni` channel with sub-accounts per Omni instance.

**Rationale**: OpenClaw's routing system uses `channel + accountId` as the key. One `omni` channel with accounts like `wa-personal`, `discord-bot` maps cleanly to Omni instances. The alternative (registering `omni-whatsapp`, `omni-discord`, etc.) would require N channel plugins and wouldn't leverage Omni's unified identity.

### 6.2 Media Processing: Omni or OpenClaw?

**Decision**: Omni handles media processing; OpenClaw receives enriched content.

**Rationale**: Omni's media pipeline (Whisper transcription, Gemini image description) runs in dedicated workers. Passing pre-processed content to OpenClaw via webhooks avoids duplicating this infrastructure and leverages Omni's GPU/API key management.

### 6.3 Session Management

**Decision**: OpenClaw manages agent sessions; Omni manages message history.

**Rationale**: OpenClaw has sophisticated session management (compaction, session keys, DM scoping). Omni stores raw events. The agent's conversation memory lives in OpenClaw; Omni provides the "ground truth" message history for search/audit.

### 6.4 Webhook vs WebSocket for Inbound

**Decision**: Webhooks (Omni → OpenClaw HTTP POST) for v1; WebSocket for v2.

**Rationale**: Webhooks are simpler to implement and debug. OpenClaw's extension system supports `registerHttpRoute()`. A future WebSocket connection could reduce latency, but webhooks are sufficient for messaging.

### 6.5 Identity Mapping

**Decision**: OpenClaw's `accountId` maps to Omni's `instanceId`; person identity lives in Omni.

**Rationale**: Omni's identity graph is its killer feature. OpenClaw doesn't need to replicate it — the agent can query Omni for person info via tools. OpenClaw's pairing/allowlist system adds a security layer on top.

---

## Part 7: Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Latency from extra HTTP hop | Medium | Medium | Connection pooling, keep-alive, local deployment |
| Omni API downtime breaks all channels | High | High | Fallback to OpenClaw native channels, health monitoring |
| Schema drift between systems | Medium | Medium | Versioned API, explicit contracts, integration tests |
| Complexity for end users | Medium | Medium | Good defaults, CLI wizard, documentation |
| OpenClaw plugin SDK changes | Low | High | Pin SDK version, follow their AGENTS.md guidelines |
| Webhook reliability | Low | Medium | Retry logic, dead letter queue, idempotency |

---

## Part 8: Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Message delivery latency | <500ms extra vs native | End-to-end timing logs |
| Channel coverage | All Omni channels usable from OpenClaw | Integration test matrix |
| Identity resolution accuracy | >95% correct person linking | Manual audit + unit tests |
| Extension install time | <5 min for new user | Onboarding test |
| Uptime with Omni backbone | >99.5% | Health monitoring |
| Agent tool success rate | >90% for identity queries | Tool execution logs |

---

## Appendix A: OpenClaw vs Omni Concept Mapping

| OpenClaw Concept | Omni v2 Concept | Notes |
|-----------------|-----------------|-------|
| Channel | Channel Plugin | Same concept, different interfaces |
| Account (within channel) | Instance | 1:1 mapping |
| Allowlist / DM Policy | Access Control Rules | Omni has richer rule engine |
| Agent (Pi) | Agent Provider | OpenClaw's is more mature |
| Session | Conversation / Event Stream | Different persistence models |
| Config (`openclaw.json`) | Instance Config (DB) | File vs database |
| Gateway | API Server | WebSocket vs HTTP |
| Node (paired device) | — | Omni doesn't have this |
| — | Identity Graph (Person) | OpenClaw lacks this |
| — | NATS Event Bus | OpenClaw has no event bus |
| — | Media Pipeline | OpenClaw has built-in but simpler |
| Hook (event handler) | Event Subscriber | Similar concept |
| Tool (agent capability) | MCP Tool | Both exposed to LLM |

## Appendix B: File Reference

### OpenClaw Key Files

| File | Purpose |
|------|---------|
| `src/channels/registry.ts` | Channel ID constants, meta, normalization |
| `src/channels/dock.ts` | Lightweight channel behavior (capabilities, threading, etc.) |
| `src/channels/plugins/types.ts` | Full ChannelPlugin interface (re-exports) |
| `src/plugins/registry.ts` | Plugin registry — registration of tools, hooks, channels |
| `src/plugins/discovery.ts` | Extension discovery (bundled, global, workspace, config) |
| `src/routing/resolve-route.ts` | Agent routing: channel+account+peer → agentId+sessionKey |
| `src/config/types.ts` | Configuration type definitions (re-exports all sub-modules) |
| `extensions/whatsapp/` | Reference implementation of a channel extension |
| `extensions/nextcloud-talk/` | Another reference channel extension |

### Omni Key Files

| File | Purpose |
|------|---------|
| `docs/architecture/overview.md` | Full system architecture |
| `docs/architecture/event-system.md` | NATS event bus, event types, handlers |
| `docs/architecture/plugin-system.md` | Channel plugin SDK, base class, examples |
| `docs/architecture/identity-graph.md` | Person/PlatformIdentity model, resolution |
| `docs/architecture/provider-system.md` | Multi-schema agent provider abstraction |

---

*This document was produced by the Coral research agent analyzing the full OpenClaw and Omni v2 codebases. It is intended to be the authoritative reference for the integration plan.*
