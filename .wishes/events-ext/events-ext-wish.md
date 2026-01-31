# WISH: Events Ext

> Webhooks and automations: external event sources and "when X happens, do Y" rules.

**Status:** READY
**Created:** 2026-01-29
**Updated:** 2026-01-31
**Author:** WISH Agent
**Beads:** omni-v2-ds9

---

## Context

The core EventBus (`nats-events`) handles event publishing/subscribing. Now we need:

1. **Webhooks** - External systems can trigger events in Omni
2. **Automations** - "When event X with conditions, execute actions Y"

**Core Use Case (from Omni v1):**
```
message.received → call agent API (agno) → send response to sender
```

This is the foundation for intelligent message handling.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | `nats-events` wish completed (EventBus working) |
| **ASM-2** | Assumption | `events-ops` completed (metrics, dead letter handling) |
| **DEC-1** | Decision | Automations stored in PostgreSQL, not code |
| **DEC-2** | Decision | Conditions use simple field matching (dot notation) |
| **DEC-3** | Decision | Actions: `webhook`, `send_message`, `emit_event`, `log` |
| **DEC-4** | Decision | Automations run in-process, simple sequential execution |
| **DEC-5** | Decision | No webhook signature validation initially (add later) |
| **DEC-6** | Decision | Defer `trigger_agent` action to future AI integration wish |

---

## Scope

### IN SCOPE

**Webhooks:**
- Webhook receiver endpoint (`POST /api/v2/webhooks/:source`)
- Webhook → `custom.webhook.{source}` event translation
- Webhook source configuration (name, expected headers)
- Manual trigger API (`POST /api/v2/events/trigger`)

**Automations:**
- Automation rule definition (trigger + conditions + actions)
- Condition evaluation (field matching, comparisons)
- Built-in actions: `send_message`, `webhook`, `emit_event`, `log`
- Automation enable/disable
- Execution logging

### OUT OF SCOPE

- Persistent event registry (define events in code for now)
- Event discovery API (not needed without registry)
- Cron-based triggers (not needed yet)
- Webhook signature validation (add later if needed)
- `trigger_agent` action (future AI integration wish)
- Visual automation builder UI
- Complex workflow orchestration (branching, rollback)
- Rate limiting / throttling

---

## Execution Group A: Webhooks & External Sources

**Goal:** Enable external systems to emit events into Omni.

**Deliverables:**
- [ ] `packages/api/src/routes/v2/webhooks.ts` - Webhook receiver endpoint
- [ ] `packages/db/src/schema/webhooks.ts` - Webhook source configuration table
- [ ] `packages/core/src/events/sources/webhook.ts` - Webhook → event translation
- [ ] Manual trigger API endpoint

**Database Schema:**
```typescript
export const webhookSources = pgTable('webhook_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),  // 'github', 'stripe', 'agno'
  description: text('description'),

  // Optional validation
  expectedHeaders: jsonb('expected_headers'),  // { 'X-GitHub-Event': true }

  // Metadata
  enabled: boolean('enabled').notNull().default(true),
  lastReceivedAt: timestamp('last_received_at'),
  totalReceived: integer('total_received').notNull().default(0),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**Webhook Flow:**
```
External System                    Omni
     │                              │
     │  POST /api/v2/webhooks/agno  │
     │  { response: "Hello!", ... } │
     │ ─────────────────────────────▶
     │                              │
     │                   Translate to event:
     │                   custom.webhook.agno
     │                   { response, ... }
     │                              │
     │                   Publish to CUSTOM stream
     │                              │
     │         200 OK               │
     │ ◀─────────────────────────────
```

**API Endpoints:**
```typescript
// Receive webhook
POST /api/v2/webhooks/:source
// ← Any JSON payload
// → 200 { received: true, eventId: '...' }

// Manual trigger
POST /api/v2/events/trigger
// ← { eventType: 'custom.manual.test', payload: {...} }
// → 201 { eventId: '...', published: true }

// Webhook source CRUD
GET    /api/v2/webhook-sources
POST   /api/v2/webhook-sources
GET    /api/v2/webhook-sources/:id
PUT    /api/v2/webhook-sources/:id
DELETE /api/v2/webhook-sources/:id
```

**Acceptance Criteria:**
- [ ] Webhook endpoint receives any JSON payload
- [ ] Webhooks translated to `custom.webhook.{source}` events
- [ ] Webhook sources stored in database (name, description, enabled)
- [ ] Unknown source creates new source automatically (or rejects - configurable)
- [ ] Manual trigger API publishes custom events
- [ ] All events include correlationId for tracing
- [ ] Source stats tracked (lastReceivedAt, totalReceived)

**Validation:**
```bash
bun test packages/api/src/routes/v2/__tests__/webhooks.test.ts
bun test packages/core/src/events/sources/__tests__/
```

---

## Execution Group B: Event Automations

**Goal:** Rule-based automation: "When event X with conditions Y, execute actions Z."

**Core Use Case:**
```
message.received → call agent API → send response to sender
```

**Deliverables:**
- [ ] `packages/core/src/automations/engine.ts` - Automation engine
- [ ] `packages/core/src/automations/conditions.ts` - Condition evaluator
- [ ] `packages/core/src/automations/actions/` - Action implementations
- [ ] `packages/db/src/schema/automations.ts` - Database tables
- [ ] Automation CRUD API
- [ ] Execution logging

**Database Schema:**
```typescript
export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),

  // Trigger
  triggerEventType: varchar('trigger_event_type', { length: 255 }).notNull(),
  triggerConditions: jsonb('trigger_conditions'),  // Condition[]

  // Actions (executed sequentially)
  actions: jsonb('actions').notNull(),  // Action[]

  // State
  enabled: boolean('enabled').notNull().default(true),
  priority: integer('priority').notNull().default(0),

  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const automationLogs = pgTable('automation_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  automationId: uuid('automation_id').notNull().references(() => automations.id),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),  // 'success' | 'failed' | 'skipped'
  conditionsMatched: boolean('conditions_matched').notNull(),
  actionsExecuted: jsonb('actions_executed'),  // [{ action, status, result, durationMs }]
  error: text('error'),
  executionTimeMs: integer('execution_time_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Condition Syntax (simple dot notation):**
```typescript
interface Condition {
  field: string;           // Dot notation: 'payload.from.isVIP', 'payload.content.type'
  operator: ConditionOp;   // 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists'
  value: unknown;          // Expected value (ignored for 'exists')
}

// Examples:
{ field: 'payload.content.type', operator: 'eq', value: 'text' }
{ field: 'payload.from.tags', operator: 'contains', value: 'vip' }
{ field: 'payload.instanceId', operator: 'exists' }
```

**Built-in Actions:**
```typescript
type Action =
  | { type: 'webhook'; config: { url: string; method?: string; headers?: Record<string, string>; bodyTemplate?: string } }
  | { type: 'send_message'; config: { instanceId?: string; to?: string; contentTemplate: string } }
  | { type: 'emit_event'; config: { eventType: string; payloadTemplate?: object } }
  | { type: 'log'; config: { level: 'debug' | 'info' | 'warn' | 'error'; message: string } };

// Templates support {{payload.field}} substitution
```

**Example: Agent Response Automation (v1 Core Flow):**
```json
{
  "name": "Agent Response Handler",
  "description": "When agent webhook responds, send message to original sender",
  "triggerEventType": "custom.webhook.agno",
  "triggerConditions": [
    { "field": "payload.response", "operator": "exists" }
  ],
  "actions": [
    {
      "type": "send_message",
      "config": {
        "instanceId": "{{payload.instanceId}}",
        "to": "{{payload.replyTo}}",
        "contentTemplate": "{{payload.response}}"
      }
    },
    {
      "type": "log",
      "config": {
        "level": "info",
        "message": "Sent agent response to {{payload.replyTo}}"
      }
    }
  ],
  "enabled": true
}
```

**Example: Forward Message to Agent:**
```json
{
  "name": "Forward to Agent",
  "description": "Send incoming messages to agent API for processing",
  "triggerEventType": "message.received",
  "triggerConditions": [
    { "field": "payload.content.type", "operator": "eq", "value": "text" }
  ],
  "actions": [
    {
      "type": "webhook",
      "config": {
        "url": "https://api.agno.ai/v1/process",
        "method": "POST",
        "headers": { "Authorization": "Bearer {{env.AGNO_API_KEY}}" },
        "bodyTemplate": "{\"message\": \"{{payload.content.text}}\", \"instanceId\": \"{{payload.instanceId}}\", \"replyTo\": \"{{payload.from.id}}\"}"
      }
    }
  ],
  "enabled": true
}
```

**API Endpoints:**
```typescript
// CRUD
GET    /api/v2/automations
POST   /api/v2/automations
GET    /api/v2/automations/:id
PUT    /api/v2/automations/:id
DELETE /api/v2/automations/:id

// Enable/disable
POST   /api/v2/automations/:id/enable
POST   /api/v2/automations/:id/disable

// Test automation against sample event
POST   /api/v2/automations/:id/test
// ← { event: { type: 'message.received', payload: {...} } }
// → { matched: true, actions: [...], dryRun: true }

// Execution logs
GET    /api/v2/automations/:id/logs
GET    /api/v2/automation-logs?eventType=message.received&status=failed
```

**Acceptance Criteria:**
- [ ] Automations stored in database with CRUD API
- [ ] Engine subscribes to all enabled trigger event types
- [ ] Conditions evaluated using dot notation field access
- [ ] Operators work: eq, neq, gt, lt, contains, exists
- [ ] Actions execute sequentially, failures logged but don't stop sequence
- [ ] Template substitution works: `{{payload.field}}`, `{{env.VAR}}`
- [ ] Execution logged with timing per action
- [ ] Can enable/disable without deletion
- [ ] Test endpoint validates without executing
- [ ] Priority determines order when multiple automations match same event

**Validation:**
```bash
bun test packages/core/src/automations/__tests__/
```

---

## Technical Notes

### Omnichannel Event Flow

The automation engine works on **all events from all channels**. This is what makes Omni truly omnichannel:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OMNI EVENT BUS (NATS)                            │
│                     Central hub for ALL events                          │
└─────────────────────────────────────────────────────────────────────────┘
        ▲                       ▲                       ▲
        │                       │                       │
   message.received       message.received       custom.webhook.agno
        │                       │                       │
┌───────┴───────┐       ┌───────┴───────┐       ┌───────┴───────┐
│   WhatsApp    │       │    Discord    │       │  Agent API    │
│   (Baileys)   │       │   (future)    │       │   Response    │
└───────────────┘       └───────────────┘       └───────────────┘
```

**Key insight:** `message.received` is channel-agnostic. Automations don't know or care if a message came from WhatsApp, Discord, or Telegram - they just see the event and its payload.

### Complete v1 Flow (2 Automations)

```
User sends WhatsApp message
         │
         ▼
┌─────────────────────────────────────────┐
│  channel-whatsapp emits:                │
│  message.received {                     │
│    instanceId: "wa-123",                │
│    from: { id: "+5511999...", ... },    │
│    content: { type: "text", text: "Hi"} │
│  }                                      │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Automation 1: "Forward to Agent"       │
│  Trigger: message.received              │
│  Action: webhook POST to agno API       │
│  Body: { message, instanceId, replyTo } │
└─────────────────────────────────────────┘
         │
         ▼
    Agent processes...
         │
         ▼
┌─────────────────────────────────────────┐
│  Agent calls back:                      │
│  POST /api/v2/webhooks/agno             │
│  { response: "Hello!", instanceId,      │
│    replyTo: "+5511999..." }             │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Omni emits:                            │
│  custom.webhook.agno { ... }            │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Automation 2: "Agent Response Handler" │
│  Trigger: custom.webhook.agno           │
│  Action: send_message to replyTo        │
└─────────────────────────────────────────┘
         │
         ▼
    User receives "Hello!" on WhatsApp
```

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
- None new (use simple dot-notation field access, no jsonpath library needed)

**Internal:**
- `@omni/core` - EventBus, event types
- `@omni/db` - Database connection
- `@omni/api` - API routes
- `@omni/channel-sdk` - For `send_message` action

---

## Depends On

- `nats-events` wish (EventBus) ✅ SHIPPED
- `api-setup` wish (API routes) ✅ SHIPPED
- `events-ops` wish (metrics, dead letter) - for operational observability
- `channel-whatsapp` wish (at least one channel to test) ✅ SHIPPED

## Enables

- **Agent integration** - The core v1 flow (message → agent → response)
- **Webhook integrations** - GitHub, Stripe, custom systems
- **Event-driven workflows** - No-code automation configuration
- **Future:** Visual automation builder UI
- **Future:** `channel-discord` and other channels (same automations work for all)
