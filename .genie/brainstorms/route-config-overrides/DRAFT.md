# Route-Level Config Overrides

## Problem Statement

When multiple agents share the same WhatsApp number via routing, they all share the same messaging behavior (debounce, split delay, ack). There's no way to give different UX to different users/chats on the same instance.

**Real use cases:**
- Dev user wants 0s debounce + no ack; prod users need 30s debounce + ack
- VIP customers get faster response; standard users get defaults
- Bot chats need debounce (multi-message); human-assisted chats need immediate forwarding

**Current workaround:** Running 3 separate Omni installations on the same machine with `HOME` env override — 3x RAM, 3x operational complexity.

## Current Architecture

Routes already support some overrides (from `packages/api/src/schemas/openapi/agent-routes.ts`):
- `agentSessionStrategy` — per_user, per_chat
- `agentPrefixSenderName` — boolean
- `agentWaitForMedia` — boolean
- `agentSendMediaPath` — boolean
- `agentGateEnabled` — boolean
- `agentTimeout` — number
- `agentStreamingEnabled` — boolean

**What's missing from routes:**
- `messageDebounceMode` / `messageDebounceMinMs` / `messageDebounceMaxMs`
- `messageSplitDelayMode` / `messageSplitDelayMinMs` / `messageSplitDelayMaxMs`
- `enableAutoSplit`
- `reactionAck` / `reactionAckEmoji` / `ackTimeoutMs`
- `agentAckMessage`

The dispatcher already resolves routes to pick the agent. The proposed change extends route resolution to also pick messaging behavior overrides.

## Proposed Solution

### Phase 1: Schema + Route Resolution
1. Add override columns to the `agent_routes` table for the missing config fields
2. Drizzle migration: `004_route_config_overrides.sql`
3. Update route resolution in agent-dispatcher to merge: `route override → instance default`
4. Update route CRUD API + CLI to expose new fields

### Phase 2: Dispatcher Integration
The dispatcher needs to read resolved config BEFORE debouncing/splitting. Currently the debounce service reads instance settings directly. After this change:
```
message arrives → resolve route → merge config → debounce with merged config → dispatch
```

### Key architectural question
The debounce service (`messageDebounce.ts`) currently receives the full instance object. We need to either:
- A) Resolve route early and patch the instance object with overrides (simple but hacky)
- B) Create a `resolvedConfig` object that the debounce service accepts (cleaner but more refactoring)
- C) Pass route overrides as a separate parameter to the debounce service

### Configs that SHOULD support route override
| Config | Why |
|--------|-----|
| `messageDebounceMode` | Dev needs instant, prod needs wait |
| `messageDebounceMinMs/MaxMs` | Different timing per segment |
| `messageSplitDelayMode/MinMs/MaxMs` | Debug = no split, prod = natural |
| `enableAutoSplit` | Dev wants raw, prod wants split |
| `reactionAck/reactionAckEmoji` | VIP gets ack, standard doesn't |
| `agentAckMessage` | Different ack per agent |
| `ackTimeoutMs` | Different tolerance |

### Configs that MUST stay instance-only
| Config | Why |
|--------|-----|
| `accessMode` / access rules | Security boundary |
| `profileName/profilePicUrl` | WhatsApp per-number |
| `readReceipts` | Protocol limitation |
| `triggerEvents/triggerMode` | Per-connection |

## Key Files
- `packages/db/src/schema.ts` — agent_routes table, add override columns
- `packages/api/src/plugins/agent-dispatcher.ts` — route resolution + config merge
- `packages/api/src/services/debounce.ts` or similar — accept resolved config
- `packages/api/src/routes/v2/agent-routes.ts` — CRUD for route overrides
- `packages/api/src/schemas/openapi/agent-routes.ts` — Zod schemas

## Questions for Brainstorm
1. Is this too large for one wish? Should we phase it (schema+API first, dispatcher integration second)?
2. Option A/B/C for passing resolved config to debounce service?
3. Should the CLI expose all override flags on `omni routes create/update`?
4. Do we need a migration to backfill existing routes with null overrides?
5. How do we test this without a live WhatsApp number? Unit tests on config merge logic?

## GitHub Issues
- https://github.com/automagik-dev/omni/issues/242
