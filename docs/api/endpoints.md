# API Endpoints Reference

> v2 is the primary API. v1 endpoints exist only for backward compatibility with the current UI during migration.

## API Versioning Strategy

```
/api/v2/*           ← PRIMARY - All new development
/api/v1/*           ← COMPATIBILITY LAYER - Maps to v2, for current UI
```

**Key Point:** We're building v2 from scratch. The v1 endpoints are thin wrappers that translate requests to v2 format, allowing the current React UI to work during migration.

```typescript
// v1 compatibility layer example
// packages/api/src/routes/v1/instances.ts

import { Hono } from 'hono';
import { v2 } from '../v2';

const v1Instances = new Hono();

// v1 endpoint maps to v2
v1Instances.get('/', async (c) => {
  // Current UI calls: GET /api/v1/instances
  // We translate and call v2
  const result = await v2.instances.list(c);

  // Transform response to v1 format if needed
  return c.json({
    items: result.items.map(transformToV1Format),
  });
});

// v1 uses instance name, v2 uses ID
v1Instances.get('/:name', async (c) => {
  const name = c.req.param('name');
  // Look up by name, return v1 format
  const instance = await v2.instances.getByName(name);
  return c.json(transformToV1Format(instance));
});
```

---

## Operations & Service Management

These are critical features for the UI - managing backend services and viewing logs.

### Service Management

```yaml
# List all services and their status
GET /api/v2/services
Response:
  items:
    - name: "omni-api"
      status: "running" | "stopped" | "error"
      pid: 12345
      uptime: 3600
      memory: 128000000
      cpu: 2.5
    - name: "nats"
      status: "running"
      ...

# Get single service status
GET /api/v2/services/:name
Response:
  name: "omni-api"
  status: "running"
  pid: 12345
  uptime: 3600
  memory: 128000000
  cpu: 2.5
  logs: [...]  # Last 100 lines

# Start a service
POST /api/v2/services/:name/start
Response:
  success: true
  status: "running"
  pid: 12345

# Stop a service
POST /api/v2/services/:name/stop
Response:
  success: true
  status: "stopped"

# Restart a service
POST /api/v2/services/:name/restart
Response:
  success: true
  status: "running"
  pid: 12346

# Restart all services
POST /api/v2/services/restart-all
Response:
  results:
    - name: "omni-api"
      success: true
    - name: "nats"
      success: true
```

### Real-Time Logs (WebSocket)

```yaml
# WebSocket endpoint for real-time logs
WS /api/v2/logs

# On connect, send subscription message:
{
  "type": "subscribe",
  "services": ["omni-api", "nats"],  # or ["*"] for all
  "level": "info",                    # "debug" | "info" | "warn" | "error"
  "tail": 100                         # Initial lines to send
}

# Server sends log entries:
{
  "type": "log",
  "service": "omni-api",
  "level": "info",
  "timestamp": "2025-01-29T12:00:00Z",
  "message": "Instance my-whatsapp connected",
  "metadata": {
    "instanceId": "abc123",
    "channel": "whatsapp-baileys"
  }
}

# Filter logs dynamically:
{
  "type": "filter",
  "services": ["omni-api"],
  "level": "error",
  "search": "connection"
}

# Unsubscribe:
{
  "type": "unsubscribe"
}
```

### REST Logs Endpoint (for non-WebSocket)

```yaml
# Get recent logs
GET /api/v2/logs
Query:
  - services: string[]   # Filter by service
  - level: string        # Minimum level
  - since: datetime      # Start time
  - until: datetime      # End time
  - search: string       # Text search
  - limit: number        # Max entries (default 500)
Response:
  items:
    - service: "omni-api"
      level: "info"
      timestamp: "2025-01-29T12:00:00Z"
      message: "Instance connected"
      metadata: {...}

# Get logs for specific service
GET /api/v2/services/:name/logs
Query:
  - level: string
  - since: datetime
  - limit: number
Response:
  items: [...]
```

---

## Onboarding Flow

The UI has an onboarding wizard for new setups.

### Onboarding Status

```yaml
# Get onboarding status
GET /api/v2/onboarding/status
Response:
  completed: false
  currentStep: "api_keys"
  steps:
    - id: "welcome"
      status: "completed"
    - id: "api_keys"
      status: "in_progress"
      data:
        groqConfigured: true
        geminiConfigured: false
        openaiConfigured: false
    - id: "first_instance"
      status: "pending"
    - id: "test_message"
      status: "pending"

# Complete a step
POST /api/v2/onboarding/steps/:stepId/complete
Body:
  data: {...}  # Step-specific data
Response:
  success: true
  nextStep: "first_instance"

# Skip onboarding
POST /api/v2/onboarding/skip
Response:
  success: true
```

### Onboarding Steps

1. **Welcome** - Introduction screen
2. **API Keys** - Configure media processing keys
3. **First Instance** - Create WhatsApp/Discord instance
4. **Connect** - QR code scan or OAuth
5. **Test Message** - Send a test message
6. **Complete** - Done!

---

## v2 Primary Endpoints

### Health & Info

```yaml
# Health check
GET /api/v2/health
Response:
  status: "healthy" | "degraded" | "unhealthy"
  version: "2.0.0"
  uptime: 86400
  timestamp: "2025-01-29T12:00:00Z"
  checks:
    database:
      status: "ok" | "error"
      latency: 5
    nats:
      status: "ok" | "error"
      streams: 6
    channels:
      whatsapp-baileys: "ok"
      discord: "ok"
  instances:
    total: 10
    connected: 8
    byChannel:
      whatsapp-baileys: 5
      discord: 3

# System info
GET /api/v2/info
Response:
  version: "2.0.0"
  environment: "production"
  uptime: 86400
  instances:
    total: 10
    connected: 8
  events:
    today: 1234
    total: 567890
```

### API Keys Management

Multiple API keys with scoped permissions and full audit trail.

```yaml
# List API keys
GET /api/v2/api-keys
Response:
  items:
    - id: "key-uuid"
      name: "Dashboard UI"
      prefix: "omni_sk_"     # First 8 chars shown
      suffix: "...a1b2"      # Last 4 chars shown
      scopes: ["*"]          # Full access
      instanceIds: null      # All instances
      createdAt: datetime
      lastUsedAt: datetime
      lastUsedIp: "192.168.1.1"
      expiresAt: datetime | null
      usageCount: 1234
    - id: "key-uuid-2"
      name: "Discord Bot"
      prefix: "omni_sk_"
      suffix: "...c3d4"
      scopes: ["messages:send", "instances:read"]
      instanceIds: ["discord-instance-1"]
      createdAt: datetime
      lastUsedAt: datetime
      expiresAt: "2025-12-31T23:59:59Z"

# Create API key
POST /api/v2/api-keys
Body:
  name: string              # Human-readable name
  scopes: string[]          # Permissions: "*", "instances:*", "messages:send", etc.
  instanceIds?: string[]    # Restrict to specific instances (null = all)
  expiresAt?: datetime      # Optional expiration
Response:
  id: string
  name: string
  key: string               # ONLY shown once on creation!
  scopes: string[]
  instanceIds: string[] | null
  createdAt: datetime
  expiresAt: datetime | null

# Get API key details
GET /api/v2/api-keys/:id
Response:
  id: string
  name: string
  prefix: string
  suffix: string
  scopes: string[]
  instanceIds: string[] | null
  createdAt: datetime
  lastUsedAt: datetime
  lastUsedIp: string
  expiresAt: datetime | null
  usageCount: number

# Update API key
PATCH /api/v2/api-keys/:id
Body:
  name?: string
  scopes?: string[]
  instanceIds?: string[]
  expiresAt?: datetime | null
Response: ApiKey

# Revoke API key
DELETE /api/v2/api-keys/:id
Response:
  success: true
  revokedAt: datetime

# Regenerate API key (creates new key, invalidates old)
POST /api/v2/api-keys/:id/regenerate
Response:
  id: string
  key: string              # New key value
  regeneratedAt: datetime

# Get API key audit log
GET /api/v2/api-keys/:id/audit
Query:
  - since: datetime
  - until: datetime
  - action: string[]       # "create", "use", "update", "regenerate"
  - limit: number
Response:
  items:
    - timestamp: datetime
      action: "use" | "create" | "update" | "regenerate" | "revoke"
      ip: string
      userAgent: string
      endpoint: string     # For "use" actions
      statusCode: number   # Response status
      metadata?: object
```

**Available Scopes:**
- `*` - Full access (admin)
- `instances:*` - All instance operations
- `instances:read` - Read instance info
- `instances:write` - Create/update instances
- `instances:delete` - Delete instances
- `messages:*` - All message operations
- `messages:send` - Send messages
- `messages:read` - Read message history
- `events:read` - Read events/traces
- `persons:*` - All identity operations
- `access:*` - Manage access rules
- `settings:*` - Manage settings
- `admin:*` - Admin operations (keys, services)

### Instances

```yaml
# List instances
GET /api/v2/instances
Query:
  - channel: string[]
  - status: string[]
  - limit: number
  - cursor: string
Response:
  items: Instance[]
  meta: { cursor, hasMore }

# Get instance
GET /api/v2/instances/:id
Response: Instance

# Create instance
POST /api/v2/instances
Body:
  name: string
  channel: ChannelType
  channelConfig?: object       # Channel-specific (see below)

  # Agent configuration
  agent?:
    providerId?: string        # Reference to shared provider
    apiUrl?: string            # Or inline config
    apiKey?: string
    agentId?: string
    timeout: number            # Default 60000
    streaming: boolean         # Default false

  # Messaging configuration
  messaging?:
    debounceMode: "disabled" | "fixed" | "randomized"  # Default "disabled"
    debounceMs?: number        # For "fixed" mode (default 1000)
    debounceMinMs?: number     # For "randomized" mode (default 500)
    debounceMaxMs?: number     # For "randomized" mode (default 2000)
    enableAutoSplit: boolean   # Split on \n\n (default true)
    splitDelayMinMs?: number   # Min delay between splits (default 300)
    splitDelayMaxMs?: number   # Max delay between splits (default 1000)
    usernamePrefix: boolean    # Prepend username to messages (default false)

  # Media processing configuration
  media?:
    processAudio: boolean      # Transcribe audio (default true)
    processImages: boolean     # Describe images (default true)
    processVideo: boolean      # Describe video (default false)
    processDocuments: boolean  # Extract documents (default true)
    processOnBlocked: boolean  # Process media even if sender blocked (default false)

Response: Instance

# Update instance
PATCH /api/v2/instances/:id
Body: Partial<InstanceConfig>
Response: Instance

# Delete instance
DELETE /api/v2/instances/:id
Response: { success: true }

# Get connection status
GET /api/v2/instances/:id/status
Response: ConnectionStatus

# Get QR code (WhatsApp)
GET /api/v2/instances/:id/qr
Response: { qr: string, expiresAt: datetime }

# Connect instance
POST /api/v2/instances/:id/connect
Response: ConnectionStatus

# Disconnect instance
POST /api/v2/instances/:id/disconnect
Response: { success: true }

# Restart instance
POST /api/v2/instances/:id/restart
Response: ConnectionStatus

# Logout instance (clear session, require re-auth)
POST /api/v2/instances/:id/logout
Response:
  success: true
  message: "Session cleared, re-authentication required"

# Update instance profile (name, picture, status)
PUT /api/v2/instances/:id/profile
Body:
  # WhatsApp profile fields
  name?: string           # Display name
  status?: string         # Status message/about
  picture?: string        # Base64 or URL

  # Discord bot profile fields
  username?: string       # Bot username
  avatar?: string         # Avatar URL or base64
  activity?:
    type: "playing" | "watching" | "listening" | "competing"
    text: string
Response:
  success: true
  profile:
    name: string
    picture?: string
    status?: string

# List supported channel types
GET /api/v2/instances/supported-channels
Response:
  items:
    - id: "whatsapp-baileys"
      name: "WhatsApp (Baileys)"
      description: "Unofficial WhatsApp via Baileys library"
      requiresQr: true
      supportsOAuth: false
      capabilities: [...]
    - id: "whatsapp-cloud"
      name: "WhatsApp Business Cloud"
      description: "Official WhatsApp Business API"
      requiresQr: false
      supportsOAuth: true
    - id: "discord"
      name: "Discord"
      description: "Discord bot integration"
      requiresQr: false
      supportsOAuth: true
```

### Messages

```yaml
# Send message
POST /api/v2/messages
Body:
  instanceId: string
  to: string
  text: string
  replyTo?: string
Response:
  messageId: string
  externalMessageId: string
  status: "sent"

# Send media
POST /api/v2/messages/media
Body:
  instanceId: string
  to: string
  type: "image" | "audio" | "video" | "document"
  url?: string
  base64?: string
  filename?: string
  caption?: string
  voiceNote?: boolean
Response: MessageResult

# Send reaction
POST /api/v2/messages/reaction
Body:
  instanceId: string
  to: string
  messageId: string
  emoji: string
Response: { success: true }

# Send sticker
POST /api/v2/messages/sticker
Body:
  instanceId: string
  to: string
  url?: string
  base64?: string
Response: MessageResult

# Send contact card
POST /api/v2/messages/contact
Body:
  instanceId: string
  to: string
  contact:
    name: string
    phone?: string
    email?: string
    organization?: string
Response: MessageResult

# Send location
POST /api/v2/messages/location
Body:
  instanceId: string
  to: string
  latitude: number
  longitude: number
  name?: string
  address?: string
Response: MessageResult
```

### Events

```yaml
# List events
GET /api/v2/events
Query:
  - channel: string[]
  - instanceId: string
  - personId: string
  - eventType: string[]
  - contentType: string[]
  - direction: "inbound" | "outbound"
  - since: datetime
  - until: datetime
  - search: string
  - limit: number
  - cursor: string
Response:
  items: Event[]
  meta: { cursor, hasMore, total }

# Get event
GET /api/v2/events/:id
Response: Event

# Timeline for person (cross-channel)
GET /api/v2/events/timeline/:personId
Query:
  - channels: string[]
  - since: datetime
  - until: datetime
  - limit: number
  - cursor: string
Response:
  personId: string
  items: TimelineEvent[]
  meta: { cursor, hasMore }

# Search events
POST /api/v2/events/search
Body:
  query?: string
  filters?: EventFilters
  format?: "full" | "summary" | "agent"
  limit?: number
Response:
  items: Event[]
  summary?: string
  asContext?: string

# Get events analytics summary
GET /api/v2/events/analytics
Query:
  - since: datetime        # Default: last 24 hours
  - until: datetime
  - instanceId: string
  - allTime: boolean       # Override date filter
Response:
  totalMessages: number
  successfulMessages: number
  failedMessages: number
  successRate: number      # Percentage
  avgProcessingTimeMs: number
  avgAgentTimeMs: number
  messageTypes:
    text: 500
    audio: 100
    image: 50
  errorStages:
    agent_request: 5
    channel_send: 2
  instances:
    my-whatsapp: 400
    my-discord: 250
  byHour:                  # For charts
    - hour: "2025-01-29T10:00:00Z"
      count: 45
      successRate: 98.2

# Get events by phone/platform user ID
GET /api/v2/events/by-sender/:senderId
Query:
  - limit: number
  - instanceId: string
Response:
  items: Event[]
  meta: { total, hasMore }

# Cleanup old events
DELETE /api/v2/events/cleanup
Query:
  - olderThanDays: number  # Required
  - dryRun: boolean        # Default true
Response:
  dryRun: boolean
  eventsToDelete: number
  cutoffDate: datetime
  deleted?: number         # Only if dryRun=false
```

### Persons (Identity)

```yaml
# Search persons
GET /api/v2/persons
Query:
  - search: string
  - limit: number
Response:
  items: Person[]

# Get person
GET /api/v2/persons/:id
Response: Person

# Get person presence
GET /api/v2/persons/:id/presence
Response:
  person: Person
  identities: PlatformIdentity[]
  summary:
    totalIdentities: number
    activeChannels: string[]
    totalMessages: number
    lastSeenAt: datetime
    firstSeenAt: datetime
  byChannel: Record<channel, ChannelPresence>

# Get person timeline
GET /api/v2/persons/:id/timeline
Query:
  - channels: string[]
  - since: datetime
  - until: datetime
  - limit: number
Response:
  items: TimelineEvent[]
  meta: { cursor, hasMore }

# Link identities
POST /api/v2/persons/link
Body:
  identityA: string
  identityB: string
Response: Person

# Unlink identity
POST /api/v2/persons/unlink
Body:
  identityId: string
  reason: string
Response:
  person: Person
  identity: PlatformIdentity

# Merge two persons into one
# All identities from source are transferred to target
# Source person is deleted, target person metadata is merged
POST /api/v2/persons/merge
Body:
  sourcePersonId: string    # Person to merge FROM (will be deleted)
  targetPersonId: string    # Person to merge INTO (will be kept)
  reason?: string           # Audit reason
Response:
  person: Person            # The merged target person
  mergedIdentityIds: string[]  # Identities that were transferred
  deletedPersonId: string   # The source person that was deleted
```

### Access Rules

```yaml
# List rules
GET /api/v2/access/rules
Query:
  - instanceId: string
  - type: "allow" | "deny"
Response:
  items: AccessRule[]

# Create rule
POST /api/v2/access/rules
Body:
  instanceId?: string
  type: "allow" | "deny"
  criteria: RuleCriteria
  priority: number
  action: RuleAction
Response: AccessRule

# Update rule
PATCH /api/v2/access/rules/:id
Body: Partial<AccessRule>
Response: AccessRule

# Delete rule
DELETE /api/v2/access/rules/:id
Response: { success: true }

# Check access
POST /api/v2/access/check
Body:
  instanceId: string
  platformUserId: string
  channel: string
Response:
  allowed: boolean
  rule?: AccessRule
  reason: string
```

### Settings

```yaml
# List settings
GET /api/v2/settings
Query:
  - category: string       # Filter by category
Response:
  items:
    - key: string
      value: any
      valueType: "string" | "integer" | "boolean" | "json" | "secret"
      category: string
      description?: string
      isSecret: boolean
      isRequired: boolean
      updatedAt: datetime

# Get setting
GET /api/v2/settings/:key
Response: Setting

# Set setting
PUT /api/v2/settings/:key
Body:
  value: any
  reason?: string          # Optional audit reason
Response: Setting

# Bulk update
PATCH /api/v2/settings
Body:
  settings: Record<string, any>
  reason?: string
Response:
  items: Setting[]

# Delete setting
DELETE /api/v2/settings/:key
Response:
  success: true

# Get setting change history
GET /api/v2/settings/:key/history
Query:
  - limit: number
  - since: datetime
Response:
  items:
    - oldValue: any
      newValue: any
      changedBy: string
      changedAt: datetime
      reason?: string
      ip?: string
```

### Channels

```yaml
# List available channels
GET /api/v2/channels
Response:
  items:
    - id: string
      name: string
      version: string
      capabilities: ChannelCapabilities

# Get channel info
GET /api/v2/channels/:id
Response: ChannelInfo
```

### Agent Providers

Reusable agent API configurations that can be shared across instances.

```yaml
# List providers
GET /api/v2/providers
Response:
  items: Provider[]

# Get provider
GET /api/v2/providers/:id
Response: Provider

# Create provider
POST /api/v2/providers
Body:
  name: string
  type: "agent_api" | "agno" | "custom"
  apiUrl: string
  apiKey?: string
  defaultTimeout: number
  defaultStreaming: boolean
  metadata?: object
Response: Provider

# Update provider
PATCH /api/v2/providers/:id
Body: Partial<Provider>
Response: Provider

# Delete provider
DELETE /api/v2/providers/:id
Response: { success: true }

# Health check provider
POST /api/v2/providers/:id/health
Response:
  healthy: boolean
  latency: number
  error?: string

# List agents from provider
GET /api/v2/providers/:id/agents
Response:
  items:
    - id: string
      name: string
      description?: string
```

### Chat & Contact Sync

Sync contacts and chat history from connected instances.

```yaml
# Trigger sync for instance
POST /api/v2/instances/:id/sync
Body:
  syncContacts: boolean
  syncChats: boolean
  syncMessages: boolean         # Sync message history
  since?: datetime              # For incremental sync (import from this date)
  until?: datetime              # For bounded sync (import until this date)

  # Discord-specific options
  discord?:
    guildIds?: string[]         # Sync specific guilds only (default: all guilds bot is in)
    channelIds?: string[]       # Sync specific channels only (default: all text channels)
    includeThreads?: boolean    # Include thread messages (default: false)
    includeForums?: boolean     # Include forum posts (default: false)
    maxMessagesPerChannel?: number  # Limit per channel (default: 1000)

  # WhatsApp-specific options
  whatsapp?:
    chatIds?: string[]          # Sync specific chats only (default: all chats)
    includeGroups?: boolean     # Include group chats (default: true)
    includeBroadcasts?: boolean # Include broadcast lists (default: false)
    maxMessagesPerChat?: number # Limit per chat (default: 500)

  # Processing options
  processMedia?: boolean        # Process media during sync (default: false - faster)
  batchSize?: number            # Messages per batch (default: 100)

Response:
  jobId: string
  status: "started"
  estimatedChats?: number
  estimatedMessages?: number

# Get sync status
GET /api/v2/instances/:id/sync/status
Response:
  lastSync: datetime
  contactsCount: number
  chatsCount: number
  messagesCount: number
  inProgress: boolean
  progress?: {
    current: number
    total: number
    stage: "contacts" | "chats" | "messages"
  }

# Start continuous sync job
POST /api/v2/instances/:id/sync/continuous
Body:
  intervalMs: number    # Sync interval (default 60000)
Response:
  jobId: string
  status: "running"

# Stop continuous sync
DELETE /api/v2/instances/:id/sync/continuous
Response: { success: true }

# List contacts for instance
GET /api/v2/instances/:id/contacts
Query:
  - search: string
  - limit: number
  - cursor: string
Response:
  items: Contact[]
  meta: { cursor, hasMore }

# List chats for instance
GET /api/v2/instances/:id/chats
Query:
  - search: string
  - limit: number
  - cursor: string
Response:
  items: Chat[]
  meta: { cursor, hasMore }

# Get chat messages
GET /api/v2/instances/:id/chats/:chatId/messages
Query:
  - limit: number
  - before: string      # Message ID cursor
  - after: string
Response:
  items: Message[]
  meta: { hasMore }

# Mark chat as read
PATCH /api/v2/instances/:id/chats/:chatId/mark-read
Response:
  success: true
  markedAt: datetime

# Mark specific message as read
PATCH /api/v2/instances/:id/messages/:messageId/mark-read
Response:
  success: true

# Get message media (download/decrypt if needed)
GET /api/v2/instances/:id/messages/:messageId/media
Response:
  base64: string           # Base64-encoded media content
  mimetype: string
  fileName?: string
  mediaStatus: "downloaded" | "pending" | "expired" | "error"
  source: "local" | "channel"  # Where it was fetched from

# Toggle media processing for a chat
PATCH /api/v2/instances/:id/chats/:chatId/processing
Query:
  - enabled: boolean       # true = process, false = skip
  - note?: string          # Reason (e.g., "Promotions group")
Response:
  chatId: string
  instanceId: string
  mediaProcessingEnabled: boolean
  note?: string
  name: string
  chatType: string

# Bulk toggle media processing for multiple chats
PATCH /api/v2/instances/:id/chats/processing/bulk
Body:
  chatIds: string[]
  enabled: boolean
  note?: string
Response:
  updatedCount: number
  updatedChatIds: string[]
  notFoundCount: number
  notFoundChatIds: string[]
```

### Recipient Validation

```yaml
# Validate if a recipient ID is valid on the platform
POST /api/v2/instances/:id/validate-recipient
Body:
  recipient: string     # Phone number, Discord user ID, etc.
Response:
  valid: boolean
  exists: boolean       # User exists on platform
  normalized: string    # Normalized recipient ID
  profile?:
    name?: string
    avatar?: string
```

### Instance Discovery

```yaml
# Discover existing sessions (WhatsApp Baileys)
POST /api/v2/instances/discover
Body:
  channel: "whatsapp-baileys"
  authPath?: string     # Custom auth path (default: ./data/auth/whatsapp)
Response:
  items:
    - sessionId: string
      phone: string
      name?: string
      connected: boolean
      lastSeen?: datetime
```

### Profile Management

```yaml
# Get profile picture
GET /api/v2/instances/:id/profile-picture/:platformUserId
Response:
  url: string
  cachedAt: datetime

# Update instance profile picture
POST /api/v2/instances/:id/profile-picture
Body:
  image: string         # Base64 or URL
Response:
  success: true
  url: string

# Fetch user profile
GET /api/v2/instances/:id/profile/:platformUserId
Response:
  platformUserId: string
  name: string
  about?: string
  profilePictureUrl?: string
  lastSeenAt?: datetime
```

### Batch Jobs

```yaml
# List batch jobs
GET /api/v2/batch-jobs
Query:
  - status: string[]
  - type: string[]
Response:
  items: BatchJob[]

# Get batch job
GET /api/v2/batch-jobs/:id
Response: BatchJob

# Create batch job (media reprocessing)
POST /api/v2/batch-jobs
Body:
  type: "media_reprocess"
  config:
    instanceId?: string
    since?: datetime
    until?: datetime
    mediaTypes: string[]
    overwrite: boolean
Response: BatchJob

# Cancel batch job
POST /api/v2/batch-jobs/:id/cancel
Response: BatchJob
```

---

## v1 Compatibility Layer

These endpoints exist **only** to support the current React UI during migration.

```
┌─────────────────────────────────────────────────────────────┐
│  Current UI                                                  │
│  (React)                                                     │
│       │                                                      │
│       ▼                                                      │
│  /api/v1/* ───────► Compatibility Layer ───────► /api/v2/*  │
│                     (thin wrapper)                           │
└─────────────────────────────────────────────────────────────┘
```

### v1 → v2 Mapping

| v1 Endpoint | v2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/instances` | `GET /api/v2/instances` | Direct mapping |
| `GET /api/v1/instances/:name` | `GET /api/v2/instances/:id` | Lookup by name → ID |
| `GET /api/v1/instances/:name/qr` | `GET /api/v2/instances/:id/qr` | Lookup by name |
| `POST /api/v1/instances/:name/send-text` | `POST /api/v2/messages` | Transform body |
| `GET /api/v1/traces` | `GET /api/v2/events` | Transform response |
| `GET /api/v1/users` | `GET /api/v2/persons` | Transform response |
| `GET /api/v1/settings` | `GET /api/v2/settings` | Direct mapping |

### Implementation Example

```typescript
// packages/api/src/routes/v1/compat.ts

import { Hono } from 'hono';
import { v2Router } from '../v2';

export const v1Compat = new Hono();

// Instance list - direct pass-through
v1Compat.get('/instances', async (c) => {
  return v2Router.request(new Request(`${c.req.url.replace('/v1/', '/v2/')}`));
});

// Instance by name - lookup required
v1Compat.get('/instances/:name', async (c) => {
  const name = c.req.param('name');
  const db = c.get('db');

  // Find instance by name
  const instance = await db.query.instances.findFirst({
    where: eq(instances.name, name),
  });

  if (!instance) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Return v1 format
  return c.json(toV1InstanceFormat(instance));
});

// Send message - transform request
v1Compat.post('/instances/:name/send-text', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json();

  // Find instance
  const instance = await findInstanceByName(name);

  // Call v2 with transformed body
  const result = await v2.messages.send({
    instanceId: instance.id,
    to: body.number,
    text: body.text,
  });

  // Return v1 format
  return c.json({
    key: { id: result.externalMessageId },
    status: result.status,
  });
});

// Traces → Events
v1Compat.get('/traces', async (c) => {
  const result = await v2.events.list(c.req.query());

  // Transform to v1 trace format
  return c.json({
    items: result.items.map(toV1TraceFormat),
    meta: result.meta,
  });
});

// Users → Persons
v1Compat.get('/users', async (c) => {
  const result = await v2.persons.search(c.req.query('search') ?? '');

  // Transform to v1 user format
  return c.json({
    items: result.map(toV1UserFormat),
  });
});

// Transform functions
function toV1InstanceFormat(instance: Instance) {
  return {
    ...instance,
    instance_name: instance.name,  // v1 used snake_case
    channel_type: instance.channel,
  };
}

function toV1TraceFormat(event: Event) {
  return {
    id: event.id,
    instance_name: event.instance?.name,
    sender_phone: event.sender?.platformUserId,
    message_type: event.contentType,
    message_text: event.textContent,
    audio_transcription: event.transcription,
    image_description: event.imageDescription,
    created_at: event.receivedAt,
    // ... more mappings
  };
}

function toV1UserFormat(person: Person) {
  return {
    id: person.id,
    name: person.displayName,
    phone_number: person.primaryPhone,
    email: person.primaryEmail,
    // ... more mappings
  };
}
```

---

## WebSocket Endpoints

### Event Stream

```yaml
WS /api/v2/ws/events

# Subscribe
{
  "type": "subscribe",
  "channels": ["message.received", "message.sent"],
  "filters": {
    "instanceId": "abc123"
  }
}

# Event received
{
  "type": "event",
  "event": {
    "type": "message.received",
    "payload": {...}
  }
}
```

### Instance Status Stream

```yaml
WS /api/v2/ws/instances

# Subscribe
{
  "type": "subscribe",
  "instances": ["abc123", "def456"]  # or ["*"] for all
}

# Status update
{
  "type": "status",
  "instanceId": "abc123",
  "status": "connected",
  "qr": "..."  # If waiting for QR
}
```

### Logs Stream

```yaml
WS /api/v2/ws/logs

# Subscribe (see above for full format)
{
  "type": "subscribe",
  "services": ["*"],
  "level": "info"
}
```

### Real-Time Chats Stream

This is a key feature for the UI - live updates in the chats view.

```yaml
WS /api/v2/ws/chats/:instanceId

# Subscribe to chat updates
{
  "type": "subscribe",
  "chatId": "123456@s.whatsapp.net",  # Optional: specific chat, or omit for all
  "includeTyping": true,
  "includePresence": true,
  "includeReadReceipts": true
}

# New message received
{
  "type": "message.new",
  "chatId": "123456@s.whatsapp.net",
  "message": {
    "id": "msg-uuid",
    "externalId": "ABCD1234",
    "sender": {
      "platformUserId": "123456@s.whatsapp.net",
      "displayName": "John Doe",
      "profilePicture": "https://..."
    },
    "content": {
      "type": "text",
      "text": "Hello!"
    },
    "timestamp": "2025-01-29T12:00:00Z",
    "status": "received"
  }
}

# Message status update (sent → delivered → read)
{
  "type": "message.status",
  "chatId": "123456@s.whatsapp.net",
  "messageId": "msg-uuid",
  "externalId": "ABCD1234",
  "status": "delivered",  # "sent" | "delivered" | "read" | "failed"
  "timestamp": "2025-01-29T12:00:01Z"
}

# Typing indicator
{
  "type": "chat.typing",
  "chatId": "123456@s.whatsapp.net",
  "isTyping": true,
  "user": {
    "platformUserId": "123456@s.whatsapp.net",
    "displayName": "John Doe"
  }
}

# Presence update (online/offline/last seen)
{
  "type": "chat.presence",
  "chatId": "123456@s.whatsapp.net",
  "presence": "online",  # "online" | "offline" | "composing" | "recording"
  "lastSeen": "2025-01-29T12:00:00Z"
}

# Read receipts (they read your message)
{
  "type": "chat.read",
  "chatId": "123456@s.whatsapp.net",
  "readUpTo": "msg-uuid",  # All messages up to this ID are read
  "timestamp": "2025-01-29T12:00:02Z"
}

# Message deleted/revoked
{
  "type": "message.deleted",
  "chatId": "123456@s.whatsapp.net",
  "messageId": "msg-uuid",
  "deletedFor": "everyone"  # "everyone" | "me"
}

# Message edited
{
  "type": "message.edited",
  "chatId": "123456@s.whatsapp.net",
  "messageId": "msg-uuid",
  "newContent": {
    "type": "text",
    "text": "Hello! (edited)"
  },
  "editedAt": "2025-01-29T12:01:00Z"
}

# Media processing complete (transcription ready)
{
  "type": "media.processed",
  "chatId": "123456@s.whatsapp.net",
  "messageId": "msg-uuid",
  "mediaId": "media-uuid",
  "result": {
    "type": "transcription",
    "content": "This is what they said in the audio...",
    "language": "en"
  }
}

# Unsubscribe from chat updates
{
  "type": "unsubscribe"
}
```

---

## MCP Server

Model Context Protocol server for Claude Code, Cursor, and other MCP clients.

```yaml
# Get MCP server status
GET /api/v2/mcp/status
Response:
  running: boolean
  port: number | null
  httpUrl?: string         # If running
  stdioAvailable: boolean
  clients:                 # Connected/configured clients
    - name: "claude-code"
      configured: true
      lastSeen?: datetime

# Start MCP server
POST /api/v2/mcp/start
Body:
  port?: number            # Default 8080
  host?: string            # Default 0.0.0.0
Response:
  success: true
  port: number
  httpUrl: string

# Stop MCP server
POST /api/v2/mcp/stop
Response:
  success: true
  stoppedAt: datetime

# Install MCP configuration for client
POST /api/v2/mcp/install
Body:
  client: "claude-code" | "cursor" | "custom"
  method: "http" | "stdio"
  configPath?: string      # For custom clients
Response:
  success: true
  configPath: string       # Where config was written
  instructions: string     # Human-readable next steps
```

---

## Webhooks

Inbound webhook handlers for channel events.

```yaml
# WhatsApp Baileys webhook
POST /api/v2/webhooks/whatsapp/:instanceId
Headers:
  x-webhook-secret: string   # Verify webhook authenticity
Body:
  event: string              # Event type from Baileys
  data: object               # Event payload
Response:
  received: true

# Discord webhook (alternative to gateway)
POST /api/v2/webhooks/discord/:instanceId
Headers:
  x-webhook-secret: string
Body:
  # Discord webhook payload
Response:
  received: true

# Generic channel webhook
POST /api/v2/webhooks/:channel/:instanceId
Headers:
  x-webhook-secret: string
Body:
  event: string
  data: object
Response:
  received: true
```

---

## Internal Endpoints

Localhost-only endpoints for service-to-service communication.

```yaml
# Get subprocess configuration (called by gateway)
GET /api/v2/_internal/subprocess-config
Restriction: localhost only
Response:
  databaseConnectionUri: string
  databaseProvider: "postgresql"
  authenticationApiKey: string

# Get channel startup info
GET /api/v2/_internal/channel-startup-info
Restriction: localhost only
Response:
  evolutionNeeded: boolean
  evolutionReason?: string
  discordNeeded: boolean
  discordReason?: string
  whatsappInstances: string[]
  discordInstances: string[]

# Internal health check
GET /api/v2/_internal/health
Restriction: localhost only
Response:
  status: "healthy"
  service: "omni-api"
```

---

### React Hook for Real-Time Chats

```typescript
// hooks/useRealtimeChat.ts

export function useRealtimeChat(instanceId: string, chatId?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE_URL}/chats/${instanceId}`);

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({
        type: 'subscribe',
        chatId,
        includeTyping: true,
        includePresence: true,
        includeReadReceipts: true,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message.new':
          setMessages(prev => [...prev, data.message]);
          break;

        case 'message.status':
          setMessages(prev => prev.map(m =>
            m.id === data.messageId
              ? { ...m, status: data.status }
              : m
          ));
          break;

        case 'chat.typing':
          setTyping(prev => ({
            ...prev,
            [data.user.platformUserId]: data.isTyping
          }));
          break;

        case 'chat.presence':
          setPresence(prev => ({
            ...prev,
            [data.chatId]: {
              status: data.presence,
              lastSeen: data.lastSeen
            }
          }));
          break;

        case 'media.processed':
          setMessages(prev => prev.map(m =>
            m.id === data.messageId
              ? { ...m, processedMedia: data.result }
              : m
          ));
          break;
      }
    };

    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, [instanceId, chatId]);

  return { messages, typing, presence, connected };
}
```
