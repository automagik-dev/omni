# WISH: Events Ext

> Extensibility layer for events: advanced registry, webhook sources, and event-driven automations.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-ds9

---

## Context

The core EventBus (`nats-events`) provides the infrastructure for publishing and subscribing to events, including:
- **In-memory EventRegistry** (`@omni/core/events/nats/registry.ts`) for runtime schema validation
- **SystemEventSchemas** with dead_letter, replay.*, health.* schemas predefined

This wish builds the **extensibility layer** on top:

1. **Persistent Event Registry** - Database-backed schema storage, versioning, discovery API
2. **External Event Sources** - Webhooks, cron triggers, manual triggers
3. **Event Automations** - Rule-based "when X happens, do Y" system

This transforms Omni from a messaging platform into an **event-driven automation platform**.

Reference: `docs/architecture/event-system.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | `nats-events` wish completed (EventBus + basic registry working) |
| **ASM-2** | Assumption | API package available for webhook endpoints |
| **DEC-1** | Decision | Automations stored in PostgreSQL, not code |
| **DEC-2** | Decision | Conditions use JSONPath-like syntax for field matching |
| **DEC-3** | Decision | Actions are pluggable (trigger_agent, send_message, webhook, etc.) |
| **DEC-4** | Decision | Automations run in-process (not separate workers, for now) |

---

## Scope

### IN SCOPE

**Persistent Event Registry (extends @omni/core EventRegistry):**
- Database-backed event schema storage (upgrade from in-memory)
- Schema versioning (breaking change detection)
- Event discovery API (list all event types including core)
- Schema validation on publish (optional, configurable)
- Sync between in-memory registry and database on startup

**External Event Sources:**
- Webhook receiver endpoint (`POST /webhooks/:source`)
- Webhook → `custom.webhook.{source}` event translation
- Cron-based event triggers (`custom.cron.{name}`)
- Manual trigger API (`POST /events/trigger`)

**Event Automations:**
- Automation rule definition (trigger + conditions + actions)
- Condition evaluation (field matching, comparisons)
- Built-in actions: `trigger_agent`, `send_message`, `emit_event`, `webhook`
- Automation enable/disable
- Execution logging

### OUT OF SCOPE

- Visual automation builder (UI - separate wish)
- Complex workflow orchestration (multi-step, branching)
- External automation engines (n8n, Temporal integration)
- Rate limiting / throttling (add later if needed)

---

## Execution Group A: Persistent Event Registry

**Goal:** Extend the in-memory EventRegistry (`@omni/core/events/nats/registry.ts`) with database persistence.

**Existing (from nats-events):**
- `EventRegistry` class with `register()`, `validate()`, `list()`, `listByNamespace()`
- `eventRegistry` singleton instance
- `createEventSchema()` helper
- `SystemEventSchemas` (dead_letter, replay.started, replay.completed, health.degraded)

**Deliverables:**
- [ ] `packages/core/src/events/registry/storage.ts` - Database persistence layer
- [ ] `packages/core/src/db/schema/event-registry.ts` - Database table
- [ ] Sync mechanism: load schemas from DB on startup, write to DB on register
- [ ] Schema versioning with compatibility checks
- [ ] Event discovery API endpoint (tRPC route)

**Database Schema:**
```typescript
export const eventSchemas = pgTable('event_schemas', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 255 }).notNull().unique(),
  schema: jsonb('schema').notNull(),           // Zod schema as JSON
  version: integer('version').notNull().default(1),
  description: text('description'),
  stream: varchar('stream', { length: 50 }),   // Override stream routing
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 100 }),
});
```

**API Endpoints:**
```typescript
// List all registered event types
GET /api/events/types
// → { types: [{ eventType, description, version, schema }] }

// Get specific event schema
GET /api/events/types/:eventType
// → { eventType, description, version, schema }

// Register new event type (admin only)
POST /api/events/types
// ← { eventType, schema, description }
```

**Acceptance Criteria:**
- [ ] Event schemas stored in database
- [ ] Can register new `custom.*` event types via API
- [ ] Schema versioning tracks changes
- [ ] Breaking changes detected (removed required fields)
- [ ] Event discovery API returns all registered types
- [ ] Core events pre-seeded in registry

**Validation:**
```bash
bun test packages/core/src/events/registry
```

---

## Execution Group B: External Event Sources

**Goal:** Enable external systems to emit events into Omni.

**Deliverables:**
- [ ] `packages/api/src/routes/webhooks.ts` - Webhook receiver
- [ ] `packages/core/src/events/sources/webhook.ts` - Webhook → event translation
- [ ] `packages/core/src/events/sources/cron.ts` - Cron trigger service
- [ ] `packages/core/src/events/sources/manual.ts` - Manual trigger
- [ ] Webhook signature verification (optional)
- [ ] Source configuration storage

**Webhook Flow:**
```
External System                    Omni
     │                              │
     │  POST /webhooks/github       │
     │  { action: "push", ... }     │
     │ ─────────────────────────────▶
     │                              │
     │                   Translate to event:
     │                   custom.webhook.github
     │                   { action, repository, ... }
     │                              │
     │                   Publish to CUSTOM stream
     │                              │
     │         200 OK               │
     │ ◀─────────────────────────────
```

**Cron Triggers:**
```typescript
// Database-stored cron definitions
export const cronTriggers = pgTable('cron_triggers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  schedule: varchar('schedule', { length: 100 }).notNull(),  // Cron expression
  eventType: varchar('event_type', { length: 255 }).notNull(),
  payload: jsonb('payload'),         // Static payload
  enabled: boolean('enabled').notNull().default(true),
  lastRun: timestamp('last_run'),
  nextRun: timestamp('next_run'),
});

// Example: Daily report trigger
{
  name: 'daily-report',
  schedule: '0 9 * * *',           // 9 AM daily
  eventType: 'custom.cron.daily-report',
  payload: { reportType: 'summary' },
}
```

**Manual Trigger API:**
```typescript
// Trigger a custom event manually
POST /api/events/trigger
{
  eventType: 'custom.trigger.vip-alert',
  payload: { personId: 'xyz', reason: 'manual escalation' },
  metadata: { triggeredBy: 'admin-user-123' }
}
// → 201 Created { eventId, sequence }
```

**Acceptance Criteria:**
- [ ] Webhook endpoint receives external payloads
- [ ] Webhooks translated to `custom.webhook.{source}` events
- [ ] Webhook sources configurable (expected headers, signature)
- [ ] Cron triggers fire on schedule
- [ ] Cron events include trigger metadata
- [ ] Manual trigger API validates against registered schema
- [ ] All sources include proper tracing (correlationId)

**Validation:**
```bash
bun test packages/api/src/routes/webhooks.test.ts
bun test packages/core/src/events/sources
```

---

## Execution Group C: Event Automations

**Goal:** Rule-based automation system: "When event X with conditions Y, execute actions Z."

**Deliverables:**
- [ ] `packages/core/src/automations/engine.ts` - Automation engine
- [ ] `packages/core/src/automations/conditions.ts` - Condition evaluator
- [ ] `packages/core/src/automations/actions/` - Action implementations
- [ ] `packages/core/src/db/schema/automations.ts` - Database tables
- [ ] Automation CRUD API
- [ ] Execution logging

**Automation Schema:**
```typescript
export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),

  // Trigger
  triggerEventType: varchar('trigger_event_type', { length: 255 }).notNull(),
  triggerConditions: jsonb('trigger_conditions'),  // Condition[]

  // Actions
  actions: jsonb('actions').notNull(),  // Action[]

  // State
  enabled: boolean('enabled').notNull().default(true),
  priority: integer('priority').notNull().default(0),

  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 100 }),
});

export const automationLogs = pgTable('automation_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  automationId: uuid('automation_id').notNull().references(() => automations.id),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),  // 'success' | 'failed' | 'skipped'
  conditionsMatched: boolean('conditions_matched').notNull(),
  actionsExecuted: jsonb('actions_executed'),  // { action, status, result }[]
  error: text('error'),
  executionTimeMs: integer('execution_time_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Condition Syntax:**
```typescript
interface Condition {
  field: string;           // JSONPath-like: 'payload.from.isVIP', 'metadata.channelType'
  operator: ConditionOp;   // 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'startsWith' | 'matches'
  value: unknown;          // Expected value
}

// Examples:
{ field: 'payload.content.type', operator: 'eq', value: 'image' }
{ field: 'metadata.channelType', operator: 'eq', value: 'whatsapp' }
{ field: 'payload.from.tags', operator: 'contains', value: 'vip' }
```

**Built-in Actions:**
```typescript
type Action =
  | { type: 'trigger_agent'; config: { priority?: string; timeout?: number } }
  | { type: 'send_message'; config: { instanceId: string; to: string; content: string } }
  | { type: 'emit_event'; config: { eventType: string; payload: unknown } }
  | { type: 'webhook'; config: { url: string; method: string; headers?: Record<string, string> } }
  | { type: 'log'; config: { level: string; message: string } };
```

**Example Automation:**
```json
{
  "name": "VIP Fast Response",
  "description": "Trigger agent immediately for VIP messages",
  "triggerEventType": "message.received",
  "triggerConditions": [
    { "field": "payload.from.tags", "operator": "contains", "value": "vip" }
  ],
  "actions": [
    {
      "type": "trigger_agent",
      "config": { "priority": "high", "timeout": 5000 }
    },
    {
      "type": "emit_event",
      "config": {
        "eventType": "custom.alert.vip-message",
        "payload": { "source": "automation" }
      }
    }
  ],
  "enabled": true,
  "priority": 100
}
```

**API Endpoints:**
```typescript
// CRUD for automations
GET    /api/automations
POST   /api/automations
GET    /api/automations/:id
PUT    /api/automations/:id
DELETE /api/automations/:id

// Enable/disable
POST   /api/automations/:id/enable
POST   /api/automations/:id/disable

// Execution logs
GET    /api/automations/:id/logs
GET    /api/automations/logs?eventType=message.received
```

**Acceptance Criteria:**
- [ ] Automations stored in database
- [ ] Engine subscribes to trigger event types
- [ ] Conditions evaluated using JSONPath-like field access
- [ ] All operators work: eq, neq, gt, lt, contains, startsWith, matches
- [ ] Actions execute in order
- [ ] Action failures don't stop subsequent actions (configurable)
- [ ] Execution logged with timing and results
- [ ] Can enable/disable automations without deletion
- [ ] Priority determines execution order when multiple automations match

**Validation:**
```bash
bun test packages/core/src/automations
```

---

## Technical Notes

### Automation Engine Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Automation Engine                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│   │   EventBus   │───▶│  Condition   │───▶│   Action     │ │
│   │  Subscriber  │    │  Evaluator   │    │  Executor    │ │
│   └──────────────┘    └──────────────┘    └──────────────┘ │
│          │                   │                    │         │
│          ▼                   ▼                    ▼         │
│   Subscribe to         Match against        Execute actions │
│   trigger events       conditions           in sequence     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Performance Considerations

1. **Automation Loading:** Cache automations in memory, reload on change
2. **Condition Evaluation:** Short-circuit on first non-match
3. **Action Execution:** Run async, don't block event processing
4. **Logging:** Batch writes, async flush

---

## Dependencies

**NPM:**
- `cron-parser` - Parse cron expressions
- `jsonpath-plus` - JSONPath field access (or implement simple version)

**Internal:**
- `@omni/core` - EventBus, event types
- `@omni/db` - Database connection
- `@omni/api` - API routes

---

## Depends On

- `nats-events` wish (EventBus + basic registry)
- `api-setup` wish (API routes)

## Enables

- No-code automation configuration
- Webhook integrations (GitHub, Stripe, etc.)
- Scheduled tasks and reports
- Event-driven workflows
- Future: Visual automation builder UI
