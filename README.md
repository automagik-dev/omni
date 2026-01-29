# Omni v2: Universal Event-Driven Omnichannel Platform

> **The universal translator for AI agents to communicate across any messaging platform.**

## Vision

Omni v2 is a complete architectural rebuild focused on:

- **Event-First Architecture** - Every action is an event, enabling real-time processing and complete audit trails
- **True Plug-and-Play Channels** - Add new messaging platforms in days, not weeks
- **Omnipresence Identity** - Unified user identity across all platforms ("show me everything from Mom")
- **LLM-Native Design** - Built-in SDK and CLI optimized for AI agent consumption
- **Production Scale** - Battle-tested patterns for 100+ instances, thousands of concurrent conversations

## Key Improvements Over v1

| Aspect | v1 (Current) | v2 (New) |
|--------|--------------|----------|
| **Language** | Python + TypeScript (mixed) | TypeScript only (unified) |
| **WhatsApp** | Evolution API fork (problematic) | Baileys direct + Official Cloud API |
| **Identity** | Basic user linking | Full identity graph with omnipresence |
| **Events** | Database-centric | Event-driven (NATS JetStream) |
| **Channels** | Hardcoded handlers | True plugin interface with SDK |
| **OAuth** | Per-channel implementations | Centralized OAuth manager |
| **Media** | Inline processing | Event-driven pipeline with retry |
| **Schema** | SQLAlchemy + Prisma (conflicts) | Drizzle ORM (unified) |
| **API** | REST only | REST + tRPC (type-safe) |
| **CLI** | None | LLM-optimized CLI |
| **SDK** | None | Auto-generated SDKs (TS, Python, Go) |

## API Strategy

```
/api/v2/*     ← PRIMARY (all new development)
/api/v1/*     ← COMPATIBILITY LAYER (for current UI during migration)
```

We're building v2 from scratch. v1 endpoints are thin wrappers that allow the existing React UI to work during migration.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              OMNI v2                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │   REST API      │    │    tRPC API     │    │   WebSocket     │     │
│  │   (Hono)        │    │  (Type-safe)    │    │  (Real-time)    │     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│           │                      │                      │               │
│  ┌────────┴──────────────────────┴──────────────────────┴────────┐     │
│  │                     EVENT BUS (NATS JetStream)                 │     │
│  └────────┬──────────────────────┬──────────────────────┬────────┘     │
│           │                      │                      │               │
│  ┌────────▼────────┐    ┌────────▼────────┐    ┌────────▼────────┐     │
│  │    IDENTITY     │    │     MEDIA       │    │     AGENT       │     │
│  │     GRAPH       │    │   PIPELINE      │    │    ROUTER       │     │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘     │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                         CHANNEL PLUGINS                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ WhatsApp │ │ WhatsApp │ │ Discord  │ │  Slack   │ │ Telegram │      │
│  │ (Baileys)│ │ (Cloud)  │ │          │ │          │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                         DATA LAYER                                       │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐  │
│  │   PostgreSQL (Drizzle ORM)   │    │   NATS KV (Session State)    │  │
│  └──────────────────────────────┘    └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key UI Features to Preserve

The current UI has operational features that v2 must support:

- **Service Management** - Start/stop/restart backend services from UI
- **Real-Time Logs** - WebSocket streaming of all backend logs
- **Onboarding Wizard** - Guided setup for new installations
- **Instance QR Codes** - WhatsApp connection flow
- **Batch Media Processing** - Reprocess historical audio/images

## MCP Integration

Omni v2 includes a Model Context Protocol (MCP) server for AI assistant integration:

```bash
# Start MCP server
bun run mcp:http    # HTTP mode for web clients
bun run mcp:stdio   # Stdio mode for Claude Desktop

# Available tools
omni_list_instances, omni_send_message, omni_search_messages,
omni_search_persons, omni_get_timeline, omni_create_instance...
```

Supports Claude Desktop, Cursor, VSCode, Windsurf, and any MCP-compatible client.

## Documentation

### Architecture
- [Architecture Overview](./docs/architecture/overview.md) - High-level system design
- [Event System](./docs/architecture/event-system.md) - Event-driven architecture with NATS
- [Identity Graph](./docs/architecture/identity-graph.md) - Omnipresence and cross-channel identity
- [Plugin System](./docs/architecture/plugin-system.md) - Channel plugin SDK and interface

### API
- [API Design](./docs/api/design.md) - API philosophy and patterns
- [REST Endpoints](./docs/api/endpoints.md) - Complete endpoint reference
- [tRPC Router](./docs/api/trpc.md) - Type-safe API for internal use

### SDK & CLI
- [TypeScript SDK](./docs/sdk/typescript-sdk.md) - Official SDK documentation
- [SDK Auto-Generation](./docs/sdk/auto-generation.md) - How SDKs are auto-generated from schemas
- [CLI Design](./docs/cli/design.md) - LLM-optimized command-line interface
- [CLI Commands](./docs/cli/commands.md) - Complete command reference

### Media Processing
- [Media Pipeline](./docs/media/processing.md) - Audio, image, video, document processing
- [Provider Configuration](./docs/media/providers.md) - Groq, OpenAI, Gemini setup

### Migration
- [Migration Plan](./docs/migration/plan.md) - v1 to v2 migration strategy
- [UI Reuse Strategy](./docs/migration/ui-reuse.md) - Reusing the React dashboard
- [V1 Features Analysis](./docs/migration/v1-features-analysis.md) - What's kept, changed, or dropped

## Quick Start

```bash
# Clone the repository
git clone https://github.com/namastexlabs/omni-v2.git
cd omni-v2

# Install dependencies
bun install

# Setup NATS (one-time)
curl -L https://github.com/nats-io/nats-server/releases/download/v2.10.22/nats-server-v2.10.22-linux-amd64.tar.gz | tar xz
sudo mv nats-server-v2.10.22-linux-amd64/nats-server /usr/local/bin/
sudo mkdir -p /var/lib/nats && sudo chown $USER:$USER /var/lib/nats

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start development
bun dev

# Or start production with PM2
pm2 start ecosystem.config.js
```

## Deployment (PM2)

We use PM2 for production deployment (no containers required):

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'nats',
      script: 'nats-server',
      args: '--jetstream --store_dir /var/lib/nats',
      interpreter: 'none',
    },
    {
      name: 'omni-api',
      script: 'bun',
      args: 'run start:api',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'omni-workers',
      script: 'bun',
      args: 'run start:workers',
      instances: 2,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

```bash
# Start all services
pm2 start ecosystem.config.js

# View logs
pm2 logs

# Monitor
pm2 monit
```

## Project Structure

```
omni-v2/
├── packages/
│   ├── core/                    # Core system (events, identity, schemas)
│   ├── api/                     # HTTP API (Hono + tRPC + OpenAPI)
│   ├── channel-sdk/             # Plugin SDK → published to npm
│   │
│   │   # Official channels (in monorepo)
│   ├── channel-whatsapp/        # WhatsApp (Baileys + Cloud API)
│   ├── channel-discord/         # Discord
│   ├── channel-slack/           # Slack
│   │
│   ├── cli/                     # LLM-optimized CLI
│   ├── sdk/                     # TypeScript SDK (auto-generated)
│   └── mcp/                     # MCP Server for AI assistants
│
├── apps/
│   └── ui/                      # React dashboard (migrated from v1)
│
├── scripts/                     # Build, deploy, SDK generation
├── docs/                        # Documentation
└── ecosystem.config.js          # PM2 configuration
```

**External/Community Channels** (separate npm packages, not in this repo):
```
omni-channel-telegram            # npm install omni-channel-telegram
omni-channel-matrix              # npm install omni-channel-matrix
@yourcompany/omni-sms            # Private npm package
```

## Core Principles

### 1. Event-First
Every action produces an event. Events are the source of truth.

```typescript
// Everything is an event
await eventBus.publish({
  type: 'message.received',
  payload: { ... }
});

// React to events
eventBus.subscribe('message.received', async (event) => {
  // Process message
});
```

### 2. Plugin Architecture
Channels are plugins, not core code. Official channels live in the monorepo; community/custom channels are npm packages.

```typescript
// omni.config.ts
export default defineConfig({
  channels: [
    // Official (monorepo)
    '@omni/channel-whatsapp',
    '@omni/channel-discord',

    // Community (npm install)
    'omni-channel-telegram',

    // Private/local
    './plugins/my-custom-channel',
  ],
});
```

See [Plugin System](./docs/architecture/plugin-system.md) for creating external plugins.

### 3. Identity Unification
One person across all platforms.

```typescript
// Query across all channels
const timeline = await identityService.getPersonTimeline(personId, {
  channels: ['whatsapp', 'discord', 'slack'],
  since: '2025-01-01',
});
```

### 4. LLM-Native
Designed for AI agent consumption.

```bash
# CLI optimized for LLM use
omni messages list --person "Mom" --format json --limit 10
omni send --to "+1234567890" --text "Hello from CLI"
```

### 5. Auto-Generated SDKs
Define schemas once, generate everything else.

```
Zod Schemas → OpenAPI Spec → TypeScript SDK
                          → Python SDK
                          → Go SDK
                          → API Docs (Swagger)
```

See [SDK Auto-Generation](./docs/sdk/auto-generation.md) for details.

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Bun | Fast, TypeScript-native, built-in test runner |
| HTTP | Hono | Lightweight, fast, great middleware |
| Type-safe API | tRPC | End-to-end type safety |
| Database | PostgreSQL + Drizzle | Type-safe ORM, great DX |
| Event Bus | NATS JetStream | Lightweight, persistent, exactly-once delivery |
| WhatsApp | Baileys + Cloud API | Direct WebSocket (unofficial) + Official API |
| Discord | discord.js | Industry standard |
| Slack | @slack/bolt | Official SDK |
| Telegram | grammY | Modern, typed, excellent |
| Frontend | React + Vite | Reused from v1, proven stack |
| Monorepo | Turborepo | Fast builds, caching |

## Roadmap

### Phase 1: Foundation (Weeks 1-4)
- [ ] Core event system with NATS
- [ ] Zod schemas (single source of truth)
- [ ] Database schema (Drizzle)
- [ ] Identity graph implementation
- [ ] Basic API with OpenAPI generation
- [ ] WhatsApp Baileys plugin

### Phase 2: Channels (Weeks 5-8)
- [ ] WhatsApp Cloud API plugin
- [ ] Discord plugin
- [ ] Slack plugin (OAuth flow)
- [ ] Telegram plugin
- [ ] Plugin SDK documentation

### Phase 3: Features (Weeks 9-12)
- [ ] Media processing pipeline
- [ ] Access control system
- [ ] SDK auto-generation pipeline (TS, Python, Go)
- [ ] LLM CLI
- [ ] UI migration with real-time chats

### Phase 4: Production (Weeks 13-16)
- [ ] Performance optimization
- [ ] Monitoring and observability
- [ ] Documentation completion
- [ ] v1 migration tools
- [ ] Production deployment

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.
