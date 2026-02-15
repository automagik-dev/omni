# WISH: Omnichannel Agent Platform Evolution

> Evolve Omni from messaging platform to omnichannel AI agent platform — reaction events, provider abstraction, multi-trigger dispatcher, OpenClaw webhook, Telegram channel.

**Status:** DRAFT
**Created:** 2026-02-09
**Author:** WISH Agent (Genie v2)
**Branch:** feat/omnichannel-agent-platform

---

## Motivation

Omni v2 handles messages well but treats agent triggering as a message-only concern (agent-responder.ts subscribes only to `message.received`). Reactions are hacked as `message.received` with `content.type: 'reaction'`. Agent providers are hardcoded to Agno's `IAgnoClient`. There's no way to plug in OpenClaw, Claude SDK, or any webhook-based agent without rewriting core logic.

This wish promotes Omni from "messaging platform with agent support" to "omnichannel AI agent platform" — where any event type can trigger any agent provider through configurable dispatch rules.

---

## Assumptions

- **ASM-1**: Council approved 10/0 — architectural direction is locked
- **ASM-2**: We already have ~80% of the trigger engine in `agent-responder.ts` + `automations.ts`
- **ASM-3**: `traceId` exists in `EventMetadata` (optional field) — just needs propagation
- **ASM-4**: `telegram` already in `CHANNEL_TYPES` array — just needs implementation
- **ASM-5**: OpenClaw will call back via existing `POST /api/v2/messages/send` — no new callback infrastructure needed

## Decisions

- **DEC-1**: `reaction.received` + `reaction.removed` become core events with their own NATS stream (REACTION)
- **DEC-2**: `AgentProvider` interface in `packages/core` replaces direct `IAgnoClient` dependency — Agno becomes one implementation
- **DEC-3**: `agent-dispatcher` replaces `agent-responder` (in-process, same location `packages/api/src/plugins/`)
- **DEC-4**: OpenClaw uses fire-and-forget mode: receives event via POST, calls back via Omni API if it wants to respond
- **DEC-5**: Trigger config lives in DB (instances table columns), not YAML files
- **DEC-6**: Discord reaction→message.received hack is a **breaking change** — automations referencing `content.type: 'reaction'` in message.received will need migration

## Risks

- **RISK-1**: Breaking change for automations using reaction-as-message pattern → **Mitigation**: Migration script + dual-emit for 1 release cycle
- **RISK-2**: OpenClaw webhook timeout on round-trip mode → **Mitigation**: Configurable timeout, default 30s, fire-and-forget as fallback
- **RISK-3**: Telegram rate limits (Bot API: 30 msg/s global, 1 msg/s per chat) → **Mitigation**: Rate limiter built into dispatcher, Telegram plugin respects limits
- **RISK-4**: Agent provider abstraction might not fit all providers equally → **Mitigation**: Keep interface minimal (trigger + health), provider-specific config in schemaConfig JSON

---

## Scope

### IN SCOPE

1. `reaction.received` + `reaction.removed` core event types, payloads, NATS REACTION stream
2. `AgentProvider` interface abstracting from `IAgnoClient` — wraps existing Agno as `AgnoAgentProvider`
3. `agent-dispatcher` replacing `agent-responder` — multi-event subscription, pattern matching, rate limiting
4. OpenClaw Webhook Provider — round-trip (POST+wait) and fire-and-forget (POST, OpenClaw calls back via API)
5. `channel-telegram` — grammy library, Bot API, `BaseChannelPlugin`, webhook + polling modes
6. `traceId` propagation through the full pipeline
7. DB schema additions: trigger config columns on instances table
8. Discord migration: emit `reaction.received`/`reaction.removed` instead of hacked `message.received`

### OUT OF SCOPE

- Claude SDK Agent Provider (Phase 2 — separate wish)
- WhatsApp reaction events (WhatsApp Baileys reaction handling is separate from this)
- Automation engine changes (automations continue working, just receive new event types)
- UI dashboard changes
- CLI changes beyond what's needed for testing

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| `@omni/core` | [x] events, [x] types, [x] providers | New event types, `AgentProvider` interface, reaction payloads |
| `@omni/db` | [x] schema | Trigger config columns on instances, `trigger_log` table |
| `@omni/api` | [x] plugins, [x] services | agent-dispatcher replaces agent-responder |
| `@omni/channel-sdk` | [ ] no changes | BaseChannelPlugin already supports reactions |
| `@omni/channel-discord` | [x] handlers | Emit reaction.received/removed instead of message.received hack |
| `@omni/channel-telegram` | [x] new package | grammy, Bot API, webhook + polling |
| `@omni/sdk` | [x] regenerate | New event types in OpenAPI |
| `@omni/cli` | [ ] minimal | Maybe a test command |

### System Checklist

- [x] **Events**: `reaction.received`, `reaction.removed` core events + REACTION NATS stream
- [x] **Database**: trigger config columns, `trigger_log` table → `make db-push`
- [x] **SDK**: API surface changed → `bun generate:sdk`
- [ ] **CLI**: No new commands required
- [x] **Tests**: core (events), api (dispatcher), channel-discord (reaction migration), channel-telegram (new)

---

## Execution Group A: Core Events + Provider Abstraction

**Goal:** Lay the foundation — reaction events, AgentProvider interface, wrap Agno

**Packages:** `@omni/core`, `@omni/db`

**Deliverables:**

- [ ] Add `reaction.received` and `reaction.removed` to `CORE_EVENT_TYPES` in `packages/core/src/events/types.ts`
- [ ] Define `ReactionReceivedPayload` and `ReactionRemovedPayload` interfaces:
  ```typescript
  interface ReactionReceivedPayload {
    messageId: string;      // The message being reacted to
    chatId: string;         // Chat where reaction happened
    from: string;           // User who reacted
    emoji: string;          // Emoji used (unicode or custom ID)
    emojiName?: string;     // Custom emoji name (Discord)
    isCustomEmoji?: boolean;
  }

  interface ReactionRemovedPayload {
    messageId: string;
    chatId: string;
    from: string;
    emoji: string;
    emojiName?: string;
    isCustomEmoji?: boolean;
  }
  ```
- [ ] Add entries to `EventPayloadMap` for type-safe handling
- [ ] Add `REACTION` stream to `STREAM_NAMES` and `STREAM_CONFIGS` in `packages/core/src/events/nats/streams.ts`:
  ```typescript
  REACTION: {
    name: 'REACTION',
    subjects: ['reaction.>'],
    max_age: daysToNs(7),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'Reaction events (received, removed)',
  }
  ```
- [ ] Update `getStreamForEventType()` to route `reaction.*` → `REACTION` stream
- [ ] Define `AgentProvider` interface in `packages/core/src/providers/types.ts`:
  ```typescript
  interface AgentProvider {
    readonly id: string;
    readonly name: string;
    readonly schema: ProviderSchema;

    /** Trigger the agent with an event context */
    trigger(context: AgentTriggerContext): Promise<AgentTriggerResult>;

    /** Health check */
    checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  }

  interface AgentTriggerContext {
    /** The triggering event */
    event: OmniEvent;
    /** Instance config */
    instance: Instance;
    /** Chat ID */
    chatId: string;
    /** Sender info */
    sender: { id: string; name?: string };
    /** Message text (for message events) or emoji (for reaction events) */
    content: string;
    /** Session ID (computed from strategy) */
    sessionId: string;
    /** Trace ID for end-to-end tracking */
    traceId: string;
  }

  interface AgentTriggerResult {
    /** Response to send back (empty = fire-and-forget, no response needed) */
    parts: string[];
    /** Provider metadata */
    metadata: {
      runId: string;
      providerId: string;
      durationMs: number;
      cost?: { inputTokens?: number; outputTokens?: number };
    };
  }
  ```
- [ ] Wrap existing `IAgnoClient` as `AgnoAgentProvider` implementing `AgentProvider`
- [ ] Add `'webhook'` to `PROVIDER_SCHEMAS` in `packages/core/src/types/agent.ts`
- [ ] Add trigger config columns to instances table in `packages/db/src/schema.ts`:
  ```typescript
  // Trigger configuration (what events activate the agent)
  triggerEvents: jsonb('trigger_events').$type<string[]>().default(['message.received']),
  triggerReactions: jsonb('trigger_reactions').$type<string[]>(), // emoji list, null = all
  triggerMentionPatterns: jsonb('trigger_mention_patterns').$type<string[]>(),
  ```
- [ ] Add `trigger_log` table for cost tracking:
  ```typescript
  export const triggerLogs = pgTable('trigger_logs', {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id').notNull().references(() => instances.id),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    providerId: uuid('provider_id').references(() => agentProviders.id),
    chatId: varchar('chat_id', { length: 255 }).notNull(),
    senderId: varchar('sender_id', { length: 255 }),
    traceId: varchar('trace_id', { length: 255 }),
    durationMs: integer('duration_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    status: varchar('status', { length: 20 }).notNull().default('completed'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  });
  ```

**Acceptance Criteria:**

- [ ] `reaction.received` and `reaction.removed` exist in `CORE_EVENT_TYPES` array
- [ ] Payloads are in `EventPayloadMap` — `TypedOmniEvent<'reaction.received'>` compiles
- [ ] REACTION stream config exists and `getStreamForEventType('reaction.received')` returns `'REACTION'`
- [ ] `AgentProvider` interface exists with `trigger()` and `checkHealth()` methods
- [ ] `AgnoAgentProvider` wraps existing `IAgnoClient` and passes existing agent-runner tests
- [ ] `trigger_log` table schema defined
- [ ] `make typecheck` passes
- [ ] `make lint` passes

**Validation:**
```bash
make typecheck
make lint
bun test packages/core/
```

---

## Execution Group B: Agent Dispatcher + OpenClaw Provider

**Goal:** Replace agent-responder with multi-event dispatcher, add OpenClaw webhook provider

**Packages:** `@omni/api`, `@omni/core`, `@omni/channel-discord`

**Deliverables:**

- [ ] Create `agent-dispatcher.ts` in `packages/api/src/plugins/` replacing `agent-responder.ts`:
  - Subscribe to `message.received`, `reaction.received`, `reaction.removed` (configurable per instance via `triggerEvents`)
  - Pattern match: @mentions, emoji lists, DM detection (reuse existing `shouldAgentReply` logic)
  - Rate limiting: per-user-per-channel, default 5 triggers/min, configurable
  - Reaction dedup: don't trigger same message+emoji twice (in-memory LRU cache)
  - traceId generation and propagation
  - Use `AgentProvider` interface instead of direct `IAgnoClient`
  - Preserve debouncing from current agent-responder (MessageDebouncer class)
  - Log every trigger to `trigger_log` table
- [ ] Create `WebhookAgentProvider` in `packages/core/src/providers/webhook-provider.ts`:
  - Round-trip mode: `POST <webhook_url>` with event payload, wait for response, return as `AgentTriggerResult`
  - Fire-and-forget mode: `POST <webhook_url>` with event payload, return empty parts immediately
  - Configurable timeout (default 30s for round-trip)
  - Retry logic: 1 retry on 5xx, no retry on 4xx
  - Payload format:
    ```typescript
    interface WebhookPayload {
      event: {
        id: string;
        type: string;
        timestamp: number;
      };
      instance: {
        id: string;
        channelType: string;
        name?: string;
      };
      chat: { id: string };
      sender: { id: string; name?: string };
      content: string;
      traceId: string;
      replyUrl: string; // POST /api/v2/messages/send endpoint
    }
    ```
  - Response format (round-trip):
    ```typescript
    interface WebhookResponse {
      reply?: string;          // Text to send back
      parts?: string[];        // Pre-split parts
      metadata?: Record<string, unknown>;
    }
    ```
- [ ] Update `createProviderClient()` factory in `packages/core/src/providers/factory.ts` to support `'webhook'` schema
- [ ] Migrate Discord plugin to emit `reaction.received`/`reaction.removed` events:
  - Update `handleReactionReceived()` in `packages/channel-discord/src/plugin.ts`
  - Stop emitting reactions as `message.received` with `content.type: 'reaction'`
  - Add dual-emit period: emit both old and new format for 1 release (behind env flag `OMNI_DUAL_EMIT_REACTIONS=true`)
- [ ] Update `setupAgentResponder` export to `setupAgentDispatcher` — keep old function name as deprecated alias
- [ ] Wire dispatcher into API startup (replace agent-responder registration)

**Acceptance Criteria:**

- [ ] Agent dispatcher subscribes to multiple event types based on instance `triggerEvents` config
- [ ] Messages still trigger agent responses (backward compatible with existing behavior)
- [ ] Reactions trigger agent when instance has `reaction.received` in `triggerEvents`
- [ ] Rate limiting blocks excessive triggers (>5/min per user per channel)
- [ ] Reaction dedup prevents double-trigger on same message
- [ ] WebhookAgentProvider POSTs to configured URL with correct payload
- [ ] Fire-and-forget mode returns immediately
- [ ] Round-trip mode waits for response and sends it back
- [ ] Discord emits `reaction.received`/`reaction.removed` events
- [ ] traceId appears on all dispatched events
- [ ] `trigger_log` entries created for every agent trigger
- [ ] All existing agent-responder tests pass (or are migrated to dispatcher)
- [ ] `make check` passes

**Validation:**
```bash
make check
bun test packages/api/
bun test packages/core/
bun test packages/channel-discord/
```

---

## Execution Group C: Channel Telegram

**Goal:** Implement Telegram channel plugin using grammy + Bot API

**Packages:** `@omni/channel-telegram` (new), `@omni/api`

**Deliverables:**

- [ ] Create `packages/channel-telegram/` with standard package structure:
  ```
  packages/channel-telegram/
  ├── package.json          # grammy dependency
  ├── tsconfig.json
  ├── src/
  │   ├── index.ts          # Plugin export
  │   ├── plugin.ts         # TelegramPlugin extends BaseChannelPlugin
  │   ├── client.ts         # grammy Bot wrapper
  │   ├── handlers/
  │   │   ├── index.ts
  │   │   ├── messages.ts   # Text, media, sticker, etc.
  │   │   └── reactions.ts  # Telegram reaction events (Bot API 7.3+)
  │   ├── senders/
  │   │   ├── index.ts
  │   │   ├── text.ts       # sendMessage
  │   │   ├── media.ts      # sendPhoto, sendAudio, sendVideo, sendDocument
  │   │   └── reaction.ts   # setMessageReaction
  │   ├── types.ts          # Telegram-specific types
  │   └── utils/
  │       ├── identity.ts   # Telegram user ID → Omni identity mapping
  │       └── formatting.ts # Markdown/HTML formatting
  └── test/
      ├── plugin.test.ts
      └── fixtures/
  ```
- [ ] Implement `TelegramPlugin` extending `BaseChannelPlugin`:
  - `connect()`: Create grammy Bot, set up webhook or start polling based on config
  - `disconnect()`: Stop bot gracefully
  - `sendMessage()`: Text, media (photo, audio, video, document), sticker
  - `sendTyping()`: `sendChatAction('typing')`
  - `handleWebhook()`: grammy webhook handler for Hono
  - `getProfile()`: `getMe()` → bot profile
  - `getHealth()`: Bot API `getMe()` health check
- [ ] Message handler: Convert Telegram messages → `message.received` events:
  - Map `message.text`, `message.photo`, `message.audio`, `message.video`, `message.document`, `message.sticker`
  - Extract sender: `from.id` (numeric), `from.username`, `from.first_name + from.last_name`
  - Chat detection: `chat.type` ('private' = DM, 'group'/'supergroup' = group, 'channel' = channel)
  - Reply detection: `reply_to_message` → `replyToId`
  - Bot mention: `@botusername` in text or `entities` with `type: 'mention'`
- [ ] Reaction handler: Convert Telegram reactions → `reaction.received`/`reaction.removed` events:
  - Bot API 7.3+ `message_reaction` update
  - Map `new_reaction` vs `old_reaction` to determine add/remove
- [ ] Identity handling:
  - Telegram users have numeric IDs (no phone from Bot API)
  - Create platform identity with `platformUserId: String(user.id)`
  - Use `username` as secondary identifier when available
  - Map to Omni person via identity pipeline
- [ ] Register plugin in API loader (`packages/api/src/plugins/loader.ts`)
- [ ] Webhook route: `POST /api/v2/channels/telegram/:instanceId/webhook`

**Acceptance Criteria:**

- [ ] `bun install` in channel-telegram succeeds (grammy resolves)
- [ ] Plugin implements full `ChannelPlugin` interface
- [ ] Text messages received via webhook → `message.received` event emitted on NATS
- [ ] Text messages sent via `sendMessage()` → delivered to Telegram
- [ ] `sendTyping()` sends typing action
- [ ] Reactions emitted as `reaction.received`/`reaction.removed` (not message.received hack)
- [ ] DM detection works (`chat.type === 'private'`)
- [ ] Bot mention detection works
- [ ] Telegram numeric user IDs create valid platform identities
- [ ] Health check via `getMe()` works
- [ ] Polling mode works for development
- [ ] Webhook mode works for production
- [ ] `make typecheck` passes with new package
- [ ] `make check` passes

**Validation:**
```bash
make check
bun test packages/channel-telegram/
# Manual: connect test bot, send message, verify event on NATS
```

---

## Build Order (Dependency Graph)

```
Group A (Foundation)
  ├── 1. Reaction event types + payloads in @omni/core
  ├── 2. REACTION NATS stream config
  ├── 3. AgentProvider interface + AgentTriggerContext
  ├── 4. AgnoAgentProvider wrapping IAgnoClient
  ├── 5. DB schema: trigger config columns + trigger_log table
  └── 6. db-push

Group B (Dispatcher) — depends on A
  ├── 7. WebhookAgentProvider (round-trip + fire-and-forget)
  ├── 8. agent-dispatcher.ts (multi-event, multi-provider, rate limiting)
  ├── 9. Discord reaction migration (emit reaction.received/removed)
  └── 10. Wire dispatcher into API startup

Group C (Telegram) — depends on A (uses reaction events), independent of B
  ├── 11. Package scaffold + grammy setup
  ├── 12. Message handlers + senders
  ├── 13. Reaction handlers
  ├── 14. Identity mapping
  └── 15. Plugin registration + webhook route
```

Groups B and C can run in **parallel** after Group A completes.

---

## Key File References

| File | Role | Changes |
|------|------|---------|
| `packages/core/src/events/types.ts` | Event definitions | Add reaction.received, reaction.removed + payloads |
| `packages/core/src/events/nats/streams.ts` | NATS streams | Add REACTION stream |
| `packages/core/src/providers/types.ts` | Provider types | Add AgentProvider interface |
| `packages/core/src/providers/factory.ts` | Provider factory | Add webhook schema support |
| `packages/core/src/types/agent.ts` | Agent types | Add 'webhook' to PROVIDER_SCHEMAS |
| `packages/core/src/types/channel.ts` | Channel types | Already has 'telegram' + 'reaction' content type |
| `packages/db/src/schema.ts` | DB schema | Trigger config columns, trigger_log table |
| `packages/api/src/plugins/agent-responder.ts` | Current trigger | **Replace** with agent-dispatcher.ts |
| `packages/api/src/services/agent-runner.ts` | Agent execution | Refactor to use AgentProvider |
| `packages/channel-discord/src/handlers/reactions.ts` | Discord reactions | Emit reaction.received instead of message.received |
| `packages/channel-discord/src/plugin.ts` | Discord plugin | Update handleReactionReceived to use new events |
| `packages/channel-telegram/` | **New package** | Full Telegram Bot API plugin |

---

## Guardrails

| Guardrail | Implementation |
|-----------|---------------|
| Rate limiting | Per-user-per-channel, 5 triggers/min default, configurable per instance |
| Reaction dedup | In-memory LRU: `${messageId}:${emoji}:${userId}` — don't trigger twice |
| Cost tracking | Every trigger logged to `trigger_log` with tokens + duration |
| traceId | Generated at dispatcher, propagated through provider call and response |
| Allowlist/blocklist | Existing access control system applies to all trigger types |
| Reaction spam | Max 3 reaction triggers per message (across all users) |
| Webhook timeout | Round-trip: 30s default, configurable. Fire-and-forget: returns immediately |
| Dual-emit period | Discord emits both old and new reaction format for 1 release cycle |
