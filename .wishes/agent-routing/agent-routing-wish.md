# WISH: Agent Routing

> Granular per-chat and per-user agent configuration within an instance

**Status:** DRAFT
**Created:** 2026-02-10
**Author:** WISH Agent
**Beads:** omni-pyt

---

## Problem

Today, agent configuration is **1:1 with instances**. Every chat and every user on an instance talks to the same agent. This blocks several real-world use cases:

- A WhatsApp number serving multiple groups, each needing a different agent personality/capability
- VIP users getting a premium agent in DMs while everyone else gets the default
- A support number where group chats use a FAQ bot but DMs use a full conversational agent
- Testing a new agent on a specific chat before rolling it out instance-wide

## Solution

Add an **agent routing layer** that sits between event ingestion and agent dispatch. Routes bind a specific agent provider+agentId to a **chat** or **user (person)**, with the instance-level config as the default fallback.

### Resolution Order

```
1. Chat route   →  "Group Y uses agent X" (everyone in the group)
2. User route   →  "User W's DMs use agent Z" (DM override only)
3. Instance     →  Default config (existing behavior, unchanged)
```

**Chat always wins.** A group is a single conversational entity — one agent for all participants. User routes only apply to DMs (where there's no chat-level override).

---

## Assumptions

- **ASM-1**: One route per scope per instance (can't have two chat routes for the same chat)
- **ASM-2**: User routes reference `personId` (unified identity), not platform-specific IDs
- **ASM-3**: `personId` is available at dispatch time (already resolved by identity system with 2s polling)
- **ASM-4**: Debounce config stays instance-level (it buffers before route resolution happens)
- **ASM-5**: Existing instances with no routes behave exactly as today (zero migration impact)

## Decisions

- **DEC-1**: Chat routes take absolute priority over user routes (group = one agent entity)
- **DEC-2**: User routes apply only when no chat route matches (effectively: DM overrides)
- **DEC-3**: Dedicated `agent_routes` table (not JSONB on chats) — proper FK constraints, queryable, auditable
- **DEC-4**: Routes can override agent-specific fields (provider, agentId, type, timeout, reply filter, session strategy) but inherit instance defaults for anything not set
- **DEC-5**: No `chat_user` composite scope — unnecessary complexity, chat scope covers groups entirely
- **DEC-6**: API nested under instances: `POST /instances/:id/agent-routes`
- **DEC-7**: Routes reference `chats.id` (internal UUID), not `externalId` — stable across reconnects

## Risks

- **RISK-1**: `personId` resolution is async (2s polling). If identity hasn't been created yet, user route won't match → falls back to instance default. **Mitigation**: This is acceptable; first message may use default, subsequent messages will route correctly. The identity system already handles this delay.
- **RISK-2**: Chat routes reference `chats.id` which requires the chat to exist in our DB first. **Mitigation**: Chats are created on first message sync. For pre-configuration, user can trigger a sync or we can accept `externalId` as an alternative lookup.
- **RISK-3**: Route cache invalidation — stale cache could route to wrong agent. **Mitigation**: Short TTL cache (30s) + event-based invalidation on route CRUD.

---

## Scope

### IN SCOPE

- New `agent_routes` database table with proper indexes and FK constraints
- Route resolver logic integrated into agent-dispatcher
- Full CRUD API endpoints: `GET/POST/PATCH/DELETE /instances/:id/agent-routes`
- Bulk operations: list all routes for an instance, delete all routes
- CLI commands: `omni agent-routes list|add|update|remove`
- Route field in `trigger_logs` for observability
- SDK regeneration (auto from OpenAPI)
- Config inheritance (null fields fall back to instance defaults)

### OUT OF SCOPE

- Per-message routing (too granular, use automations for that)
- Wildcard/pattern matching on chat names (could be future enhancement)
- Route-level debounce overrides (stays instance-level)
- UI dashboard for route management (future)
- Route-level access rules (use existing access system)
- Migration of existing configs (no data migration needed — zero routes = existing behavior)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| db | [x] schema, [x] migration | New `agent_routes` table |
| core | [x] types, [x] schemas | Route types, Zod schemas, provider types update |
| api | [x] routes, [x] services, [x] plugins | CRUD endpoints, route resolver, dispatcher update |
| sdk | [x] regenerate | New endpoints in OpenAPI spec |
| cli | [x] commands | `agent-routes` command group |
| channel-sdk | [ ] no changes | Routes are instance-internal |
| channel-* | [ ] no changes | Channels unaware of routing |

### System Checklist

- [ ] **Database**: New `agent_routes` table + indexes + FKs
- [ ] **Types**: `AgentRoute`, `CreateAgentRoute`, `UpdateAgentRoute` types
- [ ] **Schemas**: Zod validation schemas for route CRUD
- [ ] **API**: REST endpoints under `/instances/:id/agent-routes`
- [ ] **Dispatcher**: Route resolution before provider dispatch
- [ ] **Trigger Logs**: Add `routeId` column for observability
- [ ] **SDK**: Regenerate after API changes (`make sdk-generate`)
- [ ] **CLI**: New command group
- [ ] **Tests**: Route resolver unit tests, API integration tests

---

## Data Model

### `agent_routes` Table

```sql
CREATE TABLE agent_routes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id             UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,

  -- Scope: what does this route match?
  scope                   VARCHAR(20) NOT NULL,  -- 'chat' | 'user'
  chat_id                 UUID REFERENCES chats(id) ON DELETE CASCADE,   -- for scope='chat'
  person_id               UUID REFERENCES persons(id) ON DELETE CASCADE, -- for scope='user'

  -- Target: which agent handles it?
  agent_provider_id       UUID NOT NULL REFERENCES agent_providers(id) ON DELETE CASCADE,
  agent_id                VARCHAR(255) NOT NULL,
  agent_type              VARCHAR(20) NOT NULL DEFAULT 'agent',  -- agent|team|workflow

  -- Behavior overrides (NULL = inherit from instance)
  agent_timeout           INTEGER,
  agent_stream_mode       BOOLEAN,
  agent_reply_filter      JSONB,
  agent_session_strategy  VARCHAR(20),
  agent_prefix_sender_name BOOLEAN,
  agent_wait_for_media    BOOLEAN,

  -- Metadata
  label                   VARCHAR(255),  -- human-friendly description
  priority                INTEGER NOT NULL DEFAULT 0,  -- tiebreaker (higher wins)
  is_active               BOOLEAN NOT NULL DEFAULT true,

  -- Timestamps
  created_at              TIMESTAMP NOT NULL DEFAULT now(),
  updated_at              TIMESTAMP NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT scope_check CHECK (
    (scope = 'chat' AND chat_id IS NOT NULL AND person_id IS NULL) OR
    (scope = 'user' AND person_id IS NOT NULL AND chat_id IS NULL)
  ),
  CONSTRAINT unique_chat_route UNIQUE (instance_id, chat_id) WHERE chat_id IS NOT NULL,
  CONSTRAINT unique_user_route UNIQUE (instance_id, person_id) WHERE person_id IS NOT NULL
);

-- Indexes
CREATE INDEX agent_routes_instance_idx ON agent_routes(instance_id);
CREATE INDEX agent_routes_chat_idx ON agent_routes(chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX agent_routes_person_idx ON agent_routes(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX agent_routes_active_idx ON agent_routes(instance_id, is_active);
```

### Route Resolution Query

```sql
-- Single query, ordered by specificity
SELECT * FROM agent_routes
WHERE instance_id = $1
  AND is_active = true
  AND (
    (scope = 'chat' AND chat_id = $2)
    OR (scope = 'user' AND person_id = $3)
  )
ORDER BY
  CASE scope WHEN 'chat' THEN 0 WHEN 'user' THEN 1 END,
  priority DESC
LIMIT 1;
```

---

## API Design

### Endpoints

```
GET    /api/v2/instances/:instanceId/agent-routes          # List routes
POST   /api/v2/instances/:instanceId/agent-routes          # Create route
GET    /api/v2/instances/:instanceId/agent-routes/:routeId # Get route
PATCH  /api/v2/instances/:instanceId/agent-routes/:routeId # Update route
DELETE /api/v2/instances/:instanceId/agent-routes/:routeId # Delete route
```

### Create Route Schema

```typescript
const createAgentRouteSchema = z.object({
  scope: z.enum(['chat', 'user']),
  chatId: z.string().uuid().optional(),      // Required when scope='chat'
  personId: z.string().uuid().optional(),    // Required when scope='user'

  agentProviderId: z.string().uuid(),
  agentId: z.string().min(1).max(255),
  agentType: z.enum(['agent', 'team', 'workflow']).default('agent'),

  // Optional overrides
  agentTimeout: z.number().int().positive().optional(),
  agentStreamMode: z.boolean().optional(),
  agentReplyFilter: agentReplyFilterSchema.optional(),
  agentSessionStrategy: z.enum(['per_user', 'per_chat', 'per_user_per_chat']).optional(),
  agentPrefixSenderName: z.boolean().optional(),
  agentWaitForMedia: z.boolean().optional(),

  label: z.string().max(255).optional(),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
}).refine(
  (data) => (data.scope === 'chat') === !!data.chatId,
  { message: 'chatId required (and only allowed) when scope is "chat"' }
).refine(
  (data) => (data.scope === 'user') === !!data.personId,
  { message: 'personId required (and only allowed) when scope is "user"' }
);
```

### Response Shape

```typescript
interface AgentRoute {
  id: string;
  instanceId: string;
  scope: 'chat' | 'user';
  chatId?: string;
  personId?: string;

  agentProviderId: string;
  agentId: string;
  agentType: 'agent' | 'team' | 'workflow';

  // Overrides (null = inherit)
  agentTimeout?: number;
  agentStreamMode?: boolean;
  agentReplyFilter?: AgentReplyFilter;
  agentSessionStrategy?: AgentSessionStrategy;
  agentPrefixSenderName?: boolean;
  agentWaitForMedia?: boolean;

  label?: string;
  priority: number;
  isActive: boolean;

  // Expanded references (in GET responses)
  chat?: { id: string; name: string; chatType: string };
  person?: { id: string; displayName: string };
  provider?: { id: string; name: string; schema: string };

  createdAt: string;
  updatedAt: string;
}
```

### List Response

```typescript
// GET /instances/:id/agent-routes?scope=chat&active=true
{
  items: AgentRoute[],
  total: number
}
```

### CLI Commands

```bash
omni agent-routes list <instanceId> [--scope chat|user] [--active]
omni agent-routes add <instanceId> --scope chat --chat-id <id> --provider <id> --agent <agentId> [--label "Sales Bot"]
omni agent-routes add <instanceId> --scope user --person-id <id> --provider <id> --agent <agentId> [--label "VIP Bot"]
omni agent-routes update <routeId> [--agent <agentId>] [--active true|false] [--label "..."]
omni agent-routes remove <routeId>
omni agent-routes resolve <instanceId> --chat-id <id> [--person-id <id>]  # Debug: show which route would match
```

---

## Execution Groups

### Group A: Foundation (DB + Core + Resolver)

**Goal:** Schema, types, and route resolution logic

**Packages:** `db`, `core`, `api` (dispatcher only)

**Deliverables:**
- [ ] `agent_routes` table in Drizzle schema with constraints and indexes
- [ ] `AgentRoute` types and Zod schemas in `@omni/core`
- [ ] `RouteResolver` service: query + cache + merge with instance defaults
- [ ] Integrate resolver into `agent-dispatcher.ts` (`shouldProcessMessage` → resolve route → use effective config)
- [ ] Add `routeId` to `trigger_logs` table
- [ ] `db-push` to apply schema

**Acceptance Criteria:**
- [ ] Instance with no routes behaves identically to today (backward compatible)
- [ ] Chat route overrides instance agent for all users in that chat
- [ ] User route overrides instance agent for that person's DMs
- [ ] Chat route wins over user route when both could match
- [ ] Null override fields correctly inherit from instance config
- [ ] Route resolution adds <5ms latency (cached path)

**Validation:**
- `make check`
- `bun test packages/api` (dispatcher tests)
- Manual: set route on a chat, verify correct agent is triggered

### Group B: API + SDK

**Goal:** Full CRUD API endpoints and SDK regeneration

**Packages:** `api`, `sdk`

**Deliverables:**
- [ ] `packages/api/src/routes/v2/agent-routes.ts` — full CRUD endpoints
- [ ] Zod validation with refinements (scope/chatId/personId consistency)
- [ ] Instance access middleware on all endpoints
- [ ] List with filters: `?scope=chat|user`, `?active=true|false`
- [ ] Expanded references in GET responses (chat name, person name, provider name)
- [ ] Unique constraint enforcement with friendly error messages
- [ ] Mount routes in `v2/index.ts`
- [ ] OpenAPI docs for all endpoints
- [ ] SDK regeneration: `make sdk-generate`

**Acceptance Criteria:**
- [ ] All CRUD operations work via API
- [ ] Creating duplicate chat/user route returns 409 Conflict
- [ ] Deleting a route immediately falls back to instance default
- [ ] Invalid scope/reference combinations return 400
- [ ] SDK types include all new endpoints
- [ ] Consistent with existing API patterns (providers, access rules)

**Validation:**
- `make check`
- `make sdk-generate`
- Manual: CRUD via curl/SDK

### Group C: CLI + Observability

**Goal:** CLI management commands and trigger log integration

**Packages:** `cli`

**Deliverables:**
- [ ] `omni agent-routes` command group (list, add, update, remove, resolve)
- [ ] `resolve` subcommand for debugging (shows which route would match)
- [ ] Trigger logs include `routeId` in output
- [ ] Update `omni logs` to show route info when present

**Acceptance Criteria:**
- [ ] All CLI commands work end-to-end
- [ ] `resolve` command shows effective config with inheritance
- [ ] Trigger logs show which route was used (or "default" for instance fallback)
- [ ] Consistent with existing CLI patterns (providers, instances)

**Validation:**
- `make cli-build && make cli-link`
- `omni agent-routes list <instanceId>`
- `omni agent-routes resolve <instanceId> --chat-id <chatId>`

---

## Dispatcher Integration (Key Change)

Current flow in `agent-dispatcher.ts`:

```
message.received → shouldProcessMessage(instance) → use instance.agentProviderId → dispatch
```

New flow:

```
message.received → shouldProcessMessage(instance)
                 → resolveRoute(instanceId, chatId, personId)
                 → merge route overrides with instance defaults
                 → use effective config → dispatch
```

The resolver is called **after** debounce flush (inside the debouncer callback), where `chatId` and `personId` are already available. Minimal change to the existing flow.

```typescript
// Pseudocode for route resolution
async function resolveEffectiveConfig(
  instance: Instance,
  chatId: string,
  personId?: string
): Promise<EffectiveAgentConfig> {
  const route = await routeResolver.resolve(instance.id, chatId, personId);

  if (!route) {
    // No route matched — use instance defaults (existing behavior)
    return extractAgentConfig(instance);
  }

  // Merge: route overrides win, instance fills gaps
  return {
    agentProviderId: route.agentProviderId,
    agentId: route.agentId,
    agentType: route.agentType,
    agentTimeout: route.agentTimeout ?? instance.agentTimeout,
    agentStreamMode: route.agentStreamMode ?? instance.agentStreamMode,
    agentReplyFilter: route.agentReplyFilter ?? instance.agentReplyFilter,
    agentSessionStrategy: route.agentSessionStrategy ?? instance.agentSessionStrategy,
    agentPrefixSenderName: route.agentPrefixSenderName ?? instance.agentPrefixSenderName,
    agentWaitForMedia: route.agentWaitForMedia ?? instance.agentWaitForMedia,
    routeId: route.id,
  };
}
```
