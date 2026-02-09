---
title: "Architecture Overview"
created: 2025-01-29
updated: 2026-02-09
tags: [architecture, overview]
status: current
---

# Architecture Overview

> Omni v2 is built on event-driven, plugin-based architecture designed for extensibility, reliability, and AI-native consumption.

> Related: [[event-system|Event System]], [[plugin-system|Plugin System]], [[identity-graph|Identity Graph]], [[provider-system|Provider System]]

## Design Principles

### 1. Event Sourcing Hybrid
- All state changes are captured as events
- Events are the source of truth for audit/replay
- Materialized views provide fast queries
- Can rebuild state from events if needed

### 2. Plugin-First Channels
- Channels are external plugins, not core code
- Adding a channel requires zero core changes
- Plugins communicate via event bus only
- Each plugin is independently deployable

### 3. Identity as First-Class Citizen
- Users have a stable identity across all platforms
- One person = one `Person` entity, multiple `PlatformIdentity` records
- Cross-channel queries are native ("show everything from Mom")

### 4. Type Safety End-to-End
- TypeScript everywhere (no Python/JS split)
- Drizzle ORM for type-safe database access
- tRPC for type-safe API calls
- Zod for runtime validation

## System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 CLIENTS                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Dashboard  │  │   Omni SDK  │  │  Omni CLI   │  │  MCP Tools  │        │
│  │  (React)    │  │ (TypeScript)│  │   (LLM)     │  │  (Claude)   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               API LAYER                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Hono HTTP Server                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │  REST API   │  │  tRPC API   │  │  WebSocket  │  │  Webhooks   │  │  │
│  │  │ /api/v1/*   │  │  /trpc/*    │  │   /ws/*     │  │ /webhook/*  │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      Middleware Layer                                  │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │  │
│  │  │  Auth   │  │  Rate   │  │  CORS   │  │ Logging │  │ Tracing │    │  │
│  │  │         │  │  Limit  │  │         │  │         │  │         │    │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             EVENT BUS (NATS)                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Streams: MESSAGES | IDENTITY | MEDIA | AGENT | ACCESS | CHANNEL      │  │
│  │  Features: Persistence | Exactly-once | Replay | Key-Value Store      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└───────────┬───────────────────┬───────────────────┬───────────────────┬─────┘
            │                   │                   │                   │
            ▼                   ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐ ┌───────────┐
│  IDENTITY SERVICE │ │  ACCESS CONTROL   │ │  MEDIA PIPELINE   │ │  AGENT    │
│  ┌─────────────┐  │ │  ┌─────────────┐  │ │  ┌─────────────┐  │ │  ROUTER   │
│  │   Person    │  │ │  │ Rule Engine │  │ │  │ Transcribe  │  │ │           │
│  │   Graph     │  │ │  │ Allow/Deny  │  │ │  │ Describe    │  │ │  Route to │
│  │   Resolve   │  │ │  │ Rate Limit  │  │ │  │ Extract     │  │ │  Agent    │
│  │   Merge     │  │ │  │ Schedule    │  │ │  │ Store       │  │ │  APIs     │
│  └─────────────┘  │ │  └─────────────┘  │ │  └─────────────┘  │ │           │
└───────────────────┘ └───────────────────┘ └───────────────────┘ └───────────┘
            │                   │                   │                   │
            └───────────────────┴───────────────────┴───────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHANNEL MANAGER                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Plugin Registry | Connection Pool | Health Monitoring | Load Balance │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │WhatsApp │ │WhatsApp │ │ Discord │ │  Slack  │ │Telegram │ │ Custom  │  │
│  │Baileys  │ │ Cloud   │ │         │ │         │ │         │ │         │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             DATA LAYER                                       │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐    │
│  │      PostgreSQL (Drizzle)      │  │    NATS KV (Session State)     │    │
│  │  ┌──────────┐  ┌──────────┐   │  │  ┌──────────┐  ┌──────────┐   │    │
│  │  │ Events   │  │ Identity │   │  │  │ Sessions │  │ QR Codes │   │    │
│  │  │ Instances│  │ Access   │   │  │  │ Presence │  │ Temp     │   │    │
│  │  │ Settings │  │ Media    │   │  │  │ Typing   │  │ State    │   │    │
│  │  └──────────┘  └──────────┘   │  │  └──────────┘  └──────────┘   │    │
│  └────────────────────────────────┘  └────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Request Flow

### Inbound Message Flow

```
1. Webhook Received (WhatsApp/Discord/etc.)
         │
         ▼
2. Channel Plugin Normalizes Payload
   └─► Converts platform-specific format to normalized event
         │
         ▼
3. Event Published: message.received
   └─► NATS JetStream persists event
         │
         ├─────────────────────────────────────────┐
         │                                         │
         ▼                                         ▼
4. Identity Service                        5. Access Control
   └─► Resolves/creates Person               └─► Checks allow/deny rules
   └─► Links PlatformIdentity                └─► Emits: access.checked
   └─► Emits: identity.resolved                    │
         │                                         │
         └─────────────┬───────────────────────────┘
                       │
                       ▼ (if allowed)
6. Media Pipeline (if has media)
   └─► Downloads media
   └─► Transcribes audio (Groq/OpenAI)
   └─► Describes images (Gemini/OpenAI)
   └─► Emits: media.processed
         │
         ▼
7. Agent Router
   └─► Enriches message with transcriptions
   └─► Builds conversation history
   └─► Calls agent API
   └─► Emits: agent.response
         │
         ▼
8. Response Handler
   └─► Splits message if needed
   └─► Formats for platform
   └─► Sends via Channel Plugin
   └─► Emits: message.sent
         │
         ▼
9. Trace Updated
   └─► Event marked completed
   └─► Metrics recorded
```

### Outbound Message Flow (API/CLI)

```
1. API Request: POST /api/v1/messages
         │
         ▼
2. Validation & Auth
   └─► Validates payload (Zod)
   └─► Verifies API key
         │
         ▼
3. Identity Resolution
   └─► Finds or creates Person for recipient
   └─► Resolves PlatformIdentity
         │
         ▼
4. Event Published: message.sending
         │
         ▼
5. Channel Plugin
   └─► Formats for platform
   └─► Sends via platform API
   └─► Returns message ID
         │
         ▼
6. Event Published: message.sent
   └─► Includes external message ID
   └─► Triggers status webhooks
```

## Package Structure

```
packages/
├── core/                          # Core domain logic
│   ├── src/
│   │   ├── events/               # Event bus, types, streams
│   │   │   ├── bus.ts            # NATS JetStream wrapper
│   │   │   ├── types.ts          # Event type definitions
│   │   │   └── streams.ts        # Stream configuration
│   │   │
│   │   ├── identity/             # Identity graph
│   │   │   ├── service.ts        # IdentityService
│   │   │   ├── resolver.ts       # Identity resolution logic
│   │   │   └── merger.ts         # Identity merging
│   │   │
│   │   ├── access/               # Access control
│   │   │   ├── service.ts        # AccessControlService
│   │   │   ├── rules.ts          # Rule engine
│   │   │   └── patterns.ts       # Pattern matching
│   │   │
│   │   ├── media/                # Media processing
│   │   │   ├── pipeline.ts       # Processing orchestration
│   │   │   ├── processors/       # Processor implementations
│   │   │   │   ├── whisper.ts    # Audio transcription
│   │   │   │   ├── gemini.ts     # Image/video description
│   │   │   │   └── document.ts   # Document extraction
│   │   │   └── storage.ts        # Media storage
│   │   │
│   │   ├── router/               # Message routing
│   │   │   ├── router.ts         # MessageRouter
│   │   │   ├── agent-client.ts   # Agent API client
│   │   │   └── splitter.ts       # Message splitting
│   │   │
│   │   ├── oauth/                # OAuth management
│   │   │   ├── manager.ts        # OAuthManager
│   │   │   └── providers/        # Provider implementations
│   │   │
│   │   └── db/                   # Database
│   │       ├── schema.ts         # Drizzle schema
│   │       ├── migrations/       # SQL migrations
│   │       └── client.ts         # Database client
│   │
│   └── package.json
│
├── api/                           # HTTP API
│   ├── src/
│   │   ├── routes/               # Route handlers
│   │   │   ├── instances.ts      # Instance CRUD
│   │   │   ├── messages.ts       # Message operations
│   │   │   ├── events.ts         # Event queries
│   │   │   ├── identity.ts       # Identity management
│   │   │   ├── access.ts         # Access rules
│   │   │   ├── settings.ts       # Global settings
│   │   │   └── webhooks.ts       # Webhook receivers
│   │   │
│   │   ├── trpc/                 # tRPC router
│   │   │   ├── router.ts         # Main router
│   │   │   └── procedures/       # Procedure definitions
│   │   │
│   │   ├── middleware/           # Middleware
│   │   │   ├── auth.ts           # API key auth
│   │   │   ├── rate-limit.ts     # Rate limiting
│   │   │   └── logging.ts        # Request logging
│   │   │
│   │   ├── websocket/            # WebSocket handlers
│   │   │   ├── server.ts         # WS server
│   │   │   └── handlers.ts       # Event handlers
│   │   │
│   │   └── index.ts              # Server entry point
│   │
│   └── package.json
│
├── channel-sdk/                   # Plugin SDK
│   ├── src/
│   │   ├── types.ts              # Plugin interfaces
│   │   ├── base-plugin.ts        # Base class
│   │   ├── normalizer.ts         # Normalizer interface
│   │   ├── testing/              # Test utilities
│   │   └── index.ts              # Public API
│   │
│   └── package.json
│
├── channel-whatsapp/               # WhatsApp (Baileys)
├── channel-discord/               # Discord
│
├── db/                            # Database package (Drizzle schema + migrations)
│   └── package.json
│
├── media-processing/              # Media handling (transcription, vision, extraction)
│   └── package.json
│
├── sdk/                           # Auto-generated TypeScript SDK
│   └── package.json
│
├── sdk-go/                        # Go SDK
│   └── go.mod
│
├── sdk-python/                    # Python SDK
│   └── pyproject.toml
│
└── cli/                           # LLM-optimized CLI
    ├── src/
    │   ├── commands/             # Command implementations
    │   └── index.ts              # CLI entry point
    │
    └── package.json
```

## Configuration

### Environment Variables

```bash
# Server
OMNI_HOST=0.0.0.0
OMNI_PORT=8881
OMNI_API_KEY=sk-...

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/omni

# NATS
NATS_URL=nats://localhost:4222

# Media Processing
GROQ_API_KEY=...          # Audio transcription (primary)
OPENAI_API_KEY=...        # Fallback for audio + images
GEMINI_API_KEY=...        # Images and video (primary)

# OAuth (for channels that need it)
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
WHATSAPP_CLOUD_APP_ID=...
WHATSAPP_CLOUD_APP_SECRET=...

# Feature Flags
OMNI_EVENTS_REALTIME=true
OMNI_LEGACY_WRITE=false   # Enable during migration
```

### Instance Configuration

```typescript
interface InstanceConfig {
  id: string;
  name: string;
  channel: ChannelType;

  // Channel-specific config (stored encrypted)
  channelConfig: {
    // WhatsApp Baileys
    authState?: string;  // Encrypted auth state

    // WhatsApp Cloud
    phoneNumberId?: string;
    accessToken?: string;

    // Discord
    botToken?: string;
    guildIds?: string[];

    // Slack
    workspaceId?: string;
    botToken?: string;
  };

  // Agent configuration
  agent: {
    apiUrl: string;
    apiKey?: string;
    timeout: number;
    streaming: boolean;
  };

  // Message handling
  messaging: {
    debounceMode: 'disabled' | 'fixed' | 'randomized';
    debounceMs?: number;
    debounceMinMs?: number;
    debounceMaxMs?: number;
    enableAutoSplit: boolean;
    splitDelayMs?: number;
  };

  // Media processing
  media: {
    processAudio: boolean;
    processImages: boolean;
    processVideo: boolean;
    processDocuments: boolean;
    processOnBlocked: boolean;
  };

  // Status
  status: 'active' | 'inactive' | 'connecting' | 'error';
  lastConnectedAt?: Date;
}
```

## Scalability

### Horizontal Scaling

```
                    Load Balancer
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌─────────┐     ┌─────────┐     ┌─────────┐
    │ Omni-1  │     │ Omni-2  │     │ Omni-3  │
    │ (API)   │     │ (API)   │     │ (API)   │
    └────┬────┘     └────┬────┘     └────┬────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
                    ┌────┴────┐
                    │  NATS   │
                    │ Cluster │
                    └────┬────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌─────────┐     ┌─────────┐     ┌─────────┐
    │ Worker-1│     │ Worker-2│     │ Worker-3│
    │ (Media) │     │ (Media) │     │ (Media) │
    └─────────┘     └─────────┘     └─────────┘
```

**Key Points:**
- API servers are stateless, scale horizontally
- NATS handles message distribution
- Workers process media in parallel
- PostgreSQL connection pooling (PgBouncer)
- Channel connections pinned to specific instances via NATS KV

### Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Ingest latency p99 | <50ms | Webhook to event stored |
| Query latency (24h) | <100ms | Recent event queries |
| Query latency (all) | <500ms | Historical queries |
| Throughput | 1000 msg/sec | Per instance |
| Concurrent connections | 100+ | WhatsApp/Discord instances |

## Deployment (PM2)

We use PM2 for production deployment. No containers required.

### Prerequisites

```bash
# Install NATS binary (one-time)
curl -L https://github.com/nats-io/nats-server/releases/download/v2.10.22/nats-server-v2.10.22-linux-amd64.tar.gz | tar xz
sudo mv nats-server-v2.10.22-linux-amd64/nats-server /usr/local/bin/

# Create NATS data directory
sudo mkdir -p /var/lib/nats
sudo chown $USER:$USER /var/lib/nats
```

### PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    // NATS JetStream (message broker)
    {
      name: 'nats',
      script: 'nats-server',
      args: '--jetstream --store_dir /var/lib/nats',
      interpreter: 'none',
      autorestart: true,
      watch: false,
    },

    // Omni API Server
    {
      name: 'omni-api',
      script: 'bun',
      args: 'run start:api',
      cwd: '/path/to/omni-v2',
      env: {
        NODE_ENV: 'production',
        PORT: 8881,
      },
      autorestart: true,
      max_memory_restart: '500M',
    },

    // Media Processing Workers
    {
      name: 'omni-workers',
      script: 'bun',
      args: 'run start:workers',
      cwd: '/path/to/omni-v2',
      instances: 2,  // Scale based on load
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_memory_restart: '1G',
    },
  ],
};
```

### Commands

```bash
# Start all services
pm2 start ecosystem.config.js

# View status
pm2 status

# View logs (all services)
pm2 logs

# View logs (specific service)
pm2 logs omni-api

# Monitor resources
pm2 monit

# Restart a service
pm2 restart omni-api

# Restart all
pm2 restart all

# Save current config (auto-start on reboot)
pm2 save
pm2 startup
```

### Health Checks

```bash
# Check NATS is running
curl http://localhost:8222/healthz

# Check API is running
curl http://localhost:8881/api/v2/health
```

## Security

### Authentication
- API key authentication for all endpoints
- Keys stored hashed in database
- Support for multiple keys per tenant

### Encryption
- Channel credentials encrypted at rest (AES-256)
- TLS for all external communications
- NATS TLS for internal event bus

### Access Control
- Per-instance access rules
- Phone number/user ID allow/deny lists
- Rate limiting per identity

### Audit Trail
- All events stored in PostgreSQL
- Immutable event log
- Retention policies configurable

## MCP Integration (Model Context Protocol)

Omni v2 includes an MCP server that enables AI assistants (Claude, Cursor, Windsurf, etc.) to interact with the platform.

### Available Tools

| Tool | Description |
|------|-------------|
| `omni_list_instances` | List all instances with status |
| `omni_get_instance` | Get instance details |
| `omni_send_message` | Send text/media message |
| `omni_search_messages` | Search message history |
| `omni_search_persons` | Find persons across channels |
| `omni_get_person_presence` | Get cross-channel presence |
| `omni_get_timeline` | Get conversation timeline |
| `omni_create_instance` | Create new instance |
| `omni_restart_instance` | Restart connection |

### Running the MCP Server

```bash
# HTTP mode (for web clients)
bun run mcp:http

# Stdio mode (for Claude Desktop)
bun run mcp:stdio
```

### Client Installation

```bash
# Claude Desktop
npx @anthropic/install-mcp omni --url http://localhost:8882/mcp

# Cursor / VSCode
# Add to settings.json:
{
  "mcp.servers": {
    "omni": { "url": "http://localhost:8882/mcp" }
  }
}
```
