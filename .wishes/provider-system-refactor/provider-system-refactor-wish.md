# Wish: Provider System Refactor

> Genericize the agent provider interface, merge duplicate schemas, remove dead stubs

**Beads:** omni-q01
**Status:** APPROVED
**Priority:** P2
**Created:** 2026-02-07
**Updated:** 2026-02-12
**Depends on:** nothing
**Blocks:** omni-v10 (Claude Code provider), omni-s8k (AG-UI protocol)

---

## Problem

The current provider system has two dispatch paths and Agno-specific naming leaking into generic layers:

1. **Dual dispatch paths** — Legacy `IAgnoClient` path (via `agentRunner.run()`) coexists with newer `IAgentProvider` path (via `resolveProvider()`). Agno uses both; OpenClaw and Webhook only use `IAgentProvider`.
2. **Duplicate schemas** — `agnoos` and `agno` are identical, mapped to the same code path
3. **Dead stubs** — `openai`, `anthropic`, `custom`, `a2a` schemas exist in types/DB/routes/SDKs but throw "not implemented". They will NOT be implemented as standalone schemas
4. **Agno-branded interface** — `IAgnoClient` with `AgnoAgent`, `AgnoTeam`, `AgnoWorkflow` types leak Agno-specific concepts into the generic provider layer. The interface has 9 methods shaped around Agno's agent/team/workflow model
5. **~33 files** reference Agno-specific naming across core, api, db, sdk, cli, and UI

## Goal

A clean, generic provider interface that:
- Works for any agent backend (Agno, OpenClaw, Webhook, Claude Code, future providers)
- Has a single dispatch path: everything goes through `IAgentProvider`
- Kills the legacy `IAgnoClient` / `createProviderClient()` / `agentRunner` path
- Removes dead code stubs and reduces confusion
- Preserves all current functionality (zero behavior change)

## Decisions

- **DEC-1**: `IAgentProvider` is the single interface — kill `IAgnoClient` entirely. `AgnoAgentProvider` already implements `IAgentProvider`, the legacy path is redundant
- **DEC-2**: `agnoos` merged into `agno` — single canonical name, DB migration for existing rows
- **DEC-3**: Dead stubs removed — `openai`, `anthropic`, `custom`, `a2a` deleted from schema list. Future direct-LLM providers will use a new `http` or `ag-ui` schema when built
- **DEC-4**: `createProviderClient()` factory deleted — all providers resolved via `resolveProvider()` in agent-dispatcher
- **DEC-5**: `agentRunner` service simplified — no longer needs type-switching logic, delegates to `IAgentProvider.trigger()`
- **DEC-6**: Discovery endpoint uses new generic `AgentDiscoveryEntry` type instead of Agno-specific `AgnoAgent`/`AgnoTeam`/`AgnoWorkflow`
- **DEC-7**: Preserve `IAgentProvider` shape exactly — `trigger()`, `canHandle()`, `checkHealth()`, optional `dispose()`, `resetSession()`. No interface changes.

## Assumptions

- **ASM-1**: `AgnoAgentProvider` (agno-provider.ts) already fully works via `IAgentProvider` path — this was wired during OpenClaw BLOCKER B-1 fix
- **ASM-2**: No production DB has rows with removed schemas (`openai`, `anthropic`, `custom`, `a2a`) — they were never implementable
- **ASM-3**: SDK regeneration handles schema enum changes automatically

## Risks

- **RISK-1**: DB migration (`agnoos` → `agno`) — Mitigation: simple UPDATE, idempotent, no data loss
- **RISK-2**: SDK breaking change (schema enum shrinks) — Mitigation: SDKs auto-generated, regen after
- **RISK-3**: UI hardcoded schema references — Mitigation: grep and update all dropdown options

---

## Scope

### IN SCOPE

- Kill `IAgnoClient` interface and all 9 methods
- Kill `createProviderClient()` factory
- Simplify `agentRunner` to delegate to `IAgentProvider`
- Merge `agnoos` → `agno` (types, DB, API, CLI, UI)
- Remove dead stubs: `openai`, `anthropic`, `custom`, `a2a` from `PROVIDER_SCHEMAS`
- Remove dead config types: `OpenAIConfig`, `AnthropicConfig`, `A2AConfig`
- Add generic `AgentDiscoveryEntry` type for provider agent listing
- Update `discover` on `AgnoAgentProvider` to return generic entries
- Update API routes: merge `/agents`, `/teams`, `/workflows` into `/discover`
- Update CLI `providers` commands (schema options, discovery)
- Update UI provider forms (schema dropdown)
- DB schema update + migration SQL
- Regenerate all SDKs (TS, Python, Go)
- Update tests
- Update docs

### OUT OF SCOPE

- Adding Claude Code provider (omni-v10, blocked by this)
- Adding AG-UI protocol provider (omni-s8k, blocked by this)
- Changing `IAgentProvider` interface shape
- Changing OpenClaw or Webhook provider implementations
- Building a generic HTTP provider
- Changing automation action types
- Changing event schemas

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] types, [x] providers, [x] schemas | Kill IAgnoClient, update PROVIDER_SCHEMAS, add discovery type |
| db | [x] schema | Update schema enum, migration for agnoos→agno |
| api | [x] services, [x] routes, [x] plugins | Simplify runner, update provider routes, update dispatcher |
| sdk | [x] regenerate | Schema enum changed |
| sdk-python | [x] regenerate | Schema enum changed |
| sdk-go | [x] regenerate | Schema enum changed |
| cli | [x] commands | Update schema options in providers command |
| ui | [x] pages, [x] components | Providers page, AgentConfigForm |
| channel-sdk | [ ] no changes | |
| channel-* | [ ] no changes | |

### System Checklist

- [x] **Events**: No changes
- [ ] **Database**: Schema enum update + migration SQL
- [ ] **SDK**: Regenerate all 3 SDKs after API changes
- [ ] **CLI**: Update provider schema options
- [ ] **Tests**: Update agno-client tests, verify all pass
- [ ] **Docs**: Update provider-system.md

---

## Schema Changes

```typescript
// Before (8 schemas, 4 dead)
const PROVIDER_SCHEMAS = ['agnoos', 'agno', 'a2a', 'openai', 'anthropic', 'webhook', 'openclaw', 'custom'] as const;

// After (4 schemas, all working)
const PROVIDER_SCHEMAS = ['agno', 'webhook', 'openclaw'] as const;
// Note: 'ag-ui' and 'claude-code' added by their respective wishes when implemented
```

- `agnoos` → merged into `agno`
- `a2a`, `openai`, `anthropic`, `custom` → removed (dead stubs)
- `webhook`, `openclaw` → preserved (production providers)

## Interface Changes

```typescript
// DELETED: IAgnoClient (9 methods, Agno-specific)
// DELETED: AgnoAgent, AgnoTeam, AgnoWorkflow types (moved internal to agno-client.ts)
// DELETED: createProviderClient() factory
// DELETED: OpenAIConfig, AnthropicConfig, A2AConfig, CustomConfig

// KEPT AS-IS: IAgentProvider (the single unified interface)
// KEPT AS-IS: AgentTrigger, AgentTriggerResult
// KEPT AS-IS: ProviderRequest, ProviderResponse, StreamChunk (used internally by agno-client)

// NEW: Generic discovery type
interface AgentDiscoveryEntry {
  id: string;
  name: string;
  type?: string;          // 'agent' | 'team' | 'workflow' (provider-specific)
  description?: string;
  metadata?: Record<string, unknown>;
}
```

## API Route Changes

```
// Before (Agno-specific)
GET /providers/:id/agents     → client.listAgents()
GET /providers/:id/teams      → client.listTeams()
GET /providers/:id/workflows  → client.listWorkflows()

// After (generic)
GET /providers/:id/discover   → provider.discover()
// Returns AgentDiscoveryEntry[] regardless of provider schema
// Agno's discover() combines agents+teams+workflows into unified list
```

---

## Execution Groups

### Group A: Core Types + Kill Legacy Interface

**Goal:** Remove `IAgnoClient`, dead stubs, duplicate schemas. Add generic discovery type.

**Packages:** `core`

**Deliverables:**
- [ ] Update `PROVIDER_SCHEMAS` in `types/agent.ts`: remove `agnoos`, `a2a`, `openai`, `anthropic`, `custom`
- [ ] Delete `OpenAIConfig`, `AnthropicConfig`, `A2AConfig`, `CustomConfig` from `types/agent.ts`
- [ ] Delete `IAgnoClient`, `AgnoAgent`, `AgnoTeam`, `AgnoWorkflow` exports from `providers/types.ts` (move Agno types internal to `agno-client.ts`)
- [ ] Add `AgentDiscoveryEntry` and `AgentHealthResult` types to `providers/types.ts`
- [ ] Add `discover?(): Promise<AgentDiscoveryEntry[]>` to `IAgentProvider` interface
- [ ] Update `AgnoClient` to keep methods private, add `run()` and `stream()` convenience methods
- [ ] Update `AgnoAgentProvider` to implement `discover()` (combine agents+teams+workflows)
- [ ] Delete `createProviderClient()` factory (or reduce to throw-only for all schemas)
- [ ] Update `isProviderSchemaSupported()` and `getSupportedProviderSchemas()`
- [ ] Update `providers/index.ts` exports — remove `IAgnoClient`, `AgnoAgent`, `AgnoTeam`, `AgnoWorkflow`, `createProviderClient`
- [ ] Update `schemas/common.ts` if `ProviderSchemaEnum` needs adjustment
- [ ] Update agno-client tests for interface changes
- [ ] `bun test packages/core`

**Acceptance Criteria:**
- [ ] `IAgnoClient` is not exported from `@omni/core`
- [ ] `createProviderClient` is not exported
- [ ] `PROVIDER_SCHEMAS` contains only `['agno', 'webhook', 'openclaw']`
- [ ] `AgnoAgentProvider.discover()` returns `AgentDiscoveryEntry[]`
- [ ] OpenClaw and Webhook providers compile unchanged
- [ ] Core tests pass

### Group B: API + Services + DB + Dispatcher

**Goal:** Simplify runner, update routes, fix DB schema, wire everything through IAgentProvider only.

**Packages:** `api`, `db`

**Deliverables:**
- [ ] Simplify `agent-runner.ts` — remove `IAgnoClient` type switching, delegate to `IAgentProvider.trigger()` for all schemas
- [ ] Update `providers.ts` service if it references old schemas
- [ ] Replace `GET /providers/:id/agents`, `/teams`, `/workflows` with `GET /providers/:id/discover`
- [ ] Update `schemas/openapi/providers.ts` — schema enum, discovery endpoint docs
- [ ] Update `agent-dispatcher.ts` if it still has legacy `agentRunner.run()` fallback code
- [ ] Update `db/src/schema.ts` — schema enum column (remove dead values)
- [ ] Create migration SQL: `UPDATE agent_providers SET schema = 'agno' WHERE schema = 'agnoos'`
- [ ] `make check`

**Acceptance Criteria:**
- [ ] No code path calls `IAgnoClient` methods directly
- [ ] `GET /providers/:id/discover` returns agents from any schema that supports discovery
- [ ] Legacy `/agents`, `/teams`, `/workflows` endpoints removed or redirect
- [ ] DB schema allows only valid schemas
- [ ] Existing Agno providers with `schema='agnoos'` migrated to `schema='agno'`
- [ ] `make typecheck && make lint` pass
- [ ] API tests pass

### Group C: CLI + UI + SDKs + Docs

**Goal:** Update all consumer-facing surfaces and regenerate SDKs.

**Packages:** `cli`, `ui`, `sdk`, `sdk-python`, `sdk-go`, `docs`

**Deliverables:**
- [ ] Update `cli/src/commands/providers.ts` — remove dead schemas from `VALID_SCHEMAS`, update `agents`/`teams`/`workflows` subcommands to single `discover` subcommand
- [ ] Update `apps/ui/src/pages/Providers.tsx` — schema dropdown options
- [ ] Update `apps/ui/src/components/instances/AgentConfigForm.tsx` — schema options
- [ ] Regenerate TypeScript SDK: `make sdk-generate`
- [ ] Regenerate Python SDK
- [ ] Regenerate Go SDK
- [ ] Update `docs/architecture/provider-system.md`
- [ ] `make check`

**Acceptance Criteria:**
- [ ] CLI `omni providers create --schema` only accepts valid schemas
- [ ] CLI `omni providers discover <id>` returns unified agent list
- [ ] UI provider creation form shows only valid schemas
- [ ] All 3 SDKs regenerated with updated schema enum
- [ ] Docs reflect new architecture
- [ ] `make check` passes
- [ ] SDKs regenerated

---

## Success Criteria

- [ ] `IAgnoClient` is not exported anywhere in the codebase
- [ ] `createProviderClient` factory deleted
- [ ] Single `agno` schema (no `agnoos` duplicate anywhere)
- [ ] No `openai`/`anthropic`/`custom`/`a2a` stubs in codebase
- [ ] All dispatch goes through `IAgentProvider` (single path)
- [ ] `GET /providers/:id/discover` works for Agno (others return empty/unsupported)
- [ ] All tests pass
- [ ] `make check` passes
- [ ] All 3 SDKs regenerated

## Non-Goals

- Adding the Claude Code provider (that's omni-v10)
- Adding AG-UI protocol provider (that's omni-s8k)
- Building a generic HTTP provider
- Changing the automation action types
- Changing event schemas
- Changing `IAgentProvider` interface (except adding optional `discover`)
