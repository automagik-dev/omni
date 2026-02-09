# WISH: Omni v2 — Omnichannel Agent Platform Evolution

> Transform Omni from a messaging platform into a truly omnichannel AI agent platform. Same agent identity, same memory, same personality — across WhatsApp, Telegram, Discord, and any future channel.

**Status:** IN PROGRESS
**Created:** 2026-02-09
**Author:** Omni + Felipe (council-reviewed, brainstorm-validated)
**Priority:** STRATEGIC
**Branch:** `feat/omnichannel-agent-platform`

---

## Context

Omni v2 is an event-driven messaging platform with WhatsApp (Baileys) and Discord channel plugins. The platform already has:
- `agent-responder.ts` — subscribes to message.received, checks reply filters, debounces, calls agents (80% of a trigger engine)
- `automations.ts` — AutomationEngine that subscribes to events, evaluates conditions, executes actions
- `traceId` in EventMetadata (optional, not yet propagated)
- Agent providers hardcoded to Agno (`IAgnoClient`)
- Reactions hacked as `message.received` with `content.type: 'reaction'`

We need to generalize these into a true omnichannel agent dispatch system and add Telegram as a new channel.

## Success Criteria

1. ✅ A message or reaction on ANY channel (WhatsApp, Telegram, Discord) matching trigger rules dispatches to the configured agent provider
2. ✅ `@omni` mention in any channel triggers agent processing
3. ✅ Emoji reactions (configurable, e.g., 🐙) trigger agent processing
4. ✅ OpenClaw can receive trigger events via webhook in two modes: round-trip (wait for response) and fire-and-forget (agent decides autonomously)
5. ✅ Telegram channel plugin works with Bot API (grammy), webhook + polling modes
6. ✅ Multiple agent providers coexist (Agno, OpenClaw Webhook)
7. ✅ Rate limiting per user per channel on triggers
8. ✅ traceId propagated end-to-end through the event pipeline
9. ✅ All existing functionality (WhatsApp, Discord, automations) continues working

## Out of Scope

- Claude SDK Agent Provider (Phase 2, separate PR)
- Cross-channel identity graph (user X on Telegram = user X on WhatsApp)
- Conversation threading across channels
- Replacing OpenClaw's existing channel implementations
- UI dashboard for trigger management

---

## Execution Groups

### Group 1: Core Event Foundation
**Dependencies:** None
**Risk:** Low (additive changes to core types)

#### Task 1.1: Reaction Events as First-Class Citizens
- Add `reaction.received` and `reaction.removed` to `CORE_EVENT_TYPES` in `packages/core/src/events/types.ts`
- Define `ReactionReceivedPayload` and `ReactionRemovedPayload` interfaces:
  ```typescript
  interface ReactionReceivedPayload {
    targetMessageId: string;
    emoji: string;
    userId: string;
    chatId: string;
    action: 'add';
    timestamp: Date;
  }
  ```
- Add `REACTION` stream to `packages/core/src/events/nats/streams.ts` with subjects `['reaction.>']`
- Update Discord plugin to emit `reaction.received` instead of fake `message.received` with `content.type: 'reaction'`
- Update WhatsApp plugin to emit `reaction.received` for Baileys reaction events
- **Migration note:** Existing automations listening for `message.received` reactions will need updating

**Acceptance:** `bun test` passes, reaction events appear on NATS as `reaction.received.{channel}.{instanceId}`

#### Task 1.2: traceId Propagation
- Generate `traceId` (nanoid) in channel plugins for each incoming event
- Ensure `traceId` is included in EventMetadata for all emitted events
- Agent dispatcher includes original `traceId` when calling agent provider
- Response events (message.sent) include the same `traceId`
- Add traceId to log context in agent-responder/dispatcher

**Acceptance:** End-to-end trace visible: incoming message → trigger → agent call → response → sent message, all sharing same traceId

### Group 2: Agent Provider Abstraction
**Dependencies:** None (can parallel with Group 1)
**Risk:** Medium (refactoring existing agent integration)

#### Task 2.1: AgentProvider Interface
- Create `packages/core/src/providers/` directory
- Define `AgentProvider` interface:
  ```typescript
  interface AgentProvider {
    id: string;
    name: string;
    type: 'agno' | 'openclaw-webhook' | 'claude-sdk';
    mode: 'round-trip' | 'fire-and-forget';
    canHandle(trigger: AgentTrigger): boolean;
    process(trigger: AgentTrigger): Promise<AgentResponse | null>;
    healthCheck(): Promise<{ healthy: boolean; message?: string }>;
  }

  interface AgentTrigger {
    traceId: string;
    type: 'mention' | 'reaction' | 'dm' | 'command' | 'automation';
    source: {
      channel: string;
      instanceId: string;
      chatId: string;
      messageId: string;
    };
    user: {
      platformUserId: string;
      displayName?: string;
    };
    content: {
      text?: string;
      reactionEmoji?: string;
      referencedMessageId?: string;
      referencedMessageText?: string;
    };
    metadata: Record<string, unknown>;
  }

  interface AgentResponse {
    text?: string;
    media?: Array<{ url: string; type: string }>;
    actions?: Array<{ type: string; payload: unknown }>;
    metadata?: Record<string, unknown>;
  }
  ```
- Export from `packages/core/src/providers/index.ts`

**Acceptance:** Interface compiles, is importable from `@omni/core/providers`

#### Task 2.2: AgnoAgentProvider (Backward Compatibility)
- Wrap existing `AgentRunnerService` / `IAgnoClient` as `AgnoAgentProvider`
- Implements `AgentProvider` interface
- All existing agent functionality continues working unchanged
- Add `type` column to `agentProviders` DB table (default: `'agno'`)

**Acceptance:** Existing agent-responder works identically through the new provider abstraction

#### Task 2.3: OpenClaw Webhook Provider
- Implement `OpenClawWebhookProvider` implementing `AgentProvider`
- **Round-trip mode**: POST trigger event to OpenClaw webhook URL → wait for response → return AgentResponse
- **Fire-and-forget mode**: POST trigger event to OpenClaw webhook URL → return null immediately → OpenClaw may later call Omni's `POST /api/v2/messages/send` to respond
- Provider config: `{ webhookUrl, apiKey, mode: 'round-trip' | 'fire-and-forget', timeoutMs }`
- Health check: HEAD request to webhook URL
- Include `traceId` in webhook payload

**Acceptance:** 
- Round-trip: POST to OpenClaw → receive response → send via channel
- Fire-and-forget: POST to OpenClaw → return immediately → OpenClaw can independently call Omni API

### Group 3: Agent Dispatcher (Evolved agent-responder)
**Dependencies:** Group 1, Group 2
**Risk:** Medium (modifying critical path)

#### Task 3.1: Evolve agent-responder → agent-dispatcher
- Rename/refactor `packages/api/src/plugins/agent-responder.ts` → `agent-dispatcher.ts`
- Subscribe to MULTIPLE event types: `message.received.>` AND `reaction.received.>`
- For messages: existing reply filter logic (DM, mention, reply, name match)
- For reactions: match against configured trigger reactions per instance
- Add `@omni` (or configurable pattern) mention detection
- Use `AgentProvider` interface instead of direct `AgentRunnerService` calls
- Dispatch to correct provider based on instance's `agentProviderId` → provider `type`

#### Task 3.2: Trigger Configuration (DB Schema)
- Extend instances table (or create trigger_config table):
  ```sql
  ALTER TABLE instances ADD COLUMN trigger_events text[] DEFAULT '{"message.received"}';
  ALTER TABLE instances ADD COLUMN trigger_reactions text[] DEFAULT '{}';
  ALTER TABLE instances ADD COLUMN trigger_mention_patterns text[] DEFAULT '{}';
  ALTER TABLE instances ADD COLUMN trigger_mode text DEFAULT 'round-trip';
  ```
- API endpoints: `GET/PUT /api/v2/instances/:id/triggers`
- CLI: `omni instances triggers <id>` to view/edit

#### Task 3.3: Rate Limiting & Safety
- Rate limiter: max triggers per user per channel per time window (default: 5/minute)
- Allowlist/blocklist per instance for which chats trigger the agent
- Reaction dedup: don't trigger on the same message + emoji combo twice
- `trigger_log` table for observability:
  ```sql
  CREATE TABLE trigger_log (
    id uuid PRIMARY KEY,
    trace_id text,
    instance_id uuid,
    provider_id uuid,
    trigger_type text,
    channel_type text,
    chat_id text,
    user_id text,
    mode text,
    fired_at timestamptz,
    responded_at timestamptz,
    responded boolean DEFAULT false,
    cost_estimate numeric,
    metadata jsonb
  );
  ```

**Acceptance:** 
- @omni mention on WhatsApp → triggers agent → response sent back
- 🐙 reaction on Discord → triggers agent → response sent back
- Rate limiting blocks excessive triggers
- trigger_log records all dispatches

### Group 4: Telegram Channel Plugin
**Dependencies:** Group 1 (reaction event types)
**Risk:** Low (new isolated package, follows existing pattern)
**Can parallel with:** Group 2, Group 3

#### Task 4.1: channel-telegram Package Setup
- Create `packages/channel-telegram/`
- `package.json` with dependencies: `grammy` (Bun-compatible Telegram Bot API framework)
- Follow exact structure of `channel-discord`: `src/`, `test/`, `tsconfig.json`
- Implement `BaseChannelPlugin` interface

#### Task 4.2: Telegram Plugin Core
- `src/plugin.ts` — TelegramPlugin extends BaseChannelPlugin
  - `id: 'telegram'`, capabilities declaration
  - `connect()`: create grammy Bot, set webhook or start polling
  - `disconnect()`: stop bot
  - `sendMessage()`: send text, media, documents via Bot API
  - `sendTyping()`: send chat action 'typing'
- `src/handlers/messages.ts` — incoming message processing
  - Text, photo, video, document, voice, sticker
  - Emit `message.received` events
  - Handle `/start`, `/help` bot commands
- `src/handlers/reactions.ts` — reaction processing
  - Emit `reaction.received` events (Telegram Bot API supports reactions since v7.0)
- `src/types.ts` — Telegram-specific types

#### Task 4.3: Telegram Webhook + Polling
- Webhook mode (production): `bot.api.setWebhook(url)` during connect()
- Register webhook route via `handleWebhook()` method
- Polling mode (development): `bot.start()` with long polling
- Auto-detect: if `TELEGRAM_WEBHOOK_URL` is set → webhook, else → polling
- Health check: `bot.api.getMe()` call

#### Task 4.4: Telegram Identity & Media
- Map Telegram user IDs (numeric) to Omni identity system
- Handle Telegram's lack of phone number exposure (bots can't see phone numbers)
- Media handling: download files via `bot.api.getFile()`, convert to Omni media format
- Profile sync: display name, username, avatar from Telegram user object

**Acceptance:**
- Telegram bot receives messages → emits `message.received` events on NATS
- Sending messages through Omni API → delivered via Telegram Bot API
- Reactions on Telegram messages → emit `reaction.received` events
- Both webhook and polling modes work
- `make typecheck && make lint` pass

---

## Validation Commands

```bash
# Type safety
make typecheck

# Linting
make lint

# Tests
make test

# Specific: core event types
bun test packages/core/src/events/

# Specific: agent provider
bun test packages/core/src/providers/

# Integration: trigger dispatch
# Manual: send @omni message on WhatsApp/Discord → verify agent responds
# Manual: react with 🐙 on a message → verify agent triggers
# Manual: POST webhook to OpenClaw endpoint → verify round-trip and fire-and-forget

# Telegram
# Manual: send message to Telegram bot → verify event on NATS
# Manual: send message via Omni API → verify delivery on Telegram
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Reaction event migration breaks automations | High | Add backward compat: emit BOTH message.received and reaction.received during transition |
| WhatsApp anti-bot on reaction reads | Medium | humanDelay() already in place, extend to reaction handling |
| Telegram webhook needs HTTPS | Low | Support polling fallback, auto-detect |
| Fire-and-forget observability gap | Medium | trigger_log table + custom.agent.ack event from OpenClaw |
| Large PR scope | High | Split into 4 independent groups, merge incrementally |

---

## Notes

- Council voted 10/0 APPROVE with modifications (all incorporated)
- Brainstorm with Claude Code identified existing infrastructure (agent-responder, automations, traceId) that reduces work by ~40%
- Phase 2 (Claude SDK Agent Provider) will be a separate PR after this lands
- This PR establishes the foundation for "one octopus, many tentacles" 🐙
