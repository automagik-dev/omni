# Design: Per-User and Per-Agent Config Overrides on Routes

| Field | Value |
|-------|-------|
| **Slug** | `route-config-overrides` |
| **Date** | 2026-03-24 |
| **WRS** | 100/100 |

## Problem
Dev team shares a few WhatsApp numbers for testing. One developer had to spin up 3 separate Omni installations (3x RAM, 3 PM2 processes, 3 databases) because there's no way to say: "I'm Felipe, I don't want debounce/ack/split — give me raw, fast responses. Everyone else gets the polished production UX."

## Real Use Cases

### 1. Dev override — "I'm admin, no bullshit"
Felipe (admin/developer) texts the bot and wants:
- Zero debounce (instant response, no 30s wait)
- No ack emoji (visual noise during debugging)
- No split delay (see the full response immediately)
- No ack message ("Processing..." is clutter when testing)

Everyone else (clients, testers) gets the production defaults.

### 2. Shared test number — "Antonio, test on our number"
One WhatsApp number. Felipe routes to Agent A, Antonio routes to Agent B. Each person gets their own agent AND their own messaging behavior, without needing separate phones or separate Omni installations.

### 3. Kill the multi-installation hack
The other developer created 3 Omni servers to work around this. Route-level overrides eliminate that need entirely — one instance, per-user config.

## Scope
### IN
- Add messaging behavior override columns to `agent_routes` table: debounce, split delay, ack, ack message
- Extend `resolveEffectiveInstance()` merge to include new fields (this already does `route.X ?? instance.X` for 10+ fields)
- Move route resolution BEFORE debounce in the dispatcher pipeline (required for debounce overrides)
- Update route CRUD API + OpenAPI schemas
- Update CLI `omni routes create/update` with override flags
- Drizzle migration for new columns

### OUT
- Access mode/rules at route level (security stays instance-scoped)
- Profile name/pic at route level (WhatsApp protocol: per-number)
- Read receipts at route level (WhatsApp protocol: per-connection)
- Trigger events at route level (per-connection subscription)
- A/B testing framework (YAGNI — just use routes manually)

## Architecture

### What already works
Routes already override 10+ fields via `resolveEffectiveInstance()` (line 2829-2843):
```typescript
const effectiveInstance = {
  ...instance,
  agentTimeout: route.agentTimeout ?? instance.agentTimeout,
  agentStreamMode: route.agentStreamMode ?? instance.agentStreamMode,
  agentReplyFilter: route.agentReplyFilter ?? instance.agentReplyFilter,
  agentSessionStrategy: route.agentSessionStrategy ?? instance.agentSessionStrategy,
  // ... 6 more fields
};
```

Split delay, reaction ack, and ack message are read AFTER route resolution (lines 1699, 2293, 2342). Adding these to the merge = instant support, zero flow changes.

### What needs rearchitecting: debounce
Debounce config is read BEFORE route resolution:
```
message.received → shouldProcessMessage(instance) → getDebounceConfig(INSTANCE) → buffer
  → debounce callback → resolveEffectiveInstance() → processAgentResponse
```

To support per-user debounce, route resolution must move earlier:
```
message.received → shouldProcessMessage(instance) → resolveEffectiveInstance()
  → getDebounceConfig(EFFECTIVE_INSTANCE) → buffer
  → debounce callback → processAgentResponse
```

This means calling `resolveEffectiveInstance()` at line ~3625 instead of line ~3582 (inside the debounce callback). The resolved instance then flows into the debounce buffer.

### Schema: New columns on `agent_routes`

All nullable — null means "inherit from instance" (the default):

```typescript
// Debounce overrides
messageDebounceMode: varchar('message_debounce_mode', { length: 20 }),
messageDebounceMinMs: integer('message_debounce_min_ms'),
messageDebounceMaxMs: integer('message_debounce_max_ms'),
messageDebounceGroupMs: integer('message_debounce_group_ms'),
messageDebounceRestartOnTyping: boolean('message_debounce_restart_on_typing'),

// Split delay overrides
messageSplitDelayMode: varchar('message_split_delay_mode', { length: 20 }),
messageSplitDelayFixedMs: integer('message_split_delay_fixed_ms'),
messageSplitDelayMinMs: integer('message_split_delay_min_ms'),
messageSplitDelayMaxMs: integer('message_split_delay_max_ms'),
enableAutoSplit: boolean('enable_auto_split'),

// Ack overrides
reactionAck: varchar('reaction_ack', { length: 10 }),
reactionAckEmoji: jsonb('reaction_ack_emoji').$type<Record<string, string>>(),
ackTimeoutMs: integer('ack_timeout_ms'),
agentAckMessage: text('agent_ack_message'),
```

### Config Merge — extend `resolveEffectiveInstance()`

Add to the existing merge block (line 2829):
```typescript
messageDebounceMode: route.messageDebounceMode ?? instance.messageDebounceMode,
messageDebounceMinMs: route.messageDebounceMinMs ?? instance.messageDebounceMinMs,
messageDebounceMaxMs: route.messageDebounceMaxMs ?? instance.messageDebounceMaxMs,
messageDebounceGroupMs: route.messageDebounceGroupMs ?? (instance as any).messageDebounceGroupMs,
messageDebounceRestartOnTyping: route.messageDebounceRestartOnTyping ?? instance.messageDebounceRestartOnTyping,
messageSplitDelayMode: route.messageSplitDelayMode ?? instance.messageSplitDelayMode,
messageSplitDelayFixedMs: route.messageSplitDelayFixedMs ?? instance.messageSplitDelayFixedMs,
messageSplitDelayMinMs: route.messageSplitDelayMinMs ?? instance.messageSplitDelayMinMs,
messageSplitDelayMaxMs: route.messageSplitDelayMaxMs ?? instance.messageSplitDelayMaxMs,
enableAutoSplit: route.enableAutoSplit ?? instance.enableAutoSplit,
reactionAck: route.reactionAck ?? (instance as any).reactionAck,
reactionAckEmoji: route.reactionAckEmoji ?? (instance as any).reactionAckEmoji,
ackTimeoutMs: route.ackTimeoutMs ?? (instance as any).ackTimeoutMs,
agentAckMessage: route.agentAckMessage ?? (instance as any).agentAckMessage,
```

### Pipeline change — early route resolution

In the `message.received` handler (~line 3608):

```typescript
// BEFORE (current):
const instance = await shouldProcessMessage(...);
const debounceConfig = getDebounceConfig(instance);  // ← base instance
debouncer.buffer(..., debounceConfig);
// Inside debounce callback:
const { instance: resolved } = await resolveEffectiveInstance(...);  // ← too late for debounce

// AFTER (new):
const baseInstance = await shouldProcessMessage(...);
// Resolve route EARLY to get per-user overrides
const chat = await services.chats.findByExternalIdSmart(baseInstance.id, payload.chatId);
const { instance: resolved } = await resolveEffectiveInstance(
  services, db, baseInstance, chat?.id, metadata.personId,
);
const debounceConfig = getDebounceConfig(resolved);  // ← route-resolved instance
debouncer.buffer(..., { ...message, resolvedInstance: resolved }, debounceConfig);
// Inside debounce callback:
// Use the already-resolved instance from the buffer — no second resolution needed
```

### CLI Usage

```bash
# Felipe's dev override — no debounce, no ack, no split, raw output
omni routes create \
  --instance 4d1054ba-... \
  --scope user \
  --person felipe-person-id \
  --debounce-mode disabled \
  --reaction-ack off \
  --split-delay-mode disabled \
  --ack-message "" \
  --label "Felipe — dev mode"

# Antonio gets a different agent on the same number
omni routes create \
  --instance 4d1054ba-... \
  --scope user \
  --person antonio-person-id \
  --agent agent-b-id \
  --debounce-mode fixed \
  --debounce-min 5000 \
  --label "Antonio — testing Agent B"

# Everyone else gets instance defaults (no route = instance config)
```

## Execution Groups

### Group 1: Schema + API + CLI (no dispatcher changes)
- Add 14 nullable columns to `agent_routes` in `schema.ts`
- Generate Drizzle migration
- Update OpenAPI schemas in `schemas/openapi/agent-routes.ts`
- Update route CRUD in `routes/v2/agent-routes.ts`
- Extend merge in `resolveEffectiveInstance()` with new fields
- This already gives route-level overrides for split/ack/ack-message (read post-resolution)

**Files:**
- `packages/db/src/schema.ts`
- `packages/db/drizzle/` (generated migration)
- `packages/api/src/schemas/openapi/agent-routes.ts`
- `packages/api/src/routes/v2/agent-routes.ts`
- `packages/api/src/plugins/agent-dispatcher.ts` (extend merge block only)

### Group 2: Early route resolution for debounce (dispatcher refactor)
- Move `resolveEffectiveInstance()` call from debounce callback to message handler
- Store resolved instance in buffer metadata
- Update debounce callback to use pre-resolved instance
- Update typing event handler to use route-resolved debounce config

**Files:**
- `packages/api/src/plugins/agent-dispatcher.ts` (pipeline reorder)
- `packages/api/src/plugins/message-debouncer.ts` (buffer type may need resolvedInstance field)

### Group 3: Tests + validation
- Unit test: config merge — route overrides beat instance defaults, null inherits
- Unit test: route with debounce-mode=disabled → debounce is disabled for that user
- Verify existing tests pass (debounce tests, route tests)
- CLI: `omni routes create` with new flags works

## Decisions
| Decision | Rationale |
|----------|-----------|
| All 14 columns nullable | Null = inherit from instance. Existing routes auto-inherit. Zero migration backfill. |
| Move route resolution before debounce | Only way to support per-user debounce. The resolved instance is cached in the buffer — no double resolution. |
| Two groups: schema+merge first, then pipeline | Group 1 gives instant value for split/ack (post-resolution). Group 2 adds debounce (requires pipeline change). |
| No DispatchInstance type change | The spread pattern `{...instance, ...overrides}` already works. New fields just get added to the spread. |

## Risks & Assumptions
| Risk | Severity | Mitigation |
|------|----------|------------|
| Early route resolution adds latency to every message | Medium | Route resolver queries are cached. Measure before/after. If no route exists (most messages), it's a fast null return. |
| Buffer must carry resolved instance | Low | Add `resolvedInstance` to BufferedMessage metadata. Small memory increase. |
| 14 new CLI flags | Low | Only used on `routes create/update`. Grouped logically: `--debounce-*`, `--split-*`, `--ack-*`. |
| Migration adds 14 nullable columns | Low | Instant in PostgreSQL — no table rewrite for nullable columns. |

## Success Criteria
- [ ] `omni routes create --scope user --person X --debounce-mode disabled` works
- [ ] Messages from user X use disabled debounce (instant response)
- [ ] Messages from users without a route use instance defaults (no regression)
- [ ] Split delay / reaction ack / ack message overrides work per-route
- [ ] Drizzle migration generates cleanly
- [ ] Existing tests pass
- [ ] Close GitHub issue #242
