---
title: "Architecture Overview"
created: 2025-01-29
updated: 2026-09-08
tags: [architecture, overview]
status: current
---

# Architecture Overview

> Omni v2 is built on event-driven, plugin-based architecture designed for extensibility, reliability, and AI-native consumption.

> Related: [[event-system|Event System]], [[connector-contract|Connector Contract]], [[plugin-system|Plugin System]], [[identity-graph|Identity Graph]], [[provider-system|Provider System]]

## Design Principles

### 1. Event Sourcing Hybrid
- All state changes are captured as events
- Events are journaled to PostgreSQL in a total order (`journal_seq`); NATS is the transport
- The journal is the source of truth for audit, replay, tracing (`causationId`), and durable consumption
- Materialized views provide fast queries

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
- OpenAPI-generated SDKs for type-safe API calls
- Zod for runtime validation

## System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 CLIENTS                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Dashboard  │  │   Omni SDK  │  │  Omni CLI   │  │  Webhook    │        │
│  │  (React)    │  │ (TypeScript)│  │   (LLM)     │  │  Sources    │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               API LAYER                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Hono HTTP Server                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │  REST API   │  │  OpenAPI    │  │  Channel    │  │  Ingress    │  │  │
│  │  │ /api/v2/*   │  │/api/v2/docs │  │  webhooks   │  │ /ingress/*  │  │  │
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
│  │  Streams: MESSAGE | REACTION | INSTANCE | IDENTITY | MEDIA | ACCESS  │  │
│  │           SESSION | CUSTOM | SYSTEM | AGENT                           │  │
│  │  Features: Persistence | At-least-once | Replay | Key-Value Store    │  │
│  │  Journaled to PostgreSQL (omni_events) — the source of truth         │  │
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
│  │WhatsApp │ │WhatsApp │ │ Discord │ │  Slack  │ │Telegram │ │ +7 more │  │
│  │Baileys  │ │ Cloud   │ │         │ │         │ │         │ │         │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│   (also: Gupshup, H3rmes, ASC Flow, Twilio WhatsApp, A2A, Harness,         │
│    Internal — see the README channel table)                                │
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
1. API Request: POST /api/v2/messages/send
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
│   └── src/
│       ├── events/               # Event bus, causality, schema registry
│       │   ├── bus.ts            # NATS JetStream wrapper
│       │   ├── causality.ts      # correlationId/causationId propagation
│       │   ├── schema-registry.ts # Event payload schema validation
│       │   ├── replay.ts         # Journal replay
│       │   ├── payload-store.ts  # Large payload offloading
│       │   ├── dead-letter.ts    # DLQ handling
│       │   ├── nats/             # Streams, consumers, registry
│       │   └── types.ts          # Event type definitions
│       ├── automations/          # Automation engine + actions
│       ├── providers/            # Agent provider factory (webhook, openclaw, …)
│       ├── schemas/              # Zod schemas (messages, agents, manifests, …)
│       ├── connectors/           # Connector liveness contract
│       ├── sessions/ scheduler/ secrets/ egress/ observability/ …
│       └── types/                # Shared TypeScript types
│
├── api/                           # HTTP API
│   └── src/
│       ├── routes/v2/            # All /api/v2 route modules (~40)
│       ├── services/             # Domain services (events, webhooks, tenants, …)
│       ├── plugins/              # Agent dispatcher, event persistence, loader
│       ├── middleware/           # Auth, rate limiting, webhook auth
│       ├── tenancy/              # Multitenancy flags, posture, auth plane
│       ├── ws/                   # Scoped WebSocket handlers (chats, logs, voice)
│       └── index.ts              # Server entry point (auto-migrates on boot)
│
├── db/                            # Drizzle schema + hand-written SQL migrations
├── channel-sdk/                   # Plugin SDK (interfaces, base class, discovery)
├── channel-whatsapp/              # WhatsApp (Baileys)
├── channel-whatsapp-business/     # WhatsApp Cloud API (Meta)
├── channel-discord/               # Discord (incl. voice)
├── channel-slack/                 # Slack
├── channel-telegram/              # Telegram
├── channel-gupshup/               # Gupshup
├── channel-hermes/                # H3rmes (Brazilian WhatsApp gateway)
├── channel-twilio-whatsapp/       # Twilio WhatsApp
├── channel-a2a/                   # A2A protocol server
├── channel-asc-flow/              # ASC platform Flow (Brazilian BSP)
├── channel-harness/               # E2E agent-testing channel
├── channel-internal/              # In-process agent-to-agent routing
├── media-processing/              # Transcription, vision, extraction
├── plugin-openclaw/               # Omni as a channel inside OpenClaw
├── voice-client/                  # Voice transport/codec library
├── cli/                           # LLM-optimized CLI (`omni`)
├── sdk/                           # Auto-generated TypeScript SDK
├── sdk-go/                        # Go SDK
└── sdk-python/                    # Python SDK
```

## Configuration

### Environment Variables

```bash
# Server
API_HOST=0.0.0.0
API_PORT=8882
OMNI_API_KEY=omni_sk_...  # Override primary key (auto-generated on first boot)

# Database (the CLI installer manages PostgreSQL via canonical pgserve and
# writes the URL; source checkouts read .env — see .env.example)
DATABASE_URL=postgresql://postgres:postgres@localhost:8432/omni

# NATS
NATS_URL=nats://localhost:4222

# Media Processing
GROQ_API_KEY=...          # Audio transcription (primary)
OPENAI_API_KEY=...        # Fallback for audio + images
GEMINI_API_KEY=...        # Images and video (primary)

# Feature Flags
A2A_ENABLED=true                     # Mount the A2A channel
OMNI_MULTITENANCY_ENABLED=true       # Mount the /api/v2/platform control plane
OMNI_DB_ENFORCEMENT=on               # Tenant isolation enforcement (RLS)
OMNI_STRICT_EMIT_EVENT_SCHEMAS=true  # Refuse emit_event for unregistered types
```

Set `*_MANAGED=false` for externally managed services. Full list in `.env.example`.

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

We use PM2 for deployment. No containers required.

The easiest path is the CLI installer, which bootstraps the whole runtime
(PostgreSQL via pgserve, NATS, and the API) under PM2:

```bash
bun add -g @automagik/omni
omni install
```

The installer registers `omni-api` and `omni-nats` under PM2 and provisions
PostgreSQL through the canonical pgserve backbone (its own PM2-supervised
process, e.g. `autopg-server`).

For source deployments, the repo ships `ecosystem.config.cjs`, which defines
`omni-v2-nats` and `omni-v2-api` (PostgreSQL is external or pgserve-managed,
per your `.env`):

| Service | PM2 Name (installer / source checkout) | Port |
|---------|----------------------------------------|------|
| API | `omni-api` / `omni-v2-api` | 8882 |
| NATS | `omni-nats` / `omni-v2-nats` | 4222 |
| PostgreSQL | `autopg-server` (canonical pgserve, via `omni install`) | 8432 |

### Commands

```bash
# Start all services (from a source checkout)
pm2 start ecosystem.config.cjs

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
curl http://localhost:8882/api/v2/health
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

## LLM / Agent Integration

There is no MCP server in this repository. AI assistants and agents integrate
with Omni through:

- **The CLI** (`omni`) — designed to be LLM-operable: grouped help, `--json`
  output on every command, and one-shot verbs (`omni say`, `omni open`,
  `omni events wait`)
- **The REST API + SDKs** — OpenAPI-described, so agents can consume the spec
  directly
- **Agent providers** — bind an agent (webhook, OpenClaw, Claude Code, A2A,
  and more) to an instance so it responds to messages; see
  [[provider-system|Provider System]]
- **Agent event manifests** — declare what an agent consumes/publishes and let
  Omni compile the routing; see [[event-system|Event System]]
