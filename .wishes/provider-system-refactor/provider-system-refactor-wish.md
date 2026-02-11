# Wish: Provider System Refactor

> Genericize the agent provider interface, merge duplicate schemas, remove dead stubs

**Beads:** omni-q01
**Status:** APPROVED
**Priority:** P2
**Depends on:** nothing
**Blocks:** omni-v10 (Claude Code provider)

---

## Problem

The current provider system is tightly coupled to Agno's API shape:

1. **Duplicate schemas** - `agnoos` and `agno` are identical, mapped to the same code path
2. **Dead stubs** - `openai`, `anthropic`, `custom` schemas exist in types/DB/routes/SDKs but throw "not implemented". They will NOT be implemented as standalone schemas (replaced by a future generic HTTP provider)
3. **Agno-branded interface** - `IAgnoClient` with `AgnoAgent`, `AgnoTeam`, `AgnoWorkflow` types leak Agno-specific concepts into the generic provider layer. The interface has 9 methods shaped around Agno's agent/team/workflow model
4. **33 files** reference Agno-specific naming across core, api, db, sdk, cli, and UI

## Goal

A clean, generic provider interface that:
- Works for any agent backend (Agno, Claude Code, future HTTP providers)
- Has a single contract: `run()`, `stream()`, optional `discover()`, `checkHealth()`
- Removes dead code and reduces confusion
- Preserves all current Agno functionality (zero behavior change)

## Design

### New Generic Interface

```typescript
// packages/core/src/providers/types.ts

interface IAgentClient {
  /** Run agent synchronously */
  run(request: ProviderRequest): Promise<ProviderResponse>;

  /** Stream agent response */
  stream(request: ProviderRequest): AsyncGenerator<StreamChunk>;

  /** Optional: discover available agents from the provider */
  discover?(): Promise<AgentDiscoveryEntry[]>;

  /** Health check */
  checkHealth(): Promise<AgentHealthResult>;
}

interface AgentDiscoveryEntry {
  id: string;
  name: string;
  type?: string;          // 'agent' | 'team' | 'workflow' (provider-specific)
  description?: string;
  metadata?: Record<string, unknown>;
}

interface AgentHealthResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}
```

### ProviderRequest Changes

The request gains `agentId` and `agentType` so the provider client knows which endpoint to hit internally:

```typescript
interface ProviderRequest {
  message: string;
  agentId: string;                    // NEW: moved from runner into request
  agentType?: string;                 // NEW: 'agent' | 'team' | 'workflow'
  stream?: boolean;
  sessionId?: string;
  userId?: string;
  files?: ProviderFile[];
  timeoutMs?: number;
}
```

### Schema Changes

```typescript
// Before
const PROVIDER_SCHEMAS = ['agnoos', 'agno', 'a2a', 'openai', 'anthropic', 'custom'] as const;

// After
const PROVIDER_SCHEMAS = ['agno', 'ag-ui', 'claude-code'] as const;
```

- `agnoos` merged into `agno` (single canonical name)
- `a2a` removed (most frameworks aren't following proper A2A protocol)
- `openai`, `anthropic`, `custom` removed (future: generic `http` provider)
- `ag-ui` replaces A2A as the protocol standard (already has wish omni-s8k with benchmarks)
- `claude-code` reserved for wish omni-v10 (not implemented here)

### DB Migration

- Update existing rows with `schema = 'agnoos'` to `schema = 'agno'`
- Remove schema-specific config interfaces for removed schemas (`OpenAIConfig`, `AnthropicConfig`)
- Keep `schemaConfig` as generic JSON (already is)

### File Renames

| Old | New |
|-----|-----|
| `providers/agno-client.ts` | `providers/agno-client.ts` (keep, it's Agno-specific impl) |
| `providers/types.ts` (IAgnoClient) | `providers/types.ts` (IAgentClient) |

### AgentRunner Changes

The `AgentRunnerService` currently has deep knowledge of agent types (switching on agent/team/workflow). After refactor:

```typescript
// Before (agent-runner.ts)
switch (agentType) {
  case 'agent': response = await client.runAgent(agentId, request); break;
  case 'team':  response = await client.runTeam(agentId, request); break;
  // ...
}

// After
const response = await client.run({ ...request, agentId, agentType });
// The Agno client internally routes to the right endpoint
```

### Routes Changes

- `GET /providers/:id/agents` - calls `client.discover()` instead of `client.listAgents()`
- Remove separate `/teams` and `/workflows` list endpoints (discover returns all)
- Or keep them as filtered views on discover results

## Affected Files (by area)

### Core (types + providers)
- `packages/core/src/types/agent.ts` - schema list, config interfaces
- `packages/core/src/providers/types.ts` - IAgnoClient → IAgentClient
- `packages/core/src/providers/agno-client.ts` - implement new interface, internalize type routing
- `packages/core/src/providers/factory.ts` - update schemas, return type
- `packages/core/src/providers/index.ts` - update exports
- `packages/core/src/schemas/common.ts` - schema enum
- `packages/core/src/schemas/instance.ts` - if schema validation exists

### API
- `packages/api/src/services/agent-runner.ts` - simplify to use `run()`/`stream()`
- `packages/api/src/services/providers.ts` - minor
- `packages/api/src/routes/v2/providers.ts` - update list endpoints
- `packages/api/src/schemas/openapi/providers.ts` - update schema enum
- `packages/api/src/plugins/agent-responder.ts` - should be unchanged (uses runner)
- `packages/api/src/trpc/router.ts` - if it references schemas

### Database
- `packages/db/src/schema.ts` - update default, possibly migration
- Migration: `UPDATE agent_providers SET schema = 'agno' WHERE schema = 'agnoos'`

### CLI
- `packages/cli/src/commands/providers.ts` - update schema options

### UI
- `apps/ui/src/pages/Providers.tsx` - update schema options
- `apps/ui/src/components/instances/AgentConfigForm.tsx` - update schema options

### SDKs (auto-generated, update after API changes)
- `packages/sdk/` - regenerate
- `packages/sdk-python/` - regenerate
- `packages/sdk-go/` - regenerate

### Automation
- `packages/core/src/automations/` - if it references provider types

### Tests
- `packages/core/src/providers/__tests__/agno-client.test.ts` - update interface

### Docs
- `docs/architecture/provider-system.md` - update

## Execution Groups

### Group 1: Core Types + Interface (no breaking changes yet)
1. Create new `IAgentClient` interface alongside `IAgnoClient`
2. Update `ProviderRequest` to include `agentId` and `agentType`
3. Update `PROVIDER_SCHEMAS` to remove dead stubs
4. Remove `OpenAIConfig`, `AnthropicConfig` interfaces
5. Add `AgentDiscoveryEntry` type for discovery

### Group 2: Agno Client Adapter
1. Make `AgnoClient` implement `IAgentClient`
2. Add `run()` method that routes internally to agent/team/workflow
3. Add `stream()` method that routes internally
4. Add `discover()` that combines listAgents + listTeams + listWorkflows
5. Keep old methods as private (internal routing)

### Group 3: Factory + Runner
1. Update factory to return `IAgentClient`
2. Simplify `AgentRunnerService.run()` to call `client.run()`
3. Simplify `AgentRunnerService.stream()` to call `client.stream()`
4. Update client cache type

### Group 4: API + Routes + DB
1. Update provider routes (schema options, discover endpoint)
2. Update OpenAPI schemas
3. DB migration: agnoos → agno
4. Update CLI provider commands
5. Update UI provider/instance forms

### Group 5: Cleanup + Regen
1. Remove old `IAgnoClient` export (now internal)
2. Update all imports across codebase
3. Regenerate SDKs
4. Update tests
5. Update docs

## Risks

- **DB migration** - simple UPDATE, but needs to be idempotent
- **SDK breaking change** - schema enum changes. SDKs are auto-generated so just regen
- **UI** - schema dropdown options change. Any hardcoded 'agnoos' in UI will break

## Non-Goals

- Adding the Claude Code provider (that's omni-v10)
- Building a generic HTTP provider (deferred)
- Changing the automation action types
- Modifying event schemas

## Success Criteria

- [ ] `IAgentClient` is the only exported provider interface
- [ ] Single `agno` schema (no `agnoos` duplicate)
- [ ] No `openai`/`anthropic`/`custom` stubs in codebase
- [ ] `AgentRunnerService` uses `client.run()` / `client.stream()` (no type switching)
- [ ] All tests pass
- [ ] `make check` passes
- [ ] SDKs regenerated
