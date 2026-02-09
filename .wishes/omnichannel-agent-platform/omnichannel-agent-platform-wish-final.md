# WISH: Omni v2 — Omnichannel Agent Platform Evolution

> Transform Omni from a messaging platform into a truly omnichannel AI agent platform. Same agent identity, same memory, same personality — across WhatsApp, Telegram, Discord, and any future channel.

**Status:** REVIEW
**Created:** 2026-02-09
**Author:** Omni + Genie (council-reviewed 10/0, brainstorm-validated)
**Priority:** STRATEGIC
**Branch:** `feat/omnichannel-agent-platform`

---

## Context

Omni v2 is an event-driven messaging platform with WhatsApp (Baileys) and Discord channel plugins. The codebase already has ~80% of the trigger engine:

| What Exists | Where | Gap |
|-------------|-------|-----|
| Message trigger engine | `agent-responder.ts` — subscribes to message.received, checks reply filters (DM, mention, reply, name match), debounces, calls agents | Only subscribes to `message.received`, hardcoded to Agno |
| Automation engine | `automations.ts` — subscribes to events, evaluates conditions, executes actions | Works but can't dispatch to agent providers |
| traceId field | `EventMetadata.traceId` (optional) in `types.ts` | Exists but never generated or propagated |
| Reaction handling | Discord emits as `message.received` with `content.type: 'reaction'` | Hack, not first-class events |
| Agent providers | `IAgnoClient` in `packages/core/src/providers/types.ts` | Only Agno supported |
| Telegram channel type | `'telegram'` in `CHANNEL_TYPES` array | Type exists, no implementation |
| Provider schemas | `['agnoos', 'agno', 'a2a', 'openai', 'anthropic', 'custom']` | No webhook schema |

## Success Criteria

1. A message or reaction on ANY channel (WhatsApp, Telegram, Discord) matching trigger rules dispatches to the configured agent provider
2. `@omni` mention in any channel triggers agent processing
3. Emoji reactions (configurable, e.g., 🐙) trigger agent processing
4. OpenClaw can receive trigger events via webhook: round-trip (wait) and fire-and-forget (callback later)
5. Telegram channel plugin works with grammy + Bot API, webhook + polling modes
6. Multiple agent providers coexist (Agno, OpenClaw Webhook)
7. Rate limiting per user per channel on triggers
8. traceId propagated end-to-end through the event pipeline
9. All existing functionality (WhatsApp, Discord, automations) continues working

## Out of Scope

- Claude SDK Agent Provider (Phase 2 — separate wish: `omni-native-agent`)
- Cross-channel identity unification (user X on Telegram = user X on WhatsApp)
- Conversation threading across channels
- Replacing OpenClaw's existing channel implementations
- UI dashboard for trigger management
- CLI changes beyond testing

---

## Assumptions, Decisions, Risks

### Assumptions
- **ASM-1**: Council approved 10/0 — architectural direction is locked
- **ASM-2**: OpenClaw will call back via existing `POST /api/v2/messages/send` — no new callback infra
- **ASM-3**: Telegram Bot API 7.3+ reaction support is stable in grammy
- **ASM-4**: Existing automations using `content.type: 'reaction'` are few and can be migrated

### Decisions
- **DEC-1**: `reaction.received` + `reaction.removed` become core events with REACTION NATS stream
- **DEC-2**: `AgentProvider` interface in `packages/core/src/providers/` replaces direct `IAgnoClient` coupling
- **DEC-3**: `agent-dispatcher` replaces `agent-responder` (same location, in-process)
- **DEC-4**: OpenClaw uses fire-and-forget by default (round-trip optional)
- **DEC-5**: Trigger config lives in DB (instances table columns), not YAML
- **DEC-6**: Dual-emit migration: Discord emits both old + new reaction format for 1 release cycle (`OMNI_DUAL_EMIT_REACTIONS=true`)
- **DEC-7**: Payload field names match existing conventions (`from` not `userId`, `chatId` consistent)

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Reaction migration breaks automations | High | Dual-emit for 1 cycle + migration script |
| OpenClaw webhook timeout (round-trip) | Medium | 30s default, fire-and-forget as fallback |
| Telegram Bot API rate limits (30 msg/s global) | Medium | Rate limiter in dispatcher + plugin-level throttle |
| Large PR scope | High | 4 independent groups, merge incrementally |
| Agent provider abstraction doesn't fit all providers | Medium | Minimal interface (`trigger` + `healthCheck`), provider-specific config in JSON |

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| `@omni/core` | [x] events, [x] types, [x] providers | Reaction events, AgentProvider interface |
| `@omni/db` | [x] schema | Trigger config columns, trigger_log table |
| `@omni/api` | [x] plugins, [x] services | agent-dispatcher replaces agent-responder |
| `@omni/channel-sdk` | [ ] no changes | BaseChannelPlugin already handles reactions |
| `@omni/channel-discord` | [x] handlers, [x] plugin | Emit reaction events properly |
| `@omni/channel-whatsapp` | [x] handlers | Emit reaction.received for Baileys reactions |
| `@omni/channel-telegram` | [x] **new package** | grammy, Bot API, full plugin |
| `@omni/sdk` | [x] regenerate | New event types |

### System Checklist

- [x] **Events**: `reaction.received`, `reaction.removed` + REACTION NATS stream
- [x] **Database**: Trigger config columns, trigger_log table → `make db-push`
- [x] **SDK**: Regenerate after API surface changes → `make sdk-generate`
- [ ] **CLI**: No new commands
- [x] **Tests**: core, api, channel-discord, channel-whatsapp, channel-telegram

---

## Execution Group 1: Core Event Foundation

**Dependencies:** None
**Risk:** Low (additive changes)
**Packages:** `@omni/core`, `@omni/db`

### Deliverables

#### 1.1 Reaction Events as First-Class Citizens

- [ ] Add `'reaction.received'` and `'reaction.removed'` to `CORE_EVENT_TYPES` in `packages/core/src/events/types.ts`
- [ ] Define payload interfaces (matching existing field naming conventions):
  ```typescript
  interface ReactionReceivedPayload {
    messageId: string;        // The message being reacted to (matches externalId pattern)
    chatId: string;           // Chat where reaction happened
    from: string;             // User who reacted (matches MessageReceivedPayload.from)
    emoji: string;            // Emoji used (unicode char or custom ID)
    emojiName?: string;       // Custom emoji name (Discord custom emojis)
    isCustomEmoji?: boolean;  // Whether emoji is platform-custom
    rawPayload?: Record<string, unknown>;
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
- [ ] Add entries to `EventPayloadMap`:
  ```typescript
  'reaction.received': ReactionReceivedPayload;
  'reaction.removed': ReactionRemovedPayload;
  ```

#### 1.2 REACTION NATS Stream

- [ ] Add to `STREAM_NAMES` in `packages/core/src/events/nats/streams.ts`:
  ```typescript
  REACTION: 'REACTION',
  ```
- [ ] Add stream config:
  ```typescript
  [STREAM_NAMES.REACTION]: {
    name: STREAM_NAMES.REACTION,
    subjects: ['reaction.>'],
    max_age: daysToNs(7),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'Reaction events (received, removed)',
  },
  ```
- [ ] Update `getStreamForEventType()` to route `reaction.*` → `REACTION`

#### 1.3 traceId Propagation

- [ ] Generate `traceId` (nanoid) at event entry points (channel plugins) when not already set
- [ ] Ensure `traceId` flows: incoming event → dispatcher → agent provider call → response event
- [ ] Add `traceId` to structured log context in agent-responder/dispatcher

### Acceptance Criteria

- [ ] `TypedOmniEvent<'reaction.received'>` compiles correctly
- [ ] `getStreamForEventType('reaction.received')` returns `'REACTION'`
- [ ] `CORE_EVENT_TYPES` includes both reaction event types
- [ ] `make typecheck` passes
- [ ] `bun test packages/core/` passes

---

## Execution Group 2: Agent Provider Abstraction

**Dependencies:** None (can run in parallel with Group 1)
**Risk:** Medium (refactoring existing integration)
**Packages:** `@omni/core`, `@omni/db`, `@omni/api`

### Deliverables

#### 2.1 AgentProvider Interface

- [ ] Define in `packages/core/src/providers/types.ts` (extend existing file):
  ```typescript
  interface AgentProvider {
    readonly id: string;
    readonly name: string;
    readonly schema: ProviderSchema;
    readonly mode: 'round-trip' | 'fire-and-forget';

    /** Check if this provider can handle a given trigger type */
    canHandle(trigger: AgentTrigger): boolean;

    /** Process a trigger and return response (null = fire-and-forget, no response) */
    trigger(context: AgentTrigger): Promise<AgentTriggerResult | null>;

    /** Health check */
    checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  }

  interface AgentTrigger {
    traceId: string;
    type: 'mention' | 'reaction' | 'dm' | 'reply' | 'name_match' | 'command';
    event: OmniEvent;
    source: {
      channelType: ChannelType;
      instanceId: string;
      chatId: string;
      messageId: string;
    };
    sender: {
      platformUserId: string;
      personId?: string;
      displayName?: string;
    };
    content: {
      text?: string;
      emoji?: string;                // For reaction triggers
      referencedMessageId?: string;  // For reply triggers
    };
    sessionId: string;  // Computed from instance's session strategy
  }

  interface AgentTriggerResult {
    /** Response parts to send back (empty = no response needed) */
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

#### 2.2 AgnoAgentProvider (Backward Compat)

- [ ] Create `packages/core/src/providers/agno-provider.ts`
- [ ] Wraps existing `IAgnoClient` + `AgentRunnerService` logic
- [ ] Implements `AgentProvider` interface
- [ ] All existing agent-responder functionality works identically through new abstraction
- [ ] `mode: 'round-trip'` (Agno always returns responses synchronously)

#### 2.3 OpenClaw Webhook Provider

- [ ] Create `packages/core/src/providers/webhook-provider.ts`
- [ ] Add `'webhook'` to `PROVIDER_SCHEMAS` in `packages/core/src/types/agent.ts`
- [ ] Update `createProviderClient()` in `factory.ts` to handle `'webhook'` schema
- [ ] Round-trip mode: POST event payload → wait for response → return `AgentTriggerResult`
- [ ] Fire-and-forget mode: POST event payload → return `null` immediately
- [ ] Webhook payload format:
  ```typescript
  interface WebhookPayload {
    event: { id: string; type: string; timestamp: number };
    instance: { id: string; channelType: string; name?: string };
    chat: { id: string };
    sender: { id: string; name?: string; personId?: string };
    content: { text?: string; emoji?: string };
    traceId: string;
    replyEndpoint: string;  // e.g., "POST /api/v2/messages/send"
  }
  ```
- [ ] Round-trip response format:
  ```typescript
  interface WebhookResponse {
    reply?: string;
    parts?: string[];
    metadata?: Record<string, unknown>;
  }
  ```
- [ ] Configurable timeout (default 30s), 1 retry on 5xx, no retry on 4xx
- [ ] Health check: HEAD request to webhook URL

#### 2.4 DB Schema: Trigger Config + Logging

- [ ] Add columns to instances table in `packages/db/src/schema.ts` (Drizzle):
  ```typescript
  // Trigger configuration
  triggerEvents: jsonb('trigger_events').$type<string[]>().default(['message.received']),
  triggerReactions: jsonb('trigger_reactions').$type<string[]>(),  // null = all emojis
  triggerMentionPatterns: jsonb('trigger_mention_patterns').$type<string[]>(),
  triggerMode: varchar('trigger_mode', { length: 20 }).default('round-trip'),
  ```
- [ ] Add `trigger_logs` table:
  ```typescript
  export const triggerLogs = pgTable('trigger_logs', {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: varchar('trace_id', { length: 255 }),
    instanceId: uuid('instance_id').notNull().references(() => instances.id),
    providerId: uuid('provider_id').references(() => agentProviders.id),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    triggerType: varchar('trigger_type', { length: 50 }).notNull(), // mention, reaction, dm, etc.
    channelType: varchar('channel_type', { length: 50 }),
    chatId: varchar('chat_id', { length: 255 }).notNull(),
    senderId: varchar('sender_id', { length: 255 }),
    mode: varchar('mode', { length: 20 }),  // round-trip or fire-and-forget
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responded: boolean('responded').default(false),
    durationMs: integer('duration_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    error: text('error'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }, (table) => ({
    instanceIdx: index('trigger_logs_instance_idx').on(table.instanceId),
    traceIdx: index('trigger_logs_trace_idx').on(table.traceId),
    firedAtIdx: index('trigger_logs_fired_at_idx').on(table.firedAt),
  }));
  ```

### Acceptance Criteria

- [ ] `AgentProvider` interface importable from `@omni/core`
- [ ] `AgnoAgentProvider` passes existing agent integration tests
- [ ] `WebhookAgentProvider` handles both round-trip and fire-and-forget modes
- [ ] `'webhook'` is a valid `ProviderSchema`
- [ ] Trigger config columns exist on instances table
- [ ] `trigger_logs` table schema defined with indexes
- [ ] `make typecheck` passes
- [ ] `make db-push` applies without errors

---

## Execution Group 3: Agent Dispatcher + Channel Migration

**Dependencies:** Group 1 + Group 2
**Risk:** Medium (modifying critical path)
**Packages:** `@omni/api`, `@omni/channel-discord`, `@omni/channel-whatsapp`

### Deliverables

#### 3.1 agent-responder → agent-dispatcher

- [ ] Create `packages/api/src/plugins/agent-dispatcher.ts` (keep `agent-responder.ts` as deprecated re-export)
- [ ] Subscribe to multiple event types based on instance `triggerEvents` config:
  - `message.received` (existing behavior)
  - `reaction.received` (new)
  - `reaction.removed` (new, optional)
- [ ] Trigger type classification:
  - DM → `type: 'dm'`
  - @mention → `type: 'mention'`
  - Reply to bot → `type: 'reply'`
  - Name match → `type: 'name_match'`
  - Reaction emoji match → `type: 'reaction'`
- [ ] Rate limiting: per-user-per-channel sliding window
  - Default: 5 triggers/min (configurable per instance)
  - In-memory counter with TTL
- [ ] Reaction dedup: LRU cache of `${messageId}:${emoji}:${userId}`, max 3 reaction triggers per message
- [ ] Route to correct `AgentProvider` based on instance's `agentProviderId` → provider schema
- [ ] Preserve existing `MessageDebouncer` for message events
- [ ] Log every dispatch to `trigger_logs` table
- [ ] Wire into API startup (replace `setupAgentResponder` call)

#### 3.2 Discord Reaction Migration

- [ ] Update `handleReactionReceived()` in `packages/channel-discord/src/plugin.ts`:
  - Emit `reaction.received` event (new format) via eventBus
  - When `OMNI_DUAL_EMIT_REACTIONS=true`: also emit legacy `message.received` with `content.type: 'reaction'`
  - Default: dual-emit ON for backward compat
- [ ] Add `emitReactionReceived()` helper to BaseChannelPlugin or Discord plugin
- [ ] Update `handlers/reactions.ts` to call new emit method

#### 3.3 WhatsApp Reaction Events

- [ ] Detect Baileys reaction events in WhatsApp plugin
- [ ] Emit `reaction.received` for reaction add
- [ ] Emit `reaction.removed` for reaction remove
- [ ] Include emoji and target message ID

### Acceptance Criteria

- [ ] `@omni` mention on WhatsApp → agent triggered → response sent
- [ ] 🐙 reaction on Discord → agent triggered → response sent (if instance configured)
- [ ] Messages still trigger agents identically to current behavior
- [ ] Rate limiting blocks > 5 triggers/min per user
- [ ] Reaction dedup prevents double-trigger
- [ ] `trigger_logs` records every dispatch with traceId
- [ ] Discord emits proper `reaction.received` events
- [ ] WhatsApp emits `reaction.received` events
- [ ] Dual-emit mode works for backward compat
- [ ] All existing agent-responder tests pass (migrated)
- [ ] `make check` passes

**Validation:**
```bash
make check
bun test packages/api/
bun test packages/channel-discord/
```

---

## Execution Group 4: Channel Telegram

**Dependencies:** Group 1 (reaction event types)
**Can parallel with:** Groups 2 and 3
**Risk:** Low (new isolated package)
**Packages:** `@omni/channel-telegram` (new)

### Deliverables

#### 4.1 Package Setup

- [ ] Create `packages/channel-telegram/`:
  ```
  packages/channel-telegram/
  ├── package.json          # grammy dependency
  ├── tsconfig.json
  ├── CLAUDE.md             # Package-specific conventions
  ├── src/
  │   ├── index.ts
  │   ├── plugin.ts         # TelegramPlugin extends BaseChannelPlugin
  │   ├── client.ts         # grammy Bot wrapper
  │   ├── handlers/
  │   │   ├── index.ts
  │   │   ├── messages.ts   # Text, media, sticker, etc.
  │   │   └── reactions.ts  # Bot API 7.3+ reactions
  │   ├── senders/
  │   │   ├── index.ts
  │   │   ├── text.ts
  │   │   ├── media.ts
  │   │   └── reaction.ts
  │   ├── types.ts
  │   └── utils/
  │       ├── identity.ts
  │       └── formatting.ts
  └── test/
      ├── plugin.test.ts
      └── fixtures/
  ```
- [ ] `package.json` with `grammy` as dependency
- [ ] Add to Turborepo workspace config

#### 4.2 Plugin Core

- [ ] `TelegramPlugin` implements `ChannelPlugin` interface:
  - `id: 'telegram'`
  - `connect()`: create grammy Bot, set webhook or start polling
  - `disconnect()`: stop bot gracefully
  - `sendMessage()`: text, photo, audio, video, document, sticker
  - `sendTyping()`: `sendChatAction('typing')`
  - `handleWebhook()`: grammy webhook handler for Hono
  - `getProfile()`: `getMe()` → bot profile
  - `getHealth()`: `getMe()` health check
- [ ] Message handler → `message.received` events:
  - Map `message.text`, `.photo`, `.audio`, `.video`, `.document`, `.sticker`
  - Sender: `from.id` (numeric string), `from.username`, `from.first_name`
  - Chat type: `chat.type` ('private' = DM, 'group'/'supergroup' = group)
  - Reply: `reply_to_message` → `replyToId`
  - Mention: `@botusername` in text or `entities` with `type: 'mention'`
- [ ] Reaction handler → `reaction.received`/`reaction.removed`:
  - Bot API 7.3+ `message_reaction` update type
  - Compare `new_reaction` vs `old_reaction` arrays

#### 4.3 Webhook + Polling

- [ ] Webhook mode: `bot.api.setWebhook(url)` during connect
- [ ] Polling mode: `bot.start()` with long polling
- [ ] Auto-detect: `TELEGRAM_WEBHOOK_URL` set → webhook, else → polling
- [ ] Register route: `POST /api/v2/channels/telegram/:instanceId/webhook`

#### 4.4 Identity & Media

- [ ] Telegram user ID (numeric) → platform identity (`platformUserId: String(user.id)`)
- [ ] Username as secondary identifier
- [ ] Media: download via `bot.api.getFile()` → Omni media pipeline
- [ ] Profile sync: display name, username, avatar

### Acceptance Criteria

- [ ] `bun install` resolves grammy
- [ ] Plugin implements full `ChannelPlugin` interface
- [ ] Text message to bot → `message.received` on NATS
- [ ] `sendMessage()` delivers text to Telegram
- [ ] `sendTyping()` shows typing indicator
- [ ] Reactions emit `reaction.received`/`reaction.removed`
- [ ] DM detection works (`chat.type === 'private'`)
- [ ] Bot mention detection works
- [ ] Polling mode works for dev
- [ ] Webhook mode works for prod
- [ ] `make typecheck` passes
- [ ] `bun test packages/channel-telegram/` passes

---

## Build Order (Dependency Graph)

```
Group 1 (Core Events)          Group 2 (Provider Abstraction)
  ├── reaction event types       ├── AgentProvider interface
  ├── REACTION NATS stream       ├── AgnoAgentProvider
  └── traceId propagation        ├── WebhookAgentProvider
                                 └── DB: trigger config + trigger_logs
        ↓                              ↓
        └──────────┬───────────────────┘
                   ↓
        Group 3 (Dispatcher + Migration)
          ├── agent-dispatcher.ts
          ├── Discord reaction migration
          └── WhatsApp reaction events

Group 4 (Telegram) ← depends only on Group 1
  ├── Package scaffold
  ├── Plugin core
  ├── Webhook + polling
  └── Identity + media
```

**Parallelism:** Groups 1 + 2 in parallel. Group 4 starts after Group 1. Group 3 after Groups 1 + 2.

---

## Key File References

| File | Changes |
|------|---------|
| `packages/core/src/events/types.ts` | Add reaction events + payloads + EventPayloadMap |
| `packages/core/src/events/nats/streams.ts` | Add REACTION stream + update routing |
| `packages/core/src/providers/types.ts` | Add AgentProvider, AgentTrigger, AgentTriggerResult |
| `packages/core/src/providers/factory.ts` | Add webhook schema support |
| `packages/core/src/providers/agno-provider.ts` | **New** — AgnoAgentProvider wrapper |
| `packages/core/src/providers/webhook-provider.ts` | **New** — WebhookAgentProvider |
| `packages/core/src/types/agent.ts` | Add 'webhook' to PROVIDER_SCHEMAS |
| `packages/core/src/types/channel.ts` | Already has 'telegram' + 'reaction' ✓ |
| `packages/db/src/schema.ts` | Trigger config columns + trigger_logs table |
| `packages/api/src/plugins/agent-responder.ts` | **Replace** → agent-dispatcher.ts |
| `packages/api/src/services/agent-runner.ts` | Refactor to use AgentProvider |
| `packages/channel-discord/src/plugin.ts` | Update handleReactionReceived |
| `packages/channel-discord/src/handlers/reactions.ts` | Use new reaction event emit |
| `packages/channel-whatsapp/src/` | Add reaction event handling |
| `packages/channel-telegram/` | **New package** — full plugin |

---

## Guardrails

| Guardrail | Implementation | Default |
|-----------|---------------|---------|
| Rate limiting | Per-user-per-channel sliding window | 5 triggers/min |
| Reaction dedup | LRU cache: `${messageId}:${emoji}:${userId}` | Max 3 per message |
| Cost tracking | Every trigger → `trigger_logs` with tokens + duration | Always on |
| traceId | Generated at channel plugin, propagated end-to-end | nanoid |
| Access control | Existing allowlist/blocklist applies to all trigger types | Per instance |
| Webhook timeout | Configurable per provider | 30s round-trip |
| Dual-emit | `OMNI_DUAL_EMIT_REACTIONS=true` for backward compat | ON for 1 release |
| Telegram rate | Plugin-level throttle respecting Bot API limits | 30 msg/s global |

---

## Validation

```bash
# Full quality gate
make check

# Per-group validation
bun test packages/core/          # Group 1 + 2
bun test packages/api/           # Group 3
bun test packages/channel-discord/  # Group 3
bun test packages/channel-telegram/ # Group 4

# Manual integration tests
# 1. Send @omni message on WhatsApp → verify agent responds
# 2. React with 🐙 on Discord message → verify agent triggers
# 3. POST webhook payload to OpenClaw endpoint → verify round-trip + fire-and-forget
# 4. Send message to Telegram bot → verify event on NATS
# 5. Send message via Omni API → verify delivery on Telegram
```

---

## Notes

- Council voted 10/0 APPROVE with modifications (all incorporated)
- Brainstorm identified 80% existing infrastructure — reduces scope by ~40%
- Phase 2 (Claude SDK Agent Provider) tracked in separate wish: `omni-native-agent`
- This PR establishes the foundation for "one octopus, many tentacles" 🐙
