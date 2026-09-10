---
title: "Event System"
created: 2025-01-29
updated: 2026-09-08
tags: [architecture, events, nats, journal]
status: current
---

# Event System

> The event system is the nervous system of Omni v2. Every action produces events, events trigger reactions, and events are persisted for audit and replay.

> Related: [[overview|Architecture Overview]], [[plugin-system|Plugin System]], [[connector-contract|Connector Contract]] · Runbooks: [Durable Consumers](../runbooks/durable-consumers.md), [Agent Publish Governance](../runbooks/agent-publish-governance.md), [GitHub Webhook Source](../runbooks/github-webhook-source.md), [ClickUp Webhook Source](../runbooks/clickup-webhook-source.md)

## Why Event-Driven?

### Benefits for Omni

1. **Natural fit for messaging** - Messages ARE events
2. **Decoupling** - Channels don't know about processors
3. **Audit trail** - Complete history of everything
4. **Replay** - Can reprocess historical data
5. **Real-time** - WebSocket updates from same events
6. **Scalability** - Workers process events in parallel

### Event Sourcing vs. Traditional

```
Traditional (v1):                    Event-Driven (v2):

POST /message  ──────►  Database     POST /message ──────► Event Bus
      │                                    │                   │
      ▼                                    ▼                   ▼
   Response                           Event Stored      Subscribers React
                                           │                   │
                                           ▼                   ▼
                                     Database Updated    Side Effects
```

## The Journal Is the Source of Truth

Since the event-backbone work (RFC #925), the **PostgreSQL journal — the
`omni_events` table — is the durable record** of the event system. NATS
JetStream is the transport that fans events out to live subscribers; the
journal is what replay, causality tracing, and durable consumption read.
This means NATS retention limits are a transport concern, not a data-loss
concern.

Three columns make `omni_events` a proper journal:

| Column | Type | Purpose |
|--------|------|---------|
| `journal_seq` | `bigserial`, unique index | Total order over journaled events; durable-consumer cursors page strictly after it |
| `causation_id` | `uuid`, indexed | The event this event reacted to — the edge of the causality tree |
| `idempotency_key` | `text`, unique index | At-most-once journaling for retried, replayed, or redelivered ingress |

## NATS JetStream

We use NATS JetStream as our event transport:

- **Lightweight** - Single binary, <20MB memory
- **Persistent** - Events survive restarts (within stream retention; the journal outlives it)
- **Deduplicated publish** - Within NATS; end-to-end processing is at-least-once, with the journal's idempotency key as the dedup backstop
- **Fast** - <1ms latency
- **Built-in KV** - For session state

### Connection Setup

```typescript
// packages/core/src/events/bus.ts

import { connect, JetStreamClient, JetStreamManager, StringCodec } from 'nats';

export class EventBus {
  private nc!: NatsConnection;
  private js!: JetStreamClient;
  private sc = StringCodec();

  async connect(config: EventBusConfig): Promise<void> {
    this.nc = await connect({
      servers: config.url,
      user: config.user,
      pass: config.password,
      tls: config.tls ? {} : undefined,
    });

    this.js = this.nc.jetstream();
    await this.ensureStreams();

    console.log('Connected to NATS JetStream');
  }

  private async ensureStreams(): Promise<void> {
    const jsm = await this.nc.jetstreamManager();

    // Define all streams
    const streams: StreamConfig[] = [
      {
        name: 'MESSAGES',
        subjects: ['message.>'],
        retention: 'limits',
        maxAge: 30 * 24 * 60 * 60 * 1_000_000_000, // 30 days in ns
        storage: 'file',
      },
      {
        name: 'IDENTITY',
        subjects: ['identity.>'],
        retention: 'limits',
        maxAge: 90 * 24 * 60 * 60 * 1_000_000_000, // 90 days
        storage: 'file',
      },
      {
        name: 'MEDIA',
        subjects: ['media.>'],
        retention: 'limits',
        maxAge: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days
        storage: 'file',
      },
      {
        name: 'AGENT',
        subjects: ['agent.>'],
        retention: 'limits',
        maxAge: 7 * 24 * 60 * 60 * 1_000_000_000,
        storage: 'file',
      },
      {
        name: 'ACCESS',
        subjects: ['access.>'],
        retention: 'limits',
        maxAge: 30 * 24 * 60 * 60 * 1_000_000_000,
        storage: 'file',
      },
      {
        name: 'CHANNEL',
        subjects: ['channel.>'],
        retention: 'limits',
        maxAge: 7 * 24 * 60 * 60 * 1_000_000_000,
        storage: 'file',
      },
    ];

    for (const config of streams) {
      await this.ensureStream(jsm, config);
    }
  }

  private async ensureStream(jsm: JetStreamManager, config: StreamConfig): Promise<void> {
    try {
      await jsm.streams.info(config.name);
      // Stream exists, update if needed
      await jsm.streams.update(config.name, config);
    } catch {
      // Stream doesn't exist, create it
      await jsm.streams.add(config);
      console.log(`Created stream: ${config.name}`);
    }
  }

  async close(): Promise<void> {
    await this.nc.drain();
  }
}
```

## Event Types

### Core Event Interface

```typescript
// packages/core/src/events/types.ts

/**
 * Base event structure. All events extend this.
 */
interface BaseEvent<T extends string, P> {
  type: T;
  payload: P;

  // Auto-populated
  id: string;          // UUID
  timestamp: string;   // ISO 8601
  source: string;      // Service that emitted
  traceId?: string;    // For distributed tracing
}

/**
 * Event metadata for tracking
 */
interface EventMetadata {
  id: string;
  type: string;
  timestamp: Date;
  source: string;
  traceId?: string;
  sequence?: number;   // NATS sequence number
}
```

### Message Events

```typescript
// ==================== INBOUND ====================

interface MessageReceivedEvent extends BaseEvent<'message.received', {
  // Identifiers
  messageId: string;           // Omni's UUID
  externalMessageId: string;   // Platform's ID

  // Source
  channel: ChannelType;
  instanceId: string;

  // Sender (raw, before identity resolution)
  sender: {
    platformUserId: string;
    platformUsername?: string;
    profileData?: Record<string, unknown>;
  };

  // Conversation
  conversationId?: string;
  externalConversationId: string;

  // Content
  content: MessageContent;

  // Timestamps
  platformTimestamp: Date;

  // Raw for debugging
  rawPayload?: unknown;
}> {}

// Reactions are NOT messages. Inbound reactions never arrive as
// message.received — they have their own semantic types (#1033), so
// message subscribers (automations, agent dispatch, `events wait`) never
// see a 👍 as a new message, and reaction flows are directly subscribable.
interface ReactionReceivedEvent extends BaseEvent<'reaction.received', {
  messageId: string;   // target message (platform external id)
  chatId: string;
  from: string;        // platform user id of the reactor
  emoji: string;
  isCustomEmoji?: boolean;
}> {}

interface ReactionRemovedEvent extends BaseEvent<'reaction.removed', {
  messageId: string;
  chatId: string;
  from: string;
  emoji: string;       // '' on WhatsApp (platform does not say which emoji was removed)
}> {}

interface MessageContent {
  type: ContentType;
  text?: string;
  media?: MediaAttachment[];
  reaction?: {
    emoji: string;
    targetMessageId: string;
  };
  poll?: {
    question: string;
    options: string[];
    selectedOptions?: string[];
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  contact?: {
    name: string;
    phone: string;
  };
  // Protocol events (edits, deletes, etc.)
  protocol?: {
    action: 'edit' | 'delete' | 'revoke' | 'ephemeral';
    data?: unknown;
  };
}

type ContentType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'reaction' // outbound only — inbound reactions are `reaction.received` / `reaction.removed`, never `message.received` (#1033)
  | 'poll'
  | 'location'
  | 'contact'
  | 'protocol';

// ==================== OUTBOUND ====================

interface MessageSendingEvent extends BaseEvent<'message.sending', {
  messageId: string;
  instanceId: string;
  channel: ChannelType;
  recipient: {
    platformUserId: string;
    conversationId?: string;
  };
  content: MessageContent;
  replyTo?: string;
}> {}

interface MessageSentEvent extends BaseEvent<'message.sent', {
  messageId: string;
  externalMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
  metadata?: {
    latencyMs: number;
  };
}> {}

interface MessageStatusEvent extends BaseEvent<'message.status', {
  messageId: string;
  externalMessageId: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
}> {}
```

### Identity Events

```typescript
interface IdentityResolvedEvent extends BaseEvent<'identity.resolved', {
  messageId?: string;
  personId: string;
  identityId: string;
  channel: ChannelType;
  platformUserId: string;
  isNewPerson: boolean;
  isNewIdentity: boolean;
  confidence: number;
}> {}

interface IdentityMergedEvent extends BaseEvent<'identity.merged', {
  targetPersonId: string;
  sourcePersonId: string;
  mergedIdentityIds: string[];
  reason: 'same_phone' | 'same_email' | 'admin_linked' | 'user_claimed';
  evidence?: Record<string, unknown>;
  mergedBy?: string;  // Admin user ID or 'system'
}> {}

interface IdentityUpdatedEvent extends BaseEvent<'identity.updated', {
  identityId: string;
  personId: string;
  changes: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
}> {}
```

### Media Events

```typescript
interface MediaReceivedEvent extends BaseEvent<'media.received', {
  messageId: string;
  mediaId: string;
  type: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  mimeType: string;
  size?: number;
  url?: string;
  duration?: number;
  dimensions?: { width: number; height: number };
}> {}

interface MediaProcessingEvent extends BaseEvent<'media.processing', {
  messageId: string;
  mediaId: string;
  processorType: 'transcription' | 'description' | 'extraction';
  startedAt: Date;
}> {}

interface MediaProcessedEvent extends BaseEvent<'media.processed', {
  messageId: string;
  mediaId: string;
  result: {
    type: 'transcription' | 'description' | 'extraction';
    content: string;
    model: string;
    tokensUsed?: number;
    cost?: number;
    language?: string;
    confidence?: number;
  };
  processingTimeMs: number;
}> {}

interface MediaFailedEvent extends BaseEvent<'media.failed', {
  messageId: string;
  mediaId: string;
  error: string;
  retryCount: number;
  willRetry: boolean;
}> {}
```

### Agent Events

```typescript
interface AgentRequestEvent extends BaseEvent<'agent.request', {
  messageId: string;
  personId: string;
  instanceId: string;

  // Enriched content (with transcriptions, etc.)
  enrichedContent: string;

  // Conversation history
  history?: {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }[];

  // Agent config
  agentConfig: {
    apiUrl: string;
    timeout: number;
    streaming: boolean;
  };
}> {}

interface AgentResponseEvent extends BaseEvent<'agent.response', {
  messageId: string;
  response: {
    text?: string;
    media?: MediaAttachment[];
    actions?: AgentAction[];
  };
  metadata: {
    tokensUsed?: number;
    latencyMs: number;
    model?: string;
    streaming: boolean;
  };
}> {}

interface AgentErrorEvent extends BaseEvent<'agent.error', {
  messageId: string;
  error: string;
  retryCount: number;
  willRetry: boolean;
}> {}
```

### Access Events

```typescript
interface AccessCheckedEvent extends BaseEvent<'access.checked', {
  messageId: string;
  personId: string;
  identityId: string;
  instanceId: string;
  decision: 'allow' | 'deny';
  rule?: {
    id: string;
    type: 'allow' | 'deny';
    criteria: unknown;
  };
  reason: string;
}> {}

interface AccessRuleChangedEvent extends BaseEvent<'access.rule_changed', {
  ruleId: string;
  action: 'created' | 'updated' | 'deleted';
  rule?: AccessRule;
  changedBy: string;
}> {}
```

### Channel Events

```typescript
interface ChannelConnectedEvent extends BaseEvent<'channel.connected', {
  instanceId: string;
  channel: ChannelType;
  connectionInfo?: {
    phoneNumber?: string;
    username?: string;
    serverId?: string;
  };
}> {}

interface ChannelDisconnectedEvent extends BaseEvent<'channel.disconnected', {
  instanceId: string;
  channel: ChannelType;
  reason: 'logout' | 'error' | 'timeout' | 'manual';
  error?: string;
}> {}

interface ChannelQrCodeEvent extends BaseEvent<'channel.qr_code', {
  instanceId: string;
  qrCode: string;  // Base64 or data URL
  expiresAt: Date;
}> {}
```

### System & Custom Events

The event-backbone wave added families beyond the channel pipeline:

| Type | Emitted when |
|------|--------------|
| `custom.<source>.<event>` | Webhook ingress or an automation `emit_event` action publishes a custom event |
| `system.connector.stalled` / `system.connector.recovered` | The connector-liveness sweeper detects a missed / resumed heartbeat |
| `system.consumer.created` / `system.consumer.deleted` | A durable consumer is registered / removed |
| `system.agent.manifest.updated` | An agent's event manifest changes |
| `channel.alert` | A channel raises an operational alert |
| `template.status_changed` | A message template's approval status changes |
| `agent.run.cancel_requested` | Cancellation is requested for an in-flight agent run |

Journaling rules differ by family:

- **`custom.*` events are journaled by a dedicated forward-only consumer**
  (recorded with channel `internal`). Custom events published before that
  consumer first ran are not in the journal.
- **`system.*` events are deliberately NOT journaled** — they are operational
  signals on the bus, not part of the durable record.

## Publishing Events

```typescript
// packages/core/src/events/bus.ts

export class EventBus {
  // ... connection code ...

  /**
   * Publish an event to the bus.
   */
  async publish<E extends OmniEvent>(event: E): Promise<EventMetadata> {
    const enrichedEvent = {
      ...event,
      id: event.id ?? crypto.randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      source: this.serviceName,
    };

    const subject = event.type;  // e.g., 'message.received'
    const data = this.sc.encode(JSON.stringify(enrichedEvent));

    const ack = await this.js.publish(subject, data);

    return {
      id: enrichedEvent.id,
      type: event.type,
      timestamp: new Date(enrichedEvent.timestamp),
      source: this.serviceName,
      sequence: ack.seq,
    };
  }

  /**
   * Publish multiple events atomically.
   */
  async publishBatch<E extends OmniEvent>(events: E[]): Promise<EventMetadata[]> {
    const results: EventMetadata[] = [];

    for (const event of events) {
      const meta = await this.publish(event);
      results.push(meta);
    }

    return results;
  }
}
```

## Subscribing to Events

```typescript
// packages/core/src/events/bus.ts

export class EventBus {
  // ... other code ...

  /**
   * Subscribe to events matching a pattern.
   *
   * @param pattern - Subject pattern (e.g., 'message.*', 'media.processed')
   * @param handler - Async handler function
   * @param options - Subscription options
   */
  async subscribe<E extends OmniEvent>(
    pattern: string,
    handler: (event: E, metadata: EventMetadata) => Promise<void>,
    options: SubscribeOptions = {}
  ): Promise<Subscription> {
    const {
      queue,          // Queue group for load balancing
      durable,        // Durable consumer name
      startFrom,      // 'new' | 'first' | 'last' | Date
      maxRetries = 3,
      retryDelayMs = 1000,
    } = options;

    const consumer = await this.js.consumers.get(
      this.getStreamForSubject(pattern),
      {
        durable_name: durable,
        filter_subject: pattern,
        deliver_policy: this.mapStartFrom(startFrom),
        ack_policy: 'explicit',
        max_deliver: maxRetries,
        ack_wait: 30_000_000_000, // 30 seconds in nanoseconds
      }
    );

    const subscription = await consumer.consume({
      callback: async (msg) => {
        const event = JSON.parse(this.sc.decode(msg.data)) as E;
        const metadata: EventMetadata = {
          id: event.id,
          type: event.type,
          timestamp: new Date(event.timestamp),
          source: event.source,
          sequence: msg.seq,
        };

        try {
          await handler(event, metadata);
          msg.ack();
        } catch (error) {
          console.error(`Error processing event ${event.type}:`, error);

          // Check if we should retry
          if (msg.info.redeliveryCount < maxRetries) {
            msg.nak(retryDelayMs);  // Negative ack with delay
          } else {
            // Max retries exceeded, send to dead letter
            await this.sendToDeadLetter(event, error);
            msg.term();  // Terminate - don't redeliver
          }
        }
      },
    });

    return {
      unsubscribe: () => subscription.stop(),
    };
  }

  /**
   * Subscribe with in-process Zod validation (typing convenience —
   * see the schema registry note below for the persisted contract layer).
   */
  async subscribeValidated<E extends OmniEvent>(
    pattern: string,
    schema: ZodSchema<E>,
    handler: (event: E, metadata: EventMetadata) => Promise<void>,
    options: SubscribeOptions = {}
  ): Promise<Subscription> {
    return this.subscribe(pattern, async (rawEvent, metadata) => {
      const result = schema.safeParse(rawEvent);
      if (!result.success) {
        throw new ValidationError(`Invalid event: ${result.error.message}`);
      }
      await handler(result.data, metadata);
    }, options);
  }
}
```

> **`subscribeValidated()` is in-process typing, not the platform's
> validation story.** The subscriber hands in a Zod schema and gets a typed
> event (or a thrown `ValidationError`) — a convenience for consumers. The
> persisted contract layer is the [event schema registry](#event-schema-registry)
> below, which gates specific ingress points with stored JSON Schemas.

## Event Handlers

### Example: Identity Resolution Handler

```typescript
// Illustrative subscriber — the subscribe API lives in
// packages/core/src/events/bus.ts

export class IdentityEventHandler {
  constructor(
    private eventBus: EventBus,
    private identityService: IdentityService
  ) {}

  async start(): Promise<void> {
    // Listen for all incoming messages to resolve identity
    await this.eventBus.subscribe<MessageReceivedEvent>(
      'message.received',
      async (event) => {
        const { person, identity, isNewPerson, isNewIdentity } =
          await this.identityService.resolveIdentity({
            channel: event.payload.channel,
            platformUserId: event.payload.sender.platformUserId,
            instanceId: event.payload.instanceId,
            profileData: event.payload.sender.profileData,
          });

        // Emit identity resolved event
        await this.eventBus.publish({
          type: 'identity.resolved',
          payload: {
            messageId: event.payload.messageId,
            personId: person.id,
            identityId: identity.id,
            channel: event.payload.channel,
            platformUserId: event.payload.sender.platformUserId,
            isNewPerson,
            isNewIdentity,
            confidence: identity.confidence,
          },
        });
      },
      {
        queue: 'identity-resolvers',  // Load balance across instances
        durable: 'identity-resolver',
      }
    );
  }
}
```

### Example: Media Processing Handler

```typescript
// Illustrative subscriber — the subscribe API lives in
// packages/core/src/events/bus.ts

export class MediaEventHandler {
  constructor(
    private eventBus: EventBus,
    private mediaPipeline: MediaPipeline
  ) {}

  async start(): Promise<void> {
    // Listen for media events
    await this.eventBus.subscribe<MediaReceivedEvent>(
      'media.received',
      async (event) => {
        const { messageId, mediaId, type, mimeType, url } = event.payload;

        // Emit processing started
        await this.eventBus.publish({
          type: 'media.processing',
          payload: {
            messageId,
            mediaId,
            processorType: this.getProcessorType(type),
            startedAt: new Date(),
          },
        });

        try {
          const result = await this.mediaPipeline.process({
            mediaId,
            type,
            mimeType,
            url,
          });

          // Emit success
          await this.eventBus.publish({
            type: 'media.processed',
            payload: {
              messageId,
              mediaId,
              result,
              processingTimeMs: Date.now() - event.timestamp.getTime(),
            },
          });
        } catch (error) {
          // Emit failure (will be retried by NATS)
          await this.eventBus.publish({
            type: 'media.failed',
            payload: {
              messageId,
              mediaId,
              error: String(error),
              retryCount: 0,
              willRetry: true,
            },
          });

          throw error;  // Re-throw for NATS retry
        }
      },
      {
        queue: 'media-processors',
        durable: 'media-processor',
        maxRetries: 3,
        retryDelayMs: 2000,  // Exponential backoff handled by NATS
      }
    );
  }

  private getProcessorType(mediaType: string): 'transcription' | 'description' | 'extraction' {
    switch (mediaType) {
      case 'audio':
        return 'transcription';
      case 'image':
      case 'video':
        return 'description';
      case 'document':
        return 'extraction';
      default:
        return 'description';
    }
  }
}
```

## Event Replay

**Replay reads the journal, not a NATS stream.** `omni_events` outlives NATS
retention and carries a total order (`journal_seq`), so a replay session
selects journal rows by time/type/instance filters and re-publishes them to
the bus; the journal's unique idempotency key keeps a replayed event from
being journaled twice. Durable consumers (below) read the same journal for
resumable consumption — see the
[durable consumers runbook](../runbooks/durable-consumers.md).

Replay primitives live in `packages/core/src/events/replay.ts`; the API
drives sessions (one at a time, running in the background) via
`/api/v2/event-ops/replay`:

```typescript
// packages/core/src/events/replay.ts

export interface ReplayOptions {
  since: Date;               // Start timestamp (inclusive)
  until?: Date;              // End timestamp (exclusive)
  eventTypes?: string[];     // Event type filter
  instanceId?: string;       // Instance filter
  limit?: number;            // Max events to replay
  speedMultiplier?: number;  // 1 = real-time, 0 = instant
  skipProcessed?: boolean;   // Skip already-processed events
  dryRun?: boolean;          // Count without publishing
}
```

```bash
POST   /api/v2/event-ops/replay      # start a session (body: ReplayOptions)
GET    /api/v2/event-ops/replay      # list sessions
GET    /api/v2/event-ops/replay/:id  # session progress
DELETE /api/v2/event-ops/replay/:id  # cancel
```

## Causality & Tracing

Every published event can carry two lineage fields:

- **`correlationId`** (metadata) — groups an entire flow; root events
  self-reference.
- **`causationId`** (journal column) — the id of the event this one reacted
  to; the parent edge of the causality tree.

Propagation is **ambient** via `AsyncLocalStorage`
(`packages/core/src/events/causality.ts`). A consumer about to react wraps
its reaction in `runWithEventCausality`; the publish factory falls back to
the ambient context for whichever field the publish did not set explicitly:

```typescript
import { runWithEventCausality } from '@omni/core';

// Wrapped around automation runs and agent dispatch:
await runWithEventCausality(
  { correlationId: event.metadata?.correlationId, causationId: event.id },
  () => automationEngine.run(event),
);
```

Because `AsyncLocalStorage` follows the whole await chain, every publish the
reaction performs — however deep inside a channel plugin — is stamped without
threading parameters through every signature. Precedence: **explicit metadata
wins, then the ambient context, then self-reference** (roots).

Emissions made **outside** a reaction (a script, a CI step, a human) have no
ambient context and would become roots. `POST /api/v2/events/trigger` accepts
an explicit `causationId`, and `omni webhooks trigger --causation-id
<event-id>` sets it, so a mid-flow emission stays attached to the event it
answers:

```bash
omni webhooks trigger --type custom.deploy.finished \
  --payload '{"sha":"abc123"}' --causation-id <event-id>
```

Tracing surfaces:

- `GET /api/v2/events/:id/trace` — walks ancestors up to the root and
  descendants breadth-first (cycle-guarded, truncation-capped).
- `omni events trace <id>` — renders the same trace as an indented tree.

## Event Schema Registry

Payload contracts are persisted in the `event_schemas` table: `event_type`
(unique), a draft-07 JSON Schema stored as jsonb, a version, and an enabled
flag. The registry is **global**, not tenant-scoped.

```bash
# Register / revise a schema
POST /api/v2/events/schemas
omni events schema register custom.github.push --file schema.json
```

Revisions must be **additive-optional**: removing fields, tightening types,
or adding new required fields is incompatible and rejected with 409.

Enforcement runs at exactly **two gates**:

1. **Webhook ingress / manual trigger** — an invalid payload is dead-lettered
   with reason `schema_validation_failed` and the request fails with 400;
   nothing is journaled. An unregistered type passes, unless the source sets
   `strictSchemas` — then it is dead-lettered as `schema_not_registered`.
2. **Automation `emit_event`** — validated after the agent
   publishes-allowlist gate. Strict mode for unregistered types is opt-in via
   `OMNI_STRICT_EMIT_EVENT_SCHEMAS=true` (default off).

The bus itself is **ungated**: channel and core events are not schema-checked
at publish time — Zod types them in-process at the boundary
(`subscribeValidated()` above); the registry exists for payloads crossing in
from outside.

## Durable Named Consumers

> Operational guide: [durable consumers runbook](../runbooks/durable-consumers.md)

A durable consumer is a **Postgres-registered name with a cursor over the
journal** — a row in `durable_consumers`: `name` (unique), an `event_type`
filter (trailing-`*` prefix glob), `exclude_types` jsonb (globs dropped from
the stream, null = none), `filters` jsonb (payload conditions), and
a `cursor` bigint over `journal_seq`. These are **not NATS JetStream
durables** — NATS offsets live in `consumer_offsets`, a different table used
for gap detection.

Semantics:

- **At-least-once.** Pulls page strictly after the cursor, with optional
  long-poll; a client that crashes mid-page re-pulls the same page.
- **Ack is monotonic** — acking an older sequence never moves the cursor back.
- **Lag** = journal head − cursor.
- **One follower per name** — no consumer groups; fan out with more names.

Surfaces:

- REST: `/api/v2/events/consumers[...]`
- CLI: `omni events consumers create|ls|inspect|rm`,
  `omni events follow --consumer <name>` (tail + ack as you go), and the
  one-shot `omni events wait` (ephemeral, no registration).

### Filter Glob Semantics

Event-type filters are a **trailing-`*` prefix glob only** —
`custom.github.*` matches `custom.github.push`. This is not NATS wildcard
syntax (`>` and mid-token `*` are not supported). The glob works in
`events list`, `events stream`, `events wait`, and durable-consumer filters.
It is **not** supported in automation triggers (exact type match) or agent
event manifests (exact types only).

The same syntax drives **exclusion**: `--exclude <glob>` (repeatable) on
`events stream` / `events wait` / `events consumers create`, `excludeEventType`
on `GET /events`, and `excludeTypes` on consumer registration. Exclusion wins
over inclusion, so `--type "custom.*" --exclude "custom.chat.*"` keeps
application events without the housekeeping noise.

## Webhook Event Sources (External Ingress)

Rows in `webhook_sources` configure a public, auth-exempt endpoint:

```
POST /api/v2/webhooks/ingress/:source
```

Each source defines:

- **Signature verification** over the raw body — `hmac-sha256`, `hmac-sha1`,
  or `token-match`, with an optional signature prefix and a constant-time
  compare. Every verification failure returns the same 401.
- **Idempotency** via a per-source key template — default
  `{source}:{sha256(body)}`, with `{headers.<name>}` and `{payload.<path>}`
  placeholders. The key dedupes on the journal's unique idempotency index;
  duplicates return 200 with `{"duplicate": true}`.
- **Semantic typing** via `eventTypeMapping` — a header- or body-sourced
  value becomes `custom.<source>.<event>`.
- Optional **`strictSchemas`** (see the schema registry gates above).
- A **connector-liveness contract** — `expectedIntervalSeconds` plus
  `POST /api/v2/webhooks/:source/heartbeat`; a sweeper emits
  `system.connector.stalled` / `system.connector.recovered`.

GitHub and ClickUp are **config-only recipes** over this one generic
mechanism — no channel plugin involved. See
[[connector-contract|Connector Contract]],
[GitHub webhook source](../runbooks/github-webhook-source.md), and
[ClickUp webhook source](../runbooks/clickup-webhook-source.md).

## Agent Event Manifests & Governance

Agents declare their event surface in `agents.event_manifest` — `accepts`
and `publishes` lists of **exact** event types (no globs).

- **`publishes` is enforced at emit time**: an `emit_event` for an undeclared
  type is dead-lettered with reason `publish_not_declared`.
- **`accepts` is compiled into managed automations** (provenance tracked via
  `managed_by_agent_id`), so the wiring is data, not code.
- `omni agents graph` renders the resulting event topology.

See the [agent publish governance runbook](../runbooks/agent-publish-governance.md).

## Transactional Emissions on Automations

Automations with the `transactional_emissions` flag buffer their
`emit_event` actions per run and flush them **in order, only if the run
finishes with zero failed actions**. Each emission claims its journal row
with a deterministic idempotency key derived from
`(event, automation, actionIndex)`, so retries and redeliveries of the same
run skip already-journaled emissions. This is a journal-level claim, not a
database outbox table.

## Agent Usage & Cost

When a routed dispatch or an automation `call_agent` action completes, the
provider's usage is stamped on the journal row of the **event that woke the
agent** — no dedicated columns:

- `omni_events.metadata.agentUsage` = `{ providerId, runId, costUsd?,
  tokensIn?, tokensOut?, model? }` (`AgentUsageSchema` in `@omni/core`).
  Providers expose different surfaces: claude-code reports cost and model,
  Agno reports tokens and model, webhook/A2A/AG-UI report nothing — then
  nothing is stamped rather than a row of zeros.
- `omni_events.agent_latency_ms` = provider round-trip.

Cost per event type, agent, or chat is a plain aggregation over the JSONB
path, grouped by whatever the row already carries:

```sql
SELECT event_type, sum((metadata->'agentUsage'->>'costUsd')::numeric) AS cost_usd
FROM omni_events
WHERE metadata ? 'agentUsage'
GROUP BY event_type;
```

`GET /api/v2/events/analytics` returns the window's sum as `totalCostUsd`;
`omni events analytics` prints it. Streaming and turn-based dispatch are not
stamped (no provider result to read).

## Event Payload Storage

For debugging and compliance, event payloads are stored separately from the event metadata. This enables efficient queries while preserving full request/response data.

### Payload Table Schema

```typescript
// packages/db/src/schema.ts

export const eventPayloads = pgTable('event_payloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => omniEvents.id, { onDelete: 'cascade' }),

  // Stage in the processing pipeline
  stage: varchar('stage', { length: 50 }).notNull(),
  // Stages: 'webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error'

  // Compressed payload (gzip + base64)
  payloadCompressed: text('payload_compressed').notNull(),
  payloadSizeOriginal: integer('payload_size_original'),
  payloadSizeCompressed: integer('payload_size_compressed'),

  // Metadata
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  statusCode: integer('status_code'),  // HTTP status if applicable
  errorDetails: text('error_details'),

  // Content flags (for filtering without decompression)
  containsMedia: boolean('contains_media').notNull().default(false),
  containsBase64: boolean('contains_base64').notNull().default(false),

  // Indexes
}, (table) => ({
  eventIdIdx: index('event_payloads_event_id_idx').on(table.eventId),
  stageIdx: index('event_payloads_stage_idx').on(table.stage),
  timestampIdx: index('event_payloads_timestamp_idx').on(table.timestamp),
}));
```

### Compression Strategy

Payloads are compressed using gzip before storage:

```typescript
// packages/core/src/events/payload-store.ts

import { gzipSync, gunzipSync } from 'zlib';

export class PayloadStore {
  constructor(private db: Database) {}

  async storePayload(eventId: string, stage: string, payload: unknown): Promise<void> {
    const jsonString = JSON.stringify(payload);
    const originalSize = Buffer.byteLength(jsonString, 'utf8');

    // Compress with gzip
    const compressed = gzipSync(jsonString);
    const compressedBase64 = compressed.toString('base64');
    const compressedSize = compressed.length;

    // Detect content flags
    const containsMedia = this.hasMediaUrls(payload);
    const containsBase64 = jsonString.includes('base64') || jsonString.length > 10000;

    await this.db.insert(eventPayloads).values({
      eventId,
      stage,
      payloadCompressed: compressedBase64,
      payloadSizeOriginal: originalSize,
      payloadSizeCompressed: compressedSize,
      containsMedia,
      containsBase64,
    });
  }

  async getPayload(eventId: string, stage?: string): Promise<unknown[]> {
    const where = stage
      ? and(eq(eventPayloads.eventId, eventId), eq(eventPayloads.stage, stage))
      : eq(eventPayloads.eventId, eventId);

    const records = await this.db.query.eventPayloads.findMany({
      where,
      orderBy: [asc(eventPayloads.timestamp)],
    });

    return records.map(record => {
      const compressed = Buffer.from(record.payloadCompressed, 'base64');
      const decompressed = gunzipSync(compressed);
      return JSON.parse(decompressed.toString('utf8'));
    });
  }

  private hasMediaUrls(payload: unknown): boolean {
    const str = JSON.stringify(payload);
    return /https?:\/\/[^\s"]+\.(jpg|jpeg|png|gif|webp|mp4|mp3|ogg|pdf)/i.test(str);
  }
}
```

### Payload Stages

| Stage | Description | Typical Size |
|-------|-------------|--------------|
| `webhook_raw` | Raw webhook payload from channel | 1-50KB |
| `agent_request` | Request sent to agent API | 1-10KB |
| `agent_response` | Response from agent API | 1-100KB |
| `channel_send` | Payload sent to channel for delivery | 1-10KB |
| `error` | Error details when processing fails | 0.5-5KB |

### Retention Policy

Payloads follow a shorter retention than events:

```typescript
// Cleanup job - run daily
async function cleanupOldPayloads(db: Database, retentionDays = 14): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const result = await db
    .delete(eventPayloads)
    .where(lt(eventPayloads.timestamp, cutoff));

  return result.rowCount ?? 0;
}
```

| Data Type | Retention |
|-----------|-----------|
| Event metadata | 30-90 days (by stream) |
| Event payloads | 14 days |
| Dead letter payloads | 30 days |

### Query Patterns

```typescript
// Get all payloads for an event
const payloads = await payloadStore.getPayload(eventId);

// Get specific stage
const agentRequest = await payloadStore.getPayload(eventId, 'agent_request');

// Get events with large payloads (for debugging)
const largePayloads = await db.query.eventPayloads.findMany({
  where: gt(eventPayloads.payloadSizeOriginal, 50000),
  orderBy: [desc(eventPayloads.payloadSizeOriginal)],
  limit: 100,
});
```

---

## Dead Letter Queue

Failed events go to a dead letter queue for manual inspection:

```typescript
// packages/core/src/events/dead-letter.ts

export class DeadLetterHandler {
  constructor(
    private eventBus: EventBus,
    private db: Database
  ) {}

  async handleDeadLetter(event: OmniEvent, error: Error): Promise<void> {
    // Store in database for inspection
    await this.db.insert(deadLetterEvents).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      eventType: event.type,
      payload: event,
      error: error.message,
      stack: error.stack,
      createdAt: new Date(),
    });

    // Emit alert
    await this.eventBus.publish({
      type: 'system.dead_letter',
      payload: {
        eventId: event.id,
        eventType: event.type,
        error: error.message,
      },
    });
  }

  async retryDeadLetter(deadLetterId: string): Promise<void> {
    const record = await this.db.query.deadLetterEvents.findFirst({
      where: eq(deadLetterEvents.id, deadLetterId),
    });

    if (!record) {
      throw new Error(`Dead letter not found: ${deadLetterId}`);
    }

    // Re-publish original event
    await this.eventBus.publish(record.payload);

    // Mark as retried
    await this.db.update(deadLetterEvents)
      .set({ retriedAt: new Date() })
      .where(eq(deadLetterEvents.id, deadLetterId));
  }
}
```

## Monitoring

### Event Metrics

```typescript
// packages/core/src/events/metrics.ts

export class EventMetrics {
  private counters = new Map<string, number>();
  private latencies = new Map<string, number[]>();

  recordEvent(type: string): void {
    const count = this.counters.get(type) ?? 0;
    this.counters.set(type, count + 1);
  }

  recordLatency(type: string, ms: number): void {
    const latencies = this.latencies.get(type) ?? [];
    latencies.push(ms);
    // Keep last 1000
    if (latencies.length > 1000) latencies.shift();
    this.latencies.set(type, latencies);
  }

  getStats(): EventStats {
    const stats: EventStats = {};

    for (const [type, count] of this.counters) {
      const latencies = this.latencies.get(type) ?? [];
      stats[type] = {
        count,
        latencyP50: this.percentile(latencies, 50),
        latencyP95: this.percentile(latencies, 95),
        latencyP99: this.percentile(latencies, 99),
      };
    }

    return stats;
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[idx];
  }
}
```

### Grafana Dashboard Query Examples

```promql
# Events per second by type
rate(omni_events_total[5m])

# Processing latency p99
histogram_quantile(0.99, rate(omni_event_latency_bucket[5m]))

# Dead letter rate
rate(omni_dead_letters_total[5m])

# Consumer lag
omni_consumer_pending_messages
```
