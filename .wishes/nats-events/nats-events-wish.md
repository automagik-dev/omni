# WISH: NATS Events

> Implement the EventBus with NATS JetStream for multi-instance event-driven architecture.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-6p2

---

## Context

Events are the nervous system of Omni. Every action produces events, events trigger reactions, and events are persisted for audit and replay. NATS JetStream provides persistent, exactly-once event delivery.

**Multi-Instance Architecture:** Omni supports multiple instances per channel type (e.g., 3 WhatsApp accounts, 2 Discord bots). Events must be filterable by both channel type AND specific instance.

Reference: `docs/architecture/event-system.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | NATS server running via PM2 (from foundation) |
| **DEC-1** | Decision | 7 streams: MESSAGE, INSTANCE, IDENTITY, MEDIA, ACCESS, CUSTOM, SYSTEM |
| **DEC-2** | Decision | Hierarchical subjects: `{event}.{channelType}.{instanceId}` |
| **DEC-3** | Decision | Exactly-once delivery with explicit acks |
| **DEC-4** | Decision | Keep `instance.*` naming for instance lifecycle (not `channel.*`) |
| **DEC-5** | Decision | NATS implementation lives in `packages/core/src/events/nats/` |
| **DEC-6** | Decision | Open namespaces: `custom.*` for user events, `system.*` for internal |
| **DEC-7** | Decision | Core events are typed; custom/system events validated at runtime via registry |

---

## Scope

### IN SCOPE

- `NatsEventBus` implementation of `EventBus` interface
- Stream auto-creation and configuration (7 streams)
- Hierarchical subject patterns for multi-instance filtering
- Publish with auto-enrichment (id, timestamp, source)
- Subscribe with pattern matching (wildcards)
- Durable consumers for reliability
- Queue groups for load balancing
- Retry with exponential backoff
- Connection management with auto-reconnect
- **Open event namespaces:** `custom.*` and `system.*` for extensibility
- **Basic event registry:** Runtime registration of custom event schemas

### OUT OF SCOPE (see `events-ops` wish)

- Dead letter queue handling
- Event replay capability
- Payload storage (compressed)
- Metrics/monitoring dashboards

---

## Naming Conventions

### Event Namespaces

```typescript
// CORE events - typed, maintained in @omni/core
type CoreEventType =
  | 'message.received' | 'message.sent' | 'message.failed'
  | 'instance.connected' | 'instance.disconnected'
  | 'identity.linked' | 'identity.merged'
  | 'media.processed' | 'access.allowed' | 'access.denied';

// CUSTOM events - user-defined, runtime registered
type CustomEventType = `custom.${string}`;
// Examples:
//   'custom.webhook.github.push'
//   'custom.cron.daily-report'
//   'custom.trigger.vip-alert'

// SYSTEM events - internal operations
type SystemEventType = `system.${string}`;
// Examples:
//   'system.dead_letter'
//   'system.replay.started'
//   'system.health.degraded'

// Combined type
type EventType = CoreEventType | CustomEventType | SystemEventType;
```

### Event Types: `{domain}.{action}`

```typescript
// Past tense actions, lowercase
'message.received'
'message.sent'
'instance.connected'
'instance.disconnected'
'identity.linked'
```

### Subject Pattern: `{domain}.{action}.{channelType}.{instanceId}`

```typescript
// Examples:
'message.received.whatsapp.wa-001'
'instance.connected.discord.dc-002'

// Subscribe patterns:
'message.received.>'                  // All messages
'message.received.whatsapp.>'         // All WhatsApp messages
'message.received.whatsapp.wa-001'    // Specific instance
'message.*.whatsapp.>'                // All WhatsApp message events
'instance.connected.>'                // All instance connections
```

### Streams: `{DOMAIN}` (uppercase)

| Stream | Subjects | Retention | Purpose |
|--------|----------|-----------|---------|
| MESSAGE | `message.>` | 30 days | All message lifecycle events |
| INSTANCE | `instance.>` | 7 days | Instance connect/disconnect/qr |
| IDENTITY | `identity.>` | 90 days | Person/identity resolution |
| MEDIA | `media.>` | 7 days | Media processing pipeline |
| ACCESS | `access.>` | 30 days | Access control decisions |
| CUSTOM | `custom.>` | 7 days | User-defined events (webhooks, triggers) |
| SYSTEM | `system.>` | 7 days | Internal operations (dead letter, replay) |

### TypeScript Types

```typescript
// Event type: {Domain}{Action}Event
type MessageReceivedEvent = OmniEvent<'message.received', MessageReceivedPayload>;

// Payload type: {Domain}{Action}Payload
interface MessageReceivedPayload { ... }

// Handler type: {Domain}{Action}Handler
type MessageReceivedHandler = EventHandler<'message.received'>;
```

---

## Execution Group A: Core EventBus

**Goal:** Implement NatsEventBus with hierarchical subjects for multi-instance support.

**Deliverables:**
- [ ] `packages/core/src/events/nats/client.ts` - NatsEventBus implementation
- [ ] `packages/core/src/events/nats/streams.ts` - Stream definitions & auto-creation (7 streams)
- [ ] `packages/core/src/events/nats/subjects.ts` - Subject builder utilities
- [ ] `packages/core/src/events/nats/registry.ts` - Basic event schema registry
- [ ] `packages/core/src/events/nats/index.ts` - Public exports
- [ ] Connection management with reconnect logic
- [ ] Environment-based configuration

**Acceptance Criteria:**
- [ ] `NatsEventBus` implements `EventBus` interface
- [ ] All 7 streams created automatically on connect
- [ ] `publish()` builds hierarchical subject from event + metadata
- [ ] `publish()` returns ack with sequence number
- [ ] Auto-reconnects on connection loss (max 10 retries, exponential backoff)
- [ ] Graceful shutdown with `drain()`
- [ ] Can publish to `custom.*` namespace without compile-time type
- [ ] Can publish to `system.*` namespace for internal events

**Validation:**
```bash
bun test packages/core/src/events/nats
```

---

## Execution Group B: Subscriptions & Consumers

**Goal:** Implement flexible subscription patterns with durability and load balancing.

**Deliverables:**
- [ ] `packages/core/src/events/nats/consumer.ts` - Consumer configuration
- [ ] `packages/core/src/events/nats/subscription.ts` - Subscription management
- [ ] Pattern matching for subjects (wildcards: `*`, `>`)
- [ ] Queue groups for horizontal scaling
- [ ] Durable consumers that survive restarts
- [ ] Retry with configurable exponential backoff
- [ ] Zod-validated subscriptions

**Acceptance Criteria:**
- [ ] Can subscribe to specific event: `message.received.whatsapp.wa-001`
- [ ] Can subscribe to channel type: `message.received.whatsapp.>`
- [ ] Can subscribe to all of domain: `message.received.>`
- [ ] Queue groups distribute events across subscribers
- [ ] Durable consumers resume from last ack after restart
- [ ] Failed handlers retry with backoff (default: 3 retries)
- [ ] `subscribeValidated()` rejects events failing Zod schema

**Validation:**
```bash
# Unit tests
bun test packages/core/src/events/nats

# Integration test with real NATS
bun run packages/core/scripts/test-events-integration.ts
```

---

## Technical Design

### File Structure

```
packages/core/src/events/
├── index.ts              # Public exports (re-export nats)
├── types.ts              # Event type definitions (core + open namespaces)
├── schemas.ts            # Zod schemas for core events
├── bus.ts                # EventBus interface (abstract contract)
└── nats/
    ├── index.ts          # NatsEventBus export
    ├── client.ts         # NatsEventBus implementation
    ├── streams.ts        # Stream definitions & config (7 streams)
    ├── subjects.ts       # Subject builder: buildSubject(), parseSubject()
    ├── registry.ts       # Event schema registry for custom events
    ├── consumer.ts       # Durable consumer config
    └── subscription.ts   # Subscription wrapper
```

### Event Registry (Basic)

```typescript
// packages/core/src/events/nats/registry.ts

import { z, ZodSchema } from 'zod';

interface EventSchemaEntry {
  eventType: string;
  schema: ZodSchema;
  stream?: string;        // Override default stream routing
  description?: string;
}

class EventRegistry {
  private schemas = new Map<string, EventSchemaEntry>();

  /**
   * Register a custom event type with its schema.
   * For core events, schemas are pre-registered.
   */
  register(entry: EventSchemaEntry): void {
    if (!entry.eventType.startsWith('custom.') &&
        !entry.eventType.startsWith('system.')) {
      throw new Error('Can only register custom.* or system.* events');
    }
    this.schemas.set(entry.eventType, entry);
  }

  /**
   * Validate a payload against registered schema.
   * Core events use compile-time types; custom events use runtime validation.
   */
  validate(eventType: string, payload: unknown): { success: boolean; error?: string } {
    const entry = this.schemas.get(eventType);
    if (!entry) {
      // Unknown custom event - allow but warn
      if (eventType.startsWith('custom.')) {
        console.warn(`No schema registered for ${eventType}`);
        return { success: true };
      }
      return { success: false, error: `Unknown event type: ${eventType}` };
    }

    const result = entry.schema.safeParse(payload);
    return result.success
      ? { success: true }
      : { success: false, error: result.error.message };
  }

  /**
   * Get stream for event type (for routing).
   */
  getStream(eventType: string): string {
    const entry = this.schemas.get(eventType);
    if (entry?.stream) return entry.stream;

    // Default routing by prefix
    const prefix = eventType.split('.')[0];
    const STREAM_MAP: Record<string, string> = {
      message: 'MESSAGE',
      instance: 'INSTANCE',
      identity: 'IDENTITY',
      media: 'MEDIA',
      access: 'ACCESS',
      custom: 'CUSTOM',
      system: 'SYSTEM',
    };
    return STREAM_MAP[prefix] || 'CUSTOM';
  }

  list(): EventSchemaEntry[] {
    return Array.from(this.schemas.values());
  }
}

export const eventRegistry = new EventRegistry();

// Usage:
eventRegistry.register({
  eventType: 'custom.webhook.github',
  schema: z.object({
    action: z.string(),
    repository: z.string(),
    sender: z.string(),
    payload: z.unknown(),
  }),
  description: 'GitHub webhook events',
});
```

### Subject Builder

```typescript
// packages/core/src/events/nats/subjects.ts

export function buildSubject(
  eventType: EventType,
  channelType: ChannelType,
  instanceId: string
): string {
  return `${eventType}.${channelType}.${instanceId}`;
}

export function buildSubscribePattern(options: {
  eventType?: EventType | '*';
  channelType?: ChannelType | '*';
  instanceId?: string | '>';
}): string {
  const { eventType = '*', channelType = '*', instanceId = '>' } = options;
  return `${eventType}.${channelType}.${instanceId}`;
}

// Usage:
buildSubject('message.received', 'whatsapp', 'wa-001')
// → 'message.received.whatsapp.wa-001'

buildSubscribePattern({ eventType: 'message.received', channelType: 'whatsapp' })
// → 'message.received.whatsapp.>'
```

### NatsEventBus Interface

```typescript
// Extends the abstract EventBus with NATS-specific options
interface NatsEventBusConfig extends EventBusConfig {
  url: string;
  credentials?: { user: string; pass: string };
  reconnect?: {
    maxRetries: number;
    delayMs: number;
    maxDelayMs: number;
  };
}

interface SubscribeOptions {
  pattern: string;              // Subject pattern with wildcards
  queue?: string;               // Queue group name for load balancing
  durable?: string;             // Durable consumer name
  startFrom?: 'new' | 'first' | 'last' | Date;
  maxRetries?: number;          // Default: 3
  retryDelayMs?: number;        // Default: 1000 (exponential)
  ackWaitMs?: number;           // Default: 30000
}
```

---

## Dependencies

**NPM:**
- `nats` - NATS client library

**Internal:**
- `@omni/core` - Event types, schemas, EventBus interface

---

## Depends On

- Foundation (NATS server running via PM2)

## Enables

- Channel SDK (channels publish/subscribe to events)
- All event-driven features
- Custom event types via `custom.*` namespace
- Real-time WebSocket streams (future)
- Media processing pipeline (future)
- Event automations via `events-ext` wish (future)

---

## Migration Notes

Update existing code:
1. Rename `instance.connected` payload field if needed (already correct)
2. Ensure all event metadata includes `instanceId` AND `channelType`
3. Update any hardcoded subject strings to use `buildSubject()`
