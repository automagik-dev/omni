# Event System

> The event system is the nervous system of Omni v2. Every action produces events, events trigger reactions, and events are persisted for audit and replay.

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

## NATS JetStream

We use NATS JetStream as our event bus:

- **Lightweight** - Single binary, <20MB memory
- **Persistent** - Events survive restarts
- **Exactly-once** - No duplicate processing
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
  | 'reaction'
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
   * Subscribe with automatic JSON schema validation.
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

## Event Handlers

### Example: Identity Resolution Handler

```typescript
// packages/core/src/identity/handler.ts

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
// packages/core/src/media/handler.ts

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

Events can be replayed for debugging or reprocessing:

```typescript
// packages/core/src/events/replay.ts

export class EventReplayer {
  constructor(private eventBus: EventBus) {}

  /**
   * Replay events from a specific time range.
   */
  async replay(options: {
    stream: string;
    startTime: Date;
    endTime?: Date;
    filter?: (event: OmniEvent) => boolean;
    handler: (event: OmniEvent) => Promise<void>;
  }): Promise<ReplayResult> {
    const { stream, startTime, endTime, filter, handler } = options;

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    const consumer = await this.eventBus.getReplayConsumer(stream, startTime);

    for await (const msg of consumer) {
      const event = JSON.parse(msg.data) as OmniEvent;
      const eventTime = new Date(event.timestamp);

      // Check end time
      if (endTime && eventTime > endTime) {
        break;
      }

      // Apply filter
      if (filter && !filter(event)) {
        skipped++;
        continue;
      }

      try {
        await handler(event);
        processed++;
      } catch (error) {
        console.error(`Replay error for event ${event.id}:`, error);
        errors++;
      }
    }

    return { processed, skipped, errors };
  }

  /**
   * Replay a specific event by ID.
   */
  async replayEvent(eventId: string): Promise<void> {
    const event = await this.eventBus.getEventById(eventId);
    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    // Re-publish with original timestamp
    await this.eventBus.publish({
      ...event,
      id: crypto.randomUUID(),  // New ID
      replayOf: eventId,        // Link to original
    });
  }
}
```

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
