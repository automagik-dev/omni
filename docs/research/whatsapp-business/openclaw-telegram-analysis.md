---
title: "OpenClaw Telegram Integration — Deep Analysis"
created: 2026-02-09
updated: 2026-02-09
author: "🐚 Pearl (Omni Research Squad)"
tags:
  - research
  - openclaw
  - telegram
  - channel-plugin
  - architecture
  - integration-patterns
status: current
aliases:
  - OpenClaw Telegram
  - Channel Plugin Architecture
---

# OpenClaw Telegram Integration — Deep Analysis

> **Purpose:** Extract every architectural pattern, feature, and design decision from OpenClaw's Telegram channel — their best and most mature integration — so Omni can learn from it and potentially integrate with/alongside OpenClaw.

---

## 1. Architecture Overview

### 1.1 Plugin System Structure

OpenClaw uses a **dual-layer plugin architecture** for channels:

1. **Extension Plugin** (`extensions/telegram/`) — the installable package, registered via `openclaw.plugin.json`
2. **Core Channel Logic** (`src/channels/plugins/*/telegram.ts` + `src/telegram/`) — the actual implementation

```
extensions/telegram/
├── index.ts                    # Plugin entry point (registers channel)
├── openclaw.plugin.json        # Plugin manifest { id: "telegram", channels: ["telegram"] }
├── package.json                # @openclaw/telegram (workspace:*)
└── src/
    ├── channel.ts              # ChannelPlugin<ResolvedTelegramAccount, TelegramProbe> implementation
    └── runtime.ts              # Runtime DI container (PluginRuntime)

src/telegram/                   # Core Telegram logic (40+ files)
src/channels/plugins/
    ├── actions/telegram.ts     # Agent tool actions (send, react, delete, edit, sticker)
    ├── normalize/telegram.ts   # Target normalization (telegram:, tg:, t.me/ URLs)
    ├── onboarding/telegram.ts  # CLI wizard for setup
    ├── outbound/telegram.ts    # Outbound message delivery adapter
    └── status-issues/telegram.ts  # Health check / status warnings
src/agents/tools/telegram-actions.ts  # Agent tool handler (handleTelegramAction)
```

### 1.2 Plugin Registration

The entry point is clean and minimal:

```typescript
// extensions/telegram/index.ts
const plugin = {
  id: "telegram",
  name: "Telegram",
  description: "Telegram channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setTelegramRuntime(api.runtime);       // DI: inject runtime
    api.registerChannel({ plugin: telegramPlugin }); // Register the ChannelPlugin
  },
};
```

The runtime is injected via a module-level singleton pattern (`setTelegramRuntime`/`getTelegramRuntime`), allowing the extension's channel code to call back into core OpenClaw services without direct imports.

### 1.3 ChannelPlugin Interface

The `ChannelPlugin<ResolvedAccount, Probe>` interface is the core contract every channel must implement. For Telegram:

```typescript
export type ChannelPlugin<ResolvedAccount = any, Probe = unknown, Audit = unknown> = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  reload?: { configPrefixes: string[] };
  onboarding?: ChannelOnboardingAdapter;
  config: ChannelConfigAdapter<ResolvedAccount>;
  configSchema?: ChannelConfigSchema;
  setup?: ChannelSetupAdapter;
  pairing?: ChannelPairingAdapter;
  security?: ChannelSecurityAdapter<ResolvedAccount>;
  groups?: ChannelGroupAdapter;
  outbound?: ChannelOutboundAdapter;
  status?: ChannelStatusAdapter<ResolvedAccount, Probe, Audit>;
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  streaming?: ChannelStreamingAdapter;
  threading?: ChannelThreadingAdapter;
  messaging?: ChannelMessagingAdapter;
  directory?: ChannelDirectoryAdapter;
  actions?: ChannelMessageActionAdapter;
  // ... more optional adapters
};
```

**Key insight:** The interface is decomposed into ~20 focused adapters (config, security, outbound, status, gateway, threading, etc.), each optional. This allows channels to implement only what they support.

---

## 2. Complete Feature List — What Makes Telegram "Foda" 🔥

### 2.1 Core Messaging

| Feature | Details |
|---------|---------|
| **DM (1:1)** | Full support, session per user, pairing-based access control |
| **Groups** | Full support with per-group config, allowlists, mention gating |
| **Supergroups** | Full support including group→supergroup migration handling |
| **Forum Topics** | Full support — each topic gets its own session key (`agent:X:telegram:group:Y:topic:Z`) |
| **Channels** | Listed in capabilities (`chatTypes: ["direct", "group", "channel", "thread"]`) |
| **Media send** | Images, video, audio, documents, GIFs/animations, voice notes |
| **Media receive** | Photos, videos, audio, documents, stickers (with vision processing) |
| **Stickers** | Receive (WEBP → vision analysis), send by file_id, search cached stickers |
| **Voice notes** | Distinct from audio files; `[[audio_as_voice]]` tag or `asVoice: true` |
| **Location** | Inbound location messages → text context for agent |
| **Forwarded messages** | Context normalization (`normalizeForwardedContext`) |
| **Reply context** | `ReplyToId`, `ReplyToBody`, `ReplyToSender` — quoted context appended to body |

### 2.2 Inline Buttons (Interactive Keyboards)

```typescript
capabilities: {
  inlineButtons: "off" | "dm" | "group" | "all" | "allowlist" // default: "allowlist"
}
```

- **Inline keyboard buttons** with `text` + `callback_data` (max 64 chars)
- Multi-row button layouts: `buttons: [[{text, callback_data}, ...], ...]`
- Callback queries are processed as synthetic messages (forwarded to agent)
- Scope control: can restrict buttons to DMs only, groups only, allowlisted users, or all
- Button support on both text messages AND media messages
- Edit buttons on existing messages
- Used internally for **model selection** (`/model` command → provider keyboard → model list) and **command pagination** (`/commands` pages)

```typescript
// Agent tool usage:
{
  action: "send",
  channel: "telegram",
  to: "123456789",
  message: "Choose an option:",
  buttons: [
    [{ text: "Yes", callback_data: "yes" }, { text: "No", callback_data: "no" }],
    [{ text: "Cancel", callback_data: "cancel" }]
  ]
}
```

### 2.3 Reactions

**Bidirectional reaction support:**

1. **Agent → User reactions** (outbound):
   - `react` action: add/remove emoji reactions on messages
   - **Ack reactions**: `👀` while processing (configurable level)
   - Reaction level: `off | ack | minimal | extensive`

2. **User → Agent reactions** (inbound):
   - `message_reaction` handler on the bot
   - Converted to system events: `"Telegram reaction added: 👍 by John on msg 42"`
   - Notification modes: `off | own | all` (default: `own` = only bot's messages)
   - Sent-message cache tracks which messages the bot sent (`recordSentMessage`/`wasSentByBot`)

```typescript
// From bot.ts — reaction handler
bot.on("message_reaction", async (ctx) => {
  // ... access control, dedupe ...
  for (const r of addedReactions) {
    enqueueSystemEvent(text, {
      sessionKey,
      contextKey: `telegram:reaction:add:${chatId}:${messageId}:${user?.id}:${emoji}`,
    });
  }
});
```

### 2.4 Message Editing & Deletion

- **Edit messages**: `editMessage` action — updates text + optionally buttons
- **Delete messages**: `deleteMessage` action — removes bot messages
- Both gated via `channels.telegram.actions.editMessage` / `actions.deleteMessage`

### 2.5 Native Commands (Bot Menu)

OpenClaw registers commands with Telegram's `/command` menu on startup:

- `/status`, `/reset`, `/model`, `/commands`, `/activation`, `/whoami`, `/pair`, etc.
- **Custom commands** via config: `customCommands: [{ command: "backup", description: "Git backup" }]`
- Commands are access-controlled (pairing/allowlist required)
- Skill-based commands from plugins
- Plugin commands (`device-pair` adds `/pair`)
- `/model` command uses **inline buttons** for interactive model selection

### 2.6 Draft Streaming (Live Typing)

```typescript
// draft-stream.ts
export function createTelegramDraftStream(params: {
  api: Bot["api"];
  chatId: number;
  draftId: number;
  maxChars?: number;
  thread?: TelegramThreadSpec | null;
  throttleMs?: number;  // default: 300ms
}): TelegramDraftStream
```

- Uses `sendMessageDraft` Bot API (v9.3+)
- Modes: `partial` (live text), `block` (chunked updates), `off`
- DM-only (Telegram limitation)
- Requires forum topic mode enabled in BotFather
- Draft max 4096 chars
- Throttled updates (300ms default)
- Reasoning stream: streams reasoning into draft, then sends final answer without it

### 2.7 Threading & Topics

- **Forum topics**: `message_thread_id` → session key suffix `:topic:<threadId>`
- **General topic** (thread_id=1): special handling (omit `message_thread_id` on sends)
- **DM threads**: private chat `message_thread_id` used for reply routing
- **Reply threading**: `replyToMode: "off" | "first" | "all"` (default: `first`)
- Reply tags: `[[reply_to_current]]`, `[[reply_to:<id>]]`
- Per-topic configuration: skills, allowlists, system prompts, enable/disable

### 2.8 Sticker System

**Full sticker lifecycle:**

1. **Receive**: Static stickers (WEBP) → downloaded → vision AI analysis → description cached
2. **Cache**: `~/.openclaw/telegram/sticker-cache.json` — indexed by `fileUniqueId`
3. **Search**: Fuzzy search across description, emoji, set name
4. **Send**: `sendSticker` action by `file_id`
5. **Context**: `Sticker.emoji`, `Sticker.setName`, `Sticker.fileId`, `Sticker.cachedDescription`

```typescript
// sticker-cache entry:
{
  "fileId": "CAACAgIAAxkBAAI...",
  "fileUniqueId": "AgADBAADb6cxG2Y",
  "emoji": "👋",
  "setName": "CoolCats",
  "description": "A cartoon cat waving enthusiastically",
  "cachedAt": "2026-01-15T10:30:00.000Z"
}
```

### 2.9 Access Control

**DM Policy** (`channels.telegram.dmPolicy`):
- `pairing` (default) — unknown senders get pairing code, owner approves
- `allowlist` — only `allowFrom` entries
- `open` — anyone (requires `allowFrom: ["*"]`)
- `disabled` — ignore all DMs

**Group Policy** (`channels.telegram.groupPolicy`):
- `open` — all group members, mention-gated
- `allowlist` — only `groupAllowFrom` senders
- `disabled` — no groups

**Per-group/per-topic overrides:**
```json5
{
  channels: {
    telegram: {
      groups: {
        "-1001234567890": {
          requireMention: false,
          groupPolicy: "open",
          skills: ["coding"],
          systemPrompt: "You are a coding assistant",
          topics: {
            "42": {
              requireMention: true,
              skills: ["general"],
              enabled: false
            }
          }
        }
      }
    }
  }
}
```

### 2.10 Multi-Account Support

- Multiple bot tokens per instance: `channels.telegram.accounts.<accountId>`
- Each account has independent: token, allowFrom, groupPolicy, capabilities, etc.
- Account-level routing via `bindings`
- Per-account inline button scopes
- Default account fallback (`TELEGRAM_BOT_TOKEN` env var)

### 2.11 Formatting Pipeline

**Markdown → Telegram HTML conversion** (`format.ts`):

```typescript
// Pipeline: Markdown input → IR (intermediate representation) → Telegram HTML
function markdownToTelegramHtml(markdown: string): string {
  const ir = markdownToIR(markdown, {
    linkify: true,
    enableSpoilers: true,
    headingStyle: "none",
    blockquotePrefix: "",
  });
  return renderTelegramHtml(ir);
}
```

Supported tags: `<b>`, `<i>`, `<s>`, `<code>`, `<pre><code>`, `<tg-spoiler>`, `<a href="...">`

- HTML parse failures → automatic plain text fallback
- Chunking: splits at 4000 chars (configurable `textChunkLimit`)
- Chunk modes: `length` (default) or `newline` (paragraph boundaries)
- Caption splitting for media messages (Telegram caption limit)

### 2.12 Advanced Features

| Feature | Implementation |
|---------|---------------|
| **Silent messages** | `silent: true` → `disable_notification: true` |
| **Quote text** | `quoteText` → Telegram `reply_parameters.quote` |
| **Link preview control** | `linkPreview: false` → `link_preview_options.is_disabled` |
| **Proxy support** | SOCKS/HTTP proxy for Bot API calls (`channels.telegram.proxy`) |
| **Network tuning** | `autoSelectFamily`, `timeoutSeconds`, retry policy |
| **Config writes** | Auto-migrate group IDs on supergroup migration |
| **Inbound debounce** | Buffer rapid-fire messages from same sender |
| **Text fragment assembly** | Reassemble Telegram's split long-paste messages (4096+ chars) |
| **Media groups** | Buffer multi-image sends, combine into single processing unit |
| **Update deduplication** | Track `update_id` to skip duplicate webhook/poll deliveries |
| **Update offset persistence** | Store last `update_id` to survive restarts |
| **Retry with backoff** | Exponential backoff + jitter on 429/network errors |
| **Thread fallback** | If `message_thread_id` fails, retry without it |
| **Group migration** | Handle `migrate_to_chat_id` events, update config |
| **Bot probe** | `getMe` call to verify token + get bot username |
| **Group audit** | `getChatMember` to verify bot is in configured groups |
| **Chat action (typing)** | `sendChatAction("typing")` while processing |

---

## 3. Channel Plugin Architecture — The ChannelPlugin Contract

### 3.1 Core Adapters

The `ChannelPlugin` interface is the central contract. Here's each adapter with Telegram's implementation:

#### `config: ChannelConfigAdapter<ResolvedAccount>`

Account lifecycle management:

```typescript
config: {
  listAccountIds: (cfg) => listTelegramAccountIds(cfg),
  resolveAccount: (cfg, accountId) => resolveTelegramAccount({ cfg, accountId }),
  defaultAccountId: (cfg) => resolveDefaultTelegramAccountId(cfg),
  setAccountEnabled: ({ cfg, accountId, enabled }) => ...,
  deleteAccount: ({ cfg, accountId }) => ...,
  isConfigured: (account) => Boolean(account.token?.trim()),
  describeAccount: (account) => ({ accountId, name, enabled, configured, tokenSource }),
  resolveAllowFrom: ({ cfg, accountId }) => ...,
  formatAllowFrom: ({ allowFrom }) => ...,
}
```

#### `capabilities: ChannelCapabilities`

Declared feature matrix:

```typescript
capabilities: {
  chatTypes: ["direct", "group", "channel", "thread"],
  reactions: true,
  threads: true,
  media: true,
  nativeCommands: true,
  blockStreaming: true,
}
```

#### `security: ChannelSecurityAdapter`

DM policy resolution + security warnings:

```typescript
security: {
  resolveDmPolicy: ({ cfg, accountId, account }) => ({
    policy: account.config.dmPolicy ?? "pairing",
    allowFrom: account.config.allowFrom ?? [],
    policyPath: "channels.telegram.dmPolicy",
    allowFromPath: "channels.telegram.",
    approveHint: formatPairingApproveHint("telegram"),
    normalizeEntry: (raw) => raw.replace(/^(telegram|tg):/i, ""),
  }),
  collectWarnings: ({ account, cfg }) => [...] // groupPolicy="open" warnings
}
```

#### `outbound: ChannelOutboundAdapter`

Message delivery:

```typescript
outbound: {
  deliveryMode: "direct",           // Direct API calls (vs. "gateway" proxy)
  chunker: markdownToTelegramHtmlChunks,  // Markdown → HTML + chunking
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ to, text, accountId, deps, replyToId, threadId }) => {
    const result = await sendMessageTelegram(to, text, {
      textMode: "html",
      messageThreadId,
      replyToMessageId,
      accountId,
    });
    return { channel: "telegram", ...result };
  },
  sendMedia: async ({ to, text, mediaUrl, accountId, ... }) => ...,
  sendPayload: async ({ to, payload, ... }) => {
    // Full payload with channelData.telegram.buttons, quoteText, multiple mediaUrls
  },
}
```

#### `gateway: ChannelGatewayAdapter`

Lifecycle management:

```typescript
gateway: {
  startAccount: async (ctx) => {
    // 1. Probe bot token (getMe)
    // 2. Log bot username
    // 3. Start monitorTelegramProvider (long-poll or webhook)
    return monitorTelegramProvider({ token, accountId, config, ... });
  },
  logoutAccount: async ({ accountId, cfg }) => {
    // Clear botToken from config, write file
  },
}
```

#### `actions: ChannelMessageActionAdapter`

Agent tool integration:

```typescript
actions: {
  listActions: ({ cfg }) => {
    // Returns: ["send", "react", "delete", "edit", "sticker", "sticker-search"]
    // Based on action gates in config
  },
  supportsButtons: ({ cfg }) => isTelegramInlineButtonsEnabled({ cfg }),
  extractToolSend: ({ args }) => { to, accountId },
  handleAction: async ({ action, params, cfg, accountId }) => {
    // Dispatches to handleTelegramAction()
  },
}
```

#### Other Adapters

| Adapter | Telegram Implementation |
|---------|------------------------|
| `onboarding` | Interactive wizard: bot token → user ID → allowFrom resolution |
| `pairing` | `idLabel: "telegramUserId"`, normalize `tg:` prefix, notify approval via bot message |
| `groups` | `resolveRequireMention`, `resolveToolPolicy` per group/topic |
| `threading` | `replyToMode: "first"` default |
| `messaging` | Target normalization (`telegram:`, `tg:`, `@username`, `t.me/` URLs) |
| `directory` | `listPeers` and `listGroups` from config (not live API) |
| `status` | Probe (`getMe`), audit (group membership check), status issues |
| `setup` | Apply bot token to config (default account or named account) |

### 3.2 Message Normalization Pipeline

The full inbound pipeline for a Telegram message:

```
1. grammY receives update (long-poll or webhook)
2. Sequentializer: per-chat ordering (getTelegramSequentialKey)
3. Update deduplication (createTelegramUpdateDedupe)
4. Raw update logging (debug)
5. Update ID tracking (for offset persistence)
6. bot.on("callback_query") → synthetic message processing
7. bot.on("message_reaction") → system event enqueue
8. bot.on("message:migrate_to_chat_id") → group config migration
9. bot.on("message") →
   a. Group policy filtering (allowlist, disabled, open)
   b. Group allowlist check (per-group config)
   c. Text fragment buffering (long paste reassembly)
   d. Media group buffering (multi-image)
   e. Single media resolution (download)
   f. Sticker handling (skip animated/video, process static)
   g. Inbound debouncer (rapid message coalescing)
   h. processMessage() →
      i.  Build message context (sender, chat type, thread, media, reply context)
      ii. Access control (DM policy, group policy, pairing check)
      iii. Mention gating (groups: require @bot or patterns)
      iv. Ack reaction (👀 while processing)
      v.  History context (group message history)
      vi. Agent route resolution (bindings → agent → session key)
      vii. Template context building (From, To, ChatType, etc.)
      viii. Auto-reply dispatch → agent → response
      ix.  Response delivery (chunked, formatted, threaded)
```

### 3.3 Plugin SDK Exports

The `plugin-sdk/index.ts` exports ~150+ symbols for channel plugins. Key categories:

- **Channel types**: `ChannelPlugin`, `ChannelConfigAdapter`, `ChannelOutboundAdapter`, etc.
- **Config schemas**: `TelegramConfigSchema`, `DiscordConfigSchema`, etc. (Zod)
- **Channel utilities**: `normalizeAccountId`, `DEFAULT_ACCOUNT_ID`, `buildChannelConfigSchema`
- **Security**: `resolveMentionGating`, `shouldAckReaction`, `resolveControlCommandGate`
- **History**: `recordPendingHistoryEntry`, `buildPendingHistoryContextFromMap`
- **Media**: `loadWebMedia`, `detectMime`, `extractOriginalFilename`
- **Per-channel exports**: Account resolvers, onboarding adapters, normalizers, status collectors

---

## 4. Agent Tools — Message Actions

### 4.1 Tool Interface

The `handleTelegramAction` function handles all agent-initiated Telegram operations:

```typescript
// Actions:
"sendMessage"    // Send text/media/voice with optional buttons, threading, quoting
"react"          // Add/remove emoji reaction on a message
"deleteMessage"  // Delete a message by ID
"editMessage"    // Edit text + buttons of existing message
"sendSticker"    // Send sticker by file_id
"searchSticker"  // Fuzzy search cached stickers
"stickerCacheStats" // Cache statistics
```

### 4.2 Send Message (Full Parameters)

```typescript
{
  action: "sendMessage",
  to: "123456789",            // chat_id or @username
  content: "Hello!",          // required (unless mediaUrl)
  mediaUrl: "https://...",    // optional media
  buttons: [[{text, callback_data}]], // optional inline keyboard
  replyToMessageId: 42,       // optional reply threading
  messageThreadId: 123,       // optional forum topic
  quoteText: "quoted text",   // optional quote in reply
  asVoice: true,              // send audio as voice bubble
  silent: true,               // no notification
  accountId: "my-bot",        // optional multi-account
}
```

### 4.3 Action Gating

Every action is individually gatable via config:

```json5
{
  channels: {
    telegram: {
      actions: {
        reactions: true,        // default: true
        sendMessage: true,      // default: true
        deleteMessage: true,    // default: true
        editMessage: true,      // default: true
        sticker: false,         // default: false (opt-in)
      }
    }
  }
}
```

---

## 5. Core Telegram Implementation Details

### 5.1 Bot Framework: grammY

OpenClaw uses **grammY** (not Telegraf) with these middleware:

```typescript
import { Bot, webhookCallback } from "grammy";
import { sequentialize } from "@grammyjs/runner";
import { apiThrottler } from "@grammyjs/transformer-throttler";

const bot = new Bot(token, { client });
bot.api.config.use(apiThrottler());           // Rate limiting
bot.use(sequentialize(getTelegramSequentialKey)); // Per-chat ordering
bot.catch((err) => runtime.error(...));        // Global error handler
```

### 5.2 Long-Polling vs Webhook

- **Default**: Long-polling via `@grammyjs/runner` with concurrency cap
- **Webhook**: Set `webhookUrl` + `webhookSecret` → HTTP server on port 8787
- Webhook callback uses grammY's `webhookCallback(bot, "http")`
- `allowed_updates` includes `message_reaction` for reaction support

### 5.3 Send Pipeline

```typescript
// send.ts — sendMessageTelegram()
1. Resolve account (token, proxy, timeout)
2. Parse target (strip prefixes, handle t.me URLs, normalize @username)
3. Build thread params (message_thread_id, reply_to_message_id, quote)
4. If media:
   a. Download media (loadWebMedia)
   b. Detect kind (image/video/audio/document/gif)
   c. Split caption if too long
   d. Send via appropriate API (sendPhoto/sendVideo/sendAudio/sendVoice/sendAnimation/sendDocument)
   e. If caption was split, send follow-up text message
5. If text only:
   a. Render markdown → HTML (renderTelegramHtmlText)
   b. Send with parse_mode: "HTML"
   c. If HTML parse fails → retry as plain text
   d. If message_thread_id fails → retry without it
6. Record sent message (for reaction tracking)
7. Record channel activity
```

### 5.4 Error Handling Patterns

- **HTML parse errors**: Fallback to plain text (regex: `/can't parse entities/i`)
- **Thread not found**: Retry without `message_thread_id`
- **Chat not found**: Wrap with helpful error message
- **Network errors**: Exponential backoff + jitter via `createTelegramRetryRunner`
- **Rate limits (429)**: Handled by `apiThrottler` middleware
- **Long-poll restart**: Exponential backoff (2s → 30s, factor 1.8, jitter 0.25)
- **getUpdates conflict**: Detect concurrent polling, wait and retry

### 5.5 Session Routing

```
DM:     agent:<agentId>:main (or agent:<agentId>:<mainKey>)
Group:  agent:<agentId>:telegram:group:<chatId>
Topic:  agent:<agentId>:telegram:group:<chatId>:topic:<threadId>
Thread: agent:<agentId>:telegram:group:<chatId>:thread (DM threads)
```

Routing resolution order:
1. Exact peer binding match
2. Account binding match
3. Channel binding match
4. Default agent

---

## 6. Configuration Schema (Complete)

```typescript
// types.telegram.ts — TelegramConfig
{
  enabled?: boolean;
  botToken?: string;
  tokenFile?: string;                    // Secret manager support
  
  // Access control
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: (string | number)[];
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: (string | number)[];
  
  // Groups
  groups?: Record<string, {
    requireMention?: boolean;
    groupPolicy?: GroupPolicy;
    tools?: GroupToolPolicyConfig;
    toolsBySender?: GroupToolPolicyBySenderConfig;
    skills?: string[];
    enabled?: boolean;
    allowFrom?: (string | number)[];
    systemPrompt?: string;
    topics?: Record<string, {
      requireMention?: boolean;
      groupPolicy?: GroupPolicy;
      skills?: string[];
      enabled?: boolean;
      allowFrom?: (string | number)[];
      systemPrompt?: string;
    }>;
  }>;
  
  // Formatting
  textChunkLimit?: number;               // default: 4000
  chunkMode?: "length" | "newline";
  linkPreview?: boolean;                 // default: true
  markdown?: MarkdownConfig;
  responsePrefix?: string;
  
  // Streaming
  streamMode?: "off" | "partial" | "block";
  draftChunk?: BlockStreamingChunkConfig;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  
  // Threading
  replyToMode?: "off" | "first" | "all";
  
  // Media
  mediaMaxMb?: number;                   // default: 5
  
  // Capabilities
  capabilities?: { inlineButtons?: TelegramInlineButtonsScope };
  
  // Actions (agent tools)
  actions?: {
    reactions?: boolean;
    sendMessage?: boolean;
    deleteMessage?: boolean;
    editMessage?: boolean;
    sticker?: boolean;
  };
  
  // Reactions
  reactionNotifications?: "off" | "own" | "all";
  reactionLevel?: "off" | "ack" | "minimal" | "extensive";
  
  // Commands
  commands?: ProviderCommandsConfig;
  customCommands?: TelegramCustomCommand[];
  configWrites?: boolean;
  
  // Network
  timeoutSeconds?: number;
  retry?: OutboundRetryConfig;
  network?: { autoSelectFamily?: boolean };
  proxy?: string;
  
  // Webhook
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
  
  // History
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, DmConfig>;
  
  // Multi-account
  accounts?: Record<string, TelegramAccountConfig>;
  
  // Heartbeat
  heartbeat?: ChannelHeartbeatVisibilityConfig;
}
```

---

## 7. OpenClaw ↔ Omni Integration Patterns

### 7.1 How Omni Could Serve as Channel Provider FOR OpenClaw

OpenClaw's plugin architecture is designed for exactly this. Omni could provide a channel plugin:

**Option A: Omni as a Channel Plugin**

```typescript
// extensions/omni-whatsapp/index.ts
const plugin = {
  id: "omni-whatsapp",
  name: "Omni WhatsApp",
  configSchema: {
    type: "object",
    properties: {
      omniApiUrl: { type: "string" },
      omniApiKey: { type: "string" },
      instanceId: { type: "string" },
    }
  },
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: omniWhatsAppPlugin });
  },
};
```

The `ChannelPlugin` interface would:
- `gateway.startAccount` → Connect to Omni's event stream (NATS or webhooks)
- `outbound.sendText/sendMedia` → Call Omni's API to send messages
- `config.resolveAccount` → Map Omni instance to OpenClaw account
- `actions.handleAction` → Proxy to Omni's messaging API

**Option B: Omni as a Webhook Bridge**

Simpler: Omni receives WhatsApp messages → sends to OpenClaw's gateway API → OpenClaw processes → sends back via Omni's API.

**Option C: OpenClaw as an Omni Channel Plugin (Reverse)**

Omni's `channel-sdk` could have an OpenClaw plugin that:
- Receives messages from OpenClaw via webhook
- Normalizes them to Omni's event format
- Routes responses back through OpenClaw's message tool

### 7.2 Key Integration Points

| Omni Concept | OpenClaw Equivalent | Integration |
|-------------|---------------------|-------------|
| Event Bus (NATS) | System Events (`enqueueSystemEvent`) | Bridge NATS → OpenClaw events |
| Channel Plugin SDK | ChannelPlugin interface | Implement OpenClaw's interface in Omni |
| tRPC API | Gateway server methods | HTTP bridge between systems |
| Message schema (Zod) | Message context (MsgContext) | Schema mapping layer |
| Instance (account) | AccountId | 1:1 mapping |
| Contact/Conversation | Peer/Session | Map Omni contacts to OpenClaw peers |

### 7.3 What Omni Can Learn from OpenClaw's Patterns

1. **Adapter decomposition** — 20+ focused adapters instead of one monolithic interface
2. **Config schema as first-class** — Zod schemas embedded in plugin manifest
3. **Action gating** — Individual enable/disable per capability
4. **Multi-account from day one** — Account abstraction built into the core contract
5. **Inbound debouncing** — Buffer rapid messages before processing
6. **Text fragment assembly** — Handle platform-specific message splitting
7. **Media group buffering** — Combine multi-image sends
8. **Session key patterns** — Hierarchical keys with channel/group/topic/thread
9. **Graceful degradation** — HTML → plain text fallback, thread fallback
10. **Sticker caching** — Vision-based sticker description cache for semantic search
11. **Draft streaming** — Live typing via draft API
12. **Runtime DI** — Module-level singleton for plugin runtime injection

### 7.4 Architecture Comparison

| Aspect | OpenClaw | Omni |
|--------|----------|------|
| Runtime | Node.js (pnpm) | Bun |
| Channel model | Plugin (in-process) | Package (separate process possible) |
| Config | YAML/JSON5 file | PostgreSQL + env |
| Event system | In-memory + system events | NATS JetStream |
| API style | Gateway server methods | tRPC + Hono REST |
| Bot framework | grammY (Telegram) | Custom (via channel-sdk) |
| State | File-based sessions | Database (Drizzle) |
| Auth | Pairing codes | API keys + instance binding |

---

## 8. Files Read (Complete Inventory)

### Extension Plugin
- `extensions/telegram/index.ts` — Plugin entry
- `extensions/telegram/src/channel.ts` — Full ChannelPlugin implementation (400+ lines)
- `extensions/telegram/src/runtime.ts` — Runtime DI
- `extensions/telegram/openclaw.plugin.json` — Plugin manifest
- `extensions/telegram/package.json` — Package metadata

### Channel Plugins (core)
- `src/channels/plugins/actions/telegram.ts` — Agent tool action dispatch
- `src/channels/plugins/normalize/telegram.ts` — Target normalization
- `src/channels/plugins/onboarding/telegram.ts` — CLI setup wizard
- `src/channels/plugins/outbound/telegram.ts` — Outbound delivery adapter
- `src/channels/plugins/status-issues/telegram.ts` — Health check warnings

### Core Telegram (src/telegram/)
- `bot.ts` — Bot creation, middleware, reaction handler, sequentializer
- `send.ts` — Full send pipeline (text, media, reactions, delete, edit, stickers)
- `bot-handlers.ts` — Message/callback/migration handlers, media groups, text fragments
- `bot-message-context.ts` — Message context building
- `bot-native-commands.ts` — Native command registration
- `inline-buttons.ts` — Inline button scope resolution
- `format.ts` — Markdown → Telegram HTML conversion
- `voice.ts` — Voice note detection
- `draft-stream.ts` — Draft streaming (sendMessageDraft)
- `monitor.ts` — Long-poll restart with backoff
- `webhook.ts` — Webhook HTTP server

### Agent Tools
- `src/agents/tools/telegram-actions.ts` — handleTelegramAction (send, react, delete, edit, sticker, search)

### Config
- `src/config/types.telegram.ts` — Full Telegram config schema (TypeScript types)

### Plugin SDK
- `src/plugin-sdk/index.ts` — 150+ exports for channel plugin developers

### Docs
- `docs/channels/telegram.md` — Complete user-facing documentation
- `docs/channels/channel-routing.md` — Routing architecture

### Types
- `src/channels/plugins/types.plugin.ts` — ChannelPlugin interface
- `src/channels/plugins/types.core.ts` — Core channel types
- `src/channels/plugins/types.adapters.ts` — Adapter interfaces

---

## 9. Summary & Recommendations for Omni

### What's Exceptional About OpenClaw's Telegram
1. **Depth of integration** — Every Telegram feature is supported (stickers, reactions, forums, drafts, buttons, voice)
2. **Configuration granularity** — Per-group, per-topic, per-account, per-action control
3. **Error resilience** — Multiple fallback layers (HTML→plain, thread→threadless, retry with backoff)
4. **Agent-first design** — The agent has full messaging tools (send, react, edit, delete, stickers)
5. **Streaming** — Draft API for live typing is a killer feature

### What Omni Should Adopt
1. **Adapter decomposition pattern** — Split channel interfaces into focused adapters
2. **Action gating** — Let admins control exactly which agent actions are enabled
3. **Multi-account first** — Design account abstraction from day one
4. **Graceful degradation** — Always have fallbacks for formatting failures
5. **Inbound buffering** — Debounce + fragment assembly for real-world messaging patterns
6. **Session key hierarchy** — `agent:X:channel:type:id:sub:id` pattern

### Integration Priority
The cleanest integration path is **Option A**: Omni implements OpenClaw's `ChannelPlugin` interface as a WhatsApp provider. This gives OpenClaw access to Omni's WhatsApp infrastructure while keeping Omni's event-driven architecture as the source of truth for WhatsApp state.
