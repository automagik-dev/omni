# API Design

> The Omni v2 API is designed to be familiar to v1 users while adding new capabilities. It provides both REST endpoints for external use and tRPC for type-safe internal/SDK use.

## Design Principles

1. **Backward Compatible** - v1 endpoints still work
2. **Type-Safe** - tRPC for SDK, Zod for REST validation
3. **Consistent** - Same patterns across all resources
4. **LLM-Friendly** - Structured responses, clear error messages
5. **Performant** - Pagination, filtering, sparse fieldsets

## API Structure

```
/api/v1/                      # REST API (v1 compatible)
├── instances/                # Instance management
├── messages/                 # Send/receive messages
├── events/                   # Event queries (new)
├── persons/                  # Identity management (new)
├── access/                   # Access rules
├── settings/                 # Global settings
└── webhooks/                 # Webhook configuration

/trpc/                        # tRPC API (SDK use)
├── instances.*
├── messages.*
├── events.*
├── persons.*
└── ...

/webhook/                     # Incoming webhooks from channels
├── whatsapp-baileys/:id
├── whatsapp-cloud
├── discord
└── slack
```

## Authentication

All API requests require the `x-api-key` header:

```bash
curl -H "x-api-key: omni_sk_..." https://api.example.com/api/v2/instances
```

### Multiple API Keys with Scoped Permissions

Omni supports multiple API keys with granular permissions and full audit logging:

```typescript
// API Key structure
interface ApiKey {
  id: string;
  name: string;                    // Human-readable name
  keyPrefix: string;               // First 8 chars (for display)
  keySuffix: string;               // Last 4 chars (for display)
  scopes: string[];                // Permissions
  instanceIds: string[] | null;    // Restrict to instances (null = all)
  expiresAt: Date | null;          // Optional expiration
  createdAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  usageCount: number;
}
```

**Key Types:**
- **Admin keys** (`["*"]`) - Full access to all operations
- **Instance-scoped keys** - Restricted to specific instances
- **Read-only keys** (`["instances:read", "events:read"]`) - Query only
- **Send-only keys** (`["messages:send"]`) - Send messages, nothing else
- **Time-limited keys** - Auto-expire after set date

**Available Scopes:**
| Scope | Description |
|-------|-------------|
| `*` | Full admin access |
| `instances:*` | All instance operations |
| `instances:read` | Read instance info |
| `instances:write` | Create/update instances |
| `instances:delete` | Delete instances |
| `messages:*` | All message operations |
| `messages:send` | Send messages only |
| `messages:read` | Read message history |
| `events:read` | Read events/traces |
| `persons:*` | Identity management |
| `access:*` | Access rule management |
| `settings:*` | Settings management |
| `admin:*` | Admin operations (keys, services) |

**Audit Logging:**
Every API key usage is logged with:
- Timestamp
- Endpoint called
- IP address
- User agent
- Response status code

See `GET /api/v2/api-keys/:id/audit` for audit log access.

## Common Patterns

### Request Format

```typescript
// Query parameters (GET)
GET /api/v1/events?channel=whatsapp&limit=50&cursor=xxx

// JSON body (POST/PUT/PATCH)
POST /api/v1/messages
Content-Type: application/json
{
  "instanceId": "...",
  "to": "+1234567890",
  "text": "Hello!"
}
```

### Response Format

All responses follow this structure:

```typescript
// Success
{
  "data": { ... },           // For single resource
  "items": [ ... ],          // For collections
  "meta": {
    "total": 100,
    "cursor": "...",
    "hasMore": true
  }
}

// Error
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid phone number format",
    "details": {
      "field": "to",
      "received": "1234",
      "expected": "E.164 format"
    }
  }
}
```

### Pagination

Cursor-based pagination for all list endpoints:

```typescript
// First page
GET /api/v1/events?limit=50

// Response
{
  "items": [...],
  "meta": {
    "cursor": "eyJpZCI6IjEyMyIsInRzIjoiMjAyNS0wMS0wMSJ9",
    "hasMore": true
  }
}

// Next page
GET /api/v1/events?limit=50&cursor=eyJpZCI6IjEyMyIsInRzIjoiMjAyNS0wMS0wMSJ9
```

### Filtering

Standard filter parameters:

```typescript
GET /api/v1/events
  ?channel=whatsapp,discord     // Multiple values
  &since=2025-01-01T00:00:00Z   // ISO 8601
  &until=2025-01-31T23:59:59Z
  &contentType=text,audio
  &personId=uuid
  &instanceId=uuid
  &limit=50
  &cursor=xxx
```

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `FORBIDDEN` | 403 | Key lacks permission |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `RATE_LIMITED` | 429 | Too many requests |
| `CHANNEL_ERROR` | 502 | Channel (WhatsApp/Discord) error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## REST Endpoints

### Instances

```yaml
# List instances
GET /api/v1/instances
Query:
  - channel: string[]  # Filter by channel type
  - status: string[]   # Filter by status
  - limit: number
  - cursor: string
Response: { items: Instance[], meta: PaginationMeta }

# Get instance
GET /api/v1/instances/:id
Response: { data: Instance }

# Create instance
POST /api/v1/instances
Body:
  - name: string (required)
  - channel: ChannelType (required)
  - channelConfig: object
  - agent: AgentConfig
  - messaging: MessagingConfig
  - media: MediaConfig
Response: { data: Instance }

# Update instance
PATCH /api/v1/instances/:id
Body: Partial<InstanceConfig>
Response: { data: Instance }

# Delete instance
DELETE /api/v1/instances/:id
Response: { success: true }

# Get instance status
GET /api/v1/instances/:id/status
Response: { data: ConnectionStatus }

# Get QR code (WhatsApp)
GET /api/v1/instances/:id/qr
Response: { data: { qr: string, expiresAt: string } }

# Restart instance
POST /api/v1/instances/:id/restart
Response: { data: ConnectionStatus }

# Logout instance
POST /api/v1/instances/:id/logout
Response: { success: true }
```

### Messages

```yaml
# Send text message
POST /api/v1/messages
Body:
  - instanceId: string (required)
  - to: string (required)  # Phone number or platform ID
  - text: string (required)
  - replyTo?: string       # Message ID to reply to
Response: {
  data: {
    messageId: string,
    externalMessageId: string,
    status: 'sent'
  }
}

# Send media
POST /api/v1/messages/media
Body:
  - instanceId: string (required)
  - to: string (required)
  - mediaType: 'image' | 'audio' | 'video' | 'document'
  - mediaUrl?: string      # URL to fetch
  - mediaBase64?: string   # Or base64 encoded
  - filename?: string
  - caption?: string
  - voiceNote?: boolean    # For audio
Response: { data: MessageResult }

# Send reaction
POST /api/v1/messages/reaction
Body:
  - instanceId: string (required)
  - to: string (required)
  - messageId: string (required)  # Message to react to
  - emoji: string (required)
Response: { success: true }

# Get message by ID
GET /api/v1/messages/:id
Response: { data: Message }
```

### Events (New in v2)

```yaml
# List events
GET /api/v1/events
Query:
  - channel: string[]
  - instanceId: string
  - personId: string
  - eventType: string[]
  - contentType: string[]
  - since: datetime
  - until: datetime
  - search: string         # Full-text search
  - limit: number
  - cursor: string
Response: { items: Event[], meta: PaginationMeta }

# Get event by ID
GET /api/v1/events/:id
Response: { data: Event }

# Get event timeline for a person (cross-channel)
GET /api/v1/events/timeline/:personId
Query:
  - channels: string[]
  - since: datetime
  - until: datetime
  - limit: number
Response: {
  personId: string,
  channels: string[],
  items: TimelineEvent[],
  meta: PaginationMeta
}

# Search events (advanced)
POST /api/v1/events/search
Body:
  - query?: string          # Natural language query
  - filters?: EventFilters
  - format?: 'full' | 'summary' | 'agent'
  - limit?: number
Response: {
  items: Event[],
  summary?: string,        # If format=agent
  asContext?: string       # LLM-friendly format
}
```

### Persons (Identity - New in v2)

```yaml
# Search persons
GET /api/v1/persons
Query:
  - search: string         # Name, email, or phone
  - limit: number
Response: { items: Person[], meta: PaginationMeta }

# Get person by ID
GET /api/v1/persons/:id
Response: { data: Person }

# Get person presence (all identities)
GET /api/v1/persons/:id/presence
Response: {
  data: {
    person: Person,
    identities: PlatformIdentity[],
    summary: {
      totalIdentities: number,
      activeChannels: string[],
      totalMessages: number,
      lastSeenAt: datetime,
      firstSeenAt: datetime
    },
    byChannel: Record<string, ChannelPresence>
  }
}

# Get person timeline (cross-channel messages)
GET /api/v1/persons/:id/timeline
Query:
  - channels: string[]
  - since: datetime
  - until: datetime
  - limit: number
  - cursor: string
Response: { items: TimelineEvent[], meta: PaginationMeta }

# Link two identities
POST /api/v1/persons/link
Body:
  - identityA: string (required)
  - identityB: string (required)
Response: { data: Person }

# Unlink identity
POST /api/v1/persons/unlink
Body:
  - identityId: string (required)
  - reason: string (required)
Response: { data: { person: Person, identity: Identity } }
```

### Access Rules

```yaml
# List access rules
GET /api/v1/access/rules
Query:
  - instanceId: string     # Filter by instance
  - type: 'allow' | 'deny'
Response: { items: AccessRule[] }

# Create rule
POST /api/v1/access/rules
Body:
  - instanceId?: string    # null = global
  - type: 'allow' | 'deny'
  - criteria: RuleCriteria
  - priority: number
  - action: RuleAction
Response: { data: AccessRule }

# Update rule
PATCH /api/v1/access/rules/:id
Body: Partial<AccessRule>
Response: { data: AccessRule }

# Delete rule
DELETE /api/v1/access/rules/:id
Response: { success: true }

# Check access (test)
POST /api/v1/access/check
Body:
  - instanceId: string
  - platformUserId: string
  - channel: string
Response: {
  data: {
    allowed: boolean,
    rule?: AccessRule,
    reason: string
  }
}
```

### Settings

```yaml
# List settings
GET /api/v1/settings
Response: { items: Setting[] }

# Get setting
GET /api/v1/settings/:key
Response: { data: Setting }

# Update setting
PUT /api/v1/settings/:key
Body:
  - value: any
Response: { data: Setting }

# Update multiple settings
PATCH /api/v1/settings
Body:
  - settings: Record<string, any>
Response: { data: Setting[] }
```

### Channels (New in v2)

```yaml
# List available channels
GET /api/v1/channels
Response: {
  items: {
    id: string,
    name: string,
    version: string,
    capabilities: ChannelCapabilities
  }[]
}

# Get channel info
GET /api/v1/channels/:id
Response: { data: ChannelInfo }
```

## tRPC Router

For SDK and internal use, tRPC provides end-to-end type safety:

```typescript
// packages/api/src/trpc/router.ts

import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.context<Context>().create();

export const appRouter = t.router({
  instances: t.router({
    list: t.procedure
      .input(z.object({
        channel: z.array(z.string()).optional(),
        status: z.array(z.string()).optional(),
        limit: z.number().default(50),
        cursor: z.string().optional(),
      }))
      .query(async ({ input, ctx }) => {
        // Implementation
      }),

    get: t.procedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        // Implementation
      }),

    create: t.procedure
      .input(instanceCreateSchema)
      .mutation(async ({ input, ctx }) => {
        // Implementation
      }),

    // ... more procedures
  }),

  messages: t.router({
    send: t.procedure
      .input(z.object({
        instanceId: z.string().uuid(),
        to: z.string(),
        text: z.string(),
        replyTo: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Implementation
      }),

    sendMedia: t.procedure
      .input(sendMediaSchema)
      .mutation(async ({ input, ctx }) => {
        // Implementation
      }),
  }),

  events: t.router({
    list: t.procedure
      .input(eventListSchema)
      .query(async ({ input, ctx }) => {
        // Implementation
      }),

    timeline: t.procedure
      .input(z.object({
        personId: z.string().uuid(),
        channels: z.array(z.string()).optional(),
        since: z.string().datetime().optional(),
        until: z.string().datetime().optional(),
        limit: z.number().default(50),
      }))
      .query(async ({ input, ctx }) => {
        // Implementation
      }),
  }),

  persons: t.router({
    search: t.procedure
      .input(z.object({ query: z.string().min(2) }))
      .query(async ({ input, ctx }) => {
        // Implementation
      }),

    presence: t.procedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        // Implementation
      }),

    link: t.procedure
      .input(z.object({
        identityA: z.string().uuid(),
        identityB: z.string().uuid(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Implementation
      }),
  }),
});

export type AppRouter = typeof appRouter;
```

## WebSocket API

Real-time updates via WebSocket:

```typescript
// Connect
const ws = new WebSocket('wss://api.example.com/ws?apiKey=sk-...');

// Subscribe to events
ws.send(JSON.stringify({
  type: 'subscribe',
  channels: ['events', 'instances'],
  filters: {
    instanceId: '...',  // Optional
  }
}));

// Receive events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // {
  //   type: 'event',
  //   channel: 'events',
  //   payload: { ... }
  // }
};

// Unsubscribe
ws.send(JSON.stringify({
  type: 'unsubscribe',
  channels: ['events']
}));
```

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Messages (send) | 60 | 1 minute |
| Events (list) | 100 | 1 minute |
| Instances (CRUD) | 30 | 1 minute |
| General | 1000 | 1 minute |

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1706745600
```

## Versioning

The API uses URL versioning:
- `/api/v1/` - Current stable
- `/api/v2/` - Future (when breaking changes needed)

Breaking changes will be announced 6 months in advance.
